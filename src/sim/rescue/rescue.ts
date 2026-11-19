/**
 * 救助（docs/08 §5）: 未帰還通報、ヘリと地上隊の出動・捜索・接触。乱数は rescue ストリーム。
 * 接触した時点でその登山者（と近くの仲間）は RESCUED になり、結末が確定する。
 */
import { parseHHMM, parseTimeRef, clockMinOf } from '../core/clock';
import { chance, randRange } from '../core/rng';
import { partyLeader } from '../climber/party';
import { transition } from '../climber/state';
import { evalCondition } from '../scenario/conditions';
import { isForest } from '../terrain/derive';
import { nearestIndex } from '../terrain/sample';
import { resolveRoute } from '../terrain/trails';
import type { ClimberState, NodeId, SearchLeadDef, StaticContext, World } from '../types';
import { sampleLocal } from '../weather/local';

const TERMINAL = new Set(['FINISHED', 'RESCUED', 'DEAD']);

/** まだ下山していない人（下山・救助・死亡済みでない）。小屋の中の人も含む */
function missing(world: World, _ctx: StaticContext): ClimberState[] {
  return world.climbers.filter((c) => !TERMINAL.has(c.state));
}

/** 小屋の中で元気にしている人（見つかっても収容せず、無事を確認するだけ） */
function safeInHut(c: ClimberState): boolean {
  return c.body.shelterNodeId !== null && c.body.injury === 'none' && c.body.coreC >= 35;
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

const routePtsCache = new WeakMap<readonly NodeId[], Float64Array>();

/** ルート（の登山道の点）までの最短距離。既定は計画ルート */
function distToPlannedRoute(ctx: StaticContext, x: number, z: number, route: readonly NodeId[] = ctx.scenario.plan.route): number {
  let pts = routePtsCache.get(route);
  if (!pts) {
    const arr: number[] = [];
    for (const leg of resolveRoute(ctx.map, [...route])) for (const s of ctx.map.trails[leg.edgeId]!.samples) arr.push(s.x, s.z);
    pts = Float64Array.from(arr);
    routePtsCache.set(route, pts);
  }
  let best = Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i]! - x;
    const dz = pts[i + 1]! - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
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
    if (TERMINAL.has(c.state) || safeInHut(c)) continue;
    const dx = c.x - found.x;
    const dz = c.z - found.z;
    if (dx * dx + dz * dz > rt.contactRadiusM * rt.contactRadiusM) continue;
    transition(world, ctx, c, 'RESCUED', by);
    ctx.events.push({ tMin: world.tMin, type: 'RESCUED', climberId: c.id, important: true, data: { by } });
  }
  if (safeInHut(found)) ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: found.id, data: { foundSafe: true } });
  // 別の場所にまだ人が残っていれば（パーティが分かれた場合）、収容した人から場所を聞いて、近い順に向かう。
  // 地上隊は今の場所から登山道の速さで歩き、ヘリは吊り上げの後に次の場所が飛べるかを見る
  const r = world.rescue;
  let next: ClimberState | undefined;
  let bd = Infinity;
  for (const c of world.climbers) {
    if (TERMINAL.has(c.state) || safeInHut(c)) continue;
    const d = (c.x - found.x) * (c.x - found.x) + (c.z - found.z) * (c.z - found.z);
    if (d < bd) {
      bd = d;
      next = c;
    }
  }
  if (next) {
    r.status = 'dispatched';
    r.locationEstimate = { x: next.x, z: next.z, radiusM: rt.preciseM };
    const travelMin = ((Math.sqrt(bd) * rt.groundPathF) / 1000 / rt.groundTrailKmh) * 60;
    r.ground = { readyAtMin: world.tMin + travelMin, x: next.x, z: next.z, state: 'moving' };
    r.heli = { readyAtMin: null, nextCheckMin: world.tMin + rt.heliHoistMin, state: 'waiting' };
    return;
  }
  r.status = 'contacted';
  r.heli.state = 'done';
  r.ground.state = 'done';
}

