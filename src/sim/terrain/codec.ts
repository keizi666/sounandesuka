/**
 * グリッドの符号化（docs/16 §3.2、§5）。sim は DOM も Node も使わないので base64 も自前で持つ。
 * - 高さマップ: Uint16 LE を base64。h = min + v / 65535 * (max - min)
 * - 塗り直しのグリッド（vegetation.overrides・radio.paint）: [値, 個数(uint16 LE)] の繰り返しを base64（rle-u8-base64）
 *   radio.paint は Int8 の意味（-1 は 255 として保存）。
 */
import type { GridOverride, HeightmapTerrainDef } from '../types';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const REV = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHA.length; i += 1) REV[ALPHA.charCodeAt(i)] = i;

export function base64Encode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHA[(n >> 18) & 63]! + ALPHA[(n >> 12) & 63]! + ALPHA[(n >> 6) & 63]! + ALPHA[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += `${ALPHA[(n >> 18) & 63]!}${ALPHA[(n >> 12) & 63]!}==`;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += `${ALPHA[(n >> 18) & 63]!}${ALPHA[(n >> 12) & 63]!}${ALPHA[(n >> 6) & 63]!}=`;
  }
  return out;
}

export function base64Decode(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = REV[clean.charCodeAt(i)]!;
    const b = REV[clean.charCodeAt(i + 1)] ?? -1;
    const c = i + 2 < clean.length ? REV[clean.charCodeAt(i + 2)]! : -1;
    const d = i + 3 < clean.length ? REV[clean.charCodeAt(i + 3)]! : -1;
    const n = (a << 18) | (Math.max(0, b) << 12) | (Math.max(0, c) << 6) | Math.max(0, d);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (c >= 0 && o < out.length) out[o++] = (n >> 8) & 255;
    if (d >= 0 && o < out.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

/** 高さ（Float32、resolution²）→ u16-base64 */
export function encodeHeights(h: ArrayLike<number>): { minElevM: number; maxElevM: number; data: string } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < h.length; i += 1) {
    min = Math.min(min, h[i]!);
    max = Math.max(max, h[i]!);
  }
  const span = max - min || 1;
  const bytes = new Uint8Array(h.length * 2);
  for (let i = 0; i < h.length; i += 1) {
    const v = Math.round(((h[i]! - min) / span) * 65535);
    bytes[i * 2] = v & 255;
    bytes[i * 2 + 1] = v >> 8;
  }
  return { minElevM: min, maxElevM: max, data: base64Encode(bytes) };
}

export function decodeHeights(t: HeightmapTerrainDef, count: number): Float32Array {
  const bytes = base64Decode(t.data);
  if (bytes.length !== count * 2) throw new Error(`高さマップの大きさが合いません（${bytes.length / 2} 点、期待 ${count} 点）`);
  const out = new Float32Array(count);
  const span = t.maxElevM - t.minElevM;
  for (let i = 0; i < count; i += 1) out[i] = t.minElevM + ((bytes[i * 2]! | (bytes[i * 2 + 1]! << 8)) / 65535) * span;
  return out;
}

/** RLE（[値, 個数 uint16 LE]）の符号化 */
export function encodeGrid(values: ArrayLike<number>): GridOverride {
  const parts: number[] = [];
  let i = 0;
  while (i < values.length) {
    const v = values[i]! & 255;
    let n = 1;
    while (i + n < values.length && (values[i + n]! & 255) === v && n < 65535) n += 1;
    parts.push(v, n & 255, n >> 8);
    i += n;
  }
  return { encoding: 'rle-u8-base64', data: base64Encode(Uint8Array.from(parts)) };
}

export function decodeGrid(g: GridOverride, count: number): Uint8Array {
  const b = base64Decode(g.data);
  const out = new Uint8Array(count);
  let o = 0;
  for (let i = 0; i + 2 < b.length && o < count; i += 3) {
    const v = b[i]!;
    const n = b[i + 1]! | (b[i + 2]! << 8);
    out.fill(v, o, Math.min(count, o + n));
    o += n;
  }
  if (o !== count) throw new Error(`塗り直しのグリッドの大きさが合いません（${o} 点、期待 ${count} 点）`);
  return out;
}

/** Int8 として読む（radio.paint の -1） */
export function asInt8(v: number): number {
  return v > 127 ? v - 256 : v;
}
