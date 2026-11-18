/** 地形計算で使う小さな幾何・補間の関数 */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** GLSL と同じ smoothstep */
export function smoothstep(e0: number, e1: number, x: number): number {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 点列 [x, z, 値?] のポリライン。累積長を前計算して最近点探索を速くする */
export interface PreparedPolyline {
  xs: Float64Array;
  zs: Float64Array;
  /** 各点の付随値（尾根の高さ・谷の深さなど） */
  vs: Float64Array;
  /** 各点までの累積水平距離 */
  cum: Float64Array;
}

export function preparePolyline(points: readonly (readonly number[])[]): PreparedPolyline {
  const k = points.length;
  const xs = new Float64Array(k);
  const zs = new Float64Array(k);
  const vs = new Float64Array(k);
  const cum = new Float64Array(k);
  for (let i = 0; i < k; i += 1) {
    const p = points[i]!;
    xs[i] = p[0] ?? 0;
    zs[i] = p[1] ?? 0;
    vs[i] = p[2] ?? 0;
    if (i > 0) {
      const dx = xs[i]! - xs[i - 1]!;
      const dz = zs[i]! - zs[i - 1]!;
      cum[i] = cum[i - 1]! + Math.sqrt(dx * dx + dz * dz);
    }
  }
  return { xs, zs, vs, cum };
}

export interface NearestResult {
  /** 最近点までの距離 */
  d: number;
  /** 最近点での付随値（線形補間） */
  v: number;
  /** 最近点までの累積距離（ポリラインの始点から） */
  along: number;
  x: number;
  z: number;
}

/** ポリライン上の最近点。out を渡すと確保せずに書き込む */
export function nearestOnPolyline(pl: PreparedPolyline, x: number, z: number, out: NearestResult): NearestResult {
  const { xs, zs, vs, cum } = pl;
  const k = xs.length;
  let bestD2 = Infinity;
  if (k === 1) {
    const dx = x - xs[0]!;
    const dz = z - zs[0]!;
    out.d = Math.sqrt(dx * dx + dz * dz);
    out.v = vs[0]!;
    out.along = 0;
    out.x = xs[0]!;
    out.z = zs[0]!;
    return out;
  }
  for (let i = 0; i < k - 1; i += 1) {
    const ax = xs[i]!;
    const az = zs[i]!;
    const sx = xs[i + 1]! - ax;
    const sz = zs[i + 1]! - az;
    const len2 = sx * sx + sz * sz;
    let t = len2 > 0 ? ((x - ax) * sx + (z - az) * sz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + sx * t;
    const pz = az + sz * t;
    const dx = x - px;
    const dz = z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      out.v = vs[i]! + (vs[i + 1]! - vs[i]!) * t;
      out.along = cum[i]! + (cum[i + 1]! - cum[i]!) * t;
      out.x = px;
      out.z = pz;
    }
  }
  out.d = Math.sqrt(bestD2);
  return out;
}

export function newNearest(): NearestResult {
  return { d: 0, v: 0, along: 0, x: 0, z: 0 };
}
