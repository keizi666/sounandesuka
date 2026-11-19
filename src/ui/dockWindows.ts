/**
 * 合体できるタブ式のウィンドウ（3D 画面に重ねる、暗い半透明・ぼかし背景）。
 * - 各パネル（ログ・登山者・気象など）はタブになる。タブを別のウィンドウへドラッグすると合体し、外へドラッグすると切り離される。
 * - ウィンドウはタブの並びの空いたところ（またはタブが 1 枚ならそのタブ）をドラッグして動かす。最小化、右下の角で大きさ変更。
 * - 配置は localStorage（hks.v1.dock）に覚える。
 */
import { JA } from '../i18n/ja';
import { el } from './dom';
import { icon, type IconName } from './icons';

export interface DockPanel {
  id: string;
  title: string;
  icon: IconName;
  content: HTMLElement;
}

export interface DockWindowState {
  x: number;
  y: number;
  w: number;
  h: number;
  min: boolean;
  tabs: string[];
  active: string;
}

export interface Dock {
  /** ウィンドウを入れる要素（画面に足すのは呼び出し側） */
  el: HTMLElement;
  dispose(): void;
}

const KEY = 'hks.v1.dock';
const DRAG_START_PX = 6;

function loadLayout(ids: string[]): DockWindowState[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as DockWindowState[] | null;
    if (!Array.isArray(v)) return null;
    const seen = new Set<string>();
    const out: DockWindowState[] = [];
    for (const w of v) {
      if (![w.x, w.y, w.w, w.h].every(Number.isFinite) || !Array.isArray(w.tabs)) return null;
      const tabs = w.tabs.filter((t) => ids.includes(t) && !seen.has(t));
      tabs.forEach((t) => seen.add(t));
      if (tabs.length > 0) out.push({ ...w, tabs, active: tabs.includes(w.active) ? w.active : tabs[0]! });
    }
    // 保存にないパネル（あとから増えたもの）は、最初のウィンドウに足す
    const missing = ids.filter((id) => !seen.has(id));
    if (missing.length > 0 && out[0]) out[0].tabs.push(...missing);
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function createDock(panels: DockPanel[], defaults: DockWindowState[]): Dock {
  const host = el('div', { class: 'dock' });
  const byId = new Map(panels.map((p) => [p.id, p]));
  let states: DockWindowState[] = loadLayout(panels.map((p) => p.id)) ?? defaults.map((d) => ({ ...d, tabs: [...d.tabs] }));
  const observers: ResizeObserver[] = [];

  const save = (): void => {
    try {
      localStorage.setItem(KEY, JSON.stringify(states.filter((w) => w.tabs.length > 0)));
    } catch {
      // 保存できなくても続ける
    }
  };

  const clamp = (st: DockWindowState): void => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    st.w = Math.max(200, Math.min(st.w, W - 8));
    st.h = Math.max(90, Math.min(st.h, H - 8));
    st.x = Math.max(8 - st.w + 90, Math.min(st.x, W - 90));
    st.y = Math.max(0, Math.min(st.y, H - 34));
  };

  /** すべてのウィンドウを作り直す（タブの移動のあとなど） */
  function render(): void {
    for (const o of observers.splice(0)) o.disconnect();
    // 中身の要素は使い回す（作り直すと、スクロール位置や更新中の内容が失われる）
    host.replaceChildren();
    states = states.filter((s) => s.tabs.length > 0);
    states.forEach((st, wi) => {
      clamp(st);
      if (!st.tabs.includes(st.active)) st.active = st.tabs[0]!;
      const body = el('div', { class: 'fwin-body' }, [byId.get(st.active)!.content]);
      const tabEls = st.tabs.map((id) => {
        const p = byId.get(id)!;
        const t = el('button', { class: `fwin-tab${id === st.active ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': id === st.active, 'data-tab': id }, [icon(p.icon), p.title]);
        t.addEventListener('pointerdown', (e) => startTabDrag(e, wi, id));
        return t;
      });
      const minBtn = el('button', { class: 'fwin-btn', type: 'button', title: st.min ? JA.ui.windowRestore : JA.ui.windowMinimize, 'aria-label': st.min ? JA.ui.windowRestore : JA.ui.windowMinimize, 'aria-expanded': !st.min }, icon(st.min ? 'openInFull' : 'minimize'));
      minBtn.addEventListener('click', () => {
        st.min = !st.min;
        save();
        render();
      });
      const grip = el('div', { class: 'fwin-grip' });
      const bar = el('div', { class: 'fwin-bar', role: 'tablist' }, [...tabEls, grip, minBtn]);
      const win = el('section', { class: `fwin${st.min ? ' min' : ''}`, 'data-win': wi, style: `left:${Math.round(st.x)}px;top:${Math.round(st.y)}px;width:${Math.round(st.w)}px;${st.min ? '' : `height:${Math.round(st.h)}px;`}` }, [bar, body]);
      grip.addEventListener('pointerdown', (e) => startWindowDrag(e, st, win));
      bar.addEventListener('dblclick', (e) => {
        if ((e.target as HTMLElement).closest('.fwin-tab, .fwin-btn')) return;
        st.min = !st.min;
        save();
        render();
      });
      win.addEventListener('pointerdown', () => {
        for (const other of host.children) (other as HTMLElement).style.zIndex = other === win ? '9' : '8';
      });
      // 角をつまんで大きさを変えたら覚える（CSS の resize）
      const ro = new ResizeObserver(() => {
        if (st.min) return;
        const r = win.getBoundingClientRect();
        if (r.width < 1 || (Math.abs(r.width - st.w) < 1 && Math.abs(r.height - st.h) < 1)) return;
        st.w = r.width;
        st.h = r.height;
        save();
      });
      ro.observe(win);
      observers.push(ro);
      host.append(win);
    });
  }

  function startWindowDrag(e: PointerEvent, st: DockWindowState, win: HTMLElement): void {
    if (e.button !== 0) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    win.classList.add('dragging');
    const move = (ev: PointerEvent): void => {
      st.x = ev.clientX - dx;
      st.y = ev.clientY - dy;
      clamp(st);
      win.style.left = `${Math.round(st.x)}px`;
      win.style.top = `${Math.round(st.y)}px`;
    };
    const up = (): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      win.classList.remove('dragging');
      save();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    e.preventDefault();
  }

  /** タブのドラッグ: 少し動かすまではクリック（タブの切替）。動かしたら、合体・切り離し・ウィンドウの移動 */
  function startTabDrag(e: PointerEvent, wi: number, id: string): void {
    if (e.button !== 0) return;
    const st = states[wi]!;
    const tabEl = e.currentTarget as HTMLElement;
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = e.clientX - st.x;
    const oy = e.clientY - st.y;
    let ghost: HTMLElement | null = null;
    let moved = false;
    const single = st.tabs.length === 1;
    const winEl = host.children[wi] as HTMLElement;
    tabEl.setPointerCapture(e.pointerId);
    const dropTarget = (x: number, y: number): number => {
      // 自分のつまんでいる要素（ゴースト・単独タブのウィンドウ）を除いて、下にあるウィンドウを探す
      for (let i = 0; i < host.children.length; i += 1) {
        if (i === wi && single) continue;
        const r = (host.children[i] as HTMLElement).getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= Math.min(r.bottom, r.top + 44)) return i;
      }
      return -1;
    };
    const move = (ev: PointerEvent): void => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_START_PX) return;
      moved = true;
      if (single) {
        // タブが 1 枚だけのウィンドウは、ウィンドウごと動かす（ほかのウィンドウのタブの並びに重ねると合体）
        st.x = ev.clientX - ox;
        st.y = ev.clientY - oy;
        clamp(st);
        winEl.style.left = `${Math.round(st.x)}px`;
        winEl.style.top = `${Math.round(st.y)}px`;
        winEl.classList.add('dragging');
      } else {
        if (!ghost) {
          ghost = el('div', { class: 'fwin-ghost' }, [icon(byId.get(id)!.icon), byId.get(id)!.title]);
          document.body.append(ghost);
        }
        ghost.style.left = `${ev.clientX + 10}px`;
        ghost.style.top = `${ev.clientY + 8}px`;
      }
      const t = dropTarget(ev.clientX, ev.clientY);
      for (let i = 0; i < host.children.length; i += 1) (host.children[i] as HTMLElement).classList.toggle('drop', i === t && i !== wi);
    };
    const up = (ev: PointerEvent): void => {
      tabEl.removeEventListener('pointermove', move);
      tabEl.removeEventListener('pointerup', up);
      tabEl.removeEventListener('pointercancel', up);
      ghost?.remove();
      if (!moved) {
        if (st.active !== id || st.min) {
          st.active = id;
          st.min = false;
          save();
          render();
        }
        return;
      }
      const t = dropTarget(ev.clientX, ev.clientY);
      if (t >= 0 && t !== wi) {
        // 合体: 相手のウィンドウのタブに加える
        const dst = states[t]!;
        st.tabs = st.tabs.filter((x) => x !== id);
        dst.tabs.push(id);
        dst.active = id;
        dst.min = false;
      } else if (!single && t !== wi) {
        // 切り離し: 新しいウィンドウにする
        st.tabs = st.tabs.filter((x) => x !== id);
        states.push({ x: ev.clientX - 60, y: ev.clientY - 14, w: st.w, h: st.h, min: false, tabs: [id], active: id });
      }
      save();
      render();
    };
    tabEl.addEventListener('pointermove', move);
    tabEl.addEventListener('pointerup', up);
    tabEl.addEventListener('pointercancel', up);
  }

  const onResize = (): void => render();
  window.addEventListener('resize', onResize);
  render();
  return {
    el: host,
    dispose() {
      for (const o of observers.splice(0)) o.disconnect();
      window.removeEventListener('resize', onResize);
      host.remove();
    },
  };
}
