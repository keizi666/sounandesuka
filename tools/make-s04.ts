// npm run make:s04 — 史実シナリオ s04 を実地形で動かすためのバンドルを作る（docs/13 P19、docs/16 §8）。
// スケルトンマップ（public/maps/historical/tomuraushi.skeleton.json）を、国土地理院の標高タイルと OpenStreetMap の登山道に結合し、
// public/scenarios/historical/s04_tomuraushi_2009.sounan.json に書き出す。
//
// 注意:
// - 通信する（地理院の標高タイル約 64 枚、Overpass 1 回）。応答は .scratch/geo-cache/ に保存し、2 回目からは通信しない。
// - 出力には地理院の標高を加工した地形と OSM 由来の登山道が入る。公開・再配布の前に、国土地理院コンテンツ利用規約・測量法上の承認の要否・
//   ODbL を人が確認すること（docs/15 §5）。そのため出力ファイルは .gitignore に入れてあり、リポジトリには含めない。
// - 名前が OSM にない地点（日本庭園・ロックガーデン・各分岐・南沼・トムラウシ公園・前トム平・カムイ天上など）は、
//   計画ルートに沿って概略標高が合う位置に置いた下書きであり、正確な位置ではない。エディターで読み込んで直せる。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { baseElevationFor } from '../src/editor/geo/dem';
import { osmToGraph } from '../src/editor/geo/overpass';
import { buildVertexGraph, joinSkeleton, namedPoints, nearestVertex, tracePath } from '../src/editor/geo/skeleton';
import { ATTR } from '../src/editor/store/project';
import { paintCircle } from '../src/editor/map/tools';
import { runHeadless } from '../src/sim/headless';
import { validateScenario } from '../src/sim/scenario/validate';
import { encodeHeights } from '../src/sim/terrain/codec';
import { buildMapRuntime } from '../src/sim/terrain/map';
import type { SounanBundle, MapDef, ScenarioDef } from '../src/sim/types';
import { fetchHeights, fetchOsmCached } from './lib/geo-node';
import { ROOT } from './lib/maps';

// エリア: トムラウシ山の山頂付近を中心に 12.288 km（513 頂点、セル 24 m）。ヒサゴ沼避難小屋から短縮コース登山口までが入る
const LAT0 = 43.526;
const LON0 = 142.846;
const SIZE = 12288;
const N = 513;
/** 名前で結び付けるノード（OSM の名前）。作者の判断で決めたもの */
const BIND: Record<string, string> = { HISAGO_HUT: 'ヒサゴ沼', AMANUMA: '天沼', KITANUMA_FORD: '北沼', SUMMIT: 'トムラウシ山', TANSHUKU_TH: '短縮コース登山口' };

const PACE_ADJ: Record<string, number> = { T01: 1.4, T05: 1.4 };

const skeleton = JSON.parse(readFileSync(resolve(ROOT, 'public/maps/historical/tomuraushi.skeleton.json'), 'utf8')) as MapDef;
const scenario = JSON.parse(readFileSync(resolve(ROOT, 'public/scenarios/historical/s04_tomuraushi_2009.json'), 'utf8')) as ScenarioDef;

const dem = await fetchHeights(LAT0, LON0, SIZE, N, 1);
const cell = SIZE / (N - 1);
const elevAt = (x: number, z: number): number => dem.heights[Math.min(N - 1, Math.max(0, Math.round((z + SIZE / 2) / cell))) * N + Math.min(N - 1, Math.max(0, Math.round((x + SIZE / 2) / cell)))] ?? 0;
const osm = await fetchOsmCached(LAT0, LON0, SIZE);
const og = osmToGraph(osm, LAT0, LON0, SIZE, elevAt);
const graph = buildVertexGraph(og.nodes, og.edges);
const points = namedPoints(osm, LAT0, LON0, SIZE);
const bound: Record<string, { x: number; z: number }> = {};
for (const [id, name] of Object.entries(BIND)) {
  const p = points.find((q) => q.name === name);
  if (!p) throw new Error(`OSM に「${name}」が見つかりません`);
  bound[id] = { x: p.x, z: p.z };
}
// 標高がほぼ同じで補間では決まらない地点は、渡渉点からルートに沿った概略の距離で置く（作者の概算。正確な位置ではない）
const ALONG_FROM_FORD: Record<string, number> = { KITANUMA_JCT: 150, TOMU_JCT: 1050, MINAMINUMA: 1300 };
{
  const a = nearestVertex(graph, bound['KITANUMA_FORD']!.x, bound['KITANUMA_FORD']!.z).v;
  const b = nearestVertex(graph, bound['TANSHUKU_TH']!.x, bound['TANSHUKU_TH']!.z).v;
  const path = tracePath(graph, a, b);
  if (!path) throw new Error('渡渉点から登山口までの登山道がつながっていません');
  let d = 0;
  const todo = Object.entries(ALONG_FROM_FORD).sort((x, y) => x[1] - y[1]);
  for (let i = 1; i < path.length && todo.length > 0; i += 1) {
    d += Math.hypot(graph.xs[path[i]!]! - graph.xs[path[i - 1]!]!, graph.zs[path[i]!]! - graph.zs[path[i - 1]!]!);
    while (todo.length > 0 && d >= todo[0]![1]) bound[todo.shift()![0]] = { x: graph.xs[path[i]!]!, z: graph.zs[path[i]!]! };
  }
}
const joined = joinSkeleton(skeleton, bound, graph, elevAt, { snapM: 500, order: scenario.plan.route });
for (const w of joined.warnings) console.log(`⚠ ${w}`);
console.log(`名前で結合: ${joined.matched.join(', ')}`);
console.log(`補間で配置（要確認）: ${joined.interpolated.join(', ')}`);

