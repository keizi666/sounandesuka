/**
 * 標高タイルから箱庭の高さマップを作る（docs/16 §3.2〜3.3）。
 * 通信と画像のデコードは dem.worker.ts、格子へのサンプル・穴埋め・平滑化はここ（Node でテストできる純粋関数）。
 */
import { toLatLon } from './projection';
import { lonLatToTile } from './tiles';

export const DEM_ZOOM = 14;
export const TILE_PX = 256;

/** タイル 1 枚の標高（256²、無効は NaN） */
export type DemTile = Float32Array;

export function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

/** 画素の RGBA（ImageData.data）→ 標高 Float32Array（無効は NaN） */
export function decodeDemRgba(rgba: Uint8ClampedArray | Uint8Array): DemTile {
  const out = new Float32Array(TILE_PX * TILE_PX);
  for (let i = 0; i < out.length; i += 1) {
    const x = rgba[i * 4]! * 65536 + rgba[i * 4 + 1]! * 256 + rgba[i * 4 + 2]!;
    out[i] = x === 8388608 ? NaN : x < 8388608 ? x * 0.01 : (x - 16777216) * 0.01;
  }
  return out;
}

function sampleTile(tiles: Map<string, DemTile>, z: number, tx: number, ty: number): number {
  const ix = Math.floor(tx);
  const iy = Math.floor(ty);
  const t = tiles.get(tileKey(z, ix, iy));
  if (!t) return NaN;
  const px = Math.min(TILE_PX - 1, Math.max(0, (tx - ix) * TILE_PX - 0.5));
  const py = Math.min(TILE_PX - 1, Math.max(0, (ty - iy) * TILE_PX - 0.5));
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(TILE_PX - 1, x0 + 1);
  const y1 = Math.min(TILE_PX - 1, y0 + 1);
  const fx = px - x0;
  const fy = py - y0;
  const a = t[y0 * TILE_PX + x0]!;
  const b = t[y0 * TILE_PX + x1]!;
  const c = t[y1 * TILE_PX + x0]!;
  const d = t[y1 * TILE_PX + x1]!;
  if (Number.isNaN(a + b + c + d)) {
    // どれかが無効なら最寄りの有効値
    const near = [a, b, c, d].filter((v) => !Number.isNaN(v));
    return near.length > 0 ? near.reduce((s, v) => s + v, 0) / near.length : NaN;
  }
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** 箱庭の各頂点の緯度経度でタイルを双線形補間する */
export function sampleGrid(tiles: Map<string, DemTile>, z: number, lat0: number, lon0: number, size: number, n: number): Float32Array {
  const out = new Float32Array(n * n);
  const half = size / 2;
  const cell = size / (n - 1);
  for (let iz = 0; iz < n; iz += 1) {
    for (let ix = 0; ix < n; ix += 1) {
      const ll = toLatLon(lat0, lon0, -half + ix * cell, -half + iz * cell);
      const t = lonLatToTile(ll.lon, ll.lat, z);
      out[iz * n + ix] = sampleTile(tiles, z, t.x, t.y);
    }
  }
  return out;
}

/** 無効値を周囲 8 近傍の有効値の平均で埋める（繰り返し）。それでも残れば最小標高。埋めた数を返す */
export function fillInvalid(h: Float32Array, n: number): { filled: number; fallback: number } {
  let filled = 0;
  for (let pass = 0; pass < 8; pass += 1) {
    let left = 0;
    const src = h.slice();
    for (let z = 0; z < n; z += 1)
      for (let x = 0; x < n; x += 1) {
        const i = z * n + x;
        if (!Number.isNaN(src[i]!)) continue;
        let s = 0;
        let c = 0;
        for (let dz = -1; dz <= 1; dz += 1)
          for (let dx = -1; dx <= 1; dx += 1) {
            const xx = x + dx;
            const zz = z + dz;
            if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
            const v = src[zz * n + xx]!;
            if (!Number.isNaN(v)) {
              s += v;
              c += 1;
            }
          }
        if (c > 0) {
          h[i] = s / c;
          filled += 1;
        } else left += 1;
      }
    if (left === 0) return { filled, fallback: 0 };
  }
  let min = Infinity;
  for (const v of h) if (!Number.isNaN(v)) min = Math.min(min, v);
  let fallback = 0;
  for (let i = 0; i < h.length; i += 1)
    if (Number.isNaN(h[i]!)) {
      h[i] = Number.isFinite(min) ? min : 0;
      fallback += 1;
    }
  return { filled, fallback };
}

/** 3×3 ガウシアン（1-2-1）を passes 回（docs/16 §3.3） */
export function smoothGauss(h: Float32Array, n: number, passes: number): Float32Array {
  let cur = h;
  for (let p = 0; p < passes; p += 1) {
    const out = new Float32Array(n * n);
    for (let z = 0; z < n; z += 1)
      for (let x = 0; x < n; x += 1) {
        let s = 0;
        let w = 0;
        for (let dz = -1; dz <= 1; dz += 1)
          for (let dx = -1; dx <= 1; dx += 1) {
            const xx = Math.min(n - 1, Math.max(0, x + dx));
            const zz = Math.min(n - 1, Math.max(0, z + dz));
            const k = (dx === 0 ? 2 : 1) * (dz === 0 ? 2 : 1);
            s += cur[zz * n + xx]! * k;
            w += k;
          }
        out[z * n + x] = s / w;
      }
    cur = out;
  }
  return cur;
}

/** 台座の上面: 最小標高 − 余白、50 m 単位で切り下げ */
export function baseElevationFor(minElevM: number, marginM = 60): number {
  return Math.floor((minElevM - marginM) / 50) * 50;
}

/** 森林限界の初期提案（北緯 36° で 2,500 m、1° 北上ごとに −200 m。docs/16 §6.1） */
export function suggestForestLine(lat: number): number {
  return Math.round((2500 - (lat - 36) * 200) / 50) * 50;
}
