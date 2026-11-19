/**
 * ナビゲーション（docs/07 §3）: 手がかりの見えにくさ、分岐での誤り、踏み外し、気づき、軌跡、道外の 1 歩、
 * 位置確認、風下の避難地点・電波・稜線を外れる先の探索。判定は nav ストリーム。
 * 道迷いの判断はグループのリーダーが行い、仲間はリーダーに従う（party.ts）。
 */
import { datan2, dcos, DEG, dlog, dsin } from '../core/dmath';
import { chance, nextFloat } from '../core/rng';
import { findPath, trailCells } from '../terrain/pathing';
import { isInside, nearestIndex, sampleElev, vertexX, vertexZ } from '../terrain/sample';
import { pointOnTrail, shortestPath, type RouteLeg } from '../terrain/trails';
import { VegClass, type ClimberState, type EdgeId, type NodeId, type StaticContext, type World } from '../types';
import { groundAt } from '../weather/ground';
import { goToNode, setRoute } from './route';
import { transition } from './state';

function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
}

const OFF_MODES = new Set(['OFFROUTE_UNAWARE', 'LOST_AWARE', 'DESCENDING_DRAINAGE', 'NAVIGATING_TO_TRAIL', 'BACKTRACKING', 'SEEKING_SIGNAL']);

/** 手がかりの見えにくさ 0..1（docs/07 §3.1） */
export function cueOf(world: World, ctx: StaticContext, c: ClimberState): number {
  const n = ctx.tuning.nav;
  const visCue = Math.min(1, Math.max(0, 1 - c.local.visibilityM / n.visCueM));
  const darkCue = world.sun.isDark ? (c.inv.headlamp.on ? n.darkCueLamp : n.darkCueNoLamp) : world.sun.twilight ? n.twilightCue : 0;
  const snow = groundAt(world.ground, c.elevM).snowCm;
  const snowCue = snow > n.snowCueDeepCm ? n.snowCueDeep : snow > n.snowCueCm ? n.snowCue : 0;
  return Math.max(visCue, darkCue, snowCue);
}

export function navEffOf(c: ClimberState): number {
  return c.def.navSkill * c.J;
}

function phoneOk(c: ClimberState): boolean {
  return c.inv.phone.has && !c.inv.phone.dead && c.inv.phone.batteryPct > 0;
}

/** 正規ルート上の最後の地点を覚える */
function rememberOnRoute(c: ClimberState, edgeId: EdgeId, s: number, x: number, z: number): void {
  c.nav.lastKnownOnRoute = { edgeId, s, x, z };
  c.nav.track = [[x, z]];
  c.nav.trackCheckM = 0;
}

/** 分岐での誤りの確率（docs/07 §3.2）。ps は紛らわしい道ごと、pErr は全体 */
export function confuserErrorP(ctx: StaticContext, c: ClimberState, node: NodeId, leg: RouteLeg, cue: number): { ps: number[]; pErr: number } {
  const nt = ctx.tuning.nav;
  const confs = (ctx.map.nodes[node]?.confusers ?? []).filter((k) => k.whenIntending.includes(leg.edgeId));
  const eff = navEffOf(c);
  const markers = ctx.map.trails[leg.edgeId]!.def.markers;
  const ps = confs.map((k) => {
    let p = k.ambiguity * (nt.errCueBase + nt.errCueK * cue) * (1 - nt.errNavK * eff) * (nt.errMarkBase - markers * nt.errMarkK);
    if (c.plan.stopCheckedNode === node) p *= nt.errStopCheckedF;
    if (c.def.habits.gpsCheckEveryMin !== null && phoneOk(c) && c.inv.phone.gpsApp) p *= nt.errGpsHabitF;
    // 焦っている・動揺しているときは、分岐の道標や向きの確認を飛ばしやすい
    // 落ち着いているとき（不安 20 まで）は変わらない。不安 100 で ×(1 + k)
    p *= 1 + (nt.errAnxietyK * Math.max(0, c.body.anxiety - 20)) / 80;
    return Math.max(0, p);
  });
  return { ps, pErr: Math.min(nt.errMax, 1 - ps.reduce((acc, p) => acc * (1 - p), 1)) };
}

