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
import type { ClimberState, NodeId, SearchLeadDef, StaticContext, World } from '../types';
import { sampleLocal } from '../weather/local';
import { blindHeliFind, cocoheliFind, distToPlannedRoute, whereaboutsUnknown } from './heliSearch';

const TERMINAL = new Set(['FINISHED', 'RESCUED', 'DEAD']);

/** まだ下山していない人（下山・救助・死亡済みでない）。小屋の中の人も含む */
function missing(world: World, _ctx: StaticContext): ClimberState[] {
  return world.climbers.filter((c) => !TERMINAL.has(c.state));
}

/** 小屋の中で元気にしている人（見つかっても収容せず、無事を確認するだけ） */
function safeInHut(c: ClimberState): boolean {
  return c.body.shelterNodeId !== null && c.body.injury === 'none' && c.body.coreC >= 35;
}

export type HeliNoGo = 'night' | 'cloud' | 'visibility' | 'precip' | 'wind' | 'thunder';
export type GroundNoGo = 'night' | 'weather';

/** まわり r m の中でいちばん高い所（m） */
function ridgeTop(ctx: StaticContext, x: number, z: number, r: number): number {
  const map = ctx.map;
  const k = Math.max(1, Math.round(r / map.cell));
  const cx = Math.round((x + map.half) / map.cell);
  const cz = Math.round((z + map.half) / map.cell);
  let top = -Infinity;
  const step = Math.max(1, Math.floor(k / 12));
  for (let dz = -k; dz <= k; dz += step)
    for (let dx = -k; dx <= k; dx += step) {
      if (dx * dx + dz * dz > k * k) continue;
      const ix = cx + dx;
      const iz = cz + dz;
      if (ix < 0 || iz < 0 || ix >= map.n || iz >= map.n) continue;
      top = Math.max(top, map.heights[iz * map.n + ix]!);
    }
  return top;
}

/**
 * ヘリが飛べない理由（飛べるなら null）。救助ヘリは有視界飛行で、地上を目で見て飛ぶ（docs/08 §5.2）。
 * 夜（日の出の少し後〜日の入りの 1 時間前のほかは飛ばない）、雲（目標やまわりの尾根が雲に入っている・低い雲が空を覆う）、
 * 視界（1,500 m 未満）、強い雨や雪、強い風、雷のどれかがあれば飛ばない。
 */
export function heliNoGo(world: World, ctx: StaticContext, x: number, z: number): HeliNoGo | null {
  const rt = ctx.tuning.rescue;
  const sun = ctx.scenario.sun;
  const clock = clockMinOf(world.tMin);
  const light = clock >= parseHHMM(sun.sunrise) + rt.heliAfterSunriseMin && clock <= parseHHMM(sun.sunset) - rt.heliBeforeSunsetMin;
  if (!light) return 'night';
  const elev = ctx.map.heights[nearestIndex(ctx.map, x, z)]!;
  const g = world.weather;
  if (elev + rt.heliCloudClearM >= g.cloudBaseM || ridgeTop(ctx, x, z, rt.heliRidgeRadiusM) >= g.cloudBaseM) return 'cloud';
  if (g.cloudCover >= rt.heliOvercastCover && g.cloudBaseM < elev + rt.heliOvercastAboveM) return 'cloud';
  const l = sampleLocal(world, ctx, x, z, elev);
  if (l.thunder >= rt.heliMaxThunder) return 'thunder';
  if (l.visibilityM < rt.heliMinVisM) return 'visibility';
  if (l.precipMmH > rt.heliMaxPrecipMmH) return 'precip';
  if (l.windMs * g.gust >= rt.heliMaxWindMs) return 'wind';
  return null;
}

/** ヘリが飛べるか */
export function heliFlyable(world: World, ctx: StaticContext, x: number, z: number): boolean {
  return heliNoGo(world, ctx, x, z) === null;
}

/**
 * 地上の救助隊が山で動けない理由（動けるなら null）。夜は山に入らない（日の出から、日の入りの 30 分前まで）。
 * 強い雨・強い風・雷・目の前も見えない霧や吹雪では出発を見合わせ、捜索も止める（二次遭難を避ける）。
 */
