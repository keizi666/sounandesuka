/**
 * 計画ルートを引く道具で地点を押したとき（人と計画タブ・登山道タブで共通）。
 * どの道にもつながっていない地点（道のそばの山頂の印など）なら、近く（CONNECT_MAX_M 以内）のつながった地点との間に
 * 短い道（手描きと同じ扱い。T2・まっすぐ）を足してつなぎ、その地点までルートを延ばす（ユーザーの指定）。
 * ルートの中に、同じ 2 地点を結ぶ道が 2 本以上ある区間があれば（ルートは地点の並びなので、どちらを歩くか決まらない）、
 * コースタイムの短いほうの道の途中に経由点を足して、その道を通るようにする（ユーザーの指定）。
 */
import type { EdgeDef, MapDef, NodeDef } from '../../sim/types';
import type { Ed } from '../context';
import { resample } from '../geo/overpass';
import { nextId } from '../store/project';
import { appendToRoute, routeFailMessage, splitEdge } from './tools';

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

/** 道のコースタイム（分。a から b へ）。書かれていなければ長さから（毎分 50 m） */
function edgeMinutes(map: MapDef, e: EdgeDef, a: string): number {
  if (e.courseTimeMin) return e.from === a ? e.courseTimeMin[0] : e.courseTimeMin[1];
  const node = (id?: string): NodeDef | undefined => map.nodes.find((x) => x.id === id);
  const pts = [node(e.from), ...e.waypoints.map((w) => ({ x: w[0], z: w[1] })), node(e.to)].filter((p): p is { x: number; z: number } => Boolean(p));
  let len = 0;
  for (let i = 1; i < pts.length; i += 1) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
  return len / 50;
}

/** a と b を結ぶ（偽の道を除く）道 */
function edgesBetween(map: MapDef, a: string, b: string): EdgeDef[] {
  return map.edges.filter((e) => e.kind === 'trail' && e.to && ((e.from === a && e.to === b) || (e.from === b && e.to === a)));
}

/**
 * 同じ 2 地点を結ぶ道が 2 本以上ある区間を決める（map を書き換える）。コースタイムの短い道の途中（真ん中の頂点）で道を分けて経由点を作り、
 * ルートのその区間に経由点を入れる。同じ区間を往復するときは同じ経由点を通す。返り値は新しいルートと、決めた区間の説明
 */
export function disambiguateRoute(map: MapDef, route: readonly string[]): { route: string[]; notes: string[] } {
  const out: string[] = route.length ? [route[0]!] : [];
  const notes: string[] = [];
  const via = new Map<string, string>();
  const name = (id: string): string => map.nodes.find((x) => x.id === id)?.name || id;
  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const key = [a, b].sort().join('|');
    const done = via.get(key);
    if (done) {
      out.push(done, b);
      continue;
    }
    const es = edgesBetween(map, a, b);
    if (es.length < 2) {
      out.push(b);
      continue;
    }
    const best = es.reduce((x, y) => (edgeMinutes(map, y, a) < edgeMinutes(map, x, a) ? y : x));
    const minutes = Math.round(edgeMinutes(map, best, a));
    const ids = [...map.nodes.map((x) => x.id), ...map.edges.map((x) => x.id)];
    const nodeId = nextId(ids, 'N');
    const edgeId = nextId([...ids, nodeId], 'E');
    const w = best.waypoints;
    const na = map.nodes.find((x) => x.id === best.from)!;
    const nb = map.nodes.find((x) => x.id === best.to)!;
    const mid = w.length > 0 ? { x: w[Math.floor(w.length / 2)]![0], z: w[Math.floor(w.length / 2)]![1] } : { x: (na.x + nb.x) / 2, z: (na.z + nb.z) / 2 };
    splitEdge(map, best, mid, nodeId, edgeId);
    via.set(key, nodeId);
    out.push(nodeId, b);
    notes.push(`${name(a)}〜${name(b)}（道が ${es.length} 本）は、短いほうの ${best.id}（${minutes} 分ほど）に経由点 ${nodeId} を足して通るようにしました`);
  }
  return { route: out, notes };
}

/** ルートを決め直して入れる（道が 2 本ある区間があれば経由点を足す）。同じ Undo の単位で */
function setRoute(ed: Ed, label: string, route: string[], before?: () => void): void {
  // 道が 2 本ある区間がなく、道も足さないなら、地図は変えない（地図の作り直しを避ける）
  const ambiguous = route.some((b, i) => i > 0 && edgesBetween(ed.p.map, route[i - 1]!, b).length > 1);
  if (!ambiguous && !before) {
    ed.change(label, () => (ed.p.scenario.plan.route = route));
    return;
  }
  let notes: string[] = [];
  ed.change(label, () => {
    before?.();
    const r = disambiguateRoute(ed.p.map, route);
    ed.p.scenario.plan.route = r.route;
    notes = r.notes;
  }, true);
  if (notes.length) ed.toast(`${notes.join('。')}（Ctrl＋Z で戻せます）`, 8000);
}

/** いまのルートの、道が 2 本ある区間をまとめて決める（人と計画タブのボタン） */
export function fixAmbiguousRoute(ed: Ed): void {
  setRoute(ed, 'ルートの道を決める', [...ed.p.scenario.plan.route]);
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
    setRoute(ed, `${n.name} を ${near.name} につなぐ`, [...toNear, n.id], () => map.edges.push(edge));
    ed.toast(`${n.name}（${n.id}）はどの道にもつながっていなかったので、${d} m 先の ${near.name}（${near.id}）とつなぐ道 ${edge.id} を足しました（Ctrl＋Z で戻せます）`, 6000);
    return;
  }
  const r = appendToRoute(rt, route, n.id);
  if (!r) return ed.toast(routeFailMessage(map, n), 7000);
  setRoute(ed, 'ルート', r);
}