/**
 * ノードで次のエッジを選ぶ（docs/07 §3.2）。誤れば偽の道か別の正規の道に入る。
 * 返り値の leg に進む。偽の道なら falseEdge を返し、呼び出し側が位置を置く。
 */
export function chooseLegAtNode(world: World, ctx: StaticContext, c: ClimberState, node: NodeId, leg: RouteLeg): { leg: RouteLeg } | { falseEdge: EdgeId } {
  const nt = ctx.tuning.nav;
  const nd = ctx.map.nodes[node];
  const confs = (nd?.confusers ?? []).filter((k) => k.whenIntending.includes(leg.edgeId));
  if (confs.length === 0) return { leg };
  const { ps, pErr } = confuserErrorP(ctx, c, node, leg, cueOf(world, ctx, c));
  if (c.plan.stopCheckedNode === node) c.plan.stopCheckedNode = null;
  if (!chance(world.rng.nav, pErr)) return { leg };
  // 誤り: p_k に比例して選ぶ
  const total = ps.reduce((a, b) => a + b, 0);
  let r = nextFloat(world.rng.nav) * total;
  let k = 0;
  while (k < ps.length - 1 && r >= ps[k]!) r -= ps[k++]!;
  const wrong = confs[k]!.edge;
  const intendedStartS = leg.dir === 1 ? 0 : ctx.map.trails[leg.edgeId]!.lengthM;
  rememberOnRoute(c, leg.edgeId, intendedStartS, nd!.x, nd!.z);
  c.perception.routeBelief = { edgeId: leg.edgeId, s: intendedStartS };
  c.nav.offrouteSinceMin = world.tMin;
  const wdef = ctx.map.trails[wrong]!.def;
  if (wdef.kind === 'false') {
    c.nav.falseEdgeId = wrong;
    transition(world, ctx, c, 'OFFROUTE_UNAWARE', 'falseTrail');
    ctx.events.push({ tMin: world.tMin, type: 'OFFROUTE', climberId: c.id, important: true, data: { edge: wrong, node } });
    return { falseEdge: wrong };
  }
  // 別の正規の道: 本人は正しいと思って歩き続ける
  const other = wdef.from === node ? wdef.to! : wdef.from;
  ctx.events.push({ tMin: world.tMin, type: 'OFFROUTE', climberId: c.id, important: true, data: { edge: wrong, node, wrongTrail: true } });
  return { leg: { edgeId: wrong, dir: wdef.from === node ? 1 : -1, from: node, to: other } };
}

/** 別の正規の道を歩いて予定外のノードに着いたとき（道標を見て気づくか） */
export function onWrongNode(world: World, ctx: StaticContext, c: ClimberState, node: NodeId, viaEdge: EdgeId): void {
  const nt = ctx.tuning.nav;
  if (c.nav.offrouteSinceMin === null) return;
  const visCue = Math.min(1, Math.max(0, 1 - c.local.visibilityM / nt.visCueM));
  const markers = ctx.map.trails[viaEdge]?.def.markers ?? 0;
  const p = (nt.signBase + nt.signMarkersK * markers) * (1 - visCue * nt.signVisCueK);
  if (chance(world.rng.nav, p)) {
    becomeAware(world, ctx, c, true);
    return;
  }
  // 気づかない: 道標どおりに次の予定ノードへ向かう（遠回りになる）
  const target = c.plan.route[c.plan.routeIndex];
  const path = target ? shortestPath(ctx.map, node, target, ctx.tuning) : null;
  if (path && target) setRoute(ctx, c, [...path, ...c.plan.route.slice(c.plan.routeIndex + 1)]);
  c.nav.offrouteSinceMin = null;
  c.perception.routeBelief = null;
}

