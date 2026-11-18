/**
 * 道外の移動（docs/07 §1.2・§3.4〜3.6）。nav.path の先頭へ向かい、尽きたら状態に応じて次の目標を決める。
 * OFFROUTE_UNAWARE: 計画方向への効用の 1 歩 / DESCENDING_DRAINAGE: 沢筋への 1 歩（滝の手前で止まることがある）
 * BACKTRACKING: 軌跡を逆にたどる / NAVIGATING_TO_TRAIL: A* で最寄りの登山道へ / SEEKING_SIGNAL: 電波の強い所へ
 * RESTING・BIVOUAC・WAITING_RESCUE: 風下や稜線の下へ移る（path があるときだけ）
 */
import { datan2 } from '../core/dmath';
import { offTrailFactor } from '../terrain/pathing';
import { nearestIndex, sampleElev } from '../terrain/sample';
import type { ClimberState, StaticContext, World } from '../types';
import { callRescue } from './actions';
import { walkMet } from './movement';
import { checkPosition as navCheck, pathToSignal, pathToTrail, rejoinTrail, trailAt, utilityStep } from './navigation';
import { transition } from './state';
import type { WalkResult } from './walk';

const EPS = 1e-9;

/** 道外の候補速度（m/s）。docs/07 §1.2 */
export function offTrailSpeedMs(world: World, ctx: StaticContext, c: ClimberState): number {
  const m = ctx.tuning.movement;
  const i = nearestIndex(ctx.map, c.x, c.z);
  let darkF = 1;
  if (world.sun.isDark) darkF = c.inv.headlamp.on ? m.darkHeadlampF : m.darkNoLampBase + m.darkNoLampMoon * world.sun.moonIllum;
  const f = c.body.fatigue / 100;
  return ((m.offTrailKmh / 3.6) * offTrailFactor(ctx.map, i, ctx.tuning) * darkF * c.M * (1 - m.fatigueSpeedK * f * f)) * c.plan.paceFactor;
}

/** path が尽きたとき、状態に応じて次の目標を足す。false なら止まる */
function refill(world: World, ctx: StaticContext, c: ClimberState): boolean {
  switch (c.state) {
    case 'OFFROUTE_UNAWARE': {
      const p = utilityStep(world, ctx, c, false);
      if (p) c.nav.path.push(p);
      return p !== null;
    }
    case 'DESCENDING_DRAINAGE': {
      const p = utilityStep(world, ctx, c, true);
      if (!p) return false;
      const j = nearestIndex(ctx.map, p[0], p[1]);
      const wf = ctx.map.def.hazards.find(
        (h) => h.type === 'waterfall' && (h.x - p[0]) * (h.x - p[0]) + (h.z - p[1]) * (h.z - p[1]) <= (h.radius + 30) * (h.radius + 30),
      );
      const seen = c.local.visibilityM > ctx.tuning.nav.cliffSeenMinVisM && !(world.sun.isDark && !c.inv.headlamp.on);
      if ((ctx.map.cliff[j] || wf) && !c.memo.atWaterfall && seen && c.J > ctx.tuning.nav.waterfallStopJ) {
        c.memo.atWaterfall = true;
        transition(world, ctx, c, 'STAYING', 'waterfall');
        return false;
      }
      c.nav.path.push(p);
      return true;
    }
    case 'BACKTRACKING': {
      const back = [...c.nav.track].reverse();
      const lk = c.nav.lastKnownOnRoute;
      if (lk) back.push([lk.x, lk.z]);
      c.nav.track = [];
      c.nav.path = back;
      return back.length > 0;
    }
    case 'NAVIGATING_TO_TRAIL': {
      const p = pathToTrail(ctx, c);
      if (!p || p.length === 0) {
        const t = trailAt(ctx, c.x, c.z);
        if (t) rejoinTrail(world, ctx, c, t.edgeId, t.s);
        else transition(world, ctx, c, 'STAYING', 'noPath');
        return false;
      }
      c.nav.path = p;
      return true;
    }
    case 'SEEKING_SIGNAL': {
      const p = pathToSignal(ctx, c);
      if (!p || p.length === 0) {
        arrivedSignal(world, ctx, c);
        return false;
      }
      c.nav.path = p;
      return true;
    }
    default:
      return false;
  }
}

