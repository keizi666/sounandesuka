/**
 * 地図の道具に共通の処理: 当たり判定（ノード・エッジ・危険箇所）、塗りのブラシ、ID の一括書き換え、ルートの自動補完。
 */
import { decodeGrid, encodeGrid } from '../../sim/terrain/codec';
import { shortestPath } from '../../sim/terrain/trails';
import type { EdgeDef, GridOverride, MapDef, MapRuntime, NodeDef, ScenarioDef } from '../../sim/types';
import type { TileMapView } from './TileMapView';

export function edgePoints(map: MapDef, rt: MapRuntime | null, e: EdgeDef): { x: number; z: number }[] {
  const s = rt?.trails[e.id]?.samples;
  if (s) return s.map((p) => ({ x: p.x, z: p.z }));
  const node = (id?: string): NodeDef | undefined => map.nodes.find((n) => n.id === id);
  return [node(e.from), ...e.waypoints.map((w) => ({ x: w[0], z: w[1] })), node(e.to)].filter((p): p is { x: number; z: number } => Boolean(p));
}

export function hitNode(v: TileMapView, map: MapDef, px: number, py: number, radiusPx = 9): NodeDef | null {
  let best: NodeDef | null = null;
  let bd = radiusPx;
  for (const n of map.nodes) {
    const p = v.xzToPx(n.x, n.z);
    const d = Math.hypot(p.px - px, p.py - py);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return { d: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t };
}

/** 画面上でいちばん近いエッジと、その上の点（頂点の番号と比率） */
export function hitEdge(v: TileMapView, map: MapDef, rt: MapRuntime | null, px: number, py: number, radiusPx = 7): { edge: EdgeDef; index: number; t: number } | null {
  let best: { edge: EdgeDef; index: number; t: number } | null = null;
  let bd = radiusPx;
  for (const e of map.edges) {
    const pts = edgePoints(map, rt, e).map((q) => v.xzToPx(q.x, q.z));
    for (let i = 1; i < pts.length; i += 1) {
      const r = segDist(px, py, pts[i - 1]!.px, pts[i - 1]!.py, pts[i]!.px, pts[i]!.py);
      if (r.d < bd) {
        bd = r.d;
        best = { edge: e, index: i - 1, t: r.t };
      }
    }
  }
  return best;
}

export function hitHazard(v: TileMapView, map: MapDef, px: number, py: number): MapDef['hazards'][number] | null {
  for (const h of map.hazards) {
    if (!('x' in h)) continue;
    const p = v.xzToPx(h.x, h.z);
    if (Math.hypot(p.px - px, p.py - py) < Math.max(8, h.radius * v.pxPerM())) return h;
  }
  return null;
}

/** 塗り直しのグリッドに円を塗る（value 0 で消す） */
export function paintCircle(grid: GridOverride | undefined, map: MapDef, x: number, z: number, radiusM: number, value: number): GridOverride {
  const n = map.resolution;
  const d = grid ? decodeGrid(grid, n * n) : new Uint8Array(n * n);
  const cell = map.size / (n - 1);
  const half = map.size / 2;
  const cx = (x + half) / cell;
  const cz = (z + half) / cell;
  const r = radiusM / cell;
  for (let iz = Math.max(0, Math.floor(cz - r)); iz <= Math.min(n - 1, Math.ceil(cz + r)); iz += 1)
    for (let ix = Math.max(0, Math.floor(cx - r)); ix <= Math.min(n - 1, Math.ceil(cx + r)); ix += 1)
      if ((ix - cx) ** 2 + (iz - cz) ** 2 <= r * r) d[iz * n + ix] = value & 255;
  return encodeGrid(d);
}

/** ノード ID を変え、マップとシナリオの参照を一括で書き換える（docs/16 §5） */
export function renameNode(map: MapDef, scenario: ScenarioDef, from: string, to: string): ScenarioDef {
  for (const n of map.nodes) if (n.id === from) n.id = to;
  for (const e of map.edges) {
    if (e.from === from) e.from = to;
    if (e.to === from) e.to = to;
  }
  return JSON.parse(JSON.stringify(scenario).split(`"${from}"`).join(`"${to}"`)) as ScenarioDef;
}

export function renameEdge(map: MapDef, scenario: ScenarioDef, from: string, to: string): ScenarioDef {
  for (const e of map.edges) if (e.id === from) e.id = to;
  for (const n of map.nodes)
    for (const c of n.confusers ?? []) {
      if (c.edge === from) c.edge = to;
      c.whenIntending = c.whenIntending.map((x) => (x === from ? to : x));
    }
  for (const h of map.hazards) if ('onEdge' in h && h.onEdge === from) h.onEdge = to;
  return JSON.parse(JSON.stringify(scenario).split(`"${from}"`).join(`"${to}"`)) as ScenarioDef;
}

/** ルートの末尾にノードを足す（隣接していなければ最短経路で補う） */
/**
 * ルートに足せなかったときの説明。どの道にもつながらない地点（道の脇の山頂の印など）なら、そばのつながった地点を示す。
 * つながっている地点なら、道が重なって見えても途中でつながっていない場合の手がかりを出す
 */
/** ない道を指す紛らわしさ（confusers）を消す。消した数を返す */
export function pruneConfusers(map: MapDef): number {
  const ids = new Set(map.edges.map((e) => e.id));
  let removed = 0;
  for (const n of map.nodes) {
    if (!n.confusers) continue;
    const before = n.confusers.length;
    n.confusers = n.confusers
      .map((c) => ({ ...c, whenIntending: c.whenIntending.filter((w) => ids.has(w)) }))
      .filter((c) => ids.has(c.edge) && c.whenIntending.length > 0);
    removed += before - n.confusers.length;
    if (n.confusers.length === 0) delete n.confusers;
  }
  return removed;
}

export function routeFailMessage(map: MapDef, n: NodeDef): string {
  const linked = (id: string): boolean => map.edges.some((e) => e.kind === 'trail' && (e.from === id || e.to === id));
  if (!linked(n.id)) {
    const near = map.nodes
      .filter((x) => x.id !== n.id && linked(x.id))
      .map((x) => ({ x, d: Math.hypot(x.x - n.x, x.z - n.z) }))
      .filter((o) => o.d < 150)
      .sort((a, b) => a.d - b.d)[0];
    return `${n.name}（${n.id}）はどの道にもつながっていない地点です。${near ? `すぐそば（${Math.round(near.d)} m）の ${near.x.name}（${near.x.id}）を選んでください。` : '登山道タブで道を描いてつないでください。'}`;
  }
  return `${n.name} へつながる道がありません。道が重なって見えても、端が地点でなく道の途中にあるとつながっていません（登山道タブの「ノードを挿入」で分岐点を作るか、手描きの道を描き直してください）`;
}

export function appendToRoute(rt: MapRuntime, route: string[], id: string): string[] | null {
  const last = route[route.length - 1];
  if (!last) return [id];
  if (last === id) return route;
  const path = shortestPath(rt, last, id);
  if (!path) return null;
  return [...route, ...path.slice(1)];
}

/** エッジを頂点 index の位置で 2 つに分け、間にノードを入れる */
export function splitEdge(map: MapDef, e: EdgeDef, at: { x: number; z: number }, nodeId: string, newEdgeId: string, existing?: NodeDef): void {
  const pts = e.waypoints;
  // 最も近い waypoint で分ける
  let k = 0;
  let bd = Infinity;
  pts.forEach((w, i) => {
    const d = Math.hypot(w[0] - at.x, w[1] - at.z);
    if (d < bd) {
      bd = d;
      k = i;
    }
  });
  // existing: もうある地点（どこにもつながっていない地点を道の上に置いたとき）をそのまま分かれ目にする
  if (!existing) map.nodes.push({ id: nodeId, name: nodeId, type: 'junction', x: at.x, z: at.z, snap: false, source: 'manual' });
  const second: EdgeDef = { ...structuredClone(e), id: newEdgeId, from: nodeId, waypoints: pts.slice(k + 1), name: `${e.name}（2）` };
  e.to = nodeId;
  e.waypoints = pts.slice(0, k);
  if (e.courseTimeMin) {
    e.courseTimeMin = undefined;
    second.courseTimeMin = undefined;
  }
  map.edges.push(second);
}

/** 2 本のエッジを共有ノードでつなぐ（ノードの次数が 2 のとき） */
export function mergeEdges(map: MapDef, a: EdgeDef, b: EdgeDef): boolean {
  const shared = [a.from, a.to].find((x) => x && (x === b.from || x === b.to));
  if (!shared) return false;
  const deg = map.edges.filter((e) => e.from === shared || e.to === shared).length;
  if (deg !== 2) return false;
  const node = map.nodes.find((n) => n.id === shared)!;
  const aPts = a.to === shared ? a.waypoints : [...a.waypoints].reverse();
  const aStart = a.to === shared ? a.from : a.to!;
  const bPts = b.from === shared ? b.waypoints : [...b.waypoints].reverse();
  const bEnd = b.from === shared ? b.to : b.from;
  a.from = aStart;
  a.to = bEnd;
  a.waypoints = [...aPts, [node.x, node.z], ...bPts];
  map.edges.splice(map.edges.indexOf(b), 1);
  map.nodes.splice(map.nodes.indexOf(node), 1);
  return true;
}

export function reverseEdge(e: EdgeDef): void {
  if (!e.to) return;
  [e.from, e.to] = [e.to, e.from];
  e.waypoints = [...e.waypoints].reverse();
  if (e.courseTimeMin) e.courseTimeMin = [e.courseTimeMin[1], e.courseTimeMin[0]];
}

/** ルート（地点の並び）の a→b・b→a の間に n を入れる */
function insertBetween(route: string[], a: string, b: string, n: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < route.length; i += 1) {
    out.push(route[i]!);
    const nx = route[i + 1];
    if ((route[i] === a && nx === b) || (route[i] === b && nx === a)) out.push(n);
  }
  return out;
}

