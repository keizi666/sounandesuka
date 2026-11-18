import { describe, expect, it } from 'vitest';
import { computeRadioCoverage, stationStrength } from '../src/sim/terrain/coverage';
import { nearestIndex, type HeightGrid } from '../src/sim/terrain/sample';
import type { RadioStationDef } from '../src/sim/types';
import { hakoniwa } from './helpers/map';

describe('電波圏（docs/04 §7）', () => {
  it('SUMMIT・EBOSHI・HUT_RIDGE で 0.5 以上、魚止ノ滝で 0.1 未満', () => {
    const { map } = hakoniwa();
    for (const id of ['SUMMIT', 'EBOSHI', 'HUT_RIDGE']) {
      const nd = map.nodes[id]!;
      expect(map.radio[nearestIndex(map, nd.x, nd.z)]!, id).toBeGreaterThanOrEqual(0.5);
    }
    expect(map.radio[nearestIndex(map, -1200, -575)]!).toBeLessThan(0.1);
  });

  it('値域は 0..1', () => {
    const { map } = hakoniwa();
    for (const v of map.radio) if (v < 0 || v > 1) throw new Error(`radio ${v}`);
  });
});

describe('見通しの計算（合成地形）', () => {
  // 33×33、セル 10 m、全域 1000 m の平地
  const flat = (): HeightGrid => ({ n: 33, cell: 10, half: 160, heights: new Float32Array(33 * 33).fill(1000) });
  const st: RadioStationDef = { id: 's', x: 1000, z: 0, elevM: 1000, antennaM: 10, rangeM: 2000 };

  it('遮るものがなければ 1 − 距離/到達距離', () => {
    const g = flat();
    expect(stationStrength(g, 1000, 0, 0, 1000, st)).toBeCloseTo(1 - 1000 / 2000, 9);
  });

  it('壁に遮られると回折の近似（0.25 − 遮蔽量/200）で弱くなる', () => {
    const g = flat();
    // x = 100 m の列（ix = 26）に高さ 30 m の壁
    for (let iz = 0; iz < g.n; iz += 1) g.heights[iz * g.n + 26] = 1030;
    const s = stationStrength(g, 1000, 0, 0, 1000, st);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(0.25);
  });

  it('箱庭の外の平地より低い局には届かない', () => {
    const g = flat();
    const low: RadioStationDef = { ...st, elevM: 900 };
    expect(stationStrength(g, 1000, 0, 0, 1000, low)).toBe(0);
  });

  it('到達距離の外は 0、全局の max を取る', () => {
    const g = flat();
    const far: RadioStationDef = { ...st, id: 'far', x: 5000 };
    const r = computeRadioCoverage(g, [far], 1000);
    expect(Math.max(...r)).toBe(0);
    const both = computeRadioCoverage(g, [far, st], 1000);
    expect(both[nearestIndex(g, 0, 0)]!).toBeCloseTo(0.5, 6);
  });
});
