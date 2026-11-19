// npm run make:real -- <scenarioId> — 実在の山のシナリオを実地形で動かすバンドルを作る（docs/16 §8 の手順を、座標で結合）。
// 作り方は public/scenarios/real/<scenarioId>.build.json（範囲・地点の座標・偽の道・速度係数・基地局）に書く。
// スケルトンマップを、国土地理院の標高タイル・OpenStreetMap の登山道・地理院ベクトルタイルの植生記号に結合し、
// public/scenarios/real/<scenarioId>.hakoniwa.json に書き出す。
//
// 注意:
// - 通信する（地理院の標高タイル・ベクトルタイル、Overpass 1 回）。応答は .scratch/geo-cache/ に保存し、2 回目からは通信しない。
// - 出力には地理院の標高を加工した地形と OSM 由来の登山道が入る。公開・再配布の前に、国土地理院コンテンツ利用規約・測量法上の承認の要否・
//   ODbL を人が確認すること（docs/15 §5）。そのため出力ファイルは .gitignore に入れてあり、リポジトリには含めない。
// - OSM に名前のない地点や、登山道ではない尾根・沢（偽の道）は、作者が標高から読み取った概略で、正確な位置ではない。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { baseElevationFor } from '../src/editor/geo/dem';
import { osmToGraph } from '../src/editor/geo/overpass';
import { toXZ } from '../src/editor/geo/projection';
import { buildVertexGraph, joinSkeleton, type VertexGraph } from '../src/editor/geo/skeleton';
import { vegOverridesFromSymbols } from '../src/editor/geo/vegsym';
import { ATTR } from '../src/editor/store/project';
import { runHeadless } from '../src/sim/headless';
import { validateScenario } from '../src/sim/scenario/validate';
import { encodeHeights } from '../src/sim/terrain/codec';
import { buildMapRuntime } from '../src/sim/terrain/map';
import type { EdgeDef, HakoniwaBundle, MapDef, NodeDef, RadioStationDef, ScenarioDef } from '../src/sim/types';
import { fetchHeights, fetchOsmCached, fetchVegSymbolsCached } from './lib/geo-node';
import { ROOT } from './lib/maps';

type TrailEdgeSpec = { id: string; name: string; from: string; to: string; points: [number, number][]; snap?: 'ridge' | 'valley' | 'none' };

/** 作り方（public/scenarios/real/<id>.build.json） */
export interface RealBuildSpec {
  /** スケルトンマップ（ROOT からの相対） */
  skeleton: string;
  mapId: string;
  center: [number, number];
  size: number;
  resolution?: 257 | 385 | 513;
  /** OSM などの緯度経度で置く地点 */
  at?: Record<string, [number, number]>;
  /** ローカル座標（x 東・z 南、m）で置く地点 */
  atXZ?: Record<string, [number, number]>;
  /** 結合で登山道に寄せる距離（既定 200 m）。これより遠ければ警告 */
  snapM?: number;
  /** コースタイム合わせの速度係数（エッジ ID → 倍率） */
  paceAdj?: Record<string, number>;
  /** 登山道ではない尾根・沢・踏み跡（偽の道）。points はローカル座標、各点はまわり snap m のいちばん高い（ridge）か低い（valley）ところへ寄せる */
  falseEdges?: {
    id: string;
    name: string;
    from: string;
    points: [number, number][];
    snap?: 'ridge' | 'valley' | 'none';
    fadeFrac?: number;
    markers?: number;
    drift?: number;
    attractiveness?: number;
    confuser?: { whenIntending: string[]; ambiguity: number };
  }[];
  /** OSM にない登山道・車道（作者が標高から読んだ筋）。from/to は地点 ID、points はローカル座標。頂点グラフに足してから結合する */
  trailEdges?: TrailEdgeSpec[];
  radio?: RadioStationDef[];
  /** 地理院の植生記号を使う（既定 true） */
  vegetation?: boolean;
}

