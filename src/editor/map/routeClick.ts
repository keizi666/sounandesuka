/**
 * 計画ルートを引く道具で地点を押したとき（人と計画タブ・登山道タブで共通）。
 * どの道にもつながっていない地点（道のそばの山頂の印など）なら、近く（CONNECT_MAX_M 以内）のつながった地点との間に
 * 短い道（手描きと同じ扱い。T2・まっすぐ）を足してつなぎ、その地点までルートを延ばす（ユーザーの指定）。
 */
import type { EdgeDef, MapDef, NodeDef } from '../../sim/types';
import type { Ed } from '../context';
import { resample } from '../geo/overpass';
import { nextId } from '../store/project';
import { appendToRoute, routeFailMessage } from './tools';

/** 自動でつなぐ距離の上限（m） */
export const CONNECT_MAX_M = 300;

const linked = (map: MapDef, id: string): boolean => map.edges.some((e) => e.kind === 'trail' && (e.from === id || e.to === id));

/** つながっていない地点 n に、いちばん近いつながった地点（maxM 以内）。なければ null */
export function nearestLinked(map: MapDef, n: NodeDef, maxM = CONNECT_MAX_M): NodeDef | null {
  let best: NodeDef | null = null;
  let bd = maxM;
  for (const x of map.nodes) {
    if (x.id === n.id || !linked(map, x.id)) continue;
    const d = Math.hypot(x.x - n.x, x.z - n.z);
    if (d < bd) {
      bd = d;
      best = x;
    }
  }
  return best;
}

/** a から b へのまっすぐな短い道 */
export function connectorEdge(map: MapDef, a: NodeDef, b: NodeDef): EdgeDef {
  const id = nextId([...map.nodes.map((x) => x.id), ...map.edges.map((x) => x.id)], 'E');
  const pts = resample([{ x: a.x, z: a.z }, { x: b.x, z: b.z }], 10);
  return { id, name: `${a.name}〜${b.name}`, kind: 'trail', from: a.id, to: b.id, class: 'T2', markers: 0.6, drift: 0.02, sinuosity: 1, smooth: false, source: 'manual', waypoints: pts.slice(1, -1).map((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]) };
}

export function clickRouteNode(ed: Ed, n: NodeDef): void {
  const rt = ed.runtime();
  if (!rt) return;
  const map = ed.p.map;
  const route = ed.p.scenario.plan.route;
  if (!linked(map, n.id)) {
    const near = nearestLinked(map, n);
    if (!near) return ed.toast(routeFailMessage(map, n), 7000);
    // つないだ先までのルート（いまの道のつながりで）＋その地点
    const toNear = route.length === 0 ? [] : appendToRoute(rt, route, near.id);
    if (toNear === null) return ed.toast(routeFailMessage(map, near), 7000);
    const edge = connectorEdge(map, near, n);
    const d = Math.round(Math.hypot(near.x - n.x, near.z - n.z));
    ed.change(`${n.name} を ${near.name} につなぐ`, () => {
      map.edges.push(edge);
      ed.p.scenario.plan.route = [...toNear, n.id];
    }, true);
    ed.toast(`${n.name}（${n.id}）はどの道にもつながっていなかったので、${d} m 先の ${near.name}（${near.id}）とつなぐ道 ${edge.id} を足しました（Ctrl＋Z で戻せます）`, 6000);
    return;
  }
  const r = appendToRoute(rt, route, n.id);
  if (!r) return ed.toast(routeFailMessage(map, n), 7000);
  ed.change('ルート', () => (ed.p.scenario.plan.route = r));
}
