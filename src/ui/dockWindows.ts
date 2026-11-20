/**
 * 合体できるタブ式のウィンドウ（3D 画面に重ねる、暗い半透明・ぼかし背景）。
 * - 各パネル（ログ・登山者・気象など）はタブになる。タブを別のウィンドウへドラッグすると合体し、外へドラッグすると切り離される。
 * - ウィンドウはタブの並びの空いたところ（またはタブが 1 枚ならそのタブ）をドラッグして動かす。最小化。外枠のどこをつまんでも大きさを変えられる。
 * - ウィンドウは画面の外にはみ出さない（上端は上のバーの下）。画面の縁に近づけると縁にぴったり付き、付いた縁は画面の大きさが変わっても保つ。
 * - 配置は localStorage（hks.v1.dock.2）に覚える。
 * - 狭い画面（スマホ・縦長のタブレット）では、覚えた配置を使わず、上下に自動で並べる（ユーザーの指定）:
 *   1 つ目のウィンドウは上のバーの下、ほかは下（タイムラインの上）に、画面の幅いっぱい・高さは画面の約 3 割。
 *   真ん中の 3D の画面が見えるようにする。画面の向きや大きさが変わったら並べ直す。最小化だけは別に覚える（hks.v1.dock.2.c）。
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

/** 画面のどの縁に付いているか */
export interface DockSnap {
  l?: boolean;
  r?: boolean;
  t?: boolean;
  b?: boolean;
}

export interface DockWindowState {
  x: number;
  y: number;
  w: number;
  h: number;
  min: boolean;
  tabs: string[];
  active: string;
  snap?: DockSnap;
}

export interface DockOptions {
  /** ウィンドウを置ける範囲の上端（上のバーの下端）。px */
  topInset?: () => number;
  /** 狭い画面で、下に空けておく高さ（タイムラインのバー）。px */
  bottomInset?: () => number;
}

export interface Dock {
  /** ウィンドウを入れる要素（画面に足すのは呼び出し側） */
  el: HTMLElement;
  /** 置ける範囲が変わったとき（上のバーを画面に足した後など）に並べ直す */
  relayout(): void;
  dispose(): void;
}

/** 配置を覚えるキー。既定の配置を変えたら末尾の番号を上げて、古い配置を読まないようにする */
const KEY = 'hks.v1.dock.2';
const DRAG_START_PX = 6;
/** 縁に吸い付く距離 */
const SNAP_PX = 18;
const MIN_W = 200;
const MIN_H = 90;
/** 最小化したウィンドウの高さ（測れないときの目安） */
const MIN_BAR_H = 36;
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Edge = (typeof EDGES)[number];

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
      const snap = w.snap && typeof w.snap === 'object' ? { l: !!w.snap.l, r: !!w.snap.r, t: !!w.snap.t, b: !!w.snap.b } : {};
      if (tabs.length > 0) out.push({ ...w, snap, tabs, active: tabs.includes(w.active) ? w.active : tabs[0]! });
    }
    // 保存にないパネル（あとから増えたもの）は、最初のウィンドウに足す
    const missing = ids.filter((id) => !seen.has(id));
    if (missing.length > 0 && out[0]) out[0].tabs.push(...missing);
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

const clampN = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 狭い画面: 幅 760 px 未満、または幅 1000 px 未満の縦長 */
export function isCompactScreen(): boolean {
  const W = window.innerWidth;
  const H = window.innerHeight;
  return W < 760 || (W < 1000 && H > W);
}
const KEY_COMPACT = `${KEY}.c`;
/** 狭い画面のウィンドウの高さ（置ける高さに対する割合と、上限・下限 px） */
const COMPACT_TOP_F = 0.28;
const COMPACT_BOTTOM_F = 0.3;
const COMPACT_MIN_H = 120;
const COMPACT_MAX_H = 340;

