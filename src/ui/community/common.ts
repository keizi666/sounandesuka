/**
 * 「みんなの遭難記録」の画面で共通に使う小物（アイコン・顔・文言・誤りの表示）。
 * 見た目は community.css（ここで読み込む）。
 */
import './community.css';
import contentCopy from '@material-symbols/svg-400/rounded/content_copy.svg?raw';
import deleteIc from '@material-symbols/svg-400/rounded/delete.svg?raw';
import flag2 from '@material-symbols/svg-400/rounded/flag_2.svg?raw';
import forum from '@material-symbols/svg-400/rounded/forum.svg?raw';
import key from '@material-symbols/svg-400/rounded/key.svg?raw';
import personEdit from '@material-symbols/svg-400/rounded/person_edit.svg?raw';
import send from '@material-symbols/svg-400/rounded/send.svg?raw';
import chevronRight from '@material-symbols/svg-400/rounded/chevron_right.svg?raw';
import arrowBack from '@material-symbols/svg-400/rounded/arrow_back.svg?raw';
import { JA } from '../../i18n/ja';
import { fill } from '../../i18n/format';
import { ApiError } from '../../net/communityApi';
import type { PublicUser } from '../../net/communityTypes';
import { avatar } from '../avatar';
import { el } from '../dom';

const C_ICONS = { contentCopy, delete: deleteIc, flag2, forum, key, personEdit, send, chevronRight, arrowBack } as const;
export type CIconName = keyof typeof C_ICONS;

/** この画面だけで使うアイコン（icons.ts と同じ作り。Material Symbols Rounded、Apache-2.0、同梱） */
export function cIcon(name: CIconName): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = C_ICONS[name].trim();
  const svg = t.content.firstElementChild as SVGElement;
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'ic');
  return svg;
}

/** 利用者の顔（登山者のイラストから選んだもの） */
export function userAvatar(u: Pick<PublicUser, 'id' | 'nickname' | 'portrait' | 'color'>, size: number): HTMLElement {
  return avatar({ id: `user-${u.id}`, name: u.nickname, color: u.color, portrait: u.portrait, age: 40, sex: 'm' }, size);
}

/** 「40代・男性」（答えないものは出さない） */
export function sexAgeText(u: Pick<PublicUser, 'sex' | 'age'>): string {
  const C = JA.community;
  return [u.age !== 'x' ? C.ages[u.age] : null, u.sex !== 'x' ? C.sexes[u.sex] : null].filter(Boolean).join('・');
}

/** API の誤りを文に */
export function errorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'server';
  return JA.community.errors[code] ?? JA.community.errors['server']!;
}

export function hm(min: number): string {
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} 時間 ${Math.round(min - h * 60)} 分` : `${Math.round(min)} 分`;
}

export function dateText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** 文字数の表示つきの入力欄（感想・ニックネーム） */
export function counted(input: HTMLInputElement | HTMLTextAreaElement, max: number): HTMLElement {
  const n = el('small', { class: 'cm-count' });
  const upd = (): void => {
    const len = [...input.value].length;
    n.textContent = fill(JA.community.count, { n: len, max });
    n.classList.toggle('over', len > max);
  };
  input.addEventListener('input', upd);
  upd();
  return n;
}