const id = process.argv[2];
if (!id) {
  console.error('使い方: npm run make:real -- <scenarioId>');
  process.exit(1);
}
const spec = JSON.parse(readFileSync(resolve(ROOT, `public/scenarios/real/${id}.build.json`), 'utf8')) as RealBuildSpec;
const skeleton = JSON.parse(readFileSync(resolve(ROOT, spec.skeleton), 'utf8')) as MapDef;
const scenario = JSON.parse(readFileSync(resolve(ROOT, `public/scenarios/real/${id}.json`), 'utf8')) as ScenarioDef;
const [LAT0, LON0] = spec.center;
const SIZE = spec.size;
const N = spec.resolution ?? 513;

const dem = await fetchHeights(LAT0, LON0, SIZE, N, 1);
const cell = SIZE / (N - 1);
/** 双一次補間の標高 */
const elevAt = (x: number, z: number): number => {
  const fx = Math.min(N - 1.001, Math.max(0, (x + SIZE / 2) / cell));
  const fz = Math.min(N - 1.001, Math.max(0, (z + SIZE / 2) / cell));
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const h = (i: number, j: number): number => dem.heights[j * N + i] ?? 0;
  return (h(ix, iz) * (1 - tx) + h(ix + 1, iz) * tx) * (1 - tz) + (h(ix, iz + 1) * (1 - tx) + h(ix + 1, iz + 1) * tx) * tz;
};
const osm = await fetchOsmCached(LAT0, LON0, SIZE);
const og = osmToGraph(osm, LAT0, LON0, SIZE, elevAt);
const graph = buildVertexGraph(og.nodes, og.edges);

// ---- OSM にない登山道（作者が標高から読んだ筋。build.json の trailEdges）を頂点グラフに足す ----
const snapPt = (snap: string | undefined, x0: number, z0: number): [number, number] => {
  if (snap === 'none' || snap === undefined) return [x0, z0];
  const sign = snap === 'valley' ? -1 : 1;
  let bx = x0;
  let bz = z0;
  let be = -Infinity;
  for (let dz = -20; dz <= 20; dz += 4)
    for (let dx = -20; dx <= 20; dx += 4) {
      if (dx * dx + dz * dz > 400) continue;
      const e = sign * elevAt(x0 + dx, z0 + dz);
      if (e > be) (be = e), (bx = x0 + dx), (bz = z0 + dz);
    }
  return [bx, bz];
};
const posOf = (id: string): [number, number] => {
  const xz = spec.atXZ?.[id];
  if (xz) return xz;
  const ll = spec.at?.[id];
  if (!ll) throw new Error(`trailEdges: ${id} の位置がありません`);
  const p = toXZ(LAT0, LON0, { lat: ll[0], lon: ll[1] });
  return [p.x, p.z];
};
const nearestAny = (x: number, z: number): { v: number; d: number } => {
  let v = -1;
  let d = Infinity;
  for (let i = 0; i < graph.xs.length; i += 1) {
    const dd = Math.hypot(graph.xs[i]! - x, graph.zs[i]! - z);
    if (dd < d) (d = dd), (v = i);
  }
  return { v, d };
};
for (const te of spec.trailEdges ?? []) {
  const raw: [number, number][] = [posOf(te.from), ...te.points.map(([x, z]) => snapPt(te.snap, x, z)), posOf(te.to)];
  const dense: [number, number][] = [raw[0]!];
  for (let i = 1; i < raw.length; i += 1) {
    const [ax, az] = raw[i - 1]!;
    const [bx, bz] = raw[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 10));
    for (let k = 1; k <= n; k += 1) dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  const a = nearestAny(dense[0]![0], dense[0]![1]);
  const b = nearestAny(dense[dense.length - 1]![0], dense[dense.length - 1]![1]);
  let prev = -1;
  const first = graph.xs.length;
  for (const [x, z] of dense) {
    graph.xs.push(x);
    graph.zs.push(z);
    graph.adj.push([]);
    const v = graph.xs.length - 1;
    if (prev >= 0) (graph.adj[prev]!.push(v), graph.adj[v]!.push(prev));
    prev = v;
  }
  if (a.v >= 0 && a.d <= 60) (graph.adj[first]!.push(a.v), graph.adj[a.v]!.push(first));
  if (b.v >= 0 && b.d <= 60) (graph.adj[prev]!.push(b.v), graph.adj[b.v]!.push(prev));
  let len = 0;
  for (let i = 1; i < dense.length; i += 1) len += Math.hypot(dense[i]![0] - dense[i - 1]![0], dense[i]![1] - dense[i - 1]![1]);
  console.log(`手描きの道 ${te.id} ${te.name}: ${Math.round(len)} m（始点の接続 ${Math.round(a.d)} m、終点 ${Math.round(b.d)} m）  ${raw.filter((_, i) => i % 4 === 0).map((p) => Math.round(elevAt(p[0], p[1]))).join(' → ')} m`);
}