export function groundNoGo(world: World, ctx: StaticContext, x: number, z: number): GroundNoGo | null {
  const rt = ctx.tuning.rescue;
  const sun = ctx.scenario.sun;
  const clock = clockMinOf(world.tMin);
  if (clock < parseHHMM(sun.sunrise) || clock > parseHHMM(sun.sunset) - rt.groundBeforeSunsetMin) return 'night';
  const elev = ctx.map.heights[nearestIndex(ctx.map, x, z)]!;
  const l = sampleLocal(world, ctx, x, z, elev);
  if (l.precipMmH > rt.groundMaxPrecipMmH || l.windMs * world.weather.gust >= rt.groundMaxWindMs || l.thunder >= rt.groundMaxThunder || l.visibilityM < rt.groundMinVisM) return 'weather';
  return null;
}

/** 見合わせの理由が変わったときだけ、ログに 1 行出す（null は「動きはじめた」） */
function holdLog(world: World, ctx: StaticContext, by: 'heli' | 'ground', reason: string | null): void {
  const key = `hold:${by}`;
  const prev = Object.keys(world.latches).find((k) => k.startsWith(`${key}:`) && world.latches[k]) ?? null;
  const now = reason ? `${key}:${reason}` : null;
  if (prev === now) return;
  if (prev) world.latches[prev] = false;
  if (now) world.latches[now] = true;
  // 動きはじめは、それまで見合わせていたときだけ知らせる
  if (!now && !prev) return;
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', important: true, data: { rescueHold: reason ?? 'go', by } });
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

/** 通報された場所の近くにいるか */
function nearReported(ctx: StaticContext, c: ClimberState, tgt: { x: number; z: number }): boolean {
  const d2 = (c.x - tgt.x) * (c.x - tgt.x) + (c.z - tgt.z) * (c.z - tgt.z);
  return d2 <= ctx.tuning.rescue.movedAwayM * ctx.tuning.rescue.movedAwayM;
}

/**
 * 通報された場所に着いたが、そこにいない（動いてしまった）。電話が通じれば、かけ直して今の場所を確かめ、向かい直す（その分遅れる）。
 * 通じなければ、通報された場所のまわりを探す（探す範囲は時間とともに広げる。見つけにくい）
 */
function notThere(world: World, ctx: StaticContext, by: 'heli' | 'ground'): void {
  const rt = ctx.tuning.rescue;
  const r = world.rescue;
  const reach = missing(world, ctx).find((c) => {
    const ph = c.inv.phone;
    return c.body.conscious && ph.has && !ph.dead && ph.batteryPct > 0 && (ctx.map.radio[nearestIndex(ctx.map, c.x, c.z)] ?? 0) >= ctx.tuning.radio.callableMin;
  });
  if (reach) {
    r.locationEstimate = { x: reach.x, z: reach.z, radiusM: reach.inv.phone.gpsApp ? rt.preciseM : 300 };
    ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: reach.id, important: true, data: { rescueRelocated: true } });
    if (by === 'heli') r.heli = { readyAtMin: null, nextCheckMin: world.tMin + rt.relocateMin, state: 'waiting' };
    else {
      const d = Math.sqrt((reach.x - r.ground.x) * (reach.x - r.ground.x) + (reach.z - r.ground.z) * (reach.z - r.ground.z));
      r.ground = { readyAtMin: world.tMin + rt.relocateMin + ((d * rt.groundPathF) / 1000 / rt.groundTrailKmh) * 60, x: reach.x, z: reach.z, state: 'moving' };
    }
    return;
  }
  if (world.flags['rescueNotThere'] === undefined) {
    world.flags['rescueNotThere'] = world.tMin;
    ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', important: true, data: { rescueNotThere: true } });
  }
  // 正確な場所ではなくなった。まわりを探す
  if (r.locationEstimate) r.locationEstimate = { ...r.locationEstimate, radiusM: Math.max(r.locationEstimate.radiusM, rt.searchStartM) };
  if (by === 'heli') r.heli.state = 'searching';
  else r.ground.state = 'searching';
}

