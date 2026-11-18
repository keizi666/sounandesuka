/**
 * スナップショットとハッシュ（docs/03 §7）。
 * 圧縮（gzip + base64）はブラウザと Node の非同期 API を使うので app 層（storage.ts）で行う。ここは JSON とハッシュだけ。
 */
import type { RunRecord, World } from '../types';

export function serializeWorld(world: World): string {
  return JSON.stringify(world);
}

export function restoreWorld(json: string): World {
  return JSON.parse(json) as World;
}

export function cloneWorld(world: World): World {
  return JSON.parse(JSON.stringify(world)) as World;
}

/** 正規化 JSON: キーを並べ替え、数値は小数 6 桁に丸める（浮動小数の表示の違いを吸収） */
export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(6) : String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64bit（16 進 16 桁） */
export function fnv1a64(s: string): string {
  let h = FNV64_OFFSET;
  for (let i = 0; i < s.length; i += 1) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV64_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, '0');
}

export function hashWorld(world: World): string {
  return fnv1a64(canonicalJson(world));
}

export function hashRecord(record: RunRecord): string {
  return fnv1a64(canonicalJson(record));
}