const enc = encodeHeights(dem.heights);
let map: MapDef = {
  ...skeleton,
  id: 'tomuraushi',
  skeleton: false,
  size: SIZE,
  resolution: N,
  geo: { centerLat: LAT0, centerLon: LON0, projection: 'local-tangent' },
  terrain: { type: 'heightmap', encoding: 'u16-base64', minElevM: enc.minElevM, maxElevM: enc.maxElevM, baseElevation: baseElevationFor(enc.minElevM), smoothingPasses: 1, source: { dem: 'DEM10B', zoom: 14, fetchedAt: new Date().toISOString() }, data: enc.data },
  nodes: joined.nodes,
  // 記録の通過時刻に合わせた速度係数（docs/16 §4.4。ロックガーデン 08:30 → 北沼 10:00 の約 1.5 時間、小屋 05:30 → 天沼 06:10）
  edges: joined.edges.map((e) => (PACE_ADJ[e.id] ? { ...e, paceAdj: PACE_ADJ[e.id] } : e)),
  // 基地局: 南東（十勝側）の低い方角。山頂の北側（北沼）は山陰になる
  radio: { stations: [{ id: 'st1', x: 9000, z: 14000, elevM: 500, antennaM: 40, rangeM: 25000 }] },
  attribution: [ATTR.gsi, ATTR.osm],
};
delete map.areaHint;
// 電波の塗り（areaHint: 北沼付近は圏外、南沼・前トム平付近は通話できた記録）
const at = (id: string): { x: number; z: number } => map.nodes.find((n) => n.id === id)!;
let paint = map.radio.paint;
for (const id of ['KITANUMA_FORD', 'KITANUMA_JCT']) paint = paintCircle(paint, map, at(id).x, at(id).z, 500, 255);
for (const id of ['MINAMINUMA', 'MAETOMU']) paint = paintCircle(paint, map, at(id).x, at(id).z, 300, 1);
map = { ...map, radio: { ...map.radio, paint } };

const s: ScenarioDef = { ...scenario, mapId: map.id };
const issues = validateScenario(s, map);
for (const i of issues) console.log(`${i.level === 'error' ? '✖' : '⚠'} ${i.path} ${i.message}`);
if (issues.some((i) => i.level === 'error')) process.exit(1);

const bundle: SounanBundle = { format: 'sounan-bundle', version: 1, createdAt: new Date().toISOString(), generator: 'tools/make-s04.ts', map, scenario: s, attribution: [ATTR.gsi, ATTR.osm] };
const outDir = resolve(ROOT, 'public/scenarios/historical');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, 's04_tomuraushi_2009.sounan.json');
writeFileSync(out, JSON.stringify(bundle));
console.log(`${out}  ${(JSON.stringify(bundle).length / 1024).toFixed(0)} KB`);

// 確認: 地点の標高と、記録どおりの方針での 1 回の試走
const rt = buildMapRuntime(map).map;
console.log(map.nodes.map((n) => `${n.name} ${Math.round(rt.nodes[n.id]!.elevM)} m（概略 ${n.expectedElevM ?? '?'}）`).join('\n'));
console.log(map.edges.map((e) => `${e.id} ${e.name} ${Math.round(rt.trails[e.id]!.lengthM)} m`).join('\n'));
const r = runHeadless(rt, s, { policy: 'historical' });
console.log(`historical 方針の試走: ${r.ending.kind}  死亡 ${r.world.climbers.filter((c) => !c.body.alive).length} 人  終了 tMin=${Math.round(r.world.tMin)}`);