/** 見つけやすさの倍率（合図できる・森林や沢の中） */
function findFactor(ctx: StaticContext, c: ClimberState, base: 'heli' | 'ground', est: { x: number; z: number } | null = null): number {
  const rt = ctx.tuning.rescue;
  const i = nearestIndex(ctx.map, c.x, c.z);
  let f = 1;
  // 通報した場所から離れているほど見つけにくい（動かないのが基本）
  if (est) {
    const d = Math.sqrt((c.x - est.x) * (c.x - est.x) + (c.z - est.z) * (c.z - est.z));
    f /= 1 + (d / rt.movedFindScaleM) * (d / rt.movedFindScaleM);
  }
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
    // 収容された人は、その場に残らない（ヘリなら病院へ、地上の救助隊なら一緒に下山）。3D から消え、居場所を出す
    if (!c.offMap) c.offMap = by === 'heli' ? 'ヘリで病院' : '救助隊と下山';
  }
  if (safeInHut(found)) ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: found.id, data: { foundSafe: true } });
  // 別の場所からも通報があれば（要救助者が複数いて、それぞれ通報した）、覚えていた通報の場所へ近い順に向かう（ユーザーの指定）。
  // 地上隊は今の場所から登山道の速さで歩き、ヘリは吊り上げの後に次の場所が飛べるかを見る（飛べるか・入れるかは天気と時刻しだい）
  const r = world.rescue;
  const byId = new Map(world.climbers.map((c) => [c.id, c]));
  // 通報した人がもう収容された・下山した通報は消す
  const reports = (r.reports ?? []).filter((x) => {
    const c = byId.get(x.by);
    return c !== undefined && !TERMINAL.has(c.state) && c.offMap === undefined;
  });
  r.reports = reports;
  let pick = -1;
  let bd = Infinity;
  reports.forEach((x, i) => {
    const d = (x.x - found.x) * (x.x - found.x) + (x.z - found.z) * (x.z - found.z);
    if (d < bd) {
      bd = d;
      pick = i;
    }
  });
  if (pick >= 0) {
    const next = reports.splice(pick, 1)[0]!;
    r.status = 'dispatched';
    r.locationEstimate = { x: next.x, z: next.z, radiusM: next.radiusM };
    const travelMin = ((Math.sqrt(bd) * rt.groundPathF) / 1000 / rt.groundTrailKmh) * 60;
    r.ground = { readyAtMin: world.tMin + travelMin, x: next.x, z: next.z, state: 'moving' };
    r.heli = { readyAtMin: null, nextCheckMin: world.tMin + rt.heliHoistMin, state: 'waiting' };
    return;
  }
  // 通報のない人がまだ山に残っていれば、居場所は分からないので探す（収容した人の話から、本当の位置へまっすぐ向かうことはしない）
  if (missing(world, ctx).some((c) => !safeInHut(c))) {
    r.status = 'searching';
    r.locationEstimate = null;
    r.searchRadiusM = rt.searchStartM;
    r.heli = { readyAtMin: null, nextCheckMin: world.tMin + rt.heliHoistMin, state: 'waiting' };
    r.ground = { readyAtMin: world.tMin, x: found.x, z: found.z, state: 'searching' };
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
  const people = missing(world, ctx);
  // ヘリ: ココヘリの電波は居場所が分からなくてもとらえる。持たずに居場所の分からない人は、探した時間で決まる低い率でしか見つからない
  const blind: ClimberState[] = [];
  if (by === 'heli') {
    const beacon = cocoheliFind(world, ctx, people, dtMin);
    if (beacon) return beacon;
    for (const c of people) if (c.def.gear.cocoheli !== true && whereaboutsUnknown(ctx, c, est, lead?.route)) blind.push(c);
  }
  for (const c of people) {
    if (blind.includes(c)) continue;
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
    const pTick = (perH * findFactor(ctx, c, by, est) * (lead?.findF ?? 1) * dtMin) / 60;
    if (chance(world.rng.rescue, Math.min(1, pTick))) return c;
  }
  return blindHeliFind(world, ctx, blind, dtMin);
}