/**
 * 道に地点を挿入し、その道を通るルート（計画ルートと、選択肢・イベントの setRoute）にも地点を足す
 * （ユーザーの指摘: 道に地点を足すと、その道を通る選択肢のルートが「道が 1 本に決まらない」になった）
 */
export function insertNodeOnEdge(map: MapDef, scenario: ScenarioDef, e: EdgeDef, at: { x: number; z: number }, nodeId: string, newEdgeId: string, existing?: NodeDef): void {
  const a = e.from;
  const b = e.to;
  splitEdge(map, e, at, nodeId, newEdgeId, existing);
  if (!b) return;
  scenario.plan.route = insertBetween(scenario.plan.route, a, b, nodeId);
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (o['type'] === 'setRoute' && Array.isArray(o['route'])) o['route'] = insertBetween(o['route'] as string[], a, b, nodeId);
    for (const k of Object.keys(o)) if (k !== 'route') walk(o[k]);
  };
  walk(scenario.choices);
  walk(scenario.genericOverrides);
  walk(scenario.events);
  walk(scenario.groups);
}

/**
 * 道の上（maxM 以内）にあるのに、その道の分かれ目になっていない地点（ユーザーの指摘: 大曲が道の上にあるのにつながっておらず、ルートが 1 周遠回りした）。
 * 道の端（両端の地点）から endM 以内は除く。地点ごとに、いちばん近い道を 1 本返す
 */
