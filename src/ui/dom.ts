/** DOM の小さな道具（UI フレームワークは使わない） */

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | ((e: Event) => void) | undefined> = {},
  children: Child | Child[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') e.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const c of Array.isArray(children) ? children : [children]) {
    if (c === null || c === undefined || c === false) continue;
    e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

export function checkWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

let toastBox: HTMLElement | null = null;

export function toast(text: string, ms = 2500): void {
  if (!toastBox) {
    toastBox = el('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  const t = el('div', { class: 'toast' }, text);
  toastBox.append(t);
  setTimeout(() => t.remove(), ms);
}

/** 段階色（色だけに頼らず、アイコンと文字も出す。docs/11 §4） */
export type Level = 'ok' | 'warn' | 'danger' | 'critical';
export const LEVEL_ICON: Record<Level, string> = { ok: '●', warn: '▲', danger: '◆', critical: '✖' };

export function levelOf(v: number, warn: number, danger: number, critical: number, higherIsWorse = false): Level {
  if (higherIsWorse) return v > critical ? 'critical' : v > danger ? 'danger' : v > warn ? 'warn' : 'ok';
  return v < critical ? 'critical' : v < danger ? 'danger' : v < warn ? 'warn' : 'ok';
}
