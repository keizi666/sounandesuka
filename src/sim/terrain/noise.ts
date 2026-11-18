/**
 * シード付きの 2D グラディエントノイズ（改良 Perlin）と fBm・リッジノイズ（docs/04 §3）。
 * 乱数は terrain.seed から作る（World の rng は使わない）。
 */
import { makeRng } from '../core/rng';

export interface Noise2D {
  perm: Uint8Array; // 512（256 を 2 回）
}

// 8 方向の勾配（単位ベクトルではなく Perlin の慣例どおり）
const GX = [1, -1, 1, -1, 1, -1, 0, 0];
const GZ = [1, 1, -1, -1, 0, 0, 1, -1];

export function createNoise2D(seed: number): Noise2D {
  const rng = makeRng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) p[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = rng.u32() % (i + 1);
    const t = p[i]!;
    p[i] = p[j]!;
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) perm[i] = p[i & 255]!;
  return { perm };
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

function g(h: number, dx: number, dz: number): number {
  const k = h & 7;
  return GX[k]! * dx + GZ[k]! * dz;
}

/** おおよそ [-1, 1] */
export function noise2(n: Noise2D, x: number, z: number): number {
  const fx = Math.floor(x);
  const fz = Math.floor(z);
  const xi = fx & 255;
  const zi = fz & 255;
  const xf = x - fx;
  const zf = z - fz;
  const perm = n.perm;
  const aa = perm[perm[xi]! + zi]!;
  const ab = perm[perm[xi]! + zi + 1]!;
  const ba = perm[perm[xi + 1]! + zi]!;
  const bb = perm[perm[xi + 1]! + zi + 1]!;
  const u = fade(xf);
  const v = fade(zf);
  const x1 = g(aa, xf, zf) + u * (g(ba, xf - 1, zf) - g(aa, xf, zf));
  const x2 = g(ab, xf, zf - 1) + u * (g(bb, xf - 1, zf - 1) - g(ab, xf, zf - 1));
  // 2D Perlin の値域 ±√0.5 を ±1 に広げる
  return (x1 + v * (x2 - x1)) * 1.4142135623730951;
}

// オクターブごとのずらし（格子の重なりを避ける）
const OCT_OFFSET_X = 37.17;
const OCT_OFFSET_Z = -91.43;

/** fBm。正規化して おおよそ [-1, 1] */
export function fbm(n: Noise2D, x: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * noise2(n, x * freq + o * OCT_OFFSET_X, z * freq + o * OCT_OFFSET_Z);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** リッジノイズ。[0, 1]、尾根状の鋭い筋が 1 に近い */
export function ridged(n: Noise2D, x: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o += 1) {
    const r = 1 - Math.abs(noise2(n, x * freq + o * OCT_OFFSET_X, z * freq + o * OCT_OFFSET_Z));
    sum += amp * r * r;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return Math.min(1, Math.max(0, sum / norm));
}
