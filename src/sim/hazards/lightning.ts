/**
 * 落雷（docs/08 §2）。金属の有無は確率に影響しない（俗説）。
 * pStrikePerMin = 0.004 × thunderLocal² × exposureL × postureF。毎ティック dt 分を掛けて hazard ストリームで判定。
 */
import { chance } from '../core/rng';
import { isForest } from '../terrain/derive';
import { nearestIndex } from '../terrain/sample';
import { VegClass, type ClimberState, type StaticContext, type World } from '../types';
import { injure } from './slip';

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
  const p = strikePerMin(world, ctx, c) * dtMin;
  if (p <= 0 || !chance(world.rng.hazard, p)) return;
  ctx.events.push({ tMin: world.tMin, type: 'LIGHTNING_STRIKE', climberId: c.id, important: true, data: { x: c.x, z: c.z } });
  if (chance(world.rng.hazard, lt.deathP)) {
    injure(world, ctx, c, 'death', 'lightning');
  } else {
    injure(world, ctx, c, 'headInjury', 'lightning');
    c.memo.unconsciousUntilMin = Math.max(c.memo.unconsciousUntilMin ?? 0, world.tMin + lt.struckUnconsciousMin);
  }
  // 近くの仲間は地面を伝わる電流で打撲
  for (const o of world.climbers) {
    if (o === c || !o.body.alive) continue;
    const dx = o.x - c.x;
    const dz = o.z - c.z;
    if (dx * dx + dz * dz <= lt.bystanderM * lt.bystanderM && chance(world.rng.hazard, lt.bystanderP)) injure(world, ctx, o, 'bruise', 'lightning');
  }
}
