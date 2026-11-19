/**
 * 浮かぶウィンドウ（3D 画面に重ねる、暗い半透明・ぼかし背景のパネル）。
 * タイトルバーをドラッグして動かせる。最小化するとタイトルバーだけになる。右下の角で大きさを変えられる。
 * 位置・大きさ・最小化の状態は localStorage（hks.v1.win.<id>）に覚える。
 */
import { JA } from '../i18n/ja';
import { el } from './dom';

export interface FloatWindowOptions {
  id: string;
  title: string;
  /** 初期の位置と大きさ（px）。right / bottom を指定すると右端・下端からの距離 */
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  width: number;
  height: number;
  /** 最初から最小化しておく */
  minimized?: boolean;
}

interface Saved {
  x: number;
  y: number;
  w: number;
  h: number;
  min: boolean;
}

export interface FloatWindow {
  el: HTMLElement;
  dispose(): void;
}

const KEY = 'hks.v1.win.';

function load(id: string): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY + id) ?? 'null') as Saved | null;
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.w) && Number.isFinite(v.h) ? v : null;
  } catch {
    return null;
  }
}

export function createFloatWindow(content: HTMLElement, o: FloatWindowOptions): FloatWindow {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w0 = Math.min(o.width, vw - 16);
  const h0 = Math.min(o.height, vh - 70);
  const st: Saved = load(o.id) ?? {
    x: o.right !== undefined ? vw - w0 - o.right : (o.left ?? 12),
    y: o.bottom !== undefined ? vh - h0 - o.bottom : (o.top ?? 60),
    w: w0,
    h: h0,
    min: o.minimized ?? false,
  };

  const minBtn = el('button', { class: 'fwin-btn', type: 'button' });
  const titleEl = el('span', { class: 'fwin-title' }, o.title);
  const bar = el('div', { class: 'fwin-bar' }, [titleEl, minBtn]);
  const body = el('div', { class: 'fwin-body' }, [content]);
  const win = el('section', { class: 'fwin', 'aria-label': o.title }, [bar, body]);

  const save = (): void => {
    try {
      localStorage.setItem(KEY + o.id, JSON.stringify(st));
    } catch {
      // 保存できなくても続ける
    }
  };

  /** 画面の外に出ないように収めて反映する */
  const apply = (): void => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    st.w = Math.max(180, Math.min(st.w, W - 8));
    st.h = Math.max(80, Math.min(st.h, H - 8));
    // タイトルバーが必ずつかめる範囲に置く
    st.x = Math.max(8 - st.w + 80, Math.min(st.x, W - 80));
    st.y = Math.max(0, Math.min(st.y, H - 34));
    win.style.left = `${Math.round(st.x)}px`;
    win.style.top = `${Math.round(st.y)}px`;
    win.style.width = `${Math.round(st.w)}px`;
    win.style.height = st.min ? '' : `${Math.round(st.h)}px`;
    win.classList.toggle('min', st.min);
    minBtn.textContent = st.min ? '▢' : '–';
    const label = st.min ? JA.ui.windowRestore : JA.ui.windowMinimize;
    minBtn.title = label;
    minBtn.setAttribute('aria-label', label);
    minBtn.setAttribute('aria-expanded', String(!st.min));
  };

  const toggle = (): void => {
    st.min = !st.min;
    apply();
    save();
  };
  minBtn.addEventListener('click', toggle);
  bar.addEventListener('dblclick', (e) => {
    if (e.target !== minBtn) toggle();
  });

  // ドラッグで移動（マウス・タッチ・ペン）
  let drag: { id: number; dx: number; dy: number } | null = null;
  bar.addEventListener('pointerdown', (e) => {
    if (e.target === minBtn || e.button !== 0) return;
    drag = { id: e.pointerId, dx: e.clientX - st.x, dy: e.clientY - st.y };
    bar.setPointerCapture(e.pointerId);
    win.classList.add('dragging');
    e.preventDefault();
  });
  bar.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    st.x = e.clientX - drag.dx;
    st.y = e.clientY - drag.dy;
    apply();
  });
  const endDrag = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    win.classList.remove('dragging');
    save();
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  // 角をつまんで大きさを変えたら覚える（CSS の resize）
  const ro = new ResizeObserver(() => {
    if (st.min || drag) return;
    const r = win.getBoundingClientRect();
    if (r.width < 1 || (Math.abs(r.width - st.w) < 1 && Math.abs(r.height - st.h) < 1)) return;
    st.w = r.width;
    st.h = r.height;
    save();
  });
  ro.observe(win);

  const onResize = (): void => apply();
  window.addEventListener('resize', onResize);
  // 前面に出す
  win.addEventListener('pointerdown', () => {
    for (const other of document.querySelectorAll<HTMLElement>('.fwin')) other.style.zIndex = other === win ? '9' : '8';
  });
  apply();

  return {
    el: win,
    dispose() {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    },
  };
}