/** 道を外れて道外へ（踏み外し・偽の道の末端） */
export function goOffTrail(world: World, ctx: StaticContext, c: ClimberState, headingRad: number, reason: string): void {
  if (c.state === 'WALKING' && c.pos.mode === 'edge') {
    rememberOnRoute(c, c.pos.edgeId, c.pos.s, c.x, c.z);
    c.perception.routeBelief = { edgeId: c.pos.edgeId, s: c.pos.s };
    c.nav.offrouteSinceMin = world.tMin;
    ctx.events.push({ tMin: world.tMin, type: 'OFFROUTE', climberId: c.id, important: true, data: { reason } });
  }
  c.pos = { mode: 'free', x: c.x, z: c.z };
  c.nav.beliefDirRad = headingRad;
  c.nav.path = [];
  c.nav.falseEdgeId = null;
  if (c.state !== 'OFFROUTE_UNAWARE') transition(world, ctx, c, 'OFFROUTE_UNAWARE', reason);
}

/** 道迷いに気づく（docs/07 §3.5） */
export function becomeAware(world: World, ctx: StaticContext, c: ClimberState, knowsWhere = false): void {
  c.perception.awareLost = true;
  c.perception.knowsPosition = knowsWhere;
  c.nav.path = [];
  transition(world, ctx, c, 'LOST_AWARE', 'aware');
  ctx.events.push({ tMin: world.tMin, type: 'LOST_AWARE', climberId: c.id, important: true });
}

/** 気づきの判定（毎分、OFFROUTE_UNAWARE のとき） */
export function awarenessCheck(world: World, ctx: StaticContext, c: ClimberState): void {
  const nt = ctx.tuning.nav;
  const eff = navEffOf(c);
  let p = nt.awareBase + nt.awareNavK * eff;
  if (c.pos.mode === 'free') {
    const v = ctx.map.veg[nearestIndex(ctx.map, c.x, c.z)]!;
    if (v === VegClass.BROADLEAF || v === VegClass.CONIFER || v === VegClass.KRUMMHOLZ) p += nt.awareBushP;
  }
  if (c.memo.trailVanishedAtMin !== null && world.tMin - c.memo.trailVanishedAtMin <= nt.awareVanishedMin) p += nt.awareVanishedP;
  const every = c.def.habits.gpsCheckEveryMin;
  if (every !== null && phoneOk(c) && c.inv.phone.gpsApp) {
    const last = c.inv.phone.lastCheckMin ?? c.nav.offrouteSinceMin ?? world.tMin;
    if (world.tMin - last >= every) {
      c.inv.phone.lastCheckMin = world.tMin;
      c.inv.phone.batteryPct = Math.max(0, c.inv.phone.batteryPct - nt.gpsCheckBatteryPct);
      p += 1;
    }
  }
  if (c.body.anxiety > nt.awareAnxietyAbove) p *= nt.awareAnxietyF;
  if (chance(world.rng.nav, p)) becomeAware(world, ctx, c, false);
}

