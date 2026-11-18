/**
 * 登山道のポリライン化の基礎（docs/04 §5.4）。P2 の trails.ts がこれを使う。
 * smooth なら centripetal Catmull-Rom（α=0.5）で補間し、一定の水平距離ごとに再サンプルする。
 */

export interface Pt2 {
  x: number;
  z: number;
}

export interface ResampledPt extends Pt2 {
  /** 始点からの累積水平距離 */
  sH: number;
}

/** 補間曲線を細かく折れ線にするときの目安の刻み（m） */
const DENSE_STEP_M = 1;

function dist(a: Pt2, b: Pt2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** centripetal Catmull-Rom で点列を細かい折れ線にする（端点は鏡映で延長） */
export function catmullRomDense(pts: readonly Pt2[], stepM: number = DENSE_STEP_M): Pt2[] {
  if (pts.length < 2) return pts.map((p) => ({ x: p.x, z: p.z }));
  const first = pts[0]!;
  const second = pts[1]!;
  const last = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2]!;
  const ext: Pt2[] = [
    { x: 2 * first.x - second.x, z: 2 * first.z - second.z },
    ...pts,
    { x: 2 * last.x - prev.x, z: 2 * last.z - prev.z },
  ];
  const out: Pt2[] = [{ x: first.x, z: first.z }];
  for (let i = 1; i < ext.length - 2; i += 1) {
    const p0 = ext[i - 1]!;
    const p1 = ext[i]!;
    const p2 = ext[i + 1]!;
    const p3 = ext[i + 2]!;
    // ノット間隔 = 距離^0.5（centripetal）。重なった点は小さな値で代用
    const t0 = 0;
    const t1 = t0 + Math.max(1e-6, Math.sqrt(dist(p0, p1)));
    const t2 = t1 + Math.max(1e-6, Math.sqrt(dist(p1, p2)));
    const t3 = t2 + Math.max(1e-6, Math.sqrt(dist(p2, p3)));
    const segLen = dist(p1, p2);
    const steps = Math.max(1, Math.ceil(segLen / stepM));
    for (let s = 1; s <= steps; s += 1) {
      const t = t1 + ((t2 - t1) * s) / steps;
      const a1x = ((t1 - t) * p0.x + (t - t0) * p1.x) / (t1 - t0);
      const a1z = ((t1 - t) * p0.z + (t - t0) * p1.z) / (t1 - t0);
      const a2x = ((t2 - t) * p1.x + (t - t1) * p2.x) / (t2 - t1);
      const a2z = ((t2 - t) * p1.z + (t - t1) * p2.z) / (t2 - t1);
      const a3x = ((t3 - t) * p2.x + (t - t2) * p3.x) / (t3 - t2);
      const a3z = ((t3 - t) * p2.z + (t - t2) * p3.z) / (t3 - t2);
      const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / (t2 - t0);
      const b1z = ((t2 - t) * a1z + (t - t0) * a2z) / (t2 - t0);
      const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1);
      const b2z = ((t3 - t) * a2z + (t - t1) * a3z) / (t3 - t1);
      out.push({
        x: ((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1),
        z: ((t2 - t) * b1z + (t - t1) * b2z) / (t2 - t1),
      });
    }
    // 区間の終点は元の点に正確に合わせる
    const lastOut = out[out.length - 1]!;
    lastOut.x = p2.x;
    lastOut.z = p2.z;
  }
  return out;
}

/** 折れ線を水平距離 stepM ごとに再サンプル。終点は必ず含める（最後の間隔は stepM 未満になりうる） */
export function resampleByDistance(line: readonly Pt2[], stepM: number): ResampledPt[] {
  if (line.length === 0) return [];
  const first = line[0]!;
  const out: ResampledPt[] = [{ x: first.x, z: first.z, sH: 0 }];
  let acc = 0;
  let next = stepM;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const len = dist(a, b);
    if (len === 0) continue;
    while (acc + len >= next) {
      const t = (next - acc) / len;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, sH: next });
      next += stepM;
    }
    acc += len;
  }
  const last = line[line.length - 1]!;
  const tail = out[out.length - 1]!;
  if (acc - tail.sH > 1e-6) out.push({ x: last.x, z: last.z, sH: acc });
  return out;
}

/** waypoints から登山道の水平サンプル列を作る */
export function trailPolyline(waypoints: readonly (readonly [number, number])[], smooth: boolean, stepM: number): ResampledPt[] {
  const pts = waypoints.map(([x, z]) => ({ x, z }));
  const dense = smooth ? catmullRomDense(pts) : pts;
  return resampleByDistance(dense, stepM);
}
