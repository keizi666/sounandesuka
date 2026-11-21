import { describe, expect, it } from 'vitest';
import { decodeGrid, encodeGrid } from '../src/sim/terrain/codec';
import { VegClass, type MapRuntime, type UrbanDef } from '../src/sim/types';
import { clearUrbanOverrides, mergeUrbanOverrides, orientedRect, roadWidthM, urbanCells } from '../src/editor/geo/urban';

/** 一辺 n 頂点、セル cell m の平らな地図（植生はすべて広葉樹林。左端の列だけ沢） */
function flatMap(n: number, cell: number): MapRuntime {
  const veg = new Uint8Array(n * n).fill(VegClass.BROADLEAF);
  for (let z = 0; z < n; z += 1) veg[z * n] = VegClass.STREAM;
  return { n, cell, half: ((n - 1) * cell) / 2, veg } as unknown as MapRuntime;
}

describe('市街地（地理院地図の建物・道路）', () => {
  it('建物の面を、いちばん長い辺の向きの長方形にする', () => {
    // 30° 傾いた 20 m × 10 m の長方形
    const a = Math.PI / 6;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const pts = [[-10, -5], [10, -5], [10, 5], [-10, 5], [-10, -5]].map(([u, v]) => ({ x: 100 + u! * c - v! * s, z: 50 + u! * s + v! * c }));
    const r = orientedRect(pts)!;
    expect(r[0]).toBeCloseTo(100, 0);
    expect(r[1]).toBeCloseTo(50, 0);
    expect(r[2]).toBeCloseTo(20, 0);
    expect(r[3]).toBeCloseTo(10, 0);
    expect(r[4]).toBe(30);
    expect(orientedRect([{ x: 0, z: 0 }, { x: 0.2, z: 0 }, { x: 0.2, z: 0.2 }])).toBeNull();
  });

  it('道路の幅の区分から幅を決める', () => {
    expect(roadWidthM('3m未満')).toBeLessThan(3);
    expect(roadWidthM('3m-5.5m未満')).toBe(4.5);
    expect(roadWidthM('5.5m-13m未満')).toBe(7.5);
    expect(roadWidthM('19.5m以上')).toBe(21);
  });

  it('建物の周りと道路のセルを市街地にし、道路では沢のセルを塗らない', () => {
    const map = flatMap(33, 10);
    const u: UrbanDef = {
      buildings: [[0, 0, 12, 8, 0, 2]],
      lines: [{ kind: 'road', widthM: 4.5, pts: [[-160, 100], [160, 100]] }],
      source: { tiles: 'gsi-optimal_bvmap-v1', zoom: 16, fetchedAt: '' },
    };
    const cells = urbanCells(map, u);
    const at = (x: number, z: number): number => cells[Math.round((z + map.half) / 10) * 33 + Math.round((x + map.half) / 10)]!;
    expect(at(0, 0)).toBe(1);
    expect(at(10, 0)).toBe(1);
    expect(at(60, 0)).toBe(0);
    expect(at(50, 100)).toBe(1);
    expect(at(50, 130)).toBe(0);
    // 左端（沢）は道路が通っても塗らない
    expect(at(-160, 100)).toBe(0);
  });

  it('塗りに重ね、取り込み直しでは前の市街地を消し、ほかの塗りは残す', () => {
    const n = 4;
    const prev = new Uint8Array(16);
    prev[0] = VegClass.ROCK + 1;
    prev[5] = VegClass.URBAN + 1;
    const cells = new Uint8Array(16);
    cells[9] = 1;
    const m = mergeUrbanOverrides(n, encodeGrid(prev), cells);
    const g = decodeGrid(m.overrides, 16);
    expect(m.count).toBe(1);
    expect(g[0]).toBe(VegClass.ROCK + 1);
    expect(g[5]).toBe(0);
    expect(g[9]).toBe(VegClass.URBAN + 1);
    const cleared = decodeGrid(clearUrbanOverrides(n, m.overrides)!, 16);
    expect(cleared[9]).toBe(0);
    expect(cleared[0]).toBe(VegClass.ROCK + 1);
  });
});
