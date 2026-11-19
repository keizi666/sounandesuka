/** 地理院ベクトルタイルの植生記号 → 植生の塗り（src/editor/geo/mvt.ts・vegsym.ts） */
import { describe, expect, it } from 'vitest';
import { decodeMvtPoints } from '../src/editor/geo/mvt';
import { toLatLon } from '../src/editor/geo/projection';
import { vegOverridesFromSymbols, vegSymbolsFromTile } from '../src/editor/geo/vegsym';
import { decodeGrid } from '../src/sim/terrain/codec';
import { VegClass } from '../src/sim/types';
import { sounanMap } from './helpers/map';

/** テスト用の最小の PBF 書き出し（点 1 つの層） */
function pbfTile(layer: string, points: { x: number; y: number; code: number }[]): Uint8Array {
  const out: number[] = [];
  const varint = (a: number[], v: number): void => {
    while (v > 127) {
      a.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    a.push(v);
  };
  const bytes = (a: number[], field: number, b: number[] | Uint8Array): void => {
    varint(a, field * 8 + 2);
    varint(a, b.length);
    a.push(...b);
  };
  const L: number[] = [];
  bytes(L, 1, new TextEncoder().encode(layer));
  const codes = [...new Set(points.map((p) => p.code))];
  for (const p of points) {
    const F: number[] = [];
    const tags: number[] = [];
    varint(tags, 0);
    varint(tags, codes.indexOf(p.code));
    bytes(F, 2, tags);
    varint(F, 3 * 8);
    varint(F, 1); // POINT
    const g: number[] = [];
    varint(g, 1 | (1 << 3)); // MoveTo ×1
    varint(g, p.x * 2);
    varint(g, p.y * 2);
    bytes(F, 4, g);
    bytes(L, 2, F);
  }
  bytes(L, 3, new TextEncoder().encode('vt_code'));
  for (const c of codes) {
    const V: number[] = [];
    varint(V, 4 * 8);
    varint(V, c);
    bytes(L, 4, V);
  }
  varint(L, 5 * 8);
  varint(L, 4096);
  bytes(out, 3, L);
  return Uint8Array.from(out);
}

describe('植生記号', () => {
  it('PBF の点と属性を読む', () => {
    const buf = pbfTile('Anno', [{ x: 100, y: 200, code: 6322 }, { x: 4000, y: 10, code: 6321 }]);
    const pts = decodeMvtPoints(buf, ['Anno']);
    expect(pts.map((p) => [p.x, p.y, p.props['vt_code']])).toEqual([[100, 200, 6322], [4000, 10, 6321]]);
    expect(vegSymbolsFromTile(buf, 16, 58085, 25766).map((s) => s.code)).toEqual([6322, 6321]);
  });
  it('いちばん近い記号の植生を森のセルに塗り、遠いセルは自動のまま', () => {
    const { map } = sounanMap();
    const lat0 = 35.85;
    const lon0 = 139.06;
    // 地図の中央に針葉樹林、西の端に広葉樹林
    const sym = [
      { ...toLatLon(lat0, lon0, 0, 0), code: 6322 },
      { ...toLatLon(lat0, lon0, -1800, 0), code: 6321 },
    ];
    const { overrides, counts } = vegOverridesFromSymbols(map, lat0, lon0, sym, 300, 0);
    const g = decodeGrid(overrides, map.n * map.n);
    const at = (x: number, z: number): number => g[Math.round((z + map.half) / map.cell) * map.n + Math.round((x + map.half) / map.cell)]!;
    const forestAt = (x: number, z: number): boolean => {
      const v = map.veg[Math.round((z + map.half) / map.cell) * map.n + Math.round((x + map.half) / map.cell)]!;
      return v === VegClass.BROADLEAF || v === VegClass.CONIFER || v === VegClass.ROCK;
    };
    if (forestAt(0, 0)) expect(at(0, 0)).toBe(VegClass.CONIFER + 1);
    if (forestAt(-1800, 0)) expect(at(-1800, 0)).toBe(VegClass.BROADLEAF + 1);
    expect(at(1500, 1500)).toBe(0);
    expect((counts['conifer'] ?? 0) + (counts['broadleaf'] ?? 0)).toBeGreaterThan(0);
  });
});