function componentOf(g: VertexGraph, start: number): Set<number> {
  const seen = new Set<number>([start]);
  const q = [start];
  while (q.length > 0) {
    const v = q.pop()!;
    for (const u of g.adj[v] ?? []) if (!seen.has(u)) (seen.add(u), q.push(u));
  }
  return seen;
}
function nearest(g: VertexGraph, x: number, z: number, within?: Set<number>): number {
  let best = -1;
  let bd = Infinity;
  for (let v = 0; v < g.xs.length; v += 1) {
    if (within && !within.has(v)) continue;
    const d = (g.xs[v]! - x) ** 2 + (g.zs[v]! - z) ** 2;
    if (d < bd) (bd = d), (best = v);
  }
  return best;
}
const pos0: Record<string, { x: number; z: number }> = {};
for (const [k, [x, z]] of Object.entries(spec.atXZ ?? {})) pos0[k] = { x, z };
for (const [k, [lat, lon]] of Object.entries(spec.at ?? {})) pos0[k] = toXZ(LAT0, LON0, { lat, lon });
// 地点の近くにある道のつながりのうち、いちばん大きいものを本線とする（離れた切れ端の道を拾わない）
let main = new Set<number>();
for (const p of Object.values(pos0)) {
  const c = componentOf(graph, nearest(graph, p.x, p.z));
  if (c.size > main.size) main = c;
}
if (main.size === 0) throw new Error('地点の近くに登山道がありません');
const bound: Record<string, { x: number; z: number }> = {};
for (const [k, p] of Object.entries(pos0)) {
  const v = nearest(graph, p.x, p.z, main);
  const d = Math.hypot(graph.xs[v]! - p.x, graph.zs[v]! - p.z);
  if (d > (spec.snapM ?? 200)) console.log(`⚠ ${k}: 登山道まで ${Math.round(d)} m`);
  bound[k] = { x: graph.xs[v]!, z: graph.zs[v]! };
}
const joined = joinSkeleton(skeleton, bound, graph, elevAt, { snapM: Math.max(400, spec.snapM ?? 200), order: scenario.plan.route });
for (const w of joined.warnings) console.log(`⚠ ${w}`);

// 偽の道: 点を尾根（高いところ）・谷（低いところ）に寄せる
const falseEdges: EdgeDef[] = [];
const confusers: Record<string, NonNullable<NodeDef['confusers']>> = {};
for (const f of spec.falseEdges ?? []) {
  const from = joined.nodes.find((n) => n.id === f.from);
  if (!from) throw new Error(`偽の道 ${f.id}: 起点 ${f.from} がありません`);
  const pts = f.points.map(([x0, z0]): [number, number] => {
    if (f.snap === 'none') return [x0, z0];
    const sign = f.snap === 'valley' ? -1 : 1;
    let bx = x0;
    let bz = z0;
    let be = -Infinity;
    for (let dz = -20; dz <= 20; dz += 4)
      for (let dx = -20; dx <= 20; dx += 4) {
        if (dx * dx + dz * dz > 400) continue;
        const e = sign * elevAt(x0 + dx, z0 + dz);
        if (e > be) (be = e), (bx = x0 + dx), (bz = z0 + dz);
      }
    return [bx, bz];
  });
  let len = Math.hypot(pts[0]![0] - from.x, pts[0]![1] - from.z);
  for (let i = 1; i < pts.length; i += 1) len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  console.log(`偽の道 ${f.id} ${f.name}: ${Math.round(len)} m  ${pts.filter((_, i) => i % 3 === 0).map((p) => Math.round(elevAt(p[0], p[1]))).join(' → ')} m`);
  falseEdges.push({
    id: f.id,
    name: f.name,
    kind: 'false',
    from: f.from,
    class: 'T2',
    markers: f.markers ?? 0.1,
    drift: f.drift ?? 0.05,
    sinuosity: 1,
    smooth: false,
    fadeOutM: Math.round(len * (f.fadeFrac ?? 0.45)),
    attractiveness: f.attractiveness ?? 0.8,
    waypoints: pts,
  });
  if (f.confuser) (confusers[f.from] ??= []).push({ edge: f.id, whenIntending: f.confuser.whenIntending, ambiguity: f.confuser.ambiguity });
}
const nodes = joined.nodes.map((n) => (confusers[n.id] ? { ...n, confusers: [...(n.confusers ?? []), ...confusers[n.id]!] } : n));

