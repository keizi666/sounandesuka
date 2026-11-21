/**
 * 登山道グラフ（docs/04 §5）: ポリライン化、隣接、ルート解決、ダイクストラ、エッジ上の位置。
 * 逆方向の移動は s を減らすだけで、別のポリラインは作らない。
 */
import { TUNING, type Tuning } from '../tuning';
import type { EdgeDef, EdgeId, MapRuntime, NodeId, TrailRuntime, TrailSample } from '../types';
import { trailPolyline } from './polyline';
import { sampleElev } from './sample';

/** ルートの 1 区間: エッジとその向き（+1 = from→to、-1 = to→from） */
export interface RouteLeg {
  edgeId: EdgeId;
  dir: 1 | -1;
  from: NodeId;
  to: NodeId;
}

/** waypoints の端点をノードの（スナップ後の）位置に合わせる */
function anchoredWaypoints(map: MapRuntime, e: EdgeDef): [number, number][] {
  const wps = e.waypoints.map(([x, z]) => [x, z] as [number, number]);
  const from = map.nodes[e.from];
  // 途中の点が 2 つ未満の短い道（OSM の短い区間、エディターで山頂の印とつないだ道など）は、両端の地点を足して形を作る
  // （置き換えるだけでは形ができず、長さ 0 の道になって歩けなかった）
  if (wps.length < 2 && from) {
    const to = e.to ? map.nodes[e.to] : undefined;
    return [[from.x, from.z], ...wps, ...(to ? [[to.x, to.z] as [number, number]] : wps.length === 0 ? [[from.x, from.z] as [number, number]] : [])];
  }
  if (from && wps.length > 0) wps[0] = [from.x, from.z];
  if (e.to) {
    const to = map.nodes[e.to];
    if (to && wps.length > 1) wps[wps.length - 1] = [to.x, to.z];
  }
  return wps;
}

export function buildTrailRuntime(map: MapRuntime, e: EdgeDef, tuning: Tuning = TUNING): TrailRuntime {
  const pts = trailPolyline(anchoredWaypoints(map, e), e.smooth !== false, tuning.trails.sampleStepM);
  const samples: TrailSample[] = pts.map((p) => ({
    x: p.x,
    z: p.z,
    elevM: sampleElev(map, p.x, p.z),
    sH: p.sH,
    s: p.sH * e.sinuosity,
  }));
  // 両端が同じ所（山頂へ寄せた地点とすぐ横の印など）でも、区間として扱えるようサンプルを 2 つ以上にする
  while (samples.length > 0 && samples.length < 2) samples.push({ ...samples[0]! });
  const last = samples[samples.length - 1];
  return { def: e, samples, lengthM: last ? last.s : 0 };
}

/** map.trails と map.adjacency を埋める（buildMapRuntime から呼ぶ） */
export function buildTrails(map: MapRuntime, tuning: Tuning = TUNING): void {
  const trails: Record<EdgeId, TrailRuntime> = {};
  const adjacency: Record<NodeId, EdgeId[]> = {};
  for (const id of Object.keys(map.nodes)) adjacency[id] = [];
  for (const e of map.def.edges) {
    trails[e.id] = buildTrailRuntime(map, e, tuning);
    adjacency[e.from]?.push(e.id);
    if (e.to && e.to !== e.from) adjacency[e.to]?.push(e.id);
  }
  map.trails = trails;
  map.adjacency = adjacency;
}

/** a と b を直接結ぶ正規の道（偽の道は含めない）。0 本・2 本以上ならエラー文を返す */
export function edgeBetween(map: MapRuntime, a: NodeId, b: NodeId): { leg: RouteLeg } | { error: string } {
  const found: RouteLeg[] = [];
  for (const id of map.adjacency[a] ?? []) {
    const e = map.trails[id]!.def;
    if (e.kind !== 'trail' || !e.to) continue;
    if (e.from === a && e.to === b) found.push({ edgeId: id, dir: 1, from: a, to: b });
    else if (e.to === a && e.from === b) found.push({ edgeId: id, dir: -1, from: a, to: b });
  }
  if (found.length === 1) return { leg: found[0]! };
  if (found.length === 0) return { error: `${a} と ${b} を結ぶ登山道がありません` };
  return { error: `${a} と ${b} を結ぶ登山道が ${found.length} 本あり、一意に決まりません` };
}

