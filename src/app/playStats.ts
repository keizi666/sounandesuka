/**
 * 自分のプレイの印（ユーザーの指定）: シナリオごとのプレイ回数（結末まで遊んだ回数）とお気に入り。端末の localStorage。
 * プレイ回数は履歴（上限あり）と別に数えるので、古い履歴が消えても減らない。初めて読むときは、それまでの履歴から数え直す。
 */
import { clearHistoryAndSaves, loadHistory } from './storage';

const COUNT_KEY = 'hks.v1.playCounts';
const FAV_KEY = 'hks.v1.favorites';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // 保存できなくても遊べる
  }
}

/** シナリオごとのプレイ回数 */
export function playCounts(): Record<string, number> {
  let c = read<Record<string, number> | null>(COUNT_KEY, null);
  if (!c) {
    c = {};
    for (const h of loadHistory()) c[h.scenarioId] = (c[h.scenarioId] ?? 0) + 1;
    write(COUNT_KEY, c);
  }
  return c;
}

/**
 * この端末のプレイ記録を消す（ユーザーの指定）。プレイ回数・プレイ済みの印・履歴・途中の保存を消す。
 * お気に入りと、「みんなの遭難記録」に載せた記録（サーバー）はそのまま。回数は履歴から数え直さないよう、空で書く
 */
export function clearPlayRecords(): void {
  try {
    clearHistoryAndSaves();
  } catch {
    // 消せなかった分は残る
  }
  write(COUNT_KEY, {});
}

/** 結末まで遊んだ（履歴に入れるのと同じとき） */
export function countPlay(scenarioId: string): void {
  const c = playCounts();
  c[scenarioId] = (c[scenarioId] ?? 0) + 1;
  write(COUNT_KEY, c);
}

export function favorites(): Set<string> {
  return new Set(read<string[]>(FAV_KEY, []));
}

export function isFavorite(scenarioId: string): boolean {
  return favorites().has(scenarioId);
}

/** お気に入りを切り替える。切り替えたあとの状態を返す */
export function toggleFavorite(scenarioId: string): boolean {
  const f = favorites();
  const on = !f.has(scenarioId);
  if (on) f.add(scenarioId);
  else f.delete(scenarioId);
  write(FAV_KEY, [...f]);
  return on;
}