/** 家族・仲間が届け出る（reportMissing のアクション）。次のティックで未帰還の通報として扱う */
export function reportMissing(world: World, by?: string): void {
  if (world.flags['reportedMissing'] === undefined) world.flags['reportedMissing'] = world.tMin;
  if (by && world.rescue.reportedBy === undefined) world.rescue.reportedBy = by;
}

/** 困っていて、通りかかった人に助けを頼む状態 */
const DISTRESS = new Set(['LOST_AWARE', 'STAYING', 'WAITING_RESCUE', 'BIVOUAC', 'INCAPACITATED', 'UNCONSCIOUS', 'SEEKING_SIGNAL']);

/** 通りかかる登山者（scenario.passersby）。困っている人に気づけば、下山して正確な場所を通報してくれる */
function stepPassersby(world: World, ctx: StaticContext, dtMin: number): void {
  const defs = ctx.scenario.passersby;
  if (!defs || defs.length === 0 || world.sun.isDark) return;
  const r = world.rescue;
  if (r.status === 'dispatched' || r.status === 'contacted') return;
  const clock = clockMinOf(world.tMin);
  const day = Math.floor(world.tMin / 1440);
  for (const p of defs) {
    if (p.fromDay !== undefined && day < p.fromDay) continue;
    if (p.from && clock < parseHHMM(p.from)) continue;
    if (p.to && clock > parseHHMM(p.to)) continue;
    if (!chance(world.rng.rescue, (p.perHour * dtMin) / 60)) continue;
    // その道を一組が通った。道からの距離で気づくか
    for (const c of world.climbers) {
      if (TERMINAL.has(c.state) || !DISTRESS.has(c.state)) continue;
      let d = Infinity;
      for (const e of p.edges) for (const s of ctx.map.trails[e]?.samples ?? []) d = Math.min(d, (s.x - c.x) * (s.x - c.x) + (s.z - c.z) * (s.z - c.z));
      d = Math.sqrt(d);
      const reach = c.body.conscious ? (c.def.gear.whistle ? (p.whistleM ?? 300) : (p.voiceM ?? 120)) : (p.seeM ?? 40);
      if (d > Math.max(reach, p.seeM ?? 40)) continue;
      r.status = 'dispatched';
      r.via = 'passerby';
      r.calledAtMin = world.tMin;
      r.locationEstimate = { x: c.x, z: c.z, radiusM: ctx.tuning.rescue.preciseM };
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { passerby: true } });
      ctx.events.push({ tMin: world.tMin, type: 'RESCUE_CALLED', climberId: c.id, important: true, data: { via: 'passerby' } });
      return;
    }
  }
}

