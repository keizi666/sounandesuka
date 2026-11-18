/**
 * 乱数（docs/03 §5）。xoshiro128** を 32bit 整数演算だけで実装し、全環境で同じ結果にする。
 * 状態は 4 つの uint32（RngState）で、World にそのまま入る（JSON で往復できる）。
 */
import type { RngState, RngStreamName } from '../types';

export const RNG_STREAMS: readonly RngStreamName[] = [
  'weather',
  'nav',
  'hazard',
  'behavior',
  'rescue',
  'thoughts',
  'choice',
  'events',
];

const TWO_POW_32 = 4294967296;

/** splitmix32: シードを 32bit 値の列に展開する */
export function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/** 文字列の 32bit ハッシュ（FNV-1a） */
export function hashString32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32(s) の最初の出力と同じ値（関数を作らずに計算する） */
function splitmixFirst(s: number): number {
  let z = (s + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

/** 基準シードと部品からシードを派生させる（What-if・モンテカルロの runIndex など） */
export function deriveSeed(base: number, ...parts: number[]): number {
  let h = base >>> 0;
  for (const p of parts) h = splitmixFirst((h ^ (p >>> 0)) >>> 0);
  return splitmixFirst(h);
}

/** deriveSeed(base, part) と同じ値（可変長引数の配列を作らない速い版） */
export function deriveSeed1(base: number, part: number): number {
  return splitmixFirst(splitmixFirst(((base >>> 0) ^ (part >>> 0)) >>> 0));
}

/** シードから xoshiro128** の状態を作る */
export function seedState(seed: number): RngState {
  const next = splitmix32(seed);
  const s: RngState = [next(), next(), next(), next()];
  if (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0) s[0] = 1;
  return s;
}

/** 名前付きストリームを作る。ストリームのシードは名前から派生するので、ストリームを足しても他は変わらない */
export function createRngStreams(seed: number): Record<RngStreamName, RngState> {
  const out = {} as Record<RngStreamName, RngState>;
  for (const name of RNG_STREAMS) {
    out[name] = seedState(deriveSeed(seed, hashString32(name)));
  }
  return out;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** 次の uint32。状態をその場で更新する */
export function nextU32(s: RngState): number {
  const s0 = s[0];
  const s1 = s[1];
  const s2 = s[2];
  const s3 = s[3];
  const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (s1 << 9) >>> 0;
  let n2 = (s2 ^ s0) >>> 0;
  let n3 = (s3 ^ s1) >>> 0;
  const n1 = (s1 ^ n2) >>> 0;
  const n0 = (s0 ^ n3) >>> 0;
  n2 = (n2 ^ t) >>> 0;
  n3 = rotl(n3, 11);
  s[0] = n0;
  s[1] = n1;
  s[2] = n2;
  s[3] = n3;
  return result;
}

/** [0, 1) の一様乱数 */
export function nextFloat(s: RngState): number {
  return nextU32(s) / TWO_POW_32;
}

/** [a, b) の一様乱数 */
export function randRange(s: RngState, a: number, b: number): number {
  return a + (b - a) * nextFloat(s);
}

/** 0..n-1 の整数 */
export function randInt(s: RngState, n: number): number {
  return Math.floor(nextFloat(s) * n);
}

/** 確率 p で true */
export function chance(s: RngState, p: number): boolean {
  return nextFloat(s) < p;
}

/** 重みに比例して添字を選ぶ。重みの合計が 0 以下なら -1 */
export function pickWeighted(s: RngState, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return -1;
  let r = nextFloat(s) * total;
  for (let i = 0; i < weights.length; i += 1) {
    const w = Math.max(0, weights[i] ?? 0);
    if (r < w) return i;
    r -= w;
  }
  // 浮動小数の端数で抜けた場合は最後の正の重み
  for (let i = weights.length - 1; i >= 0; i -= 1) if ((weights[i] ?? 0) > 0) return i;
  return -1;
}

/** 地形生成など World の外で使う単独の乱数源 */
export function makeRng(seed: number): { state: RngState; float: () => number; u32: () => number } {
  const state = seedState(seed);
  return { state, float: () => nextFloat(state), u32: () => nextU32(state) };
}
