/**
 * 可変マップとバンドル（docs/13 P13、docs/16 §3.2）
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runHeadless } from '../src/sim/headless';
import { base64Decode, base64Encode, decodeGrid, decodeHeights, encodeGrid, encodeHeights } from '../src/sim/terrain/codec';
import { buildMapRuntime } from '../src/sim/terrain/map';
import { nearestIndex } from '../src/sim/terrain/sample';
import { validateScenario } from '../src/sim/scenario/validate';
import type { HakoniwaBundle, MapDef } from '../src/sim/types';
import { VegClass } from '../src/sim/types';

const bundle = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', 'hakoniwa385.hakoniwa.json'), 'utf8')) as HakoniwaBundle;

describe('符号化', () => {
  it('base64 は Node の Buffer と一致し、往復で戻る', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 100, 1001]) {
      const b = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 255);
      const s = base64Encode(b);
      expect(s).toBe(Buffer.from(b).toString('base64'));
      expect([...base64Decode(s)]).toEqual([...b]);
    }
  });
  it('高さマップの量子化誤差は起伏 / 65535 以内', () => {
    const h = Float32Array.from({ length: 257 * 257 }, (_, i) => 1400 + 1300 * Math.sin(i * 0.001) ** 2);
    const e = encodeHeights(h);
    const d = decodeHeights({ type: 'heightmap', encoding: 'u16-base64', minElevM: e.minElevM, maxElevM: e.maxElevM, baseElevation: 1300, source: { dem: 'DEM10B', zoom: 14, fetchedAt: '' }, data: e.data }, h.length);
    let maxErr = 0;
    for (let i = 0; i < h.length; i += 1) maxErr = Math.max(maxErr, Math.abs(d[i]! - h[i]!));
    expect(maxErr).toBeLessThan((e.maxElevM - e.minElevM) / 65535 + 1e-3);
  });
  it('RLE の塗り直しグリッドは往復で戻る（長い連続も）', () => {
    const v = new Uint8Array(513 * 513);
    v.fill(3, 1000, 90000);
    v[5] = 255;
    expect([...decodeGrid(encodeGrid(v), v.length)]).toEqual([...v]);
  });
});

describe('fixture バンドル（385 頂点の高さマップ）', () => {
  const { map } = buildMapRuntime(bundle.map);
  it('高さマップから復元でき、塗り直しが効く', () => {
    expect(map.n).toBe(385);
    expect(map.cell).toBeCloseTo(4096 / 384, 6);
    const hut = map.nodes['HUT_RIDGE']!;
    const i = nearestIndex(map, hut.x, hut.z);
    expect(map.veg[i]).toBe(VegClass.ROCK);
    expect(map.radio[i]).toBe(0);
  });
  it('シナリオの検証が通り、s01 相当が推奨・傾向どおりの両方で最後まで走る', () => {
    const v = validateScenario(bundle.scenario, bundle.map);
    expect(v.filter((x) => x.level === 'error')).toEqual([]);
    for (const policy of ['recommended', 'bias'] as const) {
      const r = runHeadless(map, bundle.scenario, { policy, seed: 5 });
      expect(r.world.ended).not.toBeNull();
    }
  });
});

describe('大きいマップ', () => {
  it('一辺 12,288 m・513 頂点のダミー高さマップで派生レイヤーが 8 秒以内', () => {
    const n = 513;
    const size = 12288;
    const h = new Float32Array(n * n);
    for (let z = 0; z < n; z += 1)
      for (let x = 0; x < n; x += 1) {
        const dx = (x - n / 2) / n;
        const dz = (z - n / 2) / n;
        h[z * n + x] = 900 + 1800 * Math.exp(-(dx * dx + dz * dz) * 9) + 120 * Math.sin(x * 0.07) * Math.cos(z * 0.05);
      }
    const e = encodeHeights(h);
    const def: MapDef = {
      id: 'dummy513',
      name: 'dummy',
      size,
      resolution: n,
      terrain: { type: 'heightmap', encoding: 'u16-base64', minElevM: e.minElevM, maxElevM: e.maxElevM, baseElevation: 850, source: { dem: 'DEM10B', zoom: 14, fetchedAt: '' }, data: e.data },
      vegetation: { forestLine: 2400, forestLineNoise: 60, broadleafLine: 1600 },
      nodes: [
        { id: 'A', name: 'A', x: -4000, z: 4000, type: 'trailhead' },
        { id: 'B', name: 'B', x: 0, z: 0, type: 'peak' },
      ],
      edges: [{ id: 'AB', name: 'AB', from: 'A', to: 'B', waypoints: [], kind: 'trail', class: 'T2', markers: 0.5, drift: 0.2, sinuosity: 1.2 }],
      hazards: [],
      radio: { stations: [{ id: 'st', x: -6000, z: 6000, elevM: 900, antennaM: 40, rangeM: 20000 }] },
    } as unknown as MapDef;
    const t0 = performance.now();
    const { map } = buildMapRuntime(def);
    const ms = performance.now() - t0;
    expect(map.n).toBe(513);
    expect(map.cell).toBe(24);
    expect(ms).toBeLessThan(8000);
  });
});
