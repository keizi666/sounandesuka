/**
 * 判断力 J・運動能力 M（docs/06 §6）と、低体温症の段階・意識・生死（§7）。
 */
import { chance } from '../core/rng';
import { TUNING, type Tuning } from '../tuning';
import type { ClimberBody, ClimberState, StaticContext, World } from '../types';
import { amsJ, amsM } from './altitude';
import { illnessM } from './illness';
import { bacPct } from './physiology';
import { transition } from './state';

/** [x, y] の昇順の表を線形補間（範囲外は端の値） */
export function piecewise(table: readonly (readonly number[])[], x: number): number {
  const first = table[0]!;
  if (x <= first[0]!) return first[1]!;
  for (let i = 1; i < table.length; i += 1) {
    const a = table[i - 1]!;
    const b = table[i]!;
    if (x <= b[0]!) return a[1]! + ((b[1]! - a[1]!) * (x - a[0]!)) / (b[0]! - a[0]!);
  }
  return table[table.length - 1]![1]!;
}

/** 脱水による係数（J と使える MET） */
export function dehydrationF(deficitL: number, tuning: Tuning = TUNING): { j: number; met: number } {
  const k = tuning.capacity;
  if (deficitL > k.dehydHighL) return { j: k.dehydHighJ, met: k.dehydHighMet };
  if (deficitL > k.dehydMidL) return { j: k.dehydMidJ, met: k.dehydMidMet };
  return { j: 1, met: 1 };
}

/** 熱疲労になる体温（脱水していると下がる） */
export function heatExhaustionAtC(c: ClimberState, tuning: Tuning = TUNING): number {
  const k = tuning.capacity;
  const pct = (100 * c.body.waterDeficitL) / c.def.weightKg;
  return Math.max(k.heatExhaustionMinC, k.heatExhaustionC - k.heatExhaustionDehydPerPct * Math.max(0, pct - k.heatExhaustionDehydFromPct));
}

export function computeJ(c: ClimberState, tuning: Tuning = TUNING): number {
  const k = tuning.capacity;
  const b = c.body;
  const j0 = k.j0Base + k.j0PerExperience * c.def.experience;
  const fCore = piecewise(k.coreJ, b.coreC);
  const fGly = b.glycogenKcal < tuning.movement.lowGlycogenKcal ? k.lowGlycogenJ : 1;
  const f = b.fatigue / 100;
  const fFat = 1 - k.fatigueJK * f * f;
  const fAnx = b.anxiety > k.anxietyHigh ? k.anxietyHighJ : b.anxiety > k.anxietyMid ? k.anxietyMidJ : 1;
  const fDehyd = dehydrationF(b.waterDeficitL, tuning).j;
  const fHead = b.injury === 'headInjury' ? k.headInjuryJ : 1;
  const fHeat = b.coreC >= heatExhaustionAtC(c, tuning) ? k.heatExhaustionJ : 1;
  const fAlc = Math.max(0.5, 1 - k.alcoholJK * bacPct(c, tuning));
  const fHealth = k.healthJ[c.def.health ?? 'good'] ?? 1;
  const j = j0 * fCore * fGly * fFat * fAnx * fDehyd * fHead * fHeat * fAlc * fHealth * amsJ(c, tuning);
  return Math.min(1, Math.max(k.jMin, j));
}

export function computeM(c: ClimberState, tuning: Tuning = TUNING): number {
  const k = tuning.capacity;
  const b = c.body;
  if (!b.alive || !b.conscious) return 0;
  const fCore = piecewise(k.coreM, b.coreC);
  const fInj = k.injuryM[b.injury];
  const fGly = b.glycogenKcal < k.veryLowGlycogenKcal ? k.veryLowGlycogenM : 1;
  const fDehyd = piecewise(k.dehydM, (100 * b.waterDeficitL) / c.def.weightKg);
  let m = illnessM(c, fCore * fInj * fGly * fDehyd);
  m *= k.healthM[c.def.health ?? 'good'] ?? 1;
  // 高山病（ユーザーの指定）
  m *= amsM(c, tuning);
  if (b.coreC >= k.heatStrokeC) m = Math.min(m, k.heatStrokeM);
  else if (b.coreC >= heatExhaustionAtC(c, tuning)) m *= k.heatExhaustionSpeed;
  return Math.min(1, Math.max(0, m));
}

