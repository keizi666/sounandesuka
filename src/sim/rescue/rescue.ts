/**
 * 救助（docs/08 §5）: 未帰還通報、ヘリと地上隊の出動・捜索・接触。乱数は rescue ストリーム。
 * 接触した時点でその登山者（と近くの仲間）は RESCUED になり、結末が確定する。
 */
import { parseHHMM, parseTimeRef, clockMinOf } from '../core/clock';
import { chance, randRange } from '../core/rng';
import { transition } from '../climber/state';
import { isForest } from '../terrain/derive';
import { nearestIndex } from '../terrain/sample';
import { resolveRoute } from '../terrain/trails';
import type { ClimberState, StaticContext, World } from '../types';
import { sampleLocal } from '../weather/local';

const TERMINAL = new Set(['FINISHED', 'RESCUED', 'DEAD']);

/** 救助を待つ人（下山・救助・死亡済みでなく、営業小屋の中でもない） */
function missing(world: World, ctx: StaticContext): ClimberState[] {
  return world.climbers.filter((c) => {
    if (TERMINAL.has(c.state) && c.state !== 'DEAD') return false;
    if (c.state === 'DEAD') return false;
    const sh = c.body.shelterNodeId ? ctx.map.nodes[c.body.shelterNodeId]?.shelter : undefined;
    return !(sh && sh.kind === 'staffed');
  });
}

/** ヘリが飛べるか（docs/08 §5.2） */
export function heliFlyable(world: World, ctx: StaticContext, x: number, z: number): boolean {
  const rt = ctx.tuning.rescue;
  const sun = ctx.scenario.sun;
  const clock = clockMinOf(world.tMin);
  const light = clock >= parseHHMM(sun.sunrise) + rt.heliAfterSunriseMin && clock <= parseHHMM(sun.sunset) - rt.heliBeforeSunsetMin;
  if (!light) return false;
  const elev = ctx.map.heights[nearestIndex(ctx.map, x, z)]!;
  const l = sampleLocal(world, ctx, x, z, elev);
  return l.visibilityM > rt.heliMinVisM && elev < world.weather.cloudBaseM - rt.heliCloudMarginM && l.windMs < rt.heliMaxWindMs && l.thunder < rt.heliMaxThunder;
}

