/**
 * 計画ルートに沿った登山道上の歩行（WALKING の 1 ティック）。
 * 10 m のサンプル区間ごとに勾配から速度を求め、区間の境目をまたぐときは時間を分けて進む。
 */
import { datan2 } from '../core/dmath';
import { edgeBetween, segmentIndexAt } from '../terrain/trails';
import type { ClimberState, MapRuntime, StaticContext, World } from '../types';
import { groundAt } from '../weather/ground';
import { capSpeedByMet, isChainAt, trailSpeedMs, type MoveEnv } from './movement';
import { syncPosition } from './position';
import { transition } from './state';

/** 速度に効く周りの状態を World から集める */
export function moveEnvFor(world: World, c: ClimberState): MoveEnv {
  const gr = groundAt(world.ground, c.elevM);
  return {
    isDark: world.sun.isDark,
    moonIllum: world.sun.moonIllum,
    visibilityM: c.local.visibilityM,
    windMs: c.local.windMs,
    snowCm: gr.snowCm,
    icy: gr.icy,
    groundWet: gr.wet,
  };
}

const EPS = 1e-9;

/** ノードに着いたときの処理。true なら歩行を終える */
function arriveAt(world: World, ctx: StaticContext, c: ClimberState, nodeId: string): boolean {
  c.pos = { mode: 'node', nodeId };
  if (world.visitedNodes[nodeId] === undefined) world.visitedNodes[nodeId] = world.tMin;
  ctx.events.push({ tMin: world.tMin, type: 'NODE_ARRIVE', climberId: c.id, data: { node: nodeId } });
  if (c.plan.route[c.plan.routeIndex] === nodeId) c.plan.routeIndex += 1;
  if (c.plan.goalNodes.includes(nodeId)) {
    transition(world, ctx, c, 'FINISHED', 'goal');
    ctx.events.push({ tMin: world.tMin, type: 'FINISHED', climberId: c.id, data: { node: nodeId } });
    return true;
  }
  return false;
}

/** WALKING の 1 ティック分（dtSec 秒）進む */
export function walkStep(world: World, ctx: StaticContext, c: ClimberState, dtSec: number): void {
  const map: MapRuntime = ctx.map;
  const env = moveEnvFor(world, c);
  let t = dtSec;
  let moved = 0;
  let metTime = 0;
  let headX = 0;
  let headZ = 0;
  while (t > EPS) {
    if (c.pos.mode === 'node') {
      const next = c.plan.route[c.plan.routeIndex];
      if (next === undefined) {
        transition(world, ctx, c, 'STAYING', 'routeEnd');
        break;
      }
      const r = edgeBetween(map, c.pos.nodeId, next);
      if ('error' in r) throw new Error(`${c.id}: ${r.error}`);
      const len = map.trails[r.leg.edgeId]!.lengthM;
      c.pos = { mode: 'edge', edgeId: r.leg.edgeId, s: r.leg.dir === 1 ? 0 : len, dir: r.leg.dir };
    }
    if (c.pos.mode !== 'edge') break; // 道外の移動は P6
    const pos = c.pos;
    const trail = map.trails[pos.edgeId]!;
    const smp = trail.samples;
    let idx = segmentIndexAt(trail, pos.s);
    if (pos.dir === -1 && idx > 0 && smp[idx]!.s >= pos.s - EPS) idx -= 1;
    const a = smp[idx]!;
    const b = smp[idx + 1] ?? a;
    const span = b.s - a.s;
    const grade = span > 0 ? ((b.elevM - a.elevM) / span) * pos.dir : 0;
    const target = pos.dir === 1 ? b.s : a.s;
    const dist = Math.abs(target - pos.s);
    const cand = trailSpeedMs(c, trail.def, isChainAt(map, pos.edgeId, pos.s), grade, env, ctx.tuning);
    const { vMs, met } = capSpeedByMet(cand, grade, c, env.windMs, ctx.tuning);
    if (vMs <= EPS) break;
    const dt = Math.min(t, dist / vMs);
    const d = vMs * dt;
    pos.s += pos.dir * d;
    if (dist - d <= EPS) pos.s = target;
    t -= dt;
    moved += d;
    metTime += met * dt;
    headX += (b.x - a.x) * pos.dir;
    headZ += (b.z - a.z) * pos.dir;
    const atEnd = pos.dir === 1 ? pos.s >= trail.lengthM - EPS : pos.s <= EPS;
    if (atEnd) {
      const node = pos.dir === 1 ? trail.def.to : trail.def.from;
      if (node === undefined) break; // 偽の道の末端（P6）
      if (arriveAt(world, ctx, c, node)) break;
    }
  }
  const restT = Math.max(0, t);
  c.speedMs = moved / dtSec;
  c.metAct = (metTime + ctx.tuning.movement.restMet * restT) / dtSec;
  if (headX !== 0 || headZ !== 0) c.headingRad = datan2(headX, -headZ);
  syncPosition(map, c);
}
