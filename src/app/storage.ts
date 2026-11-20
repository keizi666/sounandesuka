/**
 * 保存（docs/03 §9、FR-40/41）。World と記録を gzip（CompressionStream）+ base64 にして localStorage へ。
 * 容量を超えたら古い履歴から消し、それでも失敗したらあきらめる（呼び出し側がトースト表示）。
 */
import type { LogLine } from '../ui/simHud';
import type { StartConditions } from '../sim/scenario/startConditions';
import type { Speed } from './loop';
import type { RecorderState } from '../sim/record/recorder';
import type { EndingKind, World } from '../sim/types';

export interface ResumeData {
  scenarioId: string;
  world: World;
  recorder: RecorderState;
  /** 分岐点が発火したときのスナップショット（What-if・やり直し） */
  choiceSnapshots: Record<string, { world: World; recorder: RecorderState }>;
  /** 画面のログ（再開したときに、それまでのログを出し直す）。古い保存にはない */
  log?: LogLine[];
  savedAt: string;
  runId: string;
  parentRunId: string | null;
  /** 始まりの条件を変えて試していたとき（再開のときに同じように当てる） */
  conditions?: StartConditions;
  /** 再生の速さ（再開のときに戻す） */
  speed?: Speed;
}

export interface HistoryEntry {
  runId: string;
  parentRunId: string | null;
  scenarioId: string;
  title: string;
  at: string;
  ending: EndingKind;
  choices: string[];
  /** 結末の見出し・亡くなった人数・人数・行動時間（分）・条件を変えたか。古い履歴にはない */
  endingTitle?: string;
  deaths?: number;
  partySize?: number;
  durationMin?: number;
  conditions?: boolean;
}

const SAVE_PREFIX = 'hks.v1.save.';
/**
 * 保存データの形式の番号。World の形が変わる変更（グループの追加など）をしたら上げる。
 * 番号の違う保存は読み込まずに捨てる（古い形の World で再開すると途中で止まり、画面が真っ暗になる）。
 */
const SAVE_FORMAT = 2;
const HISTORY_KEY = 'hks.v1.history';
const HISTORY_MAX = 500;
/** 保存時刻（解凍せずに新しい順に並べるため） */
const SAVED_AT_PREFIX = 'hks.v1.savedAt.';

async function gzip(text: string): Promise<string> {
  const cs = new CompressionStream('gzip');
  const buf = await new Response(new Blob([text]).stream().pipeThrough(cs)).arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function gunzip(b64: string): Promise<string> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const ds = new DecompressionStream('gzip');
  return new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
}

export function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as HistoryEntry[];
  } catch {
    return [];
  }
}

function setWithEviction(key: string, value: string): boolean {
  for (let tries = 0; tries < HISTORY_MAX + 2; tries += 1) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      const h = loadHistory();
      if (h.length === 0) return false;
      h.shift();
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
      } catch {
        return false;
      }
    }
  }
  return false;
}

export async function saveResume(d: ResumeData): Promise<boolean> {
  try {
    const ok = setWithEviction(SAVE_PREFIX + d.scenarioId, await gzip(JSON.stringify({ ...d, format: SAVE_FORMAT })));
    if (ok) localStorage.setItem(SAVED_AT_PREFIX + d.scenarioId, d.savedAt);
    return ok;
  } catch {
    return false;
  }
}

export async function loadResume(scenarioId: string): Promise<ResumeData | null> {
  const raw = localStorage.getItem(SAVE_PREFIX + scenarioId);
  if (!raw) return null;
  try {
    const d = JSON.parse(await gunzip(raw)) as ResumeData & { format?: number };
    if (d.format !== SAVE_FORMAT || !Array.isArray(d.world?.groups)) {
      clearResume(scenarioId);
      return null;
    }
    return d;
  } catch {
    clearResume(scenarioId);
    return null;
  }
}

export function clearResume(scenarioId: string): void {
  localStorage.removeItem(SAVE_PREFIX + scenarioId);
  localStorage.removeItem(SAVED_AT_PREFIX + scenarioId);
}

/** 自動保存のあるシナリオ（新しい順） */
export function resumableScenarios(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k?.startsWith(SAVE_PREFIX)) out.push(k.slice(SAVE_PREFIX.length));
  }
  const at = (id: string): string => localStorage.getItem(SAVED_AT_PREFIX + id) ?? '';
  return out.sort((a, b) => at(b).localeCompare(at(a)));
}

export function addHistory(e: HistoryEntry): void {
  const h = loadHistory();
  h.push(e);
  while (h.length > HISTORY_MAX) h.shift();
  setWithEviction(HISTORY_KEY, JSON.stringify(h));
}

export function newRunId(): string {
  // UI 層なので時刻と乱数を使ってよい（sim の結果には影響しない）
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
