/**
 * 入力欄の小さな部品（インスペクタ・フォームで共通）。値は get で読み、確定（change）時に set を呼ぶ。
 */
import { el } from '../../ui/dom';

export function row(label: string, ctrl: HTMLElement, hint?: string): HTMLElement {
  return el('label', { class: 'f-row', title: hint ?? '' }, [el('span', { class: 'f-label' }, label), ctrl]);
}

export function num(label: string, value: number | null | undefined, set: (v: number) => void, o: { min?: number; max?: number; step?: number; hint?: string; unit?: string } = {}): HTMLElement {
  const i = el('input', { type: 'number', value: value ?? '', min: o.min ?? '', max: o.max ?? '', step: o.step ?? 'any', class: 'f-num' });
  i.addEventListener('change', () => {
    if (i.value === '') return;
    let v = Number(i.value);
    if (o.min !== undefined) v = Math.max(o.min, v);
    if (o.max !== undefined) v = Math.min(o.max, v);
    set(v);
  });
  return row(label, o.unit ? el('span', { class: 'f-unit' }, [i, ` ${o.unit}`]) : i, o.hint);
}

/** スライダー＋数値＋言葉の説明（docs/18 §2.1） */
export function slider(label: string, value: number, set: (v: number) => void, o: { min: number; max: number; step: number; words?: (v: number) => string }): HTMLElement {
  const out = el('span', { class: 'f-words' }, o.words?.(value) ?? String(value));
  const i = el('input', { type: 'range', min: o.min, max: o.max, step: o.step, value });
  i.addEventListener('input', () => (out.textContent = o.words?.(Number(i.value)) ?? i.value));
  i.addEventListener('change', () => set(Number(i.value)));
  return row(label, el('span', { class: 'f-slider' }, [i, out]));
}

export function text(label: string, value: string | undefined, set: (v: string) => void, o: { placeholder?: string; hint?: string; wide?: boolean } = {}): HTMLElement {
  const i = el('input', { type: 'text', value: value ?? '', placeholder: o.placeholder ?? '', class: o.wide ? 'f-wide' : '' });
  i.addEventListener('change', () => set(i.value));
  return row(label, i, o.hint);
}

export function area(label: string, value: string | undefined, set: (v: string) => void, rows = 3): HTMLElement {
  const t = el('textarea', { rows });
  t.value = value ?? '';
  t.addEventListener('change', () => set(t.value));
  return el('label', { class: 'f-col' }, [el('span', { class: 'f-label' }, label), t]);
}

export function select<T extends string | number>(label: string, value: T, options: [T, string][], set: (v: T) => void, hint?: string): HTMLElement {
  const s = el('select', {}, options.map(([v, l]) => el('option', { value: String(v), selected: v === value }, l)));
  s.addEventListener('change', () => set(options[s.selectedIndex]![0]));
  return row(label, s, hint);
}

export function check(label: string, value: boolean, set: (v: boolean) => void, hint?: string): HTMLElement {
  const c = el('input', { type: 'checkbox', checked: value });
  c.addEventListener('change', () => set(c.checked));
  return el('label', { class: 'f-check', title: hint ?? '' }, [c, label]);
}

export function section(title: string, children: (HTMLElement | null)[], open = true): HTMLElement {
  return el('details', { class: 'f-section', open }, [el('summary', {}, title), ...children]);
}

export function button(label: string, onclick: () => void, cls = ''): HTMLButtonElement {
  return el('button', { class: cls, onclick }, label);
}

/** 文字列のリスト（1 行 1 項目） */
export function lines(label: string, value: string[] | undefined, set: (v: string[]) => void, rows = 3): HTMLElement {
  return area(`${label}（1 行に 1 つ）`, (value ?? []).join('\n'), (s) => set(s.split('\n').map((x) => x.trim()).filter(Boolean)), rows);
}

/** 時刻（"D0 13:30"）の入力 */
export function timeRef(label: string, value: string | null | undefined, set: (v: string) => void): HTMLElement {
  return text(label, value ?? '', (v) => {
    if (/^D\d+ \d{1,2}:\d{2}$/.test(v.trim())) set(v.trim());
  }, { placeholder: 'D0 13:30', hint: '「D0 13:30」の形（D0 = 開始日、D1 = 翌日）' });
}
