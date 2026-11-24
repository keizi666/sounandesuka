/**
 * 幻覚・幻聴（ユーザーの指定: 遭難したときの症状として生理モデルに入れる。docs/06 §9）。
 * - 原因: 低体温（34℃ を切る）・眠れていない時間（徹夜が続く）・脱水・低血糖・ひどい疲れ・高地脳浮腫。
 *   それぞれの起こりやすさ（0〜1）を「どれか 1 つでも起きる」形で合わせ、症状の強さ（body.halluc.level、0〜1）の目標にする。
 * - 強さ onset 以上: 記録に「幻覚・幻聴が出はじめた」、人の声・人影・明かり・ヘリの音などの一人言やセリフ（仲間がそばにいれば口に出し、
 *   仲間が「何もない」と答える）。判断力 J が下がる（capacity.ts）。
 * - 強さ strong 以上: ひとりでビバーク・待機しているとき、ときどき「明かりが見える」「呼ばれた」と立ち上がって歩き回る。
 *   そのあいだ風よけと地面の断熱を失う（体が冷える）。仲間がいれば引き止める。
 * 一人言・セリフの乱数は thoughts ストリーム（結果に影響させない）、歩き回るかどうかは behavior ストリーム。
 * 眠れていない時間（body.awakeMin）は、夜に止まって寝ているあいだ、眠りの質（小屋・テント > ツェルト > 寒い外）に応じて減る。
 */
import { dexp } from '../core/dmath';
import { chance, nextFloat, randRange } from '../core/rng';
import type { ClimberBody, ClimberState, StaticContext, World } from '../types';
import { amsLevelOf } from './altitude';
import { asleep } from './behavior';
import { piecewise } from './capacity';
import { distortLevel } from './speech';

export type HallucCause = 'cold' | 'sleep' | 'dehyd' | 'sugar' | 'fatigue' | 'altitude';
type HallucState = NonNullable<ClimberBody['halluc']>;

/** 幻覚の中身（一人言・セリフのキーの元。文は i18n） */
const KINDS_DAY = ['voice', 'figure', 'heli', 'presence'] as const;
const KINDS_NIGHT = ['voice', 'figure', 'light', 'presence'] as const;
const KINDS_STRONG = ['home', 'hut'] as const;
/** 止まって夜を過ごす・待つ状態（ここから立ち上がって歩き回ることがある） */
const STILL = new Set(['BIVOUAC', 'STAYING', 'WAITING_RESCUE']);
/** 仲間の声が届く距離（m） */
const NEAR_M = 80;

function stateOf(b: ClimberBody): HallucState {
  if (!b.halluc) b.halluc = { level: 0, max: 0, onsetAtMin: null, nextMin: null, wanderUntilMin: null, wanderSaved: null, strongLogged: false };
  return b.halluc;
}

/** 出発のときに、起きてから経っている時間（分）。夜中の出発なら、出発の少し前に起きた */
function initialAwakeMin(world: World, ctx: StaticContext): number {
  const t = ctx.tuning.hallucination;
  const clock = ((world.tMin % 1440) + 1440) % 1440;
  return clock >= t.wakeClockMin ? clock - t.wakeClockMin : t.nightStartAwakeMin;
}

/** 眠りの質（0〜1） */
function sleepQuality(c: ClimberState, t: StaticContext['tuning']['hallucination']): number {
  const b = c.body;
  if (b.shelterNodeId !== null || c.plan.plannedCamp === true) return t.sleepQualityHut;
  if (b.coreC < t.sleepColdC || b.wetness > t.sleepWetMax) return t.sleepQualityCold;
  return t.sleepQualityBivy;
}

/** 原因ごとの起こりやすさ */
export function hallucCauses(c: ClimberState, ctx: StaticContext): Record<HallucCause, number> {
  const t = ctx.tuning.hallucination;
  const b = c.body;
  const ams = amsLevelOf(b.ams, ctx.tuning);
  return {
    cold: piecewise(t.coreTable, b.coreC),
    sleep: piecewise(t.awakeTable, (b.awakeMin ?? 0) / 60),
    dehyd: piecewise(t.dehydTable, (100 * b.waterDeficitL) / c.def.weightKg),
    sugar: piecewise(t.glycogenTable, b.glycogenKcal),
    fatigue: piecewise(t.fatigueTable, b.fatigue),
    altitude: ams === 'hace' ? t.haceP : ams === 'moderate' ? t.amsModerateP : 0,
  };
}

