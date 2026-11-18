import { describe, expect, it } from 'vitest';
import { baseElevationFor, decodeDemRgba, fillInvalid, sampleGrid, smoothGauss, suggestForestLine, TILE_PX, tileKey } from '../src/editor/geo/dem';
import { bboxOf } from '../src/editor/geo/projection';
import { lonLatToTile, tilesCovering } from '../src/editor/geo/tiles';

/** 標高 = 1000 + 東西方向のタイル内 x 位置に比例 の合成タイル */
function synthTile(z: number, tx: number, ty: number): Float32Array {
  const t = new Float32Array(TILE_PX * TILE_PX);
  for (let y = 0; y < TILE_PX; y += 1) for (let x = 0; x < TILE_PX; x += 1) t[y * TILE_PX + x] = 1000 + (tx * TILE_PX + x) * 0.5 - (ty * 0 + 0) + z * 0;
  return t;
}

describe('標高タイル → 高さマップ', () => {
  it('RGBA のデコード', () => {
    const rgba = new Uint8Array(TILE_PX * TILE_PX * 4);
    rgba.set([0, 3, 232, 255], 0);
    rgba.set([128, 0, 0, 255], 4);
    const d = decodeDemRgba(rgba);
    expect(d[0]).toBeCloseTo(10, 6);
    expect(Number.isNaN(d[1]!)).toBe(true);
  });
  it('合成タイルから格子へ補間すると東ほど高く、穴埋め・平滑化で値が保たれる', () => {
    const lat0 = 36.4;
    const lon0 = 137.71;
    const size = 3072;
    const n = 257;
    const tiles = new Map<string, Float32Array>();
    for (const t of tilesCovering(bboxOf(lat0, lon0, size), 14)) tiles.set(tileKey(14, t.x, t.y), synthTile(14, t.x, t.y));
    const h = sampleGrid(tiles, 14, lat0, lon0, size, n);
    expect(h.some((v) => Number.isNaN(v))).toBe(false);
    expect(h[n * 128 + 256]!).toBeGreaterThan(h[n * 128]!);
    // 中心の値は中心のタイル画素と一致
    const c = lonLatToTile(lon0, lat0, 14);
    const expectC = 1000 + (c.x * TILE_PX - 0.5) * 0.5;
    expect(h[n * 128 + 128]!).toBeCloseTo(expectC, 0);
    h[5] = NaN;
    h[6] = NaN;
    const f = fillInvalid(h, n);
    expect(f.filled).toBe(2);
    expect(Number.isNaN(h[5]!)).toBe(false);
    const s = smoothGauss(h, n, 1);
    expect(s[n * 128 + 128]!).toBeCloseTo(h[n * 128 + 128]!, 0);
  });
  it('全部無効なら最小標高（ここでは 0）で埋める', () => {
    const h = new Float32Array(9).fill(NaN);
    const f = fillInvalid(h, 3);
    expect(f.fallback).toBe(9);
  });
  it('台座と森林限界の提案', () => {
    expect(baseElevationFor(1452.3)).toBe(1350);
    expect(suggestForestLine(36)).toBe(2500);
    expect(suggestForestLine(39)).toBe(1900);
  });
});
