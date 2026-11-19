// npm run make:s05 — 架空遭難シナリオ s05（奥多摩・笙ノ岩山）を実地形で動かすためのバンドルを作る（docs/16 §8 の手順を、名前ではなく座標で結合）。
// スケルトンマップ（public/maps/real/shounoiwa.skeleton.json）を、国土地理院の標高タイルと OpenStreetMap の登山道に結合し、
// public/scenarios/real/s05_shounoiwa.hakoniwa.json に書き出す。
//
// 注意:
// - 通信する（地理院の標高タイル、Overpass 1 回）。応答は .scratch/geo-cache/ に保存し、2 回目からは通信しない。
// - 出力には地理院の標高を加工した地形と OSM 由来の登山道が入る。公開・再配布の前に、国土地理院コンテンツ利用規約・測量法上の承認の要否・
//   ODbL を人が確認すること（docs/15 §5）。そのため出力ファイルは .gitignore に入れてあり、リポジトリには含めない。
// - 東日原・川乗橋（OSM のバス停）、蕎麦粒山・仙元峠・笙ノ岩山（OSM の山頂）は OSM の座標で置く。一杯水避難小屋は OSM にないため、
//   ヨコスズ尾根が長沢背稜に出る分岐に置いた（作者の判断。正確な位置ではない）。
// - 925 m 標高点の尾根（笙ノ岩山の南の肩から南西へ分かれる尾根）は登山道ではない。標高から尾根筋をたどって「偽の道」（kind: false）にした。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { baseElevationFor } from '../src/editor/geo/dem';
import { osmToGraph } from '../src/editor/geo/overpass';
import { toXZ } from '../src/editor/geo/projection';
import { buildVertexGraph, joinSkeleton, type VertexGraph } from '../src/editor/geo/skeleton';
import { ATTR } from '../src/editor/store/project';
import { runHeadless } from '../src/sim/headless';
import { validateScenario } from '../src/sim/scenario/validate';
import { encodeHeights } from '../src/sim/terrain/codec';
import { buildMapRuntime } from '../src/sim/terrain/map';
import type { EdgeDef, HakoniwaBundle, MapDef, ScenarioDef } from '../src/sim/types';
import { fetchHeights, fetchOsmCached } from './lib/geo-node';
import { ROOT } from './lib/maps';

// エリア: 東日原から蕎麦粒山・川乗橋までが入る 6.144 km（513 頂点、セル 12 m）
const LAT0 = 35.853;
const LON0 = 139.064;
const SIZE = 6144;
const N = 513;
/** OSM の座標（バス停・山頂）。一杯水避難小屋は分岐の位置（概略） */
const AT: Record<string, { lat: number; lon: number }> = {
  TH_HIGASHINIPPARA: { lat: 35.84177, lon: 139.04453 },
  SENGEN: { lat: 35.87484, lon: 139.08258 },
  SOBATSUBU: { lat: 35.87215, lon: 139.08719 },
  SHOUNOIWA: { lat: 35.8518, lon: 139.0787 },
  TH_KAWANORI: { lat: 35.83176, lon: 139.07632 },
};
/** ローカル座標で置く地点（x 東・z 南、m） */
const AT_XZ: Record<string, { x: number; z: number }> = {
  IPPAI_HUT: { x: -516, z: -2121 },
  // 鳥屋戸尾根が南へ曲がり、925 m 標高点の尾根がまっすぐ南西へ分かれるところ
  SPUR_JCT: { x: 1300, z: 398 },
};
/**
 * 925 m 標高点の尾根の尾根筋（作者が 40 m 格子の標高から読み取った点。ローカル座標 x 東・z 南）。
 * 南の肩から西南西へ下って標高 1,000 m 付近で南南西へ向きを変え、925 m 標高点を通って日原川の方へ落ちる。各点はまわり 20 m のいちばん高いところへ寄せる
 */