/** 10 m 進むごとの判定（踏み外し・偽の道の消失・軌跡・見失い・推定位置） */
export function per10m(world: World, ctx: StaticContext, c: ClimberState): void {
  const nt = ctx.tuning.nav;
  if (OFF_MODES.has(c.state)) {
    const last = c.nav.track[c.nav.track.length - 1];
    if (!last || dist(last[0], last[1], c.x, c.z) >= nt.trackPointM) c.nav.track.push([c.x, c.z]);
  }
  if (c.state === 'WALKING' && c.pos.mode === 'edge') {
    const e = ctx.map.trails[c.pos.edgeId]!.def;
    // 動揺している・けがをしている・冷えて頭が回らないときは、見えている道でも外しやすい（遭難のあとに正しく歩けるとは限らない）
    const stress = (1 + (nt.driftAnxietyK * c.body.anxiety) / 100) * (nt.driftInjury[c.body.injury] ?? 1) * (1 + nt.driftColdK * Math.max(0, 35.5 - c.body.coreC));
    const p = ((e.drift * nt.driftScale) / 10) * cueOf(world, ctx, c) * (1 - nt.driftNavK * navEffOf(c)) * (1 + c.body.fatigue / 100) * stress;
    if (chance(world.rng.nav, p)) goOffTrail(world, ctx, c, c.headingRad, 'drift');
    return;
  }
  if (c.state === 'OFFROUTE_UNAWARE' && c.pos.mode === 'edge') {
    // 偽の道: fadeOutM の区間で踏み跡が薄れ、末端で消える
    const t = ctx.map.trails[c.pos.edgeId]!;
    const fade = t.def.fadeOutM ?? 0;
    const remain = t.lengthM - c.pos.s;
    const f = fade > 0 ? Math.min(1, Math.max(0, 1 - remain / fade)) : 0;
    const p10 = (t.def.drift + (1 - t.def.drift) * f) / 10;
    if (remain <= 1 || (f > 0 && chance(world.rng.nav, p10))) {
      c.memo.trailVanishedAtMin = world.tMin;
      goOffTrail(world, ctx, c, c.headingRad, 'trailVanished');
    }
  }
  if (c.state === 'BACKTRACKING') {
    c.nav.trackCheckM += 10;
    if (c.nav.trackCheckM >= nt.trackLoseEveryM) {
      c.nav.trackCheckM = 0;
      if (!(c.inv.phone.trackRecording && phoneOk(c))) {
        const p = (1 - navEffOf(c)) * nt.trackLoseK * (nt.trackLoseBase + cueOf(world, ctx, c));
        if (chance(world.rng.nav, p)) {
          c.nav.beliefDirRad = c.headingRad;
          c.nav.path = [];
          c.perception.awareLost = false;
          transition(world, ctx, c, 'OFFROUTE_UNAWARE', 'lostTrack');
        }
      }
    }
  }
  // 推定位置は計画ルート上を進んでいると思い込む
  const b = c.perception.routeBelief;
  if (b && c.state === 'OFFROUTE_UNAWARE') {
    const t = ctx.map.trails[b.edgeId];
    if (t) b.s = Math.min(t.lengthM, Math.max(0, b.s + 10));
  }
  if (c.perception.knowsPosition && c.perception.knowsPositionAt) {
    const k = c.perception.knowsPositionAt;
    if (dist(k.x, k.z, c.x, c.z) > nt.knowsPositionForgetM && c.pos.mode === 'free') c.perception.knowsPosition = false;
  }
}

/** 道外の効用の 1 歩（docs/07 §3.4、沢下りは §3.6）。行き先の格子点を返す */
export function utilityStep(world: World, ctx: StaticContext, c: ClimberState, drainage: boolean): [number, number] | null {
  const nt = ctx.tuning.nav;
  const map = ctx.map;
  const n = map.n;
  const i0 = nearestIndex(map, c.x, c.z);
  const x0 = i0 % n;
  const z0 = (i0 - x0) / n;
  const h0 = map.heights[i0]!;
  const vis = c.local.visibilityM;
  const canSee = vis > nt.cliffSeenMinVisM && !(world.sun.isDark && !c.inv.headlamp.on);
  const belief = c.nav.beliefDirRad ?? c.headingRad;
  let best = -Infinity;
  let bestI = -1;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dz === 0) continue;
      const x = x0 + dx;
      const z = z0 + dz;
      if (x < 0 || z < 0 || x >= n || z >= n) continue;
      const j = z * n + x;
      const d = map.cell * (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
      const down = Math.max(0, (h0 - map.heights[j]!) / d);
      const slope = map.slopeDeg[j]!;
      const steep = (slope - nt.slopeEasyDeg) / nt.slopeSteepSpanDeg;
      const slopePen = slope < nt.slopeEasyDeg ? (slope / nt.slopeEasyDeg) * 0.2 : 0.2 + steep * steep;
      const bush = 1 - (ctx.tuning.movement.vegSpeed[map.veg[j]!] ?? 0.5);
      const cliffPen = map.cliff[j] && canSee && d <= vis ? nt.uCliffSeen : 0;
      let u: number;
      if (drainage) {
        const flow = Math.max(-1, Math.min(1, dlog(map.flowAcc[j]!) - dlog(map.flowAcc[i0]!)));
        u = nt.drainDescend * down + nt.drainFlow * flow;
      } else {
        const ang = datan2(dx, -dz) - belief;
        u = nt.uBelief * dcos(ang) + nt.uDescend * down * nt.descendBias;
      }
      const cxw = vertexX(map, x);
      const czw = vertexZ(map, z);
      const tr = c.nav.track;
      let revisit = 0;
      for (let k = Math.max(0, tr.length - nt.revisitPoints); k < tr.length; k += 1) {
        const p = tr[k]!;
        if ((p[0] - cxw) * (p[0] - cxw) + (p[1] - czw) * (p[1] - czw) < map.cell * map.cell * 0.5) {
          revisit = nt.uRevisit;
          break;
        }
      }
      u += -nt.uSlope * slopePen - nt.uBush * bush - cliffPen - revisit + (nextFloat(world.rng.nav) - 0.5) * 2 * nt.uNoise;
      if (u > best) {
        best = u;
        bestI = j;
      }
    }
  }
  if (bestI < 0) return null;
  return [vertexX(map, bestI % n), vertexZ(map, Math.floor(bestI / n))];
}

