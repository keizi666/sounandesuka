/**
 * 計算した結果のキャッシュ（IndexedDB。ユーザーの指定: シナリオ開始時に作る 3D のデータを毎回作らず、同じ条件なら使い回す）。
 * - キーには、アプリの版とビルドの時刻（APP_BUILT）を含める。デプロイすると古いキャッシュは使わない（作り方が変わっても古い結果を使わない）。
 * - 大きいので、種類（キーの先頭の語）ごとに数を絞り、長く使っていないものから消す。
 * - 読み書きに失敗しても（容量不足・プライベートブラウズ）、計算し直して続ける。
 */
import { APP_BUILT, APP_VERSION } from './version';

const DB = 'hks-cache';
const DB_VER = 1;
const STORE = 'kv';
const META = 'meta';
/** キーの作りを変えたら上げる */
const FORMAT = 1;

/** 種類ごとに残す数 */
const KEEP: Record<string, number> = { runtime: 12, masks: 8, terrain: 6, trees: 12 };

let dbp: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

/** 版とビルドの時刻を含めたキー */
export function cacheKey(kind: string, ...parts: (string | number)[]): string {
  return [kind, FORMAT, APP_VERSION, APP_BUILT, ...parts].join('|');
}

function kindOf(key: string): string {
  return key.slice(0, key.indexOf('|'));
}

function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction([STORE, META], 'readwrite');
    const req = tx.objectStore(STORE).get(key);
    const value = await new Promise<T | null>((resolve) => {
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
    if (value !== null) tx.objectStore(META).put({ kind: kindOf(key), used: Date.now() }, key);
    await done(tx);
    return value;
  } catch {
    return null;
  }
}

export async function cachePut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction([STORE, META], 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.objectStore(META).put({ kind: kindOf(key), used: Date.now() }, key);
    if (!(await done(tx))) return;
    await evict(db, kindOf(key));
  } catch {
    // 容量不足など。キャッシュなしで続ける
  }
}

/** 種類ごとに、長く使っていないものから消す。版が古いものは数に関わらず消す */
async function evict(db: IDBDatabase, kind: string): Promise<void> {
  const keep = KEEP[kind] ?? 8;
  const tx = db.transaction([STORE, META], 'readwrite');
  const meta = tx.objectStore(META);
  const req = meta.openCursor();
  const rows: { key: string; used: number; kind: string }[] = [];
  await new Promise<void>((resolve) => {
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      const v = c.value as { kind: string; used: number };
      rows.push({ key: String(c.key), used: v.used, kind: v.kind });
      c.continue();
    };
    req.onerror = () => resolve();
  });
  const current = `|${FORMAT}|${APP_VERSION}|${APP_BUILT}|`;
  const stale = rows.filter((r) => !r.key.includes(current));
  const mine = rows.filter((r) => r.kind === kind && r.key.includes(current)).sort((a, b) => b.used - a.used);
  for (const r of [...stale, ...mine.slice(keep)]) {
    tx.objectStore(STORE).delete(r.key);
    meta.delete(r.key);
  }
  await done(tx);
}

/** 文字列の短いハッシュ（FNV-1a 32 ビット、16 進） */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
