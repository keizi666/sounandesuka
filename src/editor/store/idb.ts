/**
 * IndexedDB（docs/15 §3.1）: データベース hakoniwa-editor、ストア projects（キー id）。素の API。
 * プレイヤー（同一オリジン）も「エディターで作ったシナリオ」を読むためにここを使う。
 */
import type { EditorProject } from '../../sim/types';

const DB = 'hakoniwa-editor';
const STORE = 'projects';

function open(): Promise<IDBDatabase> {
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
