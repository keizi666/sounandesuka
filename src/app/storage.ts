/**
 * 保存（docs/03 §9、FR-40/41）。World と記録を gzip（CompressionStream）+ base64 にして localStorage へ。
 * 容量を超えたら古い履歴から消し、それでも失敗したらあきらめる（呼び出し側がトースト表示）。
 */
import type { RecorderState } from '../sim/record/recorder';
import type { EndingKind, World } from '../sim/types';

export interface ResumeData {
  scenarioId: string;
  world: World;
  recorder: RecorderState;
  /** 分岐点が発火したときのスナップショット（What-if・やり直し） */
  choiceSnapshots: Record<string, { world: World; recorder: RecorderState }>;
  savedAt: string;
  runId: string;
  parentRunId: string | null;
}

export interface HistoryEntry {
  runId: string;
  parentRunId: string | null;
  scenarioId: string;
  title: string;
  at: string;
  ending: EndingKind;
  choices: string[];
}

const SAVE_PREFIX = 'hks.v1.save.';
const HISTORY_KEY = 'hks.v1.history';
const HISTORY_MAX = 50;
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
    const ok = setWithEviction(SAVE_PREFIX + d.scenarioId, await gzip(JSON.stringify(d)));
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
    return JSON.parse(await gunzip(raw)) as ResumeData;
  } catch {
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
