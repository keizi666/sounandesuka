/**
 * 計画ルートの操作（docs/09 §6 の continueRoute / setRoute / turnBack / goToNode と、ノード到着時の処理）。
 * plan.route[plan.routeIndex] が「次に向かうノード」。エッジ上にいるときは route[routeIndex] がエッジの先のノード。
 */
import { formatTimeRef, nextSunriseTMin, sunParamsOf } from '../core/clock';
import { edgeBetween, legCourseTimeMin, shortestPath } from '../terrain/trails';
import type { ClimberState, NodeId, StaticContext, World } from '../types';
import { callRescue } from './actions';
import { transition } from './state';

/** 今いるノード、またはエッジ上なら前後のノード */
export function whereOnGraph(ctx: StaticContext, c: ClimberState): { at?: NodeId; ahead?: NodeId; behind?: NodeId; fraction?: number } {
  if (c.pos.mode === 'node') return { at: c.pos.nodeId };
  if (c.pos.mode === 'edge') {
    const t = ctx.map.trails[c.pos.edgeId]!;
    const e = t.def;
    const ahead = c.pos.dir === 1 ? e.to : e.from;
    const behind = c.pos.dir === 1 ? e.from : e.to;
    // ahead までの残りの割合
    const fraction = t.lengthM > 0 ? (c.pos.dir === 1 ? (t.lengthM - c.pos.s) / t.lengthM : c.pos.s / t.lengthM) : 0;
    return { ahead, behind, fraction };
  }
  return {};
}

/** 「次の日の出 + 30 分」の TimeRef */
export function dawnRef(world: World, ctx: StaticContext, fromMin: number = world.tMin): string {
  const p = sunParamsOf(ctx.scenario.sun, ctx.scenario.season, ctx.tuning);
  return formatTimeRef(nextSunriseTMin(fromMin, p) + ctx.tuning.behavior.dawnAfterSunriseMin);
}

function reverseOnEdge(c: ClimberState): void {
  if (c.pos.mode === 'edge') c.pos = { ...c.pos, dir: c.pos.dir === 1 ? -1 : 1 };
}

/** ルートを差し替える。先頭が今いるノード・エッジの前後のノードでなければ、最短経路でつなぐ */
export function setRoute(ctx: StaticContext, c: ClimberState, route: readonly NodeId[], goalNodes?: readonly NodeId[]): void {
  const w = whereOnGraph(ctx, c);
  let r = [...route];
  if (w.at !== undefined) {
    if (r[0] !== w.at) {
      const link = r[0] !== undefined ? shortestPath(ctx.map, w.at, r[0], ctx.tuning) : null;
      r = link ? [...link, ...r.slice(1)] : [w.at, ...r];
    }
    c.plan.route = r;
    c.plan.routeIndex = 1;
  } else {
    if (r[0] === w.behind) reverseOnEdge(c);
    else if (r[0] !== w.ahead && w.ahead !== undefined) {
      const link = r[0] !== undefined ? shortestPath(ctx.map, w.ahead, r[0], ctx.tuning) : null;
      r = link ? [...link, ...r.slice(1)] : [w.ahead, ...r];
    }
    c.plan.route = r;
    c.plan.routeIndex = 0;
  }
  if (goalNodes) c.plan.goalNodes = [...goalNodes];
}

/** 来たルートを逆順に戻る。最初のノード（登山口）が目標 */
export function turnBack(ctx: StaticContext, c: ClimberState): void {
  const passed = c.plan.route.slice(0, Math.max(1, c.plan.routeIndex));
  const back = [...passed].reverse();
  const start = passed[0]!;
  if (c.pos.mode === 'edge') {
    reverseOnEdge(c);
    c.plan.route = back;
    c.plan.routeIndex = 0;
  } else {
    c.plan.route = back;
    c.plan.routeIndex = 1;
  }
  c.plan.goalNodes = [start];
  c.plan.goTo = null;
}

/** 経路探索でノードへ向かう。エッジ上なら前後どちら回りが近いかで決める */
export function goToNode(ctx: StaticContext, c: ClimberState, node: NodeId, then: 'stay' | 'continue' | 'call'): boolean {
  const w = whereOnGraph(ctx, c);
  const costOf = (path: NodeId[] | null): number => {
    if (!path) return Infinity;
    let s = 0;
    for (let i = 0; i + 1 < path.length; i += 1) {
      const r = edgeBetween(ctx.map, path[i]!, path[i + 1]!);
      if ('leg' in r) s += legCourseTimeMin(ctx.map, r.leg, ctx.tuning);
    }
    return s;
  };
  let path: NodeId[] | null = null;
  if (w.at !== undefined) path = shortestPath(ctx.map, w.at, node, ctx.tuning);
  else if (w.ahead !== undefined && w.behind !== undefined && c.pos.mode === 'edge') {
    const legT = costOf([w.behind, w.ahead]);
    const viaAhead = shortestPath(ctx.map, w.ahead, node, ctx.tuning);
    const viaBehind = shortestPath(ctx.map, w.behind, node, ctx.tuning);
    const f = w.fraction ?? 0;
    const cA = costOf(viaAhead) + legT * f;
    const cB = costOf(viaBehind) + legT * (1 - f);
    path = cA <= cB ? viaAhead : viaBehind;
    if (path && cA > cB) reverseOnEdge(c);
  }
  if (!path) return false;
  c.plan.route = path;
  c.plan.routeIndex = w.at !== undefined ? 1 : 0;
  c.plan.goTo = { node, then };
  return true;
}