/** どの原因も起こりやすさ 0 の範囲にいる（計算を省く。表のいちばん低い端より手前） */
function clearOf(c: ClimberState, ctx: StaticContext): boolean {
  const t = ctx.tuning.hallucination;
  const b = c.body;
  const last = (tb: readonly (readonly number[])[]): number => tb[tb.length - 1]![0]!;
  const first = (tb: readonly (readonly number[])[]): number => tb[0]![0]!;
  return (
    b.coreC >= last(t.coreTable) &&
    (b.awakeMin ?? 0) / 60 <= first(t.awakeTable) &&
    (100 * b.waterDeficitL) / c.def.weightKg <= first(t.dehydTable) &&
    b.glycogenKcal >= last(t.glycogenTable) &&
    b.fatigue <= first(t.fatigueTable) &&
    (b.ams ?? 0) < ctx.tuning.altitude.amsModerate
  );
}

/** 症状の強さの目標（どれか 1 つでも起きる確率の形で合わせる）と、いちばん大きい原因 */
export function hallucTarget(c: ClimberState, ctx: StaticContext): { target: number; cause: HallucCause } {
  if (clearOf(c, ctx)) return { target: 0, cause: 'cold' };
  const ps = hallucCauses(c, ctx);
  let keep = 1;
  let cause: HallucCause = 'cold';
  let top = -1;
  for (const [k, p0] of Object.entries(ps) as [HallucCause, number][]) {
    const p = Math.min(1, Math.max(0, p0));
    keep *= 1 - p;
    if (p > top) (top = p), (cause = k);
  }
  return { target: 1 - keep, cause };
}

/** 判断力 J に掛ける係数（症状が出はじめる強さから下がる） */
export function hallucJ(c: ClimberState, t: StaticContext['tuning']): number {
  const h = t.hallucination;
  const lv = c.body.halluc?.level ?? 0;
  return 1 - h.jK * Math.max(0, (lv - h.onset) / (1 - h.onset));
}

/** 声の届く所にいる、意識のある仲間（いちばん近い人） */
function nearMate(world: World, c: ClimberState): ClimberState | null {
  let best: ClimberState | null = null;
  let bd = NEAR_M * NEAR_M;
  for (const o of world.climbers) {
    if (o === c || o.groupId !== c.groupId || !o.body.alive || !o.body.conscious || o.offMap !== c.offMap) continue;
    const d = (o.x - c.x) * (o.x - c.x) + (o.z - c.z) * (o.z - c.z);
    if (d <= bd) (bd = d), (best = o);
  }
  return best;
}

/** 1 ティックぶん進める（step.ts の生理のあと） */
export function stepHallucination(world: World, ctx: StaticContext, c: ClimberState, dtMin: number): void {
  const b = c.body;
  if (!b.alive) return;
  const t = ctx.tuning.hallucination;
  // 眠れていない時間
  if (b.awakeMin === undefined) b.awakeMin = initialAwakeMin(world, ctx);
  // 寝ているかは夜だけ調べる（昼に止まっているのは休んでいるだけ。毎ティックの日の出の計算を省く）
  if (world.sun.isDark && asleep(world, ctx, c)) b.awakeMin = Math.max(0, b.awakeMin - dtMin * t.sleepRecoverPerMin * sleepQuality(c, t));
  else if (b.conscious) b.awakeMin += dtMin;
  // 症状の強さ（下山・救助のあとは、手当てを受けて治まっていく）
  const done = c.state === 'FINISHED' || c.state === 'RESCUED';
  if (!b.halluc && (done || clearOf(c, ctx))) return;
  const { target, cause } = done ? { target: 0, cause: 'cold' as HallucCause } : hallucTarget(c, ctx);
  if (target < 0.01 && !b.halluc) return;
  const h = stateOf(b);
  const tau = target > h.level ? t.riseTauMin : t.fallTauMin;
  h.level += (target - h.level) * (1 - dexp(-dtMin / tau));
  h.max = Math.max(h.max, h.level);
  if (!b.conscious || done) {
    endWander(world, ctx, c, h);
    return;
  }
  // 出はじめ・強くなった（記録に 1 行ずつ）
  if (h.level >= t.onset && h.onsetAtMin === null) {
    h.onsetAtMin = world.tMin;
    ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { halluc: 'onset', cause } });
  }
  if (h.level >= t.strong && !h.strongLogged) {
    h.strongLogged = true;
    ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { halluc: 'strong' } });
  }
  if (h.wanderUntilMin !== null && world.tMin >= h.wanderUntilMin) endWander(world, ctx, c, h);
  if (h.level < t.onset) return;
  speakOrThink(world, ctx, c, h);
  maybeWander(world, ctx, c, h, dtMin);
}