function arrivedSignal(world: World, ctx: StaticContext, c: ClimberState): void {
  callRescue(world, ctx, c, 'auto');
  transition(world, ctx, c, world.rescue.status === 'dispatched' ? 'WAITING_RESCUE' : 'STAYING', 'signalSought');
}

/** path を最後までたどったとき */
function onPathDone(world: World, ctx: StaticContext, c: ClimberState): void {
  if (c.state === 'BACKTRACKING') {
    const lk = c.nav.lastKnownOnRoute;
    if (lk) rejoinTrail(world, ctx, c, lk.edgeId, lk.s);
    else transition(world, ctx, c, 'LOST_AWARE', 'trackEnd');
  } else if (c.state === 'NAVIGATING_TO_TRAIL') {
    const t = trailAt(ctx, c.x, c.z);
    if (t) rejoinTrail(world, ctx, c, t.edgeId, t.s);
  } else if (c.state === 'SEEKING_SIGNAL') {
    arrivedSignal(world, ctx, c);
  }
}

/** 先頭 c を dtSec 秒、道外で進める（members は一緒に動く人） */
export function stepFree(world: World, ctx: StaticContext, c: ClimberState, dtSec: number, members: readonly ClimberState[]): WalkResult {
  let t = dtSec;
  let moved = 0;
  let gradeTime = 0;
  const metTime = members.map(() => 0);
  const metF = ctx.tuning.physiology.offTrailMetF;
  let guard = 0;
  while (t > EPS && guard < 50) {
    guard += 1;
    if (c.pos.mode !== 'free') break;
    if (c.nav.path.length === 0) {
      const before = c.state;
      if (!refill(world, ctx, c) || c.state !== before) break;
    }
    const [tx, tz] = c.nav.path[0]!;
    const dx = tx - c.x;
    const dz = tz - c.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < EPS) {
      c.nav.path.shift();
      if (c.nav.path.length === 0) {
        onPathDone(world, ctx, c);
        if (c.pos.mode !== 'free') break;
      }
      continue;
    }
    let v = Infinity;
    for (const m of members) v = Math.min(v, offTrailSpeedMs(world, ctx, m));
    if (!(v > EPS)) break;
    const dt = Math.min(t, dist / v);
    const d = v * dt;
    const f = d / dist;
    const h0 = c.elevM;
    c.x += dx * f;
    c.z += dz * f;
    c.elevM = sampleElev(ctx.map, c.x, c.z);
    c.pos = { mode: 'free', x: c.x, z: c.z };
    c.headingRad = datan2(dx, -dz);
    const grade = d > 0 ? (c.elevM - h0) / d : 0;
    for (let k = 0; k < members.length; k += 1) metTime[k] = metTime[k]! + walkMet(v, grade, members[k]!.def, members[k]!.local.windMs, ctx.tuning) * metF * dt;
    gradeTime += grade * dt;
    moved += d;
    t -= dt;
    if (d >= dist - EPS) {
      c.nav.path.shift();
      // 気づかずに歩いていて登山道に出たら、その道をたどる
      if (c.state === 'OFFROUTE_UNAWARE') {
        const tr = trailAt(ctx, c.x, c.z);
        if (tr && c.nav.track.length > 3) {
          rejoinTrail(world, ctx, c, tr.edgeId, tr.s);
          break;
        }
      }
      if (c.nav.path.length === 0 && c.state !== 'OFFROUTE_UNAWARE' && c.state !== 'DESCENDING_DRAINAGE') {
        onPathDone(world, ctx, c);
        if (c.pos.mode !== 'free') break;
      }
    }
  }
  const restT = Math.max(0, t);
  const metById: Record<string, number> = {};
  for (let k = 0; k < members.length; k += 1) metById[members[k]!.id] = (metTime[k]! + ctx.tuning.movement.restMet * restT) / dtSec;
  c.speedMs = moved / dtSec;
  const walked = dtSec - restT;
  return { movedM: moved, grade: walked > 0 ? gradeTime / walked : 0, metById };
}

/** 位置確認の作業が終わったとき（behavior.finishTask から） */
export function finishCheckPosition(world: World, ctx: StaticContext, c: ClimberState): void {
  const r = navCheck(world, ctx, c);
  if (r.ok && c.perception.awareLost) c.perception.knowsPosition = true;
}
