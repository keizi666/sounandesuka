import { describe, expect, it } from 'vitest';
import { decodeGrid, encodeGrid } from '../src/sim/terrain/codec';
import { VegClass, type MapRuntime } from '../src/sim/types';
import { mergeForestOverrides } from '../src/editor/geo/gsiVector';
import { toLatLon } from '../src/editor/geo/projection';

const lat0 = 35.8;
const lon0 = 139.2;

/** 一辺 n 頂点・セル 20 m の平らな地図（植生はすべて広葉樹林） */
function flat(n: number): MapRuntime {
  return { n, cell: 20, half: ((n - 1) * 20) / 2, veg: new Uint8Array(n * n).fill(VegClass.BROADLEAF), slopeDeg: new Float32Array(n * n) } as unknown as MapRuntime;
}

describe('地形図の植生記号から森の種類を塗る（エディター）', () => {
  it('記号の近くを針葉樹林にし、作者が塗った岩場・市街地は残し、前に塗った森の種類は塗り直す', () => {
    const n = 21;
    const map = flat(n);
    const sym = { ...toLatLon(lat0, lon0, 0, 0), code: 6322 };
    const prev = new Uint8Array(n * n);
    const center = 10 * n + 10;
    prev[center] = VegClass.ROCK + 1;
    prev[center + 1] = VegClass.URBAN + 1;
    prev[0] = VegClass.BROADLEAF + 1; // 前に塗った森（記号から遠ければ自動に戻る）
    const r = mergeForestOverrides(map, lat0, lon0, encodeGrid(prev), [sym], 120, 0);
    const g = decodeGrid(r.overrides, n * n);
    expect(g[center]).toBe(VegClass.ROCK + 1);
    expect(g[center + 1]).toBe(VegClass.URBAN + 1);
    expect(g[center + 2]).toBe(VegClass.CONIFER + 1);
    expect(g[0]).toBe(0);
    expect(r.counts['conifer']).toBeGreaterThan(0);
  });
});
