// テスト用のバンドルを作る（docs/13 P13）:
//   npm run fixture:bundle
// 箱庭岳を 385 頂点で手続き生成し、高さマップ（u16-base64）に変換したマップと、s01 相当のシナリオを 1 つのバンドルにまとめる。
// 植生の塗り直し（小屋の周りを岩場に）と電波の塗り直し（稜線小屋は圏外）も入れて、overrides / paint の復元を試せるようにする。
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildHeights } from '../src/sim/terrain/map';
import { encodeGrid, encodeHeights } from '../src/sim/terrain/codec';
import type { SounanBundle, MapDef, ScenarioDef } from '../src/sim/types';
import { VegClass } from '../src/sim/types';
import { loadMapDef, ROOT } from './lib/maps';
import { loadScenarioById } from './lib/scenarios';

const src = loadMapDef('sounan');
const res = 385;
const procedural: MapDef = { ...src, resolution: res };
const grid = buildHeights(procedural);
const enc = encodeHeights(grid.heights);
const n = res;
const cell = src.size / (n - 1);
const half = src.size / 2;
const idx = (x: number, z: number): number => Math.round((z + half) / cell) * n + Math.round((x + half) / cell);

// 塗り直し: 稜線小屋の周り 60 m を岩場、電波は圏外
const hut = src.nodes.find((x) => x.shelter) ?? src.nodes[0]!;
const veg = new Uint8Array(n * n);
const paint = new Uint8Array(n * n);
const r = Math.ceil(60 / cell);
const c0 = idx(hut.x, hut.z);
for (let dz = -r; dz <= r; dz += 1)
  for (let dx = -r; dx <= r; dx += 1) {
    const i = c0 + dz * n + dx;
    veg[i] = VegClass.ROCK + 1;
    paint[i] = 255; // -1 = 強制圏外
  }

const map: MapDef = {
  ...src,
  id: 'sounan385',
  name: '箱庭岳（385 頂点・高さマップ）',
  resolution: res,
  terrain: {
    type: 'heightmap',
    encoding: 'u16-base64',
    minElevM: enc.minElevM,
    maxElevM: enc.maxElevM,
    baseElevation: src.terrain.baseElevation,
    smoothingPasses: 0,
    source: { dem: 'mixed', zoom: 0, fetchedAt: '2026-11-19T00:00:00+09:00' },
    data: enc.data,
  },
  // 手続き地形ではノードを既定でスナップするが、高さマップでは snap: true のものだけ
  nodes: src.nodes.map((nd) => ({ ...nd, snap: true })),
  vegetation: { ...src.vegetation, overrides: encodeGrid(veg) },
  radio: { ...src.radio, paint: encodeGrid(paint) },
};
const s01 = loadScenarioById('s01_cold_front');
const scenario: ScenarioDef = { ...s01, id: 's01_fixture385', title: `${s01.title}（385 頂点）`, mapId: map.id };
const bundle: SounanBundle = {
  format: 'sounan-bundle',
  version: 1,
  createdAt: '2026-11-19T00:00:00+09:00',
  generator: 'tools/make-fixture-bundle.ts',
  map,
  scenario,
  attribution: [],
};
const out = resolve(ROOT, 'tests', 'fixtures', 'sounan385.sounan.json');
writeFileSync(out, JSON.stringify(bundle));
console.log(`${out}  ${(JSON.stringify(bundle).length / 1024).toFixed(0)} KB  hut=${hut.id}`);
