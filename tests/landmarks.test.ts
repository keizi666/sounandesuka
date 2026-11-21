import { describe, expect, it } from 'vitest';
import type { PowerLineDef } from '../src/sim/types';
import { joinParts, nearestOnLine, placeTowers, TOWER_MAX_M, TOWER_MIN_M } from '../src/editor/geo/landmarks';

describe('送電線と鉄塔', () => {
  it('タイルの境目で切れた送電線を 1 本につなぐ（向きが逆の切れ端も）', () => {
    const parts: [number, number][][] = [
      [[0, 0], [100, 0]],
      [[200, 0], [100, 0]],
      [[200, 0], [300, 10]],
      [[5000, 5000], [5100, 5000]],
    ];
    const lines = joinParts(parts);
    expect(lines).toHaveLength(2);
    const long = lines.find((l) => l.length > 2)!;
    expect(long[0]).toEqual([0, 0]);
    expect(long[long.length - 1]).toEqual([300, 10]);
  });

  it('鉄塔は決まった間隔の中で、いちばん高い所（尾根）に置く', () => {
    // 東西 3 km の線。標高は 600 m ごとに山（x が 600 の倍数で高い）
    const line: PowerLineDef = { id: 'PL01', pts: [[-1500, 0], [1500, 0]] };
    const elev = (x: number): number => 500 + 200 * Math.cos(((x + 1500) / 600) * 2 * Math.PI);
    const towers = placeTowers(line, 2000, (x) => elev(x));
    expect(towers.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < towers.length; i += 1) {
      const d = towers[i]!.x - towers[i - 1]!.x;
      expect(d).toBeGreaterThanOrEqual(TOWER_MIN_M - 1);
      expect(d).toBeLessThanOrEqual(TOWER_MAX_M + 1);
    }
    // 半分以上の鉄塔が山の上のほう（標高 650 m 以上）にある
    expect(towers.filter((t) => elev(t.x) > 650).length).toBeGreaterThanOrEqual(towers.length / 2);
  });

  it('範囲の外の区間には置かない', () => {
    const line: PowerLineDef = { id: 'PL01', pts: [[-5000, 0], [5000, 0]] };
    const towers = placeTowers(line, 1000, () => 500);
    expect(towers.every((t) => Math.abs(t.x) < 1000)).toBe(true);
  });

  it('線の上のいちばん近い点', () => {
    const q = nearestOnLine([[0, 0], [100, 0]], 40, 30);
    expect(q.x).toBeCloseTo(40);
    expect(q.z).toBeCloseTo(0);
    expect(q.d).toBeCloseTo(30);
  });
});

describe('タイルの切り取り', () => {
  it('のりしろにはみ出した部分を切り落とし、境目の点で切る', async () => {
    const { clipToTile } = await import('../src/editor/geo/landmarks');
    const r = clipToTile([[-100, 50], [200, 50], [4200, 50]], 4096);
    expect(r).toHaveLength(1);
    expect(r[0]![0]).toEqual([0, 50]);
    expect(r[0]![r[0]!.length - 1]![0]).toBeCloseTo(4096);
  });
});
