/**
 * 渡渉と沢の増水（ユーザーの指定: ゲリラ豪雨での沢の増水・渡渉。屋久島）。
 * - 水位: 渡渉点ごとに、上流の地点の雨の強さから目標の水位を出し、増えるときは riseMin、引くときは fallMin の時定数で近づける（1 分ごと）。
 *   上流で強い雨が降ると、渡渉点で降っていなくても水が増える。雨がやめば、しばらくして引く。
 * - 渡る（行動 ford）: グループの一人ずつ、水位（子どもは背が低いので深く感じる）で、足を取られる・流される危険を hazard ストリームで引く。
 *   ロープで 1 人ずつ確保すると、危険は下がるが時間がかかる。流されたら、岸に打ち上げられる・けが・溺れる（亡くなる）
 */
import { dexp } from '../core/dmath';
import { chance, nextFloat } from '../core/rng';
import { sampleBilinear } from '../terrain/sample';
import { sampleLocal } from '../weather/local';
import type { ClimberState, FordDef, InjuryKind, StaticContext, World } from '../types';
import { injure } from './slip';
import { soak } from '../climber/actions';
import { transition } from '../climber/state';

/** 亡くなる（溺れる・窒息・高地脳浮腫など、けがでない死因） */
export function killWith(world: World, ctx: StaticContext, c: ClimberState, cause: 'drowning' | 'asphyxia' | 'hace'): void {
  c.body.alive = false;
  c.body.conscious = false;
  c.body.deathCause = cause;
  c.J = 0;
  c.M = 0;
  transition(world, ctx, c, 'DEAD', cause);
  ctx.events.push({ tMin: world.tMin, type: 'DEATH', climberId: c.id, important: true, data: { cause } });
}

/** 渡渉点の水位を 1 分ぶん進める（渡渉点がなければ何もしない） */
export function updateFords(world: World, ctx: StaticContext, dtMin = 1): void {
  const fords = ctx.scenario.fords;
  if (!fords || fords.length === 0) return;
  const levels = (world.fords ??= {});
  for (const f of fords) {
    const x = f.catchX ?? f.x;
    const z = f.catchZ ?? f.z;
    const elev = sampleBilinear(ctx.map, ctx.map.heights, x, z);
    const rain = sampleLocal(world, ctx, x, z, elev).precipMmH;
    const target = f.baseCm + f.gainCmPerMmH * rain;
    const cur = levels[f.id] ?? f.baseCm;
    const tau = target > cur ? f.riseMin : f.fallMin;
    levels[f.id] = cur + (target - cur) * (1 - dexp(-dtMin / Math.max(1, tau)));
  }
}

export function fordLevelCm(world: World, f: FordDef): number {
  return world.fords?.[f.id] ?? f.baseCm;
}

/** 結果の表（重み）から 1 つ引く */
function pickOutcome(world: World, table: Record<string, number>): InjuryKind | 'death' {
  const keys = Object.keys(table);
  const total = keys.reduce((s, k) => s + (table[k] ?? 0), 0);
  let r = nextFloat(world.rng.hazard) * total;
  for (const k of keys) {
    r -= table[k] ?? 0;
    if (r < 0) return k as InjuryKind | 'death';
  }
  return keys[keys.length - 1] as InjuryKind | 'death';
}

/**
 * グループで渡渉点を渡る。渡るあいだは手がふさがる（busy）。結果はログ（SCRIPT_LOG の ford・swept）に出す。
 * 渡りきった人も、水に入った深さに応じて濡れる
 */
export function crossFord(world: World, ctx: StaticContext, members: readonly ClimberState[], fordId: string, rope: boolean): void {
  const f = ctx.scenario.fords?.find((x) => x.id === fordId);
  if (!f) return;
  const t = ctx.tuning.ford;
  const level = fordLevelCm(world, f);
  const minutes = t.crossMin * (rope ? t.ropeTimeF : 1);
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: members[0]?.id, important: true, data: { ford: f.name, levelCm: Math.round(level), rope } });
  for (const c of members) {
    if (!c.body.alive || !c.body.conscious) continue;
    const depth = level * (c.def.age <= t.childAge ? t.childDepthF : 1);
    const ropeF = rope ? t.ropeF : 1;
    // 濡れる深さ
    soak(world, ctx, c, depth < 25 ? 'feet' : depth < 50 ? 'knees' : depth < 80 ? 'waist' : 'full', false);
    let swept = false;
    if (depth >= f.sweepCm) {
      const p = Math.min(t.sweptMaxP, t.sweptP + (t.sweptPer10Cm * (depth - f.sweepCm)) / 10) * ropeF;
      swept = chance(world.rng.hazard, p);
    } else if (depth >= f.wadeCm && chance(world.rng.hazard, t.slipP * ropeF)) {
      // 足を取られた: たいていは転んで濡れるだけ。まれに流される
      swept = chance(world.rng.hazard, t.slipSweptP * ropeF);
      if (!swept) {
        soak(world, ctx, c, 'full', false);
        const k = pickOutcome(world, t.slipOutcomes);
        ctx.events.push({ tMin: world.tMin, type: 'FALL', climberId: c.id, important: k !== 'none', data: { ford: f.name, slipped: true, injury: k } });
        if (k !== 'none') injure(world, ctx, c, k, 'trauma');
      }
    }
    if (swept) {
      soak(world, ctx, c, 'full', false);
      const k = pickOutcome(world, t.sweptOutcomes);
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { swept: f.name, injury: k } });
      if (k === 'death') {
        killWith(world, ctx, c, 'drowning');
        continue;
      }
      if (k !== 'none') injure(world, ctx, c, k, 'trauma');
    }
    if (c.body.alive && c.plan.busyUntilMin === null) {
      c.plan.busyUntilMin = world.tMin + minutes;
      c.plan.busyWith = 'ford';
    }
  }
}