const SPUR_PTS: [number, number][] = [
  [1262, 410], [1222, 430], [1182, 462], [1145, 500], [1140, 540], [1130, 580], [1090, 605], [1050, 615], [1010, 625], [980, 645],
  [955, 690], [925, 740], [902, 790], [882, 840], [862, 880], [832, 920], [812, 960], [795, 1010], [783, 1060], [780, 1110],
];

/** コースタイムに合わせた速度係数（一杯水→蕎麦粒山 約 1 時間 10 分、蕎麦粒山→笙ノ岩山 約 1 時間、笙ノ岩山→川乗橋 約 1 時間 40 分） */
const PACE_ADJ: Record<string, number> = { E2: 1.15, E3: 1.1, E4: 1.3, E5: 1.2, E6: 1.35 };

const skeleton = JSON.parse(readFileSync(resolve(ROOT, 'public/maps/real/shounoiwa.skeleton.json'), 'utf8')) as MapDef;
const scenario = JSON.parse(readFileSync(resolve(ROOT, 'public/scenarios/real/s05_shounoiwa.json'), 'utf8')) as ScenarioDef;

const dem = await fetchHeights(LAT0, LON0, SIZE, N, 1);
const cell = SIZE / (N - 1);
const elevAt = (x: number, z: number): number => {
  // 双一次補間（尾根をたどるのに格子の段差を拾わない）
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

/** つながった登山道の中で一番近い頂点（離れた切れ端の道を拾わない） */
function nearestInComponent(g: VertexGraph, comp: Set<number>, x: number, z: number): number {
  let best = -1;
  let bd = Infinity;
  for (const v of comp) {
    const d = (g.xs[v]! - x) ** 2 + (g.zs[v]! - z) ** 2;
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
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
const pos0: Record<string, { x: number; z: number }> = { ...AT_XZ };
for (const [id, ll] of Object.entries(AT)) pos0[id] = toXZ(LAT0, LON0, ll);
// 蕎麦粒山を含むつながりを本線とする
let seed = -1;
{
  let bd = Infinity;
  for (let v = 0; v < graph.xs.length; v += 1) {
    const d = (graph.xs[v]! - pos0['SOBATSUBU']!.x) ** 2 + (graph.zs[v]! - pos0['SOBATSUBU']!.z) ** 2;
    if (d < bd) (bd = d), (seed = v);
  }
}
const comp = componentOf(graph, seed);
const bound: Record<string, { x: number; z: number }> = {};
for (const [id, p] of Object.entries(pos0)) {
  const v = nearestInComponent(graph, comp, p.x, p.z);
  const d = Math.hypot(graph.xs[v]! - p.x, graph.zs[v]! - p.z);
  if (d > 150) console.log(`⚠ ${id}: 登山道まで ${Math.round(d)} m`);
  bound[id] = { x: graph.xs[v]!, z: graph.zs[v]! };
}
const joined = joinSkeleton(skeleton, bound, graph, elevAt, { snapM: 200, order: scenario.plan.route });
for (const w of joined.warnings) console.log(`⚠ ${w}`);

const jct = joined.nodes.find((n) => n.id === 'SPUR_JCT')!;
const crest: [number, number][] = SPUR_PTS.map(([x0, z0]) => {
  let bx = x0;
  let bz = z0;
  let be = -Infinity;
  for (let dz = -20; dz <= 20; dz += 4)
    for (let dx = -20; dx <= 20; dx += 4) {
      if (dx * dx + dz * dz > 400) continue;
      const e = elevAt(x0 + dx, z0 + dz);
      if (e > be) (be = e), (bx = x0 + dx), (bz = z0 + dz);
    }
  return [bx, bz];
});
let crestLen = Math.hypot(crest[0]![0] - jct.x, crest[0]![1] - jct.z);
for (let i = 1; i < crest.length; i += 1) crestLen += Math.hypot(crest[i]![0] - crest[i - 1]![0], crest[i]![1] - crest[i - 1]![1]);
console.log(`925 m 標高点の尾根: ${Math.round(crestLen)} m  ${crest.map((p) => Math.round(elevAt(p[0], p[1]))).join(' → ')} m`);
const spur: EdgeDef = {
  id: 'F1',
  name: '925 m 標高点の尾根（踏み跡）',
  kind: 'false',
  from: 'SPUR_JCT',
  class: 'T2',
  markers: 0.1,
  drift: 0.05,
  sinuosity: 1.0,
  smooth: false,
  // 標高 900 m あたりから下は踏み跡が薄れて消える
  fadeOutM: Math.round(crestLen * 0.45),
  attractiveness: 0.8,
  waypoints: crest,
};
// 南の肩: 下りで鳥屋戸尾根（E6）へ行くつもりで、まっすぐ南西へ延びる尾根（F1）に入りやすい
const nodes = joined.nodes.map((n) => (n.id === 'SPUR_JCT' ? { ...n, confusers: [{ edge: 'F1', whenIntending: ['E6'], ambiguity: 1.4 }] } : n));

const enc = encodeHeights(dem.heights);
const map: MapDef = {
  ...skeleton,
  id: 'shounoiwa',
  skeleton: false,
  size: SIZE,
  resolution: N,
  geo: { centerLat: LAT0, centerLon: LON0, projection: 'local-tangent' },
  terrain: { type: 'heightmap', encoding: 'u16-base64', minElevM: enc.minElevM, maxElevM: enc.maxElevM, baseElevation: baseElevationFor(enc.minElevM), smoothingPasses: 1, source: { dem: 'DEM10B', zoom: 14, fetchedAt: new Date().toISOString() }, data: enc.data },
  nodes,
  edges: [...joined.edges.map((e) => (PACE_ADJ[e.id] ? { ...e, paceAdj: PACE_ADJ[e.id] } : e)), spur],
  // 基地局: 南東（青梅・奥多摩駅の方角）の遠く。尾根の上には届くが、日原側の斜面と谷は山の陰になる
  radio: { stations: [{ id: 'st_se', x: 7000, z: 9000, elevM: 600, antennaM: 40, rangeM: 25000 }] },
  attribution: [ATTR.gsi, ATTR.osm],
};
delete map.areaHint;

const s: ScenarioDef = { ...scenario, mapId: map.id };
const issues = validateScenario(s, map);
for (const i of issues) console.log(`${i.level === 'error' ? '✖' : '⚠'} ${i.path} ${i.message}`);
if (issues.some((i) => i.level === 'error')) process.exit(1);

const bundle: HakoniwaBundle = { format: 'hakoniwa-bundle', version: 1, createdAt: new Date().toISOString(), generator: 'tools/make-s05.ts', map, scenario: s, attribution: [ATTR.gsi, ATTR.osm] };
const outDir = resolve(ROOT, 'public/scenarios/real');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, 's05_shounoiwa.hakoniwa.json');
writeFileSync(out, JSON.stringify(bundle));
console.log(`${out}  ${(JSON.stringify(bundle).length / 1024).toFixed(0)} KB`);

// 確認: 地点の標高と道の長さ、1 回の試走
const rt = buildMapRuntime(map).map;
console.log(map.nodes.map((n) => `${n.name} ${Math.round(rt.nodes[n.id]!.elevM)} m（概略 ${n.expectedElevM ?? '?'}）  (${Math.round(n.x)}, ${Math.round(n.z)})`).join('\n'));
console.log(map.edges.map((e) => `${e.id} ${e.name} ${Math.round(rt.trails[e.id]!.lengthM)} m`).join('\n'));
const r = runHeadless(rt, s, { policy: 'bias', seed: 1 });
console.log(`bias 方針の試走: ${r.ending.kind}  終了 tMin=${Math.round(r.world.tMin)}`);
