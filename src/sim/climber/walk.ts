/**
 * 計画ルートに沿った登山道上の歩行（WALKING の 1 ティック）。
 * 10 m のサンプル区間ごとに勾配から速度を求め、区間の境目をまたぐときは時間を分けて進む。
 * まとまって歩くグループ（tight）は、全員の速度の最小で進む（docs/07 §1.1 末尾）。
 * ノードに着いたらそのティックの歩行を終える（次のティックで分岐点を判定するため）。
 */
import { datan2 } from '../core/dmath';
import { edgeBetween, segmentIndexAt } from '../terrain/trails';
import type { ClimberState, MapRuntime, StaticContext, World } from '../types';
import { footSnowCm, groundAt } from '../weather/ground';
import { capSpeedByMet, isChainAt, trailSpeedMs, walkMet, type MoveEnv } from './movement';
import { syncPosition } from './position';
import { chooseLegAtNode, onWrongNode } from './navigation';
import { arriveAt, setRoute } from './route';
import { shortestPath } from '../terrain/trails';
import { transition } from './state';

/** 速度に効く周りの状態を World から集める */
export function moveEnvFor(world: World, c: ClimberState, ctx?: StaticContext): MoveEnv {
  const gr = groundAt(world.ground, c.elevM);
  return {
    isDark: world.sun.isDark,
    moonIllum: world.sun.moonIllum,
    visibilityM: c.local.visibilityM,
    windMs: c.local.windMs,
    snowCm: ctx ? footSnowCm(world, ctx, c) : gr.snowCm,
    icy: gr.icy,
    groundWet: gr.wet,
  };
}

const EPS = 1e-9;

export interface WalkResult {
  movedM: number;
  /** 歩いた時間で重みを付けた平均勾配（上りが正） */
  grade: number;
  /** 各メンバーの平均 MET（id → MET） */
  metById: Record<string, number>;
}

/**
 * すぐそこ（hutNearM 以内）の開いている小屋へ向かっているなら、計算上は進めなくても這うような遅さでは進める
 * （ユーザーの指摘: s18 で頂上宿舎の手前、強風と低体温で速さが 0 になり、小屋に入れなかった）。全員に意識があるときだけ
 */
function hutCrawlMs(ctx: StaticContext, c: ClimberState, members: readonly ClimberState[]): number {
  const id = c.plan.goTo?.node;
  if (id === undefined) return 0;
  const nd = ctx.map.nodes[id];
  if (!nd?.shelter || !(ctx.scenario.nodeOverrides?.[id]?.open ?? nd.shelter.open)) return 0;
  const bt = ctx.tuning.behavior;
  const dx = c.x - nd.x;
  const dz = c.z - nd.z;
  if (dx * dx + dz * dz > bt.hutNearM * bt.hutNearM) return 0;
  return members.every((m) => m.body.alive && m.body.conscious) ? bt.hutCrawlMs : 0;
}

/**
 * 先頭 c を dtSec 秒進める。members は一緒に歩く人（c を含む）。速度は全員の上限の最小。
 * 位置・ルートの更新は c だけに行い、呼び出し側が他のメンバーに写す。
 */