/** 救助の 1 ティック（docs/03 §4 の 10） */
export function stepRescue(world: World, ctx: StaticContext, dtMin: number): void {
  const rt = ctx.tuning.rescue;
  const r = world.rescue;
  stepPassersby(world, ctx, dtMin);
  // 未帰還通報（家族が通報する時刻を過ぎても下山の連絡がない。または家族・仲間が届け出た）
  const due = ctx.scenario.plan.reportIfNotBackBy;
  const dueNow = (due !== null && world.tMin >= parseTimeRef(due) && world.flags['familyNotified'] === undefined) || world.flags['reportedMissing'] !== undefined;
  if (r.status === 'none' && dueNow && missing(world, ctx).length > 0) {
    r.status = 'searching';
    r.via = 'overdue';
    r.calledAtMin = world.tMin;
    r.locationEstimate = null;
    // 届け出た人と、予定の時刻を過ぎたからか（それより前の相談か）
    const scheduled = due !== null && world.tMin >= parseTimeRef(due) && world.flags['reportedMissing'] === undefined;
    ctx.events.push({ tMin: world.tMin, type: 'RESCUE_CALLED', important: true, data: { via: 'overdue', by: r.reportedBy ?? '', scheduled } });
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
  const searchingNow = r.ground.state === 'searching' || r.heli.state === 'searching';
  if ((r.via === 'overdue' || r.locationEstimate === null || world.flags['rescueNotThere'] !== undefined) && searchingNow) r.searchRadiusM += (rt.searchGrowMPerH / 60) * dtMin;
  const precise = (r.locationEstimate?.radiusM ?? Infinity) <= rt.preciseM;
  const tgt = target(world);

  // ヘリ
  const h = r.heli;
  if ((h.state === 'preparing' && world.tMin >= (h.readyAtMin ?? Infinity)) || (h.state === 'waiting' && world.tMin >= (h.nextCheckMin ?? Infinity))) {
    const ng = heliNoGo(world, ctx, tgt.x, tgt.z);
    if (!ng) {
      h.state = precise ? 'flying' : 'searching';
      h.readyAtMin = world.tMin + (precise ? rt.heliHoistMin : 0);
      holdLog(world, ctx, 'heli', null);
    } else {
      h.state = 'waiting';
      h.nextCheckMin = world.tMin + rt.heliRecheckMin;
      holdLog(world, ctx, 'heli', ng);
    }
  } else if (h.state === 'flying' || h.state === 'searching') {
    const ng = heliNoGo(world, ctx, tgt.x, tgt.z);
    if (ng) {
      h.state = 'waiting';
      h.nextCheckMin = world.tMin + rt.heliRecheckMin;
      holdLog(world, ctx, 'heli', ng);
    } else if (h.state === 'flying' && world.tMin >= (h.readyAtMin ?? Infinity)) {
      const c = nearestMissing(world, ctx, tgt);
      if (c && nearReported(ctx, c, tgt)) return contact(world, ctx, c, 'heli');
      if (c) notThere(world, ctx, 'heli');
    } else if (h.state === 'searching') {
      const c = search(world, ctx, rt.heliFindPerH, 'heli', dtMin);
      if (c) return contact(world, ctx, c, 'heli');
    }
  }

  // 地上隊: 夜・悪天候では山に入らず、捜索も止めて下山する（翌朝・天気の回復を待って、登山口から入り直す）
  const g = r.ground;
  const active = g.state === 'mobilizing' || g.state === 'moving' || g.state === 'searching' || g.state === 'standby';
  if (active) {
    const ng = groundNoGo(world, ctx, tgt.x, tgt.z);
    if (ng) {
      if (g.state === 'moving' || g.state === 'searching' || (g.state === 'mobilizing' && world.tMin >= (g.readyAtMin ?? Infinity))) {
        g.state = 'standby';
        // いったん見合わせたら、しばらくは様子を見る（天気がしきい値の近くで揺れても出入りを繰り返さない）
        g.readyAtMin = world.tMin + rt.groundHoldMinMin;
        holdLog(world, ctx, 'ground', ng);
      }
    } else if (g.state === 'standby' && world.tMin >= (g.readyAtMin ?? 0)) {
      // 隊はもう集まっている。登山口から入り直す
      g.state = 'mobilizing';
      g.readyAtMin = world.tMin;
      holdLog(world, ctx, 'ground', null);
    }
  }
  if (g.state === 'mobilizing' && world.tMin >= (g.readyAtMin ?? Infinity)) {
    // 最寄りの登山口から目標までの道のり（直線距離 × groundPathF を登山道の速さで）
    let bestD = Infinity;
    // 登山口がない地図では、範囲の外から道が入ってくる境界点から入る
    const hasTrailhead = Object.values(ctx.map.nodes).some((nd) => nd.type === 'trailhead');
    for (const nd of Object.values(ctx.map.nodes)) {
      if (nd.type !== 'trailhead' && (hasTrailhead || nd.type !== 'boundary')) continue;
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
      if (c && nearReported(ctx, c, tgt)) return contact(world, ctx, c, 'ground');
      if (c) notThere(world, ctx, 'ground');
    }
  } else if (g.state === 'searching') {
    const c = search(world, ctx, rt.groundFindPerH, 'ground', dtMin);
    if (c) return contact(world, ctx, c, 'ground');
  }
}