/** 小屋に入る（ノードに小屋があり、営業・開放されていること） */
export function enterShelter(world: World, ctx: StaticContext, c: ClimberState, nodeId: NodeId, until: string): boolean {
  const nd = ctx.map.nodes[nodeId];
  const open = ctx.scenario.nodeOverrides?.[nodeId]?.open ?? nd?.shelter?.open ?? false;
  if (!nd?.shelter || !open) return false;
  c.body.shelterNodeId = nodeId;
  c.body.leeShelter = 0;
  c.body.inBivy = false;
  c.plan.bivouacUntil = until;
  c.plan.restUntilMin = null;
  // 「小屋で過ごした」は、暗くなってから小屋にいたときに立てる（step）。昼の休憩・昼食だけでは立てない
  transition(world, ctx, c, 'SHELTERED', 'shelter');
  ctx.events.push({ tMin: world.tMin, type: 'SHELTER_ENTER', climberId: c.id, important: true, data: { node: nodeId, kind: nd.shelter.kind } });
  return true;
}

export function leaveShelter(world: World, ctx: StaticContext, c: ClimberState): void {
  if (c.body.shelterNodeId) {
    ctx.events.push({ tMin: world.tMin, type: 'SHELTER_LEAVE', climberId: c.id, data: { node: c.body.shelterNodeId } });
  }
  c.body.shelterNodeId = null;
  c.body.inBivy = false;
  c.body.leeShelter = 0;
  c.body.groundInsulation = false;
  c.plan.bivouacUntil = null;
}

/** ノードに着いたときの処理。true なら、このティックの歩行をここで終える */
export function arriveAt(world: World, ctx: StaticContext, c: ClimberState, nodeId: NodeId): boolean {
  c.pos = { mode: 'node', nodeId };
  if (world.visitedNodes[nodeId] === undefined) world.visitedNodes[nodeId] = world.tMin;
  ctx.events.push({ tMin: world.tMin, type: 'NODE_ARRIVE', climberId: c.id, data: { node: nodeId } });
  if (c.plan.route[c.plan.routeIndex] === nodeId) c.plan.routeIndex += 1;
  if (c.plan.goalNodes.includes(nodeId)) {
    transition(world, ctx, c, 'FINISHED', 'goal');
    // 小屋が目的地なら「着いた」（下山ではない）
    const hut = ctx.map.nodes[nodeId]?.shelter !== undefined;
    // 小屋に着いたのが昼過ぎなら「今日はここに泊まる」。朝・昼前なら着いただけ
    const clock = ((world.tMin % 1440) + 1440) % 1440;
    ctx.events.push({ tMin: world.tMin, type: 'FINISHED', climberId: c.id, important: true, data: hut ? { node: nodeId, hut: true, stay: clock >= 13 * 60 } : { node: nodeId } });
    return true;
  }
  const g = c.plan.goTo;
  if (g && g.node === nodeId) {
    c.plan.goTo = null;
    // 滞在の後に歩き出したときの行き先を先に引いておく
    ensureRouteAhead(ctx, c);
    if (g.then === 'call') {
      // 電波の入る地点まで来たので通報する。つながれば、その場で救助を待つ（救助隊を案内する）
      const rep = callRescue(world, ctx, c, 'auto');
      // 仲間の急病やけがを知らせに来たのなら、伝える場所はその仲間のいる所（スマホの地図で分かる）
      if (rep) {
        const patient = world.climbers.find((o) => o !== c && o.body.alive && (o.body.illness?.active === true || o.body.injury !== 'none'));
        if (patient) {
          Object.assign(rep, { x: patient.x, z: patient.z, radiusM: c.inv.phone.gpsApp ? 100 : 500 });
          ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: patient.id, important: true, data: { rescueLoc: 'relayed', radiusM: rep.radiusM, by: c.def.name } });
        }
      }
      transition(world, ctx, c, world.rescue.status === 'dispatched' ? 'WAITING_RESCUE' : 'STAYING', 'signalSought');
      return true;
    }
    if (g.then === 'stay') {
      const until = dawnRef(world, ctx);
      if (!enterShelter(world, ctx, c, nodeId, until)) {
        c.plan.restUntilMin = null;
        c.plan.bivouacUntil = until;
        transition(world, ctx, c, 'RESTING', 'goToStay');
      }
    }
    return true;
  }
  // 分岐点の判定（次のティック）までノードにとどまる
  return true;
}

/**
 * ノードにいて行き先が尽きていたら、元の計画ルートの残り（そのノードが計画に含まれる場合）か、
 * 最寄りの下山口までの最短経路を引く。
 */
export function ensureRouteAhead(ctx: StaticContext, c: ClimberState): void {
  if (c.pos.mode !== 'node') return;
  if (c.plan.route[c.plan.routeIndex] !== undefined) return;
  const here = c.pos.nodeId;
  const plan = ctx.scenario.plan.route;
  const idx = plan.lastIndexOf(here);
  if (idx >= 0 && idx < plan.length - 1) {
    setRoute(ctx, c, plan.slice(idx));
    return;
  }
  const goal = nearestGoalPath(ctx, here, c.plan.goalNodes);
  if (goal && goal.length > 1) setRoute(ctx, c, goal);
}

function nearestGoalPath(ctx: StaticContext, from: NodeId, goals: readonly NodeId[]): NodeId[] | null {
  let best: NodeId[] | null = null;
  let bestLen = Infinity;
  for (const g of goals) {
    const p = shortestPath(ctx.map, from, g, ctx.tuning);
    if (p && p.length < bestLen) {
      best = p;
      bestLen = p.length;
    }
  }
  return best;
}
