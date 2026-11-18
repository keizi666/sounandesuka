import { describe, expect, it } from 'vitest';
import { catmullRomDense, resampleByDistance, trailPolyline } from '../src/sim/terrain/polyline';

describe('ポリライン化（docs/04 §5.4 の基礎）', () => {
  it('再サンプルは 10 m 間隔で、終点を含む', () => {
    const pts = resampleByDistance(
      [
        { x: 0, z: 0 },
        { x: 25, z: 0 },
      ],
      10,
    );
    expect(pts.map((p) => p.sH)).toEqual([0, 10, 20, 25]);
    expect(pts[pts.length - 1]).toMatchObject({ x: 25, z: 0 });
  });

  it('折れ線の角をまたいでも距離は連続', () => {
    const pts = resampleByDistance(
      [
        { x: 0, z: 0 },
        { x: 15, z: 0 },
        { x: 15, z: 15 },
      ],
      10,
    );
    expect(pts.map((p) => p.sH)).toEqual([0, 10, 20, 30]);
    expect(pts[2]).toMatchObject({ x: 15, z: 5 });
  });

  it('Catmull-Rom は全 waypoint を通り、端点が一致する', () => {
    const wps = [
      { x: 0, z: 0 },
      { x: 100, z: 50 },
      { x: 200, z: -30 },
      { x: 260, z: 40 },
    ];
    const dense = catmullRomDense(wps);
    for (const w of wps) {
      expect(dense.some((p) => Math.abs(p.x - w.x) < 1e-9 && Math.abs(p.z - w.z) < 1e-9)).toBe(true);
    }
    expect(dense[0]).toEqual(wps[0]);
    expect(dense[dense.length - 1]).toEqual(wps[3]);
  });

  it('smooth: false は折れ線のまま（長さ = 区間の和）', () => {
    const pts = trailPolyline(
      [
        [0, 0],
        [30, 40],
        [30, 100],
      ],
      false,
      10,
    );
    expect(pts[pts.length - 1]!.sH).toBeCloseTo(110, 9);
  });

  it('smooth: true は直線上の点なら直線のまま', () => {
    const pts = trailPolyline(
      [
        [0, 0],
        [50, 0],
        [100, 0],
      ],
      true,
      10,
    );
    expect(pts[pts.length - 1]!.sH).toBeCloseTo(100, 6);
    for (const p of pts) expect(Math.abs(p.z)).toBeLessThan(1e-9);
  });
});