export function nodesOnEdges(map: MapDef, maxM = 6, endM = 15): { node: NodeDef; edge: EdgeDef; d: number }[] {
  const nodeById = new Map(map.nodes.map((n) => [n.id, n]));
  const lines = map.edges
    .filter((e) => e.kind === 'trail' && e.to)
    .map((e) => {
      const pts = edgePoints(map, null, e);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of pts) {
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
      }
      return { e, pts, x0: x0 - maxM, x1: x1 + maxM, z0: z0 - maxM, z1: z1 + maxM, a: nodeById.get(e.from), b: nodeById.get(e.to!) };
    });
  const out: { node: NodeDef; edge: EdgeDef; d: number }[] = [];
  for (const n of map.nodes) {
    let best: { edge: EdgeDef; d: number } | null = null;
    for (const l of lines) {
      if (l.e.from === n.id || l.e.to === n.id) continue;
      if (n.x < l.x0 || n.x > l.x1 || n.z < l.z0 || n.z > l.z1) continue;
      if ((l.a && Math.hypot(l.a.x - n.x, l.a.z - n.z) < endM) || (l.b && Math.hypot(l.b.x - n.x, l.b.z - n.z) < endM)) continue;
      for (let i = 1; i < l.pts.length; i += 1) {
        const p = l.pts[i - 1]!;
        const q = l.pts[i]!;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const L = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((n.x - p.x) * dx + (n.z - p.z) * dz) / L));
        const d = Math.hypot(p.x + t * dx - n.x, p.z + t * dz - n.z);
        if (d <= maxM && (!best || d < best.d)) best = { edge: l.e, d };
      }
    }
    if (best) out.push({ node: n, ...best });
  }
  return out;
}

