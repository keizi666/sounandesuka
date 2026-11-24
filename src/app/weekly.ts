/**
 * 週替わりのお題（ユーザーの指定: リピーターを増やす）。毎週 1 本のシナリオを、同じ乱数の種（同じ天気・同じ巡り合わせ）で全員が遊ぶ。
 * サーバーに聞かずに、日付だけから決める（月曜 0 時〔日本時間〕に替わる）。史実のシナリオは選ばない（種が決まっているため）。
 * いまの季節のシナリオがあれば、そこから選ぶ。前の週と同じシナリオにはしない。
 * 載せた記録には週の番号（week）が入り、トップのお題の欄で、その週の参加人数と結末の割合を出す。
 */
import type { ScenarioIndexEntry } from '../sim/types';
import { seasonOfMonth } from './season';

const DAY_MS = 86400000;
const JST_MS = 9 * 3600000;
/** 第 1 週の月曜（2026-01-05、日本時間の 0 時） */
const WEEK1_UTC = Date.UTC(2026, 0, 5) - JST_MS;

/** 32 ビットのハッシュ（同じ入力なら、どの端末でも同じ） */
function hash32(n: number): number {
  let h = Math.imul(n ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x165667b1);
  h ^= h >>> 13;
  return h >>> 0;
}

/** その時刻の週の番号（1 から） */
export function weekOf(nowMs: number): number {
  return Math.floor((nowMs - WEEK1_UTC) / (7 * DAY_MS)) + 1;
}

/** 週の始まり（月曜）と終わり（日曜）の日付（日本時間の「M/D」） */
export function weekRange(week: number): { from: string; to: string } {
  const start = WEEK1_UTC + (week - 1) * 7 * DAY_MS + JST_MS;
  const md = (ms: number): string => {
    const d = new Date(ms);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };
  return { from: md(start), to: md(start + 6 * DAY_MS) };
}

/** その週の乱数の種（全員同じ） */
export function weekSeed(week: number): number {
  return (hash32(week * 7919 + 13) % 999999937) + 1;
}

/** その週の候補の中から、ハッシュで選んだもの（前の週との重なりは見ない） */
function rawPick(entries: readonly ScenarioIndexEntry[], w: number): { e: ScenarioIndexEntry; pool: ScenarioIndexEntry[] } | null {
  const all = entries.filter((e) => !e.historical);
  if (all.length === 0) return null;
  // その週の真ん中（木曜）の月の季節に合うシナリオから選ぶ（4 本以上あれば）
  const mid = new Date(WEEK1_UTC + (w - 1) * 7 * DAY_MS + JST_MS + 3 * DAY_MS);
  const season = seasonOfMonth(mid.getUTCMonth() + 1);
  const inSeason = all.filter((e) => e.season === season);
  const pool = [...(inSeason.length >= 4 ? inSeason : all)].sort((a, b) => (a.id < b.id ? -1 : 1));
  return { e: pool[hash32(w) % pool.length]!, pool };
}

/**
 * その週のお題のシナリオ（候補がなければ null）。前の週と同じになったら、同じ候補の中の次のものにする。
 * 前の週の決定にも同じ決まりが当たるので、第 1 週から順に決める（どの端末でも同じになる。週の数は数百なので軽い）
 */
export function weeklyPick(entries: readonly ScenarioIndexEntry[], week: number): ScenarioIndexEntry | null {
  let prev: ScenarioIndexEntry | null = null;
  let cur: ScenarioIndexEntry | null = null;
  for (let w = 1; w <= week; w += 1) {
    const r = rawPick(entries, w);
    if (!r) return null;
    cur = r.e;
    if (prev && cur.id === prev.id && r.pool.length > 1) cur = r.pool[(r.pool.indexOf(cur) + 1) % r.pool.length]!;
    prev = cur;
  }
  return cur;
}
