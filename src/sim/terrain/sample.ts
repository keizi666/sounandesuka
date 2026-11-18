/**
 * 高さグリッドのサンプリング（docs/04 §1）。i = iz * n + ix、x = -half + ix * cell。
 * 「16 m」「257」をコードに書かず、必ず grid.cell / grid.n を使う（CLAUDE.md 鉄則 7）。
 */

export interface GridGeom {
  /** 一辺の頂点数 */
  n: number;
  /** 頂点の間隔（m） */
  cell: number;
  /** 一辺の半分（m） */
  half: number;
}

export interface HeightGrid extends GridGeom {
  heights: Float32Array;
}

export function gridGeom(size: number, resolution: number): GridGeom {
  if (!Number.isInteger(resolution) || resolution < 3) throw new Error(`resolution が不正です: ${resolution}`);
  if (!(size > 0)) throw new Error(`size が不正です: ${size}`);
  return { n: resolution, cell: size / (resolution - 1), half: size / 2 };
}

export function vertexX(g: GridGeom, ix: number): number {
  return -g.half + ix * g.cell;
}

export function vertexZ(g: GridGeom, iz: number): number {
  return -g.half + iz * g.cell;
}

export function isInside(g: GridGeom, x: number, z: number): boolean {
  return x >= -g.half && x <= g.half && z >= -g.half && z <= g.half;
}

/** 最寄りの頂点の添字（範囲外は端に寄せる） */
export function nearestIndex(g: GridGeom, x: number, z: number): number {
  const fx = Math.round((x + g.half) / g.cell);
  const fz = Math.round((z + g.half) / g.cell);
  const ix = fx < 0 ? 0 : fx > g.n - 1 ? g.n - 1 : fx;
  const iz = fz < 0 ? 0 : fz > g.n - 1 ? g.n - 1 : fz;
  return iz * g.n + ix;
}

/** 任意のグリッド（高さ・派生レイヤー）の双線形補間。範囲外は端の値 */
export function sampleBilinear(g: GridGeom, data: ArrayLike<number>, x: number, z: number): number {
  const n = g.n;
  let fx = (x + g.half) / g.cell;
  let fz = (z + g.half) / g.cell;
  fx = fx < 0 ? 0 : fx > n - 1 ? n - 1 : fx;
  fz = fz < 0 ? 0 : fz > n - 1 ? n - 1 : fz;
  let ix = Math.floor(fx);
  let iz = Math.floor(fz);
  if (ix > n - 2) ix = n - 2;
  if (iz > n - 2) iz = n - 2;
  const tx = fx - ix;
  const tz = fz - iz;
  const i = iz * n + ix;
  const h00 = data[i]!;
  const h10 = data[i + 1]!;
  const h01 = data[i + n]!;
  const h11 = data[i + n + 1]!;
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

/** 標高（双線形補間） */
export function sampleElev(g: HeightGrid, x: number, z: number): number {
  return sampleBilinear(g, g.heights, x, z);
}

/** 箱庭の外を平地（outsideElevM）とみなす標高 */
export function sampleElevOr(g: HeightGrid, x: number, z: number, outsideElevM: number): number {
  return isInside(g, x, z) ? sampleBilinear(g, g.heights, x, z) : outsideElevM;
}

/** 法線（中心差分）。y が上。out を渡すと確保しない */
export function sampleNormal(
  g: HeightGrid,
  x: number,
  z: number,
  out: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 },
): { x: number; y: number; z: number } {
  const e = g.cell;
  const dhdx = (sampleElev(g, x + e, z) - sampleElev(g, x - e, z)) / (2 * e);
  const dhdz = (sampleElev(g, x, z + e) - sampleElev(g, x, z - e)) / (2 * e);
  const len = Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
  out.x = -dhdx / len;
  out.y = 1 / len;
  out.z = -dhdz / len;
  return out;
}