/** 位置確認（docs/07 §3.7）。成功したら true（呼び出し側が所要時間を待たせる） */
export function checkPosition(world: World, ctx: StaticContext, c: ClimberState): { ok: boolean; minutes: number } {
  const nt = ctx.tuning.nav;
  const ph = c.inv.phone;
  let ok = false;
  let minutes = nt.mapCheckMin;
  if (ph.gpsApp && phoneOk(c)) {
    ok = true;
    minutes = nt.gpsCheckMin;
    ph.batteryPct = Math.max(0, ph.batteryPct - nt.gpsCheckBatteryPct);
    ph.lastCheckMin = world.tMin;
  } else if (c.def.gear.map) {
    const good = c.local.visibilityM > nt.mapCheckVisM && !world.sun.isDark;
    const p = good ? nt.mapCheckBase + nt.mapCheckNavK * c.def.navSkill : nt.mapCheckPoorP;
    ok = c.def.gear.compass || good ? chance(world.rng.nav, p) : chance(world.rng.nav, nt.mapCheckPoorP);
  }
  if (ok) {
    c.perception.knowsPosition = true;
    c.perception.knowsPositionAt = { x: c.x, z: c.z };
  }
  return { ok, minutes };
}

/** 道外の点から最寄りの正規登山道への経路（GPS で道へ戻る） */
export function pathToTrail(ctx: StaticContext, c: ClimberState): [number, number][] | null {
  const cells = trailCells(ctx.map);
  return findPath(ctx.map, c.x, c.z, (i) => cells.has(i), { tuning: ctx.tuning });
}

/** 今いる格子点が登山道の上なら、そのエッジと s */
export function trailAt(ctx: StaticContext, x: number, z: number): { edgeId: EdgeId; s: number } | null {
  return trailCells(ctx.map).get(nearestIndex(ctx.map, x, z)) ?? null;
}