/** 計画ルート（の登山道の点）までの最短距離 */
function distToPlannedRoute(ctx: StaticContext, x: number, z: number): number {
  let best = Infinity;
  for (const leg of resolveRoute(ctx.map, ctx.scenario.plan.route)) {
    for (const s of ctx.map.trails[leg.edgeId]!.samples) {
      const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

function target(world: World): { x: number; z: number } {
  const e = world.rescue.locationEstimate;
  return e ? { x: e.x, z: e.z } : { x: 0, z: 0 };
}

function start(world: World, ctx: StaticContext): void {
  const rt = ctx.tuning.rescue;
  const r = world.rescue;
  r.heli = { readyAtMin: world.tMin + randRange(world.rng.rescue, rt.heliPrepMinMin, rt.heliPrepMaxMin), nextCheckMin: null, state: 'preparing' };
  const night = world.sun.isDark ? rt.groundNightAddMin : 0;
  r.ground = { readyAtMin: world.tMin + randRange(world.rng.rescue, rt.groundMobMinMin, rt.groundMobMaxMin) + night, x: 0, z: 0, state: 'mobilizing' };
  r.searchRadiusM = rt.searchStartM;
  ctx.events.push({ tMin: world.tMin, type: 'HELI_DISPATCH', important: true });
  ctx.events.push({ tMin: world.tMin, type: 'GROUND_DISPATCH', important: true });
}

/** 見つけやすさの倍率（合図できる・森林や沢の中） */
function findFactor(ctx: StaticContext, c: ClimberState, base: 'heli' | 'ground'): number {
  const rt = ctx.tuning.rescue;
  const i = nearestIndex(ctx.map, c.x, c.z);
  let f = 1;
  if (base === 'heli' && isForest(ctx.map.veg[i]!)) f *= rt.heliFindForestPerH / rt.heliFindPerH;
  if (c.body.conscious && (c.inv.headlamp.on || c.body.inBivy || c.def.gear.whistle)) f *= base === 'heli' ? rt.signalF : rt.groundVoiceF;
  else if (base === 'ground' && c.body.conscious) f *= rt.groundVoiceF;
  if (c.state === 'DESCENDING_DRAINAGE' || ctx.map.stream[i]) f *= rt.deepDrainageF;
  return f;
}

function contact(world: World, ctx: StaticContext, found: ClimberState, by: 'heli' | 'ground'): void {
  const rt = ctx.tuning.rescue;
  for (const c of world.climbers) {
    if (TERMINAL.has(c.state)) continue;
    const dx = c.x - found.x;
    const dz = c.z - found.z;
    if (dx * dx + dz * dz > rt.contactRadiusM * rt.contactRadiusM) continue;
    transition(world, ctx, c, 'RESCUED', by);
    ctx.events.push({ tMin: world.tMin, type: 'RESCUED', climberId: c.id, important: true, data: { by } });
  }
  world.rescue.status = 'contacted';
  world.rescue.heli.state = 'done';
  world.rescue.ground.state = 'done';
}

/** 捜索で見つかるか。見つかった人を返す */
function search(world: World, ctx: StaticContext, perH: number, by: 'heli' | 'ground', dtMin: number): ClimberState | null {
  const r = world.rescue;
  const est = r.locationEstimate;
  for (const c of missing(world, ctx)) {
    // 捜索範囲の中にいるか
    if (est) {
      const dx = c.x - est.x;
      const dz = c.z - est.z;
      if (dx * dx + dz * dz > (est.radiusM + r.searchRadiusM) * (est.radiusM + r.searchRadiusM)) continue;
    } else if (distToPlannedRoute(ctx, c.x, c.z) > r.searchRadiusM) continue;
    const pTick = (perH * findFactor(ctx, c, by) * dtMin) / 60;
    if (chance(world.rng.rescue, Math.min(1, pTick))) return c;
  }
  return null;
}

/** 救助の 1 ティック（docs/03 §4 の 10） */
export function stepRescue(world: World, ctx: StaticContext, dtMin: number): void {
  const rt = ctx.tuning.rescue;
  const r = world.rescue;
  // 未帰還通報（家族が通報する時刻を過ぎても下山の連絡がない）
  const due = ctx.scenario.plan.reportIfNotBackBy;
  if (r.status === 'none' && due !== null && world.tMin >= parseTimeRef(due) && world.flags['familyNotified'] === undefined && missing(world, ctx).length > 0) {
    r.status = 'searching';
    r.via = 'overdue';
    r.calledAtMin = world.tMin;
    r.locationEstimate = null;
    ctx.events.push({ tMin: world.tMin, type: 'RESCUE_CALLED', important: true, data: { via: 'overdue' } });
    start(world, ctx);
    return;
  }
  if (r.status === 'dispatched' && r.heli.state === 'idle') start(world, ctx);
  if (r.status !== 'dispatched' && r.status !== 'searching') return;
  if (missing(world, ctx).length === 0) return;
  // 計画ルートからの捜索範囲は時間とともに広がる
  if (r.via === 'overdue') r.searchRadiusM += (rt.searchGrowMPerH / 60) * dtMin;
  const precise = (r.locationEstimate?.radiusM ?? Infinity) <= rt.preciseM;
  const tgt = target(world);

  // ヘリ
  const h = r.heli;
  if ((h.state === 'preparing' && world.tMin >= (h.readyAtMin ?? Infinity)) || (h.state === 'waiting' && world.tMin >= (h.nextCheckMin ?? Infinity))) {
    if (heliFlyable(world, ctx, tgt.x, tgt.z)) {
      h.state = precise ? 'flying' : 'searching';
      h.readyAtMin = world.tMin + (precise ? rt.heliHoistMin : 0);
    } else {
      h.state = 'waiting';
      h.nextCheckMin = world.tMin + rt.heliRecheckMin;
    }
  } else if (h.state === 'flying' || h.state === 'searching') {
    if (!heliFlyable(world, ctx, tgt.x, tgt.z)) {
      h.state = 'waiting';
      h.nextCheckMin = world.tMin + rt.heliRecheckMin;
    } else if (h.state === 'flying' && world.tMin >= (h.readyAtMin ?? Infinity)) {
      const c = missing(world, ctx)[0];
      if (c) return contact(world, ctx, c, 'heli');
    } else if (h.state === 'searching') {
      const c = search(world, ctx, rt.heliFindPerH, 'heli', dtMin);
      if (c) return contact(world, ctx, c, 'heli');
    }
  }

  // 地上隊
  const g = r.ground;
  if (g.state === 'mobilizing' && world.tMin >= (g.readyAtMin ?? Infinity)) {
    // 最寄りの登山口から目標までの道のり（直線距離 × groundPathF を登山道の速さで）
    let bestD = Infinity;
    for (const nd of Object.values(ctx.map.nodes)) {
      if (nd.type !== 'trailhead') continue;
      const d = Math.sqrt((nd.x - tgt.x) * (nd.x - tgt.x) + (nd.z - tgt.z) * (nd.z - tgt.z));
      if (d < bestD) bestD = d;
    }
    const travelMin = ((bestD * rt.groundPathF) / 1000 / rt.groundTrailKmh) * 60;
    g.state = 'moving';
    g.readyAtMin = world.tMin + (Number.isFinite(travelMin) ? travelMin : 0);
    g.x = tgt.x;
    g.z = tgt.z;
  } else if (g.state === 'moving' && world.tMin >= (g.readyAtMin ?? Infinity)) {
    g.state = 'searching';
    if (precise) {
      const c = missing(world, ctx)[0];
      if (c) return contact(world, ctx, c, 'ground');
    }
  } else if (g.state === 'searching') {
    const visF = world.sun.isDark ? rt.groundNightFindF : 1;
    const c = search(world, ctx, rt.groundFindPerH * visF, 'ground', dtMin);
    if (c) return contact(world, ctx, c, 'ground');
  }
}
