/**
 * 登山者の顔アイコン。丸形で、外枠は各人のテーマカラー。
 * 絵は、年代と性別ごとのイラスト（public/portraits/<区分>.webp。1 人 128px を index.json の列数で並べた 1 枚）から 1 人分を表示する。
 * どの絵を使うかは、登山者の設定 portrait（"区分:番号"）があればそれ、なければ年齢・性別と ID から決める（同じ人はいつも同じ顔）。
 * 画像がなければ、テーマカラーの丸に名前の頭文字を出す。
 * 画像は tools/make-portraits.py で、ユーザーが用意したイラスト（assets-src/hikers-cells-v5）から作る。
 * 顔は架空のイラストで、特定の人物を表さない（史実シナリオでも同じ）。
 */
import { assetUrl } from '../app/data';
import type { ClimberDef } from '../sim/types';
import { el } from './dom';

export type PortraitGroup = 'child_m' | 'child_f' | 'young_m' | 'young_f' | 'mid_m' | 'mid_f' | 'senior_m' | 'senior_f';

interface PortraitIndex {
  cols: number;
  counts: Partial<Record<PortraitGroup, number>>;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 年代と性別の区分（子供 〜15 歳、若者 16〜39、中年 40〜64、高齢 65〜） */
export function portraitGroup(def: Pick<ClimberDef, 'age' | 'sex'>): PortraitGroup {
  const age = def.age < 16 ? 'child' : def.age < 40 ? 'young' : def.age < 65 ? 'mid' : 'senior';
  return `${age}_${def.sex === 'f' ? 'f' : 'm'}` as PortraitGroup;
}

export const PORTRAIT_GROUPS: PortraitGroup[] = ['child_m', 'child_f', 'young_m', 'young_f', 'mid_m', 'mid_f', 'senior_m', 'senior_f'];

/** 設定の portrait（"mid_m:3"）を読む。番号は 0 から に直す。形が違えば null */
export function parsePortrait(v: string | undefined): { group: PortraitGroup; index: number } | null {
  const m = /^(child|young|mid|senior)_([mf]):([1-9][0-9]*)$/.exec(v ?? '');
  return m ? { group: `${m[1]}_${m[2]}` as PortraitGroup, index: Number(m[3]) - 1 } : null;
}

/** 区分の中の何番目の絵か（count 人のうち） */
export function portraitIndex(id: string, count: number): number {
  return count > 0 ? hash(id) % count : 0;
}

let indexPromise: Promise<PortraitIndex | null> | null = null;
/** 読み終えた一覧（undefined = まだ）。読み終えたあとは、作ったその場で絵を付ける（パネルは 1 秒に数回作り直すので、ちらつかせない） */
let loadedIndex: PortraitIndex | null | undefined;
function loadIndex(): Promise<PortraitIndex | null> {
  indexPromise ??= fetch(assetUrl('portraits/index.json'))
    .then((r) => (r.ok ? (r.json() as Promise<PortraitIndex>) : null))
    .catch(() => null)
    .then((v) => (loadedIndex = v));
  return indexPromise;
}

/** 顔アイコンの要素。size は直径（px） */
export function avatar(def: Pick<ClimberDef, 'id' | 'age' | 'sex' | 'name' | 'color' | 'portrait'>, size: number): HTMLElement {
  const a = el('span', { class: 'avatar', 'aria-hidden': 'true', style: `width:${size}px;height:${size}px;border-color:${def.color};font-size:${Math.round(size * 0.46)}px;background-color:${def.color}` }, [...def.name][0] ?? '');
  const chosen = parsePortrait(def.portrait);
  const group = chosen?.group ?? portraitGroup(def);
  const apply = (idx: PortraitIndex | null): void => {
    const count = idx?.counts[group] ?? 0;
    if (!idx || count === 0) return;
    const cols = Math.max(1, idx.cols);
    const rows = Math.ceil(count / cols);
    const i = chosen ? Math.min(chosen.index, count - 1) : portraitIndex(def.id, count);
    const col = i % cols;
    const row = Math.floor(i / cols);
    a.textContent = '';
    a.classList.add('img');
    a.style.backgroundColor = '#f6f2ea';
    a.style.backgroundImage = `url("${assetUrl(`portraits/${group}.webp`)}")`;
    a.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
    a.style.backgroundPosition = `${cols > 1 ? (col / (cols - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`;
  };
  if (loadedIndex !== undefined) apply(loadedIndex);
  else void loadIndex().then(apply);
  return a;
}

/** 区分ごとの人数（顔の一覧を出すとき用。読み込めなければ null） */
export function portraitCounts(): Promise<Partial<Record<PortraitGroup, number>> | null> {
  return loadIndex().then((idx) => idx?.counts ?? null);
}