/** 登山道に戻って計画ルートを続ける（エッジ上の位置に置き、次の予定ノードへの道順を引く） */
export function rejoinTrail(world: World, ctx: StaticContext, c: ClimberState, edgeId: EdgeId, s: number): void {
  const t = ctx.map.trails[edgeId]!;
  const target = c.plan.route[c.plan.routeIndex];
  const toEnd = t.def.to;
  // 次の予定ノードに近い向きで歩き出す
  let dir: 1 | -1 = 1;
  if (target !== undefined && toEnd !== undefined) {
    const viaTo = shortestPath(ctx.map, toEnd, target, ctx.tuning)?.length ?? Infinity;
    const viaFrom = shortestPath(ctx.map, t.def.from, target, ctx.tuning)?.length ?? Infinity;
    dir = viaFrom < viaTo ? -1 : 1;
  }
  c.pos = { mode: 'edge', edgeId, s, dir };
  const p = pointOnTrail(t, s);
  c.x = p.x;
  c.z = p.z;
  c.elevM = p.elevM;
  const ahead = dir === 1 ? toEnd! : t.def.from;
  if (target !== undefined && ahead !== target) {
    const path = shortestPath(ctx.map, ahead, target, ctx.tuning);
    if (path) setRoute(ctx, c, [...path, ...c.plan.route.slice(c.plan.routeIndex + 1)]);
  } else if (target !== undefined) {
    setRoute(ctx, c, c.plan.route.slice(c.plan.routeIndex));
  }
  c.nav = { ...c.nav, offrouteSinceMin: null, beliefDirRad: null, track: [], falseEdgeId: null, path: [], trackCheckM: 0 };
  c.perception.awareLost = false;
  c.perception.routeBelief = null;
  c.perception.knowsPosition = true;
  c.memo.atWaterfall = false;
  transition(world, ctx, c, 'WALKING', 'backOnRoute');
  ctx.events.push({ tMin: world.tMin, type: 'BACK_ON_ROUTE', climberId: c.id, important: true });
  // 道の外で「地点へ向かう」を選んでいたら、道に戻ったところでそこへ向かう
  const pg = c.plan.pendingGoTo;
  if (pg) {
    c.plan.pendingGoTo = null;
    goToNode(ctx, c, pg.node, pg.then);
  }
}

// ---------- 探索 ----------

/** 風下の避難地点（docs/04 §8）。適地がなければ null */
export function findLeeSpot(ctx: StaticContext, x: number, z: number, windDirDeg: number): { x: number; z: number; shelter: number } | null {
  const nt = ctx.tuning.nav;
  const map = ctx.map;
  const n = map.n;
  const r = nt.leeRadiusM;
  const ang = windDirDeg * DEG;
  const wx = dsin(ang);
  const wz = -dcos(ang);
  let best = -Infinity;
  let bestP: { x: number; z: number; shelter: number } | null = null;
  const i0 = nearestIndex(map, x, z);
  const x0 = i0 % n;
  const z0 = (i0 - x0) / n;
  const rc = Math.ceil(r / map.cell);
  for (let dz = -rc; dz <= rc; dz += 1) {
    for (let dx = -rc; dx <= rc; dx += 1) {
      const gx = x0 + dx;
      const gz = z0 + dz;
      if (gx < 0 || gz < 0 || gx >= n || gz >= n) continue;
      const px = vertexX(map, gx);
      const pz = vertexZ(map, gz);
      if ((px - x) * (px - x) + (pz - z) * (pz - z) > r * r) continue;
      const j = gz * n + gx;
      const slope = map.slopeDeg[j]!;
      if (slope > nt.leeMaxSlopeDeg || map.stream[j] || map.cliff[j]) continue;
      if (nearHazardCell(map, gx, gz, Math.ceil(nt.leeAvoidM / map.cell))) continue;
      const h = map.heights[j]!;
      let rise = 0;
      for (let d = 25; d <= nt.leeLookM; d += 25) {
        const qx = px + wx * d;
        const qz = pz + wz * d;
        if (!isInside(map, qx, qz)) continue;
        rise = Math.max(rise, sampleElev(map, qx, qz) - h);
      }
      const shelter = Math.min(1, rise / nt.leeFullM);
      const veg = map.veg[j]!;
      const vegShelter = 1 - (ctx.tuning.weather.vegWindFactor[veg] ?? 1);
      const score = shelter * nt.leeWindW + vegShelter * nt.leeVegW - slope * nt.leeSlopePenaltyPerDeg;
      if (score > best) {
        best = score;
        bestP = { x: px, z: pz, shelter };
      }
    }
  }
  return bestP;
}