const enc = encodeHeights(dem.heights);
const map: MapDef = {
  ...skeleton,
  id: spec.mapId,
  skeleton: false,
  size: SIZE,
  resolution: N,
  geo: { centerLat: LAT0, centerLon: LON0, projection: 'local-tangent' },
  terrain: { type: 'heightmap', encoding: 'u16-base64', minElevM: enc.minElevM, maxElevM: enc.maxElevM, baseElevation: baseElevationFor(enc.minElevM), smoothingPasses: 1, source: { dem: 'DEM10B', zoom: 14, fetchedAt: new Date().toISOString() }, data: enc.data },
  nodes,
  edges: [...joined.edges.map((e) => (spec.paceAdj?.[e.id] ? { ...e, paceAdj: spec.paceAdj[e.id] } : e)), ...falseEdges],
  radio: { stations: spec.radio ?? [] },
  attribution: [ATTR.gsi, ATTR.osm],
};
delete map.areaHint;
if (spec.vegetation !== false) {
  const veg = await fetchVegSymbolsCached(LAT0, LON0, SIZE);
  const tally: Record<number, number> = {};
  for (const v of veg.symbols) tally[v.code] = (tally[v.code] ?? 0) + 1;
  const r0 = buildMapRuntime(map, { radio: false }).map;
  const ov = vegOverridesFromSymbols(r0, LAT0, LON0, veg.symbols);
  console.log(`植生記号: タイル ${veg.tiles} 枚、記号 ${JSON.stringify(tally)}、塗ったセル ${JSON.stringify(ov.counts)}`);
  map.vegetation = { ...map.vegetation, overrides: ov.overrides };
}

const s: ScenarioDef = { ...scenario, mapId: map.id };
const issues = validateScenario(s, map);
for (const i of issues) console.log(`${i.level === 'error' ? '✖' : '⚠'} ${i.path} ${i.message}`);
if (issues.some((i) => i.level === 'error')) process.exit(1);

const bundle: HakoniwaBundle = { format: 'hakoniwa-bundle', version: 1, createdAt: new Date().toISOString(), generator: `tools/make-real.ts ${id}`, map, scenario: s, attribution: [ATTR.gsi, ATTR.osm] };
const outDir = resolve(ROOT, 'public/scenarios/real');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `${id}.hakoniwa.json`);
writeFileSync(out, JSON.stringify(bundle));
console.log(`${out}  ${(JSON.stringify(bundle).length / 1024).toFixed(0)} KB`);

const rt = buildMapRuntime(map).map;
console.log(map.nodes.map((n) => `${n.name} ${Math.round(rt.nodes[n.id]!.elevM)} m（概略 ${n.expectedElevM ?? '?'}）  (${Math.round(n.x)}, ${Math.round(n.z)})`).join('\n'));
console.log(map.edges.map((e) => `${e.id} ${e.name} ${Math.round(rt.trails[e.id]!.lengthM)} m`).join('\n'));
const r = runHeadless(rt, s, { policy: 'recommended', seed: 1 });
console.log(`recommended 方針の試走: ${r.ending.kind}  終了 tMin=${Math.round(r.world.tMin)}`);