/** 通報された位置にいちばん近い、まだ収容されていない人 */
function nearestMissing(world: World, ctx: StaticContext, tgt: { x: number; z: number }): ClimberState | undefined {
  let best: ClimberState | undefined;
  let bd = Infinity;
  for (const c of missing(world, ctx)) {
    const d = (c.x - tgt.x) * (c.x - tgt.x) + (c.z - tgt.z) * (c.z - tgt.z);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/**
 * 捜索側が今つかんでいる手がかり（いちばん新しいもの）。シナリオに searchLeads がなければ undefined（計画ルートを探す）、
 * あるのにまだ何も分かっていなければ null（どこを探せばよいか分からない）
 */
function activeLead(world: World, ctx: StaticContext): SearchLeadDef | null | undefined {
  const leads = ctx.scenario.plan.searchLeads;
  if (!leads || leads.length === 0) return undefined;
  let best: SearchLeadDef | null = null;
  const scope = { world, map: ctx.map, scenario: ctx.scenario, leader: partyLeader(world) };
  for (const l of leads) {
    if (world.tMin < parseTimeRef(l.at)) continue;
    if (l.when && !evalCondition(l.when, scope, `lead:${l.id}`)) continue;
    best = l;
  }
  return best;
}

/** 捜索で見つかるか。見つかった人を返す */
function search(world: World, ctx: StaticContext, perH: number, by: 'heli' | 'ground', dtMin: number): ClimberState | null {
  const r = world.rescue;
  const est = r.locationEstimate;
  const lead = est ? undefined : activeLead(world, ctx);
  if (lead === null) return null;
  for (const c of missing(world, ctx)) {
    // 捜索範囲の中にいるか
    if (est) {
      const dx = c.x - est.x;
      const dz = c.z - est.z;
      if (dx * dx + dz * dz > (est.radiusM + r.searchRadiusM) * (est.radiusM + r.searchRadiusM)) continue;
    } else if (lead) {
      // 笛を持っていて意識があれば、地上隊には探す範囲の少し外からでも聞こえる
      const extra = by === 'ground' && c.body.conscious && c.def.gear.whistle ? ctx.tuning.rescue.whistleExtraM : 0;
      if (distToPlannedRoute(ctx, c.x, c.z, lead.route) > Math.min(r.searchRadiusM, lead.maxRadiusM ?? Infinity) + extra) continue;
    } else if (distToPlannedRoute(ctx, c.x, c.z) > r.searchRadiusM) continue;
    const pTick = (perH * findFactor(ctx, c, by) * (lead?.findF ?? 1) * dtMin) / 60;
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
    // 行き先の手がかりが何もなければ、届け出は受けても捜索隊は出せない（手がかりが分かった時点で出る）
    if (activeLead(world, ctx) === null) {
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', important: true, data: { noLead: true } });
      return;
    }
    start(world, ctx);
    return;
  }
  if (r.status === 'dispatched' && r.heli.state === 'idle') start(world, ctx);
  if (r.status !== 'dispatched' && r.status !== 'searching') return;
  if (missing(world, ctx).length === 0) return;
  // 新しい手がかりが分かったら知らせ、その道の周りを最初から探し直す
  if (r.via === 'overdue' && r.locationEstimate === null) {
    const lead = activeLead(world, ctx);
    if (lead && world.flags[`lead:${lead.id}`] === undefined) {
      world.flags[`lead:${lead.id}`] = world.tMin;
      r.searchRadiusM = rt.searchStartM;
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', text: lead.text, important: true, data: { searchLead: lead.id } });
      // 最初の手がかりで、はじめて捜索隊が出る
      if (r.heli.state === 'idle') start(world, ctx);
    }
  }
  // 計画ルートからの捜索範囲は時間とともに広がる
  if (r.via === 'overdue' || r.locationEstimate === null) r.searchRadiusM += (rt.searchGrowMPerH / 60) * dtMin;
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
      const c = nearestMissing(world, ctx, tgt);
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
      const c = nearestMissing(world, ctx, tgt);
      if (c) return contact(world, ctx, c, 'ground');
    }
  } else if (g.state === 'searching') {
    const visF = world.sun.isDark ? rt.groundNightFindF : 1;
    const c = search(world, ctx, rt.groundFindPerH * visF, 'ground', dtMin);
    if (c) return contact(world, ctx, c, 'ground');
  }
}
