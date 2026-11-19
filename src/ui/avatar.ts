/**
 * 登山者の顔アイコン。丸形で、外枠は各人のテーマカラー。
 * 絵は、年代と性別ごとのイラスト（public/portraits/<区分>.webp。5 列 × 4 行の 20 人）から 1 人分を表示する。
 * どの絵を使うかは、年齢・性別と ID から決める（同じ人はいつも同じ顔）。画像がなければ、色つきの丸に名前の頭文字を出す。
 * 画像は tools/make-portraits.py で、ユーザーが用意したイラストの一覧から切り出して作る。
 */
import { assetUrl } from '../app/data';
import type { ClimberDef } from '../sim/types';
import { el } from './dom';

export const PORTRAIT_COLS = 5;
export const PORTRAIT_ROWS = 4;

type Group = 'child_m' | 'child_f' | 'young_m' | 'young_f' | 'mid_m' | 'mid_f' | 'senior_m' | 'senior_f';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 年代と性別の区分と、その中の何番目の絵か */
export function portraitOf(def: Pick<ClimberDef, 'id' | 'age' | 'sex'>): { group: Group; index: number } {
  const age = def.age < 16 ? 'child' : def.age < 40 ? 'young' : def.age < 65 ? 'mid' : 'senior';
  return { group: `${age}_${def.sex === 'f' ? 'f' : 'm'}` as Group, index: hash(def.id) % (PORTRAIT_COLS * PORTRAIT_ROWS) };
}

/** 区分ごとに、画像があるかを 1 回だけ調べる */
const available = new Map<Group, Promise<boolean>>();
function hasSheet(group: Group): Promise<boolean> {
  let p = available.get(group);
  if (!p) {
    p = new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0);
      img.onerror = () => resolve(false);
      img.src = assetUrl(`portraits/${group}.webp`);
    });
    available.set(group, p);
  }
  return p;
}

/** 顔アイコンの要素。size は直径（px） */
export function avatar(def: Pick<ClimberDef, 'id' | 'age' | 'sex' | 'name' | 'color'>, size: number): HTMLElement {
  const { group, index } = portraitOf(def);
  const a = el('span', { class: 'avatar', 'aria-hidden': 'true', style: `width:${size}px;height:${size}px;border-color:${def.color};font-size:${Math.round(size * 0.46)}px;background-color:${def.color}` }, [...def.name][0] ?? '');
  void hasSheet(group).then((ok) => {
    if (!ok) return;
    const col = index % PORTRAIT_COLS;
    const row = Math.floor(index / PORTRAIT_COLS);
    a.textContent = '';
    a.classList.add('img');
    a.style.backgroundColor = '#f4efe6';
    a.style.backgroundImage = `url("${assetUrl(`portraits/${group}.webp`)}")`;
    a.style.backgroundSize = `${PORTRAIT_COLS * 100}% ${PORTRAIT_ROWS * 100}%`;
    a.style.backgroundPosition = `${(col / (PORTRAIT_COLS - 1)) * 100}% ${(row / (PORTRAIT_ROWS - 1)) * 100}%`;
  });
  return a;
}