/** 体温の段階（docs/06 §7、高体温を含む） */
export function stageOf(coreC: number, tuning: Tuning = TUNING, exhaustionAtC: number = tuning.capacity.heatExhaustionC): ClimberBody['stage'] {
  const p = tuning.physiology;
  const k = tuning.capacity;
  if (coreC >= k.heatStrokeC) return 'heatStroke';
  if (coreC >= exhaustionAtC) return 'heatExhaustion';
  if (coreC >= p.stageColdC) return 'normal';
  if (coreC >= p.stageMildC) return 'cold';
  if (coreC >= p.stageModerateC) return 'mild';
  if (coreC >= p.stageSevereC) return 'moderate';
  return 'severe';
}

const TERMINAL = new Set(['FINISHED', 'RESCUED', 'DEAD']);
/** 動けなくなっても状態を変えない（すでに横になって待っている） */
const LYING_OK = new Set(['INCAPACITATED', 'SHELTERED', 'BIVOUAC', 'WAITING_RESCUE']);

function die(world: World, ctx: StaticContext, c: ClimberState, cause: 'hypothermia' | 'heat'): void {
  c.body.alive = false;
  c.body.conscious = false;
  c.body.deathCause = cause;
  c.J = 0;
  c.M = 0;
  transition(world, ctx, c, 'DEAD', cause);
  ctx.events.push({ tMin: world.tMin, type: 'DEATH', climberId: c.id, important: true, data: { cause } });
}

/**
 * 段階・意識・生死を更新し、J・M を計算する（docs/03 §4 の 8h）。
 * 心停止・熱中症の意識喪失は arrestCheckMin ごとに hazard ストリームで判定する。
 */
export function updateCapacity(world: World, ctx: StaticContext, c: ClimberState, checkTick: boolean): void {
  const p = ctx.tuning.physiology;
  const k = ctx.tuning.capacity;
  const b = c.body;
  if (!b.alive) return;

  const stage = stageOf(b.coreC, ctx.tuning, heatExhaustionAtC(c, ctx.tuning));
  if (stage !== b.stage) {
    const from = b.stage;
    b.stage = stage;
    ctx.events.push({ tMin: world.tMin, type: 'STAGE_CHANGE', climberId: c.id, important: true, data: { from, to: stage, coreC: b.coreC } });
  }

  // 生死
  if (b.coreC <= p.deathCoreC) return die(world, ctx, c, 'hypothermia');
  if (b.coreC >= p.heatDeathC) return die(world, ctx, c, 'heat');
  if (checkTick && b.coreC < p.arrestBelowC) {
    const pr = p.arrestBase + p.arrestPerC * (p.arrestBelowC - b.coreC);
    if (chance(world.rng.hazard, pr)) {
      ctx.events.push({ tMin: world.tMin, type: 'CARDIAC_ARREST', climberId: c.id, important: true });
      return die(world, ctx, c, 'hypothermia');
    }
  }

  // 意識
  let conscious = b.coreC >= p.unconsciousBelowC;
  // 頭部外傷による意識喪失（docs/06 §7 負傷の表）
  const ku = c.memo.unconsciousUntilMin;
  if (ku !== null) {
    if (world.tMin < ku) conscious = false;
    else c.memo.unconsciousUntilMin = null;
  }
  if (conscious && b.coreC >= k.heatStrokeC) {
    // 熱中症: 一度失った意識は体温が下がるまで戻らない
    conscious = b.conscious && !(checkTick && chance(world.rng.hazard, p.heatStrokeUnconsciousP));
  }
  // 高地脳浮腫が続くと意識がなくなる（altitude.ts。下ろして点が下がるまで）
  if ((b.haceMin ?? 0) >= ctx.tuning.altitude.haceUnconsciousH * 60) conscious = false;
  b.conscious = conscious;

  c.J = b.conscious ? computeJ(c, ctx.tuning) : 0;
  c.M = computeM(c, ctx.tuning);

  // 体から決まる状態遷移
  if (TERMINAL.has(c.state)) return;
  if (!b.conscious) {
    if (c.state !== 'UNCONSCIOUS') transition(world, ctx, c, 'UNCONSCIOUS', 'core');
  } else if (c.state === 'UNCONSCIOUS') {
    transition(world, ctx, c, c.M > 0 ? 'STAYING' : 'INCAPACITATED', 'regained');
  } else if (c.M <= 0 && !LYING_OK.has(c.state)) {
    transition(world, ctx, c, 'INCAPACITATED', 'M0');
  }
}
