/**
 * IndexedDB（docs/15 §3.1）: データベース sounan-editor、ストア projects（キー id）。素の API。
 * プレイヤー（同一オリジン）も「エディターで作ったシナリオ」を読むためにここを使う。
 * 旧名（hakoniwa-editor）のデータベースにプロジェクトがあれば、はじめて開いたときに写す（名前を変えたため）。
 */
import type { EditorProject } from '../../sim/types';

const DB = 'sounan-editor';
const OLD_DB = 'hakoniwa-editor';
const STORE = 'projects';
let migrated: Promise<void> | null = null;

function openRaw(name: string, create: boolean): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      if (!create) {
        // 旧名のデータベースがなかった。作らずに閉じる
        r.transaction?.abort();
        return;
      }
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  });
}

/** 旧名のデータベースから、まだないプロジェクトを写す（1 回だけ） */
function migrate(): Promise<void> {
  if (!migrated)
    migrated = (async () => {
      const old = await openRaw(OLD_DB, false);
      if (!old || !old.objectStoreNames.contains(STORE)) {
        old?.close();
        return;
      }
      const all = await new Promise<EditorProject[]>((resolve) => {
        const req = old.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result as EditorProject[]);
        req.onerror = () => resolve([]);
      });
      old.close();
      if (all.length === 0) return;
      const db = await openRaw(DB, true);
      if (!db) return;
      await new Promise<void>((resolve) => {
        const t = db.transaction(STORE, 'readwrite');
        const st = t.objectStore(STORE);
        for (const p of all) {
          const g = st.get(p.id);
          g.onsuccess = () => {
            if (!g.result) st.put(p);
          };
        }
        t.oncomplete = () => resolve();
        t.onerror = () => resolve();
      });
      db.close();
    })().catch(() => undefined);
  return migrated;
}

function open(): Promise<IDBDatabase> {
  return migrate().then(() => openNew());
}

function openNew(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB を開けませんでした'));
  });
}

function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = f(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => reject(t.error ?? new Error('IndexedDB の操作に失敗しました'));
      }),
  );
}

export function putProject(p: EditorProject): Promise<IDBValidKey> {
  return tx('readwrite', (s) => s.put(p));
}

export function getProject(id: string): Promise<EditorProject | undefined> {
  return tx('readonly', (s) => s.get(id) as IDBRequest<EditorProject | undefined>);
}

export function deleteProject(id: string): Promise<undefined> {
  return tx('readwrite', (s) => s.delete(id) as IDBRequest<undefined>);
}

/** 一覧（高さの配列は重いので名前と日付だけ返す） */
export async function listProjects(): Promise<{ id: string; name: string; updatedAt: string; real: boolean }[]> {
  const all = await tx('readonly', (s) => s.getAll() as IDBRequest<EditorProject[]>);
  return all
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, real: Boolean(p.map.geo) }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