export function walkStep(world: World, ctx: StaticContext, c: ClimberState, dtSec: number, members: readonly ClimberState[] = [c]): WalkResult {
  const map: MapRuntime = ctx.map;
  const envs = members.map((m) => moveEnvFor(world, m, ctx));
  const metTime = members.map(() => 0);
  let t = dtSec;
  let moved = 0;
  let headX = 0;
  let headZ = 0;
  let gradeTime = 0;
  const crawlMs = hutCrawlMs(ctx, c, members);
  while (t > EPS) {
    if (c.pos.mode === 'node') {
      const next = c.plan.route[c.plan.routeIndex];
      if (next === undefined) {
        transition(world, ctx, c, 'STAYING', 'routeEnd');
        break;
      }
      let r = edgeBetween(map, c.pos.nodeId, next);
      if ('error' in r) {
        // 次のノードが隣でない（道迷いの後など）: 最短経路でつなぎ直す
        const link = shortestPath(map, c.pos.nodeId, next, ctx.tuning);
        if (link && link.length > 1) {
          setRoute(ctx, c, [...link, ...c.plan.route.slice(c.plan.routeIndex + 1)]);
          r = edgeBetween(map, c.pos.nodeId, c.plan.route[c.plan.routeIndex]!);
        }
      }
      if ('error' in r) throw new Error(`${c.id}: ${r.error}`);
      let leg = r.leg;
      if (c.state === 'WALKING') {
        // 分岐での道間違い（docs/07 §3.2）
        const ch = chooseLegAtNode(world, ctx, c, c.pos.nodeId, leg);
        if ('falseEdge' in ch) {
          c.pos = { mode: 'edge', edgeId: ch.falseEdge, s: 0, dir: 1 };
          continue;
        }
        leg = ch.leg;
      }
      const len = map.trails[leg.edgeId]!.lengthM;
      c.pos = { mode: 'edge', edgeId: leg.edgeId, s: leg.dir === 1 ? 0 : len, dir: leg.dir };
    }
    if (c.pos.mode !== 'edge') break; // 道外の移動は offtrail.ts
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
    const chain = isChainAt(map, pos.edgeId, pos.s);
    let vMs = Infinity;
    for (let k = 0; k < members.length; k += 1) {
      const m = members[k]!;
      const env = envs[k]!;
      const cand = trailSpeedMs(m, trail.def, chain, grade, env, ctx.tuning);
      // 足を骨折して這う人は、這う速さの上限だけで決める（運動能力が低く MET の上限で 0 にならないように）
      vMs = Math.min(vMs, m.body.injury === 'legFracture' && m.body.conscious ? cand : capSpeedByMet(cand, grade, m, env.windMs, ctx.tuning).vMs);
    }
    vMs = Math.max(vMs, crawlMs);
    if (!(vMs > EPS)) break;
    const dt = Math.min(t, dist / vMs);
    const d = vMs * dt;
    pos.s += pos.dir * d;
    if (dist - d <= EPS) pos.s = target;
    t -= dt;
    moved += d;
    for (let k = 0; k < members.length; k += 1) {
      metTime[k] = metTime[k]! + walkMet(vMs, grade, members[k]!.def, envs[k]!.windMs, ctx.tuning) * dt;
    }
    gradeTime += grade * dt;
    headX += (b.x - a.x) * pos.dir;
    headZ += (b.z - a.z) * pos.dir;
    const atEnd = pos.dir === 1 ? pos.s >= trail.lengthM - EPS : pos.s <= EPS;
    if (atEnd) {
      const node = pos.dir === 1 ? trail.def.to : trail.def.from;
      if (node === undefined) break; // 偽の道の末端（navigation.per10m が道外へ出す）
      const expected = c.plan.route[c.plan.routeIndex];
      const via = pos.edgeId;
      arriveAt(world, ctx, c, node);
      if (node !== expected && c.state === 'WALKING' && c.nav.offrouteSinceMin !== null) onWrongNode(world, ctx, c, node, via);
      break;
    }
  }
  const restT = Math.max(0, t);
  const metById: Record<string, number> = {};
  for (let k = 0; k < members.length; k += 1) {
    metById[members[k]!.id] = (metTime[k]! + ctx.tuning.movement.restMet * restT) / dtSec;
  }
  c.speedMs = moved / dtSec;
  c.metAct = metById[c.id]!;
  if (headX !== 0 || headZ !== 0) c.headingRad = datan2(headX, -headZ);
  syncPosition(map, c);
  const walkedT = dtSec - restT;
  return { movedM: moved, grade: walkedT > 0 ? gradeTime / walkedT : 0, metById };
}
