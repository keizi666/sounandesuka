/**
 * 落雷（docs/08 §2）。金属の有無は確率に影響しない（俗説）。
 * pStrikePerMin = 0.004 × thunderLocal² × exposureL × postureF。毎ティック dt 分を掛けて hazard ストリームで判定。
 */
import { chance } from '../core/rng';
import { isForest } from '../terrain/derive';
import { nearestIndex } from '../terrain/sample';
import { VegClass, type ClimberState, type StaticContext, type World } from '../types';
import { injure } from './slip';
import { groundAt } from '../weather/ground';

export function lightningExposure(world: World, ctx: StaticContext, c: ClimberState): number {
  const lt = ctx.tuning.lightning;
  if (c.body.shelterNodeId) return 0;
  const map = ctx.map;
  for (const nd of Object.values(map.nodes)) {
    if (nd.type !== 'peak') continue;
    const dx = nd.x - c.x;
    const dz = nd.z - c.z;
    if (dx * dx + dz * dz <= lt.summitRadiusM * lt.summitRadiusM) return lt.exposureSummit;
  }
  const i = nearestIndex(map, c.x, c.z);
  const veg = map.veg[i]!;
  const tpi = map.tpi[i]!;
  if (isForest(veg)) return lt.exposureForest;
  if (veg === VegClass.STREAM || tpi < lt.hollowTpi) return lt.exposureHollow;
  if (tpi > lt.ridgeTpi && (veg === VegClass.ALPINE || veg === VegClass.ROCK)) return lt.exposureRidge;
  return lt.exposureOpen;
}

/** 1 分あたりの被雷確率 */
export function strikePerMin(world: World, ctx: StaticContext, c: ClimberState): number {
  const lt = ctx.tuning.lightning;
  const th = c.local.thunder;
  if (th <= 0) return 0;
  const posture = c.plan.postureUntilMin !== null && world.tMin < c.plan.postureUntilMin ? lt.postureF : 1;
  return lt.perMinK * th * th * lightningExposure(world, ctx, c) * posture;
}

export function lightningCheck(world: World, ctx: StaticContext, c: ClimberState, dtMin: number): void {
  if (!c.body.alive) return;
  const lt = ctx.tuning.lightning;
  const p = (strikePerMin(world, ctx, c) * dtMin * clusterShare(world, c, lt.groundM, lt.clusterK));
  if (p <= 0 || !chance(world.rng.hazard, p)) return;
  ctx.events.push({ tMin: world.tMin, type: 'LIGHTNING_STRIKE', climberId: c.id, important: true, data: { x: c.x, z: c.z } });
  if (chance(world.rng.hazard, lt.deathP)) {
    injure(world, ctx, c, 'death', 'lightning');
  } else {
    injure(world, ctx, c, 'headInjury', 'lightning');
    c.memo.unconsciousUntilMin = Math.max(c.memo.unconsciousUntilMin ?? 0, world.tMin + lt.struckUnconsciousMin);
  }
  groundCurrent(world, ctx, c);
}

/** 群れの中の一人の受け持ち（近くに n 人いれば (1 + k(n − 1)) / n） */
function clusterShare(world: World, c: ClimberState, r: number, k: number): number {
  let n = 1;
  for (const o of world.climbers) {
    if (o === c || !o.body.alive || o.body.shelterNodeId) continue;
    const dx = o.x - c.x;
    const dz = o.z - c.z;
    if (dx * dx + dz * dz <= r * r) n += 1;
  }
  return (1 + k * (n - 1)) / n;
}

/**
 * 地面を伝わる電流・側撃: 打たれた人の近くにいる人も、近いほど強く受ける。地面が濡れていると遠くまで届く。
 * 1 回の落雷で何人もが倒れる（ユーザーの指定。s16 西穂高 1967）。小屋の中の人は受けない
 */
function groundCurrent(world: World, ctx: StaticContext, c: ClimberState): void {
  const lt = ctx.tuning.lightning;
  const wet = groundAt(world.ground, c.elevM).wet > lt.groundWetAbove;
  const r = wet ? lt.groundWetM : lt.groundM;
  let hit = 0;
  for (const o of world.climbers) {
    if (o === c || !o.body.alive || o.body.shelterNodeId) continue;
    const dx = o.x - c.x;
    const dz = o.z - c.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r * r) continue;
    const k = 1 - Math.sqrt(d2) / r;
    const posture = o.plan.postureUntilMin !== null && world.tMin < o.plan.postureUntilMin ? lt.postureF : 1;
    if (chance(world.rng.hazard, lt.groundDeathP * k * k * posture)) {
      injure(world, ctx, o, 'death', 'lightning');
      hit += 1;
    } else if (chance(world.rng.hazard, lt.groundKnockP * k * posture)) {
      injure(world, ctx, o, 'headInjury', 'lightning');
      o.memo.unconsciousUntilMin = Math.max(o.memo.unconsciousUntilMin ?? 0, world.tMin + lt.struckUnconsciousMin * k);
      hit += 1;
    } else if (chance(world.rng.hazard, lt.bystanderP * k)) injure(world, ctx, o, 'bruise', 'lightning');
  }
  if (hit > 0) ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { groundCurrent: hit } });
}