/** ノード列をエッジ列に解決する。解決できなければ例外 */
export function resolveRoute(map: MapRuntime, route: readonly NodeId[]): RouteLeg[] {
  const legs: RouteLeg[] = [];
  for (let i = 0; i + 1 < route.length; i += 1) {
    const r = edgeBetween(map, route[i]!, route[i + 1]!);
    if ('error' in r) throw new Error(`ルート[${i}→${i + 1}]: ${r.error}`);
    legs.push(r.leg);
  }
  return legs;
}

/** その向きでの標準コースタイム（分）。マップに書かれていなければ長さと標準速度から概算 */
export function legCourseTimeMin(map: MapRuntime, leg: RouteLeg, tuning: Tuning = TUNING): number {
  const t = map.trails[leg.edgeId]!;
  const ct = t.def.courseTimeMin;
  if (ct) return leg.dir === 1 ? ct[0] : ct[1];
  return t.lengthM / tuning.trails.fallbackSpeedMPerMin;
}

/**
 * ダイクストラ（重み = 標準コースタイム、偽の道は通らない）。同じ重みはノード ID の辞書順で決める。
 * 到達できなければ null。
 */
export function shortestPath(map: MapRuntime, from: NodeId, to: NodeId, tuning: Tuning = TUNING): NodeId[] | null {
  if (from === to) return [from];
  const dist: Record<NodeId, number> = { [from]: 0 };
  const prev: Record<NodeId, NodeId> = {};
  const done = new Set<NodeId>();
  for (;;) {
    let u: NodeId | null = null;
    let best = Infinity;
    for (const [id, d] of Object.entries(dist)) {
      if (done.has(id)) continue;
      if (d < best || (d === best && u !== null && id < u)) {
        best = d;
        u = id;
      }
    }
    if (u === null) return null;
    if (u === to) break;
    done.add(u);
    for (const id of map.adjacency[u] ?? []) {
      const e = map.trails[id]!.def;
      if (e.kind !== 'trail' || !e.to) continue;
      const v = e.from === u ? e.to : e.from;
      const leg: RouteLeg = { edgeId: id, dir: e.from === u ? 1 : -1, from: u, to: v };
      const nd = best + legCourseTimeMin(map, leg, tuning);
      if (nd < (dist[v] ?? Infinity)) {
        dist[v] = nd;
        prev[v] = u;
      }
    }
  }
  const path: NodeId[] = [to];
  while (path[0] !== from) path.unshift(prev[path[0]!]!);
  return path;
}

/** s を含むサンプル区間の添字（samples[i].s ≤ s ≤ samples[i+1].s） */
export function segmentIndexAt(t: TrailRuntime, s: number): number {
  const smp = t.samples;
  let lo = 0;
  let hi = smp.length - 2;
  if (hi <= 0) return 0;
  if (s <= smp[0]!.s) return 0;
  if (s >= smp[hi]!.s) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (smp[mid]!.s <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** エッジ上の位置 s（実距離）の座標・標高 */
export function pointOnTrail(t: TrailRuntime, s: number): { x: number; z: number; elevM: number } {
  const smp = t.samples;
  if (smp.length === 1) return { x: smp[0]!.x, z: smp[0]!.z, elevM: smp[0]!.elevM };
  const i = segmentIndexAt(t, s);
  const a = smp[i]!;
  const b = smp[i + 1]!;
  const span = b.s - a.s;
  const f = span > 0 ? Math.min(1, Math.max(0, (s - a.s) / span)) : 0;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, elevM: a.elevM + (b.elevM - a.elevM) * f };
}