/** 幻覚の一人言・セリフ（結果に影響させない thoughts ストリーム） */
function speakOrThink(world: World, ctx: StaticContext, c: ClimberState, h: HallucState): void {
  const t = ctx.tuning.hallucination;
  const rng = world.rng.thoughts;
  const dim = world.sun.isDark || c.local.visibilityM < 100;
  if (h.nextMin === null) {
    h.nextMin = world.tMin + randRange(rng, 1, t.gapMinMin);
    return;
  }
  if (world.tMin < h.nextMin) return;
  h.nextMin = world.tMin + randRange(rng, t.gapMinMin, t.gapMaxMin) * (dim ? t.gapDarkF : 1);
  const kinds: string[] = [...(world.sun.isDark ? KINDS_NIGHT : KINDS_DAY), ...(h.level >= t.strong ? KINDS_STRONG : [])];
  const kind = kinds[Math.floor(nextFloat(rng) * kinds.length)] ?? 'voice';
  const r = nextFloat(rng);
  const mate = nearMate(world, c);
  c.thoughtHistory[`halluc_${kind}`] = world.tMin;
  // 口に出すのは、言葉がまだ通じるとき（34℃ を切ってろれつが回らなければ、意味の通らない発語になり、仲間の返事がかみ合わない）
  if (mate && nextFloat(rng) < t.sayP && distortLevel(c) < 2) {
    // 口に出す。仲間は「何もない」と答える（仲間も幻覚を見ていれば、つられる）
    ctx.events.push({ tMin: world.tMin, type: 'SPEECH', climberId: c.id, data: { key: `halluc_${kind}_say`, r, to: mate.id, tone: 'normal', distortLevel: distortLevel(c), documented: false, source: null } });
    const r2 = nextFloat(rng);
    const also = (mate.body.halluc?.level ?? 0) >= t.onset;
    if (distortLevel(mate) < 3) {
      ctx.events.push({ tMin: world.tMin, type: 'SPEECH', climberId: mate.id, data: { key: also ? 'halluc_reply_too' : 'halluc_reply', r: r2, to: c.id, tone: 'normal', distortLevel: distortLevel(mate), delaySec: 3 + Math.floor(r2 * 12), documented: false, source: null } });
    }
    return;
  }
  // ひとりなら、呼ぶ声やヘリの音に向かって叫ぶこともある
  if (!mate && (kind === 'voice' || kind === 'heli' || kind === 'light') && r < 0.4 && distortLevel(c) < 2) {
    ctx.events.push({ tMin: world.tMin, type: 'SPEECH', climberId: c.id, data: { key: 'halluc_shout', r: nextFloat(rng), to: null, tone: 'shout', distortLevel: distortLevel(c), documented: false, source: null } });
    return;
  }
  ctx.events.push({ tMin: world.tMin, type: 'THOUGHT', climberId: c.id, data: { key: `halluc_${kind}`, r } });
}

/** 強い症状で、ひとりで止まっているときに、立ち上がって歩き回る（風よけと地面の断熱を失う） */
function maybeWander(world: World, ctx: StaticContext, c: ClimberState, h: HallucState, dtMin: number): void {
  const t = ctx.tuning.hallucination;
  const b = c.body;
  if (h.level < t.strong || h.wanderUntilMin !== null || !STILL.has(c.state) || b.shelterNodeId !== null) return;
  if (b.injury === 'legFracture' || b.injury === 'severeTrauma' || c.M < 0.1) return;
  // 仲間がそばにいれば引き止める
  if (nearMate(world, c)) return;
  if (!chance(world.rng.behavior, (t.wanderPerHour * dtMin) / 60)) return;
  h.wanderSaved = { lee: b.leeShelter, ground: b.groundInsulation, bivy: b.inBivy };
  b.leeShelter = 0;
  b.groundInsulation = false;
  b.inBivy = false;
  h.wanderUntilMin = world.tMin + randRange(world.rng.behavior, t.wanderMinMin, t.wanderMaxMin);
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { halluc: world.sun.isDark ? 'wanderLight' : 'wanderVoice' } });
}

/** 歩き回るのをやめて、元の場所に戻る（止まっている状態のままなら、風よけと断熱を戻す） */
function endWander(world: World, ctx: StaticContext, c: ClimberState, h: HallucState): void {
  if (h.wanderUntilMin === null) return;
  const saved = h.wanderSaved;
  h.wanderUntilMin = null;
  h.wanderSaved = null;
  if (saved && STILL.has(c.state) && c.body.alive) {
    c.body.leeShelter = saved.lee;
    c.body.groundInsulation = saved.ground;
    c.body.inBivy = saved.bivy;
    if (c.body.conscious) ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, data: { halluc: 'wanderEnd' } });
  }
}
