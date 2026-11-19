/**
 * 道具のパレット（ユーザーの指定: ドロップダウンではなく、アイコンのボタン。フォトショップのような使い心地）。
 * 地図の左端に縦に並べる。いまの道具は色が変わり、マウスを当てると名前とショートカットキーが出る。
 * 1 文字のキー（V・M など）で道具を切り替えられる（入力欄の中では効かない）。
 * インスペクタには、いまの道具の名前と使い方を出す（返り値）。
 */
import { el } from '../../ui/dom';
import { icon, type IconName } from '../../ui/icons';
import type { Ed } from '../context';

export interface ToolDef<T extends string> {
  id: T;
  icon: IconName;
  label: string;
  /** ショートカットキー（1 文字、英字） */
  key?: string;
  /** 使い方の一言（インスペクタに出す） */
  hint?: string;
}

export function toolPalette<T extends string>(ed: Ed, tools: readonly ToolDef<T>[], current: T, pick: (t: T) => void): HTMLElement {
  const keys = new Map<string, () => void>();
  const btns = tools.map((t) => {
    const title = t.key ? `${t.label}（${t.key.toUpperCase()}）` : t.label;
    const b = el('button', { type: 'button', class: `tp-btn${t.id === current ? ' on' : ''}`, title, 'aria-label': title, 'aria-pressed': t.id === current ? 'true' : 'false', onclick: () => pick(t.id) }, [
      icon(t.icon),
      t.key ? el('span', { class: 'tp-key' }, t.key.toUpperCase()) : null,
    ]);
    if (t.key) keys.set(t.key.toLowerCase(), () => pick(t.id));
    return b;
  });
  ed.setToolPalette(el('div', { class: 'tool-palette', role: 'toolbar', 'aria-label': '道具' }, btns), keys);
  const cur = tools.find((t) => t.id === current);
  return el('div', { class: 'tp-caption' }, [
    cur ? icon(cur.icon) : null,
    el('div', {}, [el('strong', {}, cur?.label ?? ''), cur?.hint ? el('small', {}, cur.hint) : null]),
  ]);
}
