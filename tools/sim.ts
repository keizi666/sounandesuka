// npm run sim — ヘッドレス実行（P5 で実装）。P1 では --dump-terrain だけ使える。
//   npm run sim -- --dump-terrain [--map hakoniwa] [--layer heights|hillshade|slope|veg|radio|flow|tpi|sky] [--out file.pgm] [--png]
import { parseArgs } from 'node:util';
import { DEG, dcos, dsin, datan2 } from '../src/sim/core/dmath';
import { buildMapRuntime } from '../src/sim/terrain/map';
import type { MapRuntime } from '../src/sim/types';
import { normalizeToBytes, writePgm, writePng } from './lib/image';
import { loadMapDef } from './lib/maps';

const LAYERS = ['heights', 'hillshade', 'slope', 'veg', 'radio', 'flow', 'tpi', 'sky'] as const;
type Layer = (typeof LAYERS)[number];

function hillshade(m: MapRuntime): Uint8Array {
  const { n, cell, heights: h } = m;
  const out = new Uint8Array(n * n);
  const az = 315 * DEG;
  const alt = 45 * DEG;
  for (let iz = 0; iz < n; iz += 1) {
    for (let ix = 0; ix < n; ix += 1) {
      const xm = Math.max(0, ix - 1);
      const xp = Math.min(n - 1, ix + 1);
      const zm = Math.max(0, iz - 1);
      const zp = Math.min(n - 1, iz + 1);
      const dzdx = (h[iz * n + xp]! - h[iz * n + xm]!) / ((xp - xm) * cell);
      const dzdy = (h[zm * n + ix]! - h[zp * n + ix]!) / ((zp - zm) * cell); // 北向き +
      const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      const aspect = datan2(dzdy, -dzdx);
      const v = dsin(alt) * dcos(slope) + dcos(alt) * dsin(slope) * dcos(az - Math.PI / 2 - aspect);
      out[iz * n + ix] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }
  return out;
}

function layerBytes(m: MapRuntime, layer: Layer): Uint8Array {
  switch (layer) {
    case 'heights':
      return normalizeToBytes(m.heights);
    case 'hillshade':
      return hillshade(m);
    case 'slope':
      return normalizeToBytes(m.slopeDeg, 0, 60);
    case 'veg':
      return normalizeToBytes(m.veg, 0, 6);
    case 'radio':
      return normalizeToBytes(m.radio, 0, 1);
    case 'flow':
      return normalizeToBytes(Float32Array.from(m.flowAcc, (v) => Math.log(v)));
    case 'tpi':
      return normalizeToBytes(m.tpi, -150, 150);
    case 'sky':
      return normalizeToBytes(m.skyView, 0, 1);
  }
}

function dumpTerrain(mapId: string, layer: Layer, out: string | undefined, png: boolean): void {
  const t0 = performance.now();
  const { map, warnings } = buildMapRuntime(loadMapDef(mapId), { radio: layer === 'radio' || layer === 'heights' });
  const ms = performance.now() - t0;
  const file = out ?? `terrain-${mapId}-${layer}.${png ? 'png' : 'pgm'}`;
  const bytes = layerBytes(map, layer);
  if (png) writePng(file, map.n, map.n, bytes);
  else writePgm(file, map.n, map.n, bytes);
  console.log(`${file} を書き出しました（${map.n}×${map.n}、セル ${map.cell} m、生成 ${ms.toFixed(0)} ms）`);
  for (const nd of Object.values(map.nodes)) {
    console.log(`  ${nd.id.padEnd(11)} ${nd.name.padEnd(12)} ${nd.elevM.toFixed(0).padStart(5)} m  (${nd.x.toFixed(0)}, ${nd.z.toFixed(0)})`);
  }
  for (const w of warnings) console.warn(`警告: ${w}`);
}

const { values } = parseArgs({
  allowPositionals: true,
  options: {
    'dump-terrain': { type: 'boolean' },
    map: { type: 'string', default: 'hakoniwa' },
    layer: { type: 'string', default: 'heights' },
    out: { type: 'string' },
    png: { type: 'boolean' },
  },
});

if (values['dump-terrain']) {
  const layer = values.layer as Layer;
  if (!LAYERS.includes(layer)) {
    console.error(`--layer は ${LAYERS.join(' / ')} のどれか`);
    process.exit(1);
  }
  dumpTerrain(values.map ?? 'hakoniwa', layer, values.out, values.png ?? false);
} else {
  console.log('npm run sim: シナリオの実行は未実装です（P5 で実装）。地形の確認は --dump-terrain');
}
