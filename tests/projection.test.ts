import { describe, expect, it } from 'vitest';
import { bboxOf, gridFor, toLatLon, toXZ } from '../src/editor/geo/projection';
import { demPixelToElev, lonLatToTile, tilesCovering, tileToLonLat, tileUrl } from '../src/editor/geo/tiles';
import { sunTimes } from '../src/editor/geo/sunrise';

describe('投影（docs/16 §1）', () => {
  it('往復で戻り、東が +x・北が -z', () => {
    const lat0 = 36.4;
    const lon0 = 137.71;
    const p = toXZ(lat0, lon0, { lat: 36.41, lon: 137.72 });
    expect(p.x).toBeGreaterThan(0);
    expect(p.z).toBeLessThan(0);
    const q = toLatLon(lat0, lon0, p.x, p.z);
    expect(q.lat).toBeCloseTo(36.41, 9);
    expect(q.lon).toBeCloseTo(137.72, 9);
    // 緯度 0.01° ≒ 1113 m
    expect(-p.z).toBeCloseTo(1113.2, 0);
  });
  it('一辺から解像度とセルを決め、セルが整数メートルになる', () => {
    expect(gridFor(3000)).toEqual({ size: 3072, resolution: 257, cell: 12 });
    expect(gridFor(5000)).toEqual({ size: 4992, resolution: 385, cell: 13 });
    expect(gridFor(6000)).toEqual({ size: 6144, resolution: 513, cell: 12 }); // docs/16 §3.1 の例
    expect(gridFor(12288)).toEqual({ size: 12288, resolution: 513, cell: 24 });
  });
  it('外接矩形は中心を含む', () => {
    const b = bboxOf(36.4, 137.71, 6000);
    expect(b.south).toBeLessThan(36.4);
    expect(b.north).toBeGreaterThan(36.4);
    expect(b.west).toBeLessThan(137.71);
  });
});

describe('タイル', () => {
  it('タイル座標の往復', () => {
    const t = lonLatToTile(137.71, 36.4, 14);
    const ll = tileToLonLat(t.x, t.y, 14);
    expect(ll.lat).toBeCloseTo(36.4, 9);
    expect(ll.lon).toBeCloseTo(137.71, 9);
  });
  it('地理院の標高 PNG の画素の換算（無効値・負の標高）', () => {
    expect(demPixelToElev(128, 0, 0)).toBeNull();
    expect(demPixelToElev(0, 3, 232)).toBeCloseTo(10, 6);
    expect(demPixelToElev(255, 255, 156)).toBeCloseTo(-1, 6);
  });
  it('6 km 四方は z14 で 4〜16 枚', () => {
    const n = tilesCovering(bboxOf(36.4, 137.71, 6000), 14).length;
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(16);
  });
  it('URL は地理院の xyz', () => {
    expect(tileUrl('dem_png', 14, 1, 2)).toBe('https://cyberjapandata.gsi.go.jp/xyz/dem_png/14/1/2.png');
    expect(tileUrl('seamlessphoto', 14, 1, 2)).toMatch(/\.jpg$/);
  });
});

describe('日の出・日の入り', () => {
  it('東京付近の 10 月中旬はおよそ 5:45 と 17:10', () => {
    const s = sunTimes('2026-10-17', 35.68, 139.77);
    expect(s.sunriseMin).toBeGreaterThan(5 * 60 + 35);
    expect(s.sunriseMin).toBeLessThan(5 * 60 + 55);
    expect(s.sunsetMin).toBeGreaterThan(17 * 60);
    expect(s.sunsetMin).toBeLessThan(17 * 60 + 20);
  });
});