function nearHazardCell(map: StaticContext['map'], gx: number, gz: number, rc: number): boolean {
  const n = map.n;
  for (let dz = -rc; dz <= rc; dz += 1) {
    for (let dx = -rc; dx <= rc; dx += 1) {
      const x = gx + dx;
      const z = gz + dz;
      if (x < 0 || z < 0 || x >= n || z >= n) continue;
      const j = z * n + x;
      if (map.stream[j] || map.cliff[j]) return true;
    }
  }
  return false;
}

/** 半径内で電波が最大の格子点への経路 */
/**
 * 電波の入る所への道筋。登山道の上にいるなら、その道に沿って前後を探し（道を外れない）、
 * 道の外にいるなら周りの高い所だけを探す。どちらも今より低い所（谷）へは行かない。
 * 今いる所より良い所がなければ空の道筋（その場でかける）。
 */
export function pathToSignal(ctx: StaticContext, c: ClimberState): [number, number][] | null {
  const map = ctx.map;
  const t = ctx.tuning.nav;
  const r = t.seekSignalRadiusM;
  const minElev = c.elevM - t.seekSignalMaxDropM;
  const here = map.radio[nearestIndex(map, c.x, c.z)] ?? 0;
  const n = map.n;
  // 登山道の上: 道に沿って前後 r m を見る
  const on = trailAt(ctx, c.x, c.z);
  if (on) {
    const tr = map.trails[on.edgeId]!;
    const ss = tr.samples;
    let k0 = 0;
    for (let k = 1; k < ss.length; k += 1) if (Math.abs(ss[k]!.s - on.s) < Math.abs(ss[k0]!.s - on.s)) k0 = k;
    let best = here + t.seekSignalMinGain;
    let bestK = -1;
    for (let k = 0; k < ss.length; k += 1) {
      const p = ss[k]!;
      if (Math.abs(p.s - on.s) > r || p.elevM < minElev) continue;
      // 途中で低い所（谷）を通る道筋は選ばない
      let dip = false;
      for (let j = Math.min(k, k0); j <= Math.max(k, k0); j += 1) if (ss[j]!.elevM < minElev) dip = true;
      if (dip) continue;
      const v = map.radio[nearestIndex(map, p.x, p.z)] ?? 0;
      if (v > best || (v === best && bestK >= 0 && p.elevM > ss[bestK]!.elevM)) {
        best = v;
        bestK = k;
      }
    }
    if (bestK < 0) return [];
    const path: [number, number][] = [];
    const step = bestK >= k0 ? 1 : -1;
    for (let k = k0; k !== bestK + step; k += step) path.push([ss[k]!.x, ss[k]!.z]);
    return path;
  }
  // 道の外: 周りの高い所だけ
  let best = here + t.seekSignalMinGain;
  let bestI = -1;
  for (let i = 0; i < n * n; i += 1) {
    const dx = vertexX(map, i % n) - c.x;
    const dz = vertexZ(map, Math.floor(i / n)) - c.z;
    if (dx * dx + dz * dz > r * r || map.cliff[i] || map.heights[i]! < minElev) continue;
    const v = map.radio[i]!;
    if (v > best || (v === best && bestI >= 0 && map.heights[i]! > map.heights[bestI]!)) {
      best = v;
      bestI = i;
    }
  }
  if (bestI < 0) return [];
  return findPath(map, c.x, c.z, (i) => i === bestI, { tuning: ctx.tuning, heuristicTo: [vertexX(map, bestI % n), vertexZ(map, Math.floor(bestI / n))] });
}

/** 稜線を外れて minDropM 下がる先（森林を優先） */
export function pathOffRidge(ctx: StaticContext, c: ClimberState, minDropM: number): [number, number][] | null {
  const map = ctx.map;
  const limit = c.elevM - minDropM;
  const r = ctx.tuning.nav.offRidgeRadiusM;
  return findPath(
    map,
    c.x,
    c.z,
    (i) => {
      const n = map.n;
      const dx = vertexX(map, i % n) - c.x;
      const dz = vertexZ(map, Math.floor(i / n)) - c.z;
      return map.heights[i]! <= limit && dx * dx + dz * dz <= r * r;
    },
    { tuning: ctx.tuning, maxCost: r * 6 },
  );
}