export function createDock(panels: DockPanel[], defaults: DockWindowState[], opts: DockOptions = {}): Dock {
  const host = el('div', { class: 'dock' });
  const byId = new Map(panels.map((p) => [p.id, p]));
  const ids = panels.map((p) => p.id);
  let compact = isCompactScreen();
  /** 広い画面の配置（覚えたもの） */
  let wideStates: DockWindowState[] = loadLayout(ids) ?? defaults.map((d) => ({ ...d, tabs: [...d.tabs] }));
  /** 狭い画面の配置（タブのまとまりと最小化だけ覚え、位置と大きさは毎回決める） */
  let compactStates: DockWindowState[] = loadCompact() ?? defaults.map((d) => ({ ...d, tabs: [...d.tabs], min: false }));
  let states: DockWindowState[] = compact ? compactStates : wideStates;

  function loadCompact(): DockWindowState[] | null {
    try {
      const v = JSON.parse(localStorage.getItem(KEY_COMPACT) ?? 'null') as { tabs: string[]; active: string; min: boolean }[] | null;
      if (!Array.isArray(v)) return null;
      const seen = new Set<string>();
      const out = v
        .map((w) => ({ x: 0, y: 0, w: 300, h: 200, min: !!w.min, tabs: (w.tabs ?? []).filter((t) => ids.includes(t) && !seen.has(t) && (seen.add(t), true)), active: w.active, snap: {} }))
        .filter((w) => w.tabs.length > 0)
        .map((w) => ({ ...w, active: w.tabs.includes(w.active) ? w.active : w.tabs[0]! }));
      const missing = ids.filter((id) => !seen.has(id));
      if (missing.length > 0 && out[0]) out[0].tabs.push(...missing);
      return out.length > 0 ? out : null;
    } catch {
      return null;
    }
  }

  const save = (): void => {
    try {
      const live = states.filter((w) => w.tabs.length > 0);
      if (compact) localStorage.setItem(KEY_COMPACT, JSON.stringify(live.map((w) => ({ tabs: w.tabs, active: w.active, min: w.min }))));
      else localStorage.setItem(KEY, JSON.stringify(live));
    } catch {
      // 保存できなくても続ける
    }
  };

  /** 狭い画面: 1 つ目のウィンドウを上、ほかを下に、幅いっぱいで並べる（高さは画面に合わせる） */
  const layoutCompact = (): void => {
    const B = bounds();
    const bottom = B.b - Math.max(0, Math.round(opts.bottomInset?.() ?? 0));
    const bh = Math.max(MIN_H * 2, bottom - B.t);
    const hTop = clampN(Math.round(bh * COMPACT_TOP_F), COMPACT_MIN_H, COMPACT_MAX_H);
    const hBottom = clampN(Math.round(bh * COMPACT_BOTTOM_F), COMPACT_MIN_H, COMPACT_MAX_H);
    states.forEach((st, i) => {
      st.x = B.l;
      st.w = B.r - B.l;
      if (i === 0) {
        st.y = B.t;
        st.h = hTop;
        st.snap = { l: true, r: true, t: true };
      } else {
        st.h = hBottom;
        // 下のウィンドウが複数あれば、下から積む
        const below = states.slice(i + 1).reduce((a, x) => a + (x.min ? MIN_BAR_H : hBottom), 0);
        st.y = bottom - below - (st.min ? MIN_BAR_H : hBottom);
        st.snap = { l: true, r: true };
      }
    });
  };

  /** ウィンドウを置ける範囲 */
  const bounds = (): { l: number; t: number; r: number; b: number } => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const t = clampN(Math.round(opts.topInset?.() ?? 0), 0, Math.max(0, H - MIN_H));
    return { l: 0, t, r: W, b: H };
  };
  const heightOf = (st: DockWindowState, win?: HTMLElement): number => (st.min ? win?.offsetHeight || MIN_BAR_H : st.h);

  /** 範囲に収め、付いている縁に合わせる */
  const fit = (st: DockWindowState, win?: HTMLElement): void => {
    const B = bounds();
    const bw = B.r - B.l;
    const bh = B.b - B.t;
    st.w = clampN(st.w, Math.min(MIN_W, bw), bw);
    st.h = clampN(st.h, Math.min(MIN_H, bh), bh);
    const s = st.snap ?? {};
    if (s.l && s.r) {
      st.x = B.l;
      st.w = bw;
    } else if (s.l) st.x = B.l;
    else if (s.r) st.x = B.r - st.w;
    if (!st.min && s.t && s.b) {
      st.y = B.t;
      st.h = bh;
    } else if (s.t) st.y = B.t;
    else if (s.b) st.y = B.b - heightOf(st, win);
    st.x = clampN(st.x, B.l, B.r - st.w);
    st.y = clampN(st.y, B.t, Math.max(B.t, B.b - heightOf(st, win)));
  };
  /** 今の位置と大きさから、どの縁に付いているかを決め直す */
  const detectSnap = (st: DockWindowState, win?: HTMLElement): void => {
    const B = bounds();
    st.snap = { l: st.x <= B.l + 0.5, r: st.x + st.w >= B.r - 0.5, t: st.y <= B.t + 0.5, b: st.y + heightOf(st, win) >= B.b - 0.5 };
  };
  /** 動かしているときの吸い付き（大きさは変えない） */
  const snapMove = (st: DockWindowState, win: HTMLElement): void => {
    const B = bounds();
    const h = heightOf(st, win);
    if (st.x - B.l <= SNAP_PX) st.x = B.l;
    else if (B.r - (st.x + st.w) <= SNAP_PX) st.x = B.r - st.w;
    if (st.y - B.t <= SNAP_PX) st.y = B.t;
    else if (B.b - (st.y + h) <= SNAP_PX) st.y = B.b - h;
    st.x = clampN(st.x, B.l, B.r - st.w);
    st.y = clampN(st.y, B.t, Math.max(B.t, B.b - h));
    detectSnap(st, win);
  };
  const apply = (st: DockWindowState, win: HTMLElement): void => {
    win.style.left = `${Math.round(st.x)}px`;
    win.style.top = `${Math.round(st.y)}px`;
    win.style.width = `${Math.round(st.w)}px`;
    win.style.height = st.min ? '' : `${Math.round(st.h)}px`;
    win.classList.toggle('snap-l', !!st.snap?.l);
    win.classList.toggle('snap-r', !!st.snap?.r);
    win.classList.toggle('snap-t', !!st.snap?.t);
    win.classList.toggle('snap-b', !!st.snap?.b);
  };

  /** すべてのウィンドウを作り直す（タブの移動のあとなど） */
  function render(): void {
    // 中身の要素は使い回す（作り直すと、スクロール位置や更新中の内容が失われる）
    host.replaceChildren();
    states = states.filter((s) => s.tabs.length > 0);
    if (compact) {
      compactStates = states;
      layoutCompact();
    } else wideStates = states;
    states.forEach((st, wi) => {
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
      const handles = EDGES.map((d) => {
        const h = el('div', { class: `fwin-rz rz-${d}`, 'aria-hidden': 'true' });
        h.addEventListener('pointerdown', (e) => startResize(e, st, win, d));
        return h;
      });
      const win = el('section', { class: `fwin${st.min ? ' min' : ''}`, 'data-win': wi }, [bar, body, ...handles]);
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
      fit(st);
      apply(st, win);
      host.append(win);
      // 最小化の高さは画面に置いてから測れる
      if (st.min && win.isConnected) {
        fit(st, win);
        apply(st, win);
      }
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
      snapMove(st, win);
      apply(st, win);
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

  /** 外枠（辺・角）をつまんで大きさを変える。動かす辺は画面の縁に吸い付き、外には出ない */
  function startResize(e: PointerEvent, st: DockWindowState, win: HTMLElement, d: Edge): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const x0 = st.x;
    const y0 = st.y;
    const w0 = st.w;
    const h0 = heightOf(st, win);
    win.classList.add('resizing');
    const move = (ev: PointerEvent): void => {
      const B = bounds();
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (d.includes('e')) {
        let right = x0 + w0 + dx;
        if (B.r - right <= SNAP_PX) right = B.r;
        st.w = Math.max(Math.min(MIN_W, B.r - x0), Math.min(right, B.r) - x0);
      }
      if (d.includes('w')) {
        let left = x0 + dx;
        if (left - B.l <= SNAP_PX) left = B.l;
        left = clampN(left, B.l, x0 + w0 - MIN_W);
        st.x = left;
        st.w = x0 + w0 - left;
      }
      if (!st.min && d.includes('s')) {
        let bottom = y0 + h0 + dy;
        if (B.b - bottom <= SNAP_PX) bottom = B.b;
        st.h = Math.max(Math.min(MIN_H, B.b - y0), Math.min(bottom, B.b) - y0);
      }
      if (!st.min && d.includes('n')) {
        let top = y0 + dy;
        if (top - B.t <= SNAP_PX) top = B.t;
        top = clampN(top, B.t, y0 + h0 - MIN_H);
        st.y = top;
        st.h = y0 + h0 - top;
      }
      detectSnap(st, win);
      apply(st, win);
    };
    const up = (): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      win.classList.remove('resizing');
      save();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
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
        snapMove(st, winEl);
        apply(st, winEl);
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
        // 切り離し: 新しいウィンドウにする（縁には付けない）
        st.tabs = st.tabs.filter((x) => x !== id);
        states.push({ x: ev.clientX - 60, y: ev.clientY - 14, w: st.w, h: st.h, min: false, tabs: [id], active: id, snap: {} });
      }
      save();
      render();
    };
    tabEl.addEventListener('pointermove', move);
    tabEl.addEventListener('pointerup', up);
    tabEl.addEventListener('pointercancel', up);
  }

  const onResize = (): void => {
    // 広い画面と狭い画面を行き来したら、それぞれの配置に切り替える
    const c = isCompactScreen();
    if (c !== compact) {
      compact = c;
      states = c ? compactStates : wideStates;
    }
    render();
  };
  window.addEventListener('resize', onResize);
  render();
  return {
    el: host,
    relayout: render,
    dispose() {
      window.removeEventListener('resize', onResize);
      host.remove();
    },
  };
}
