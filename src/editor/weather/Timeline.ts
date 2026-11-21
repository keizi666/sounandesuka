/**
 * 天候のタイムライン（docs/17 §2、Canvas2D）。変数ごとの行に、全変数共通の時刻を持つキーフレームを描く。
 * 上の帯（timelineBar.ts）に追加・削除・拡大・行の選択・操作のしかた・たたむを置く。
 * - 点を上下にドラッグで値を変える（選んでいなくてよい。Shift で細かく）。いちばん上の四角を左右にドラッグで時刻を動かす
 * - 空いた所のクリックで時刻を合わせる（緑の線）、ダブルクリックで追加、Delete で削除、上の帯を Shift＋ドラッグでまとめて選ぶ
 * - Ctrl＋ホイールで拡大・縮小、Shift＋ホイール（横スクロール）か下のつまみで左右に動かす。ふつうのホイールは下の欄のスクロール
 * - ポインタを載せると、その時刻とその行の値を吹き出しで出す
 */
import { formatTimeRef, parseTimeRef } from '../../sim/core/clock';
import type { WeatherDef, WeatherKeyframe } from '../../sim/types';
import { interpolateKeyframes } from '../../sim/weather/global';
import { el } from '../../ui/dom';
import { buildBar, loadPrefs, savePrefs, type TimelinePrefs } from './timelineBar';
import { drawTimeline } from './timelineDraw';
import { DRAG_FULL_PX, HIT_PX, LEFT, RIGHT, ROW_H, ROWS, TOP, type RowDef, type TimelineMarks } from './timelineRows';

export { ROWS, type RowDef, type TimelineMarks } from './timelineRows';

export interface TimelineHandlers {
  /** キーフレームの変更（Undo の単位は呼び出し側）。end=true でドラッグの終わり */
  edit(kfs: WeatherKeyframe[], label: string, end: boolean): void;
  select(indices: number[]): void;
  cursor(tMin: number): void;
}

type Drag = { kind: 'time' | 'value' | 'range' | 'pan'; idx: number; row: number; x0: number; y0: number; startT: number; v0: [number, number]; orig: WeatherKeyframe[]; moved: boolean };

export class Timeline {
  /** 上の帯・本体・つまみをまとめた要素（下の欄に置く） */
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  t0 = 0;
  t1 = 1440;
  selected: number[] = [];
  ghost: WeatherKeyframe[] | null = null;
  cursorMin = 0;
  private w: WeatherDef | null = null;
  private marks: TimelineMarks = { sunrise: [], sunset: [], choices: [], events: [], nodeElevs: [], cells: [] };
  /** 表示している時刻の範囲（拡大中は t0..t1 の一部） */
  private v0 = 0;
  private v1 = 1440;
  private prefs: TimelinePrefs = loadPrefs();
  private barHost = el('div');
  private body: HTMLElement;
  private tip = el('div', { class: 'wtl-tip', hidden: true });
  private scroller = el('input', { type: 'range', class: 'wtl-scroll', min: 0, max: 1000, value: 0, title: '左右に動かす' });

  constructor(private h: TimelineHandlers) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wtl-canvas';
    this.canvas.tabIndex = 0;
    this.body = el('div', { class: 'wtl-body' }, [this.canvas, this.tip]);
    this.root = el('div', { class: 'wtl' }, [this.barHost, this.body, this.scroller]);
    this.scroller.addEventListener('input', () => {
      const span = this.v1 - this.v0;
      const free = this.t1 - this.t0 - span;
      this.v0 = this.t0 + (free * Number(this.scroller.value)) / 1000;
      this.v1 = this.v0 + span;
      this.draw();
    });
    new ResizeObserver(() => this.draw()).observe(this.body);
    this.bind();
  }

  set(w: WeatherDef, range: [number, number], marks: TimelineMarks): void {
    const rangeChanged = range[0] !== this.t0 || range[1] !== this.t1;
    this.w = w;
    [this.t0, this.t1] = range;
    if (rangeChanged || this.v1 <= this.v0) [this.v0, this.v1] = range;
    this.clampView();
    this.marks = marks;
    this.renderBar();
    this.draw();
  }

  // ---- 上の帯 ----
  private renderBar(): void {
    const p = this.prefs;
    const cursorLabel = formatTimeRef(Math.round(this.cursorMin));
    this.barHost.replaceChildren(
      buildBar(ROWS, { collapsed: p.collapsed, help: p.help, rows: p.rows, selectedCount: this.selected.length, zoomed: this.zoomed(), cursorLabel }, {
        add: () => this.addAt(this.cursorMin),
        remove: () => this.removeSelected(),
        zoom: (f) => this.zoomAround((this.v0 + this.v1) / 2, f),
        fit: () => {
          [this.v0, this.v1] = [this.t0, this.t1];
          this.refreshView();
        },
        toggleCollapse: () => this.update({ collapsed: !p.collapsed }),
        toggleHelp: () => this.update({ help: !p.help }),
        setRows: (rows) => this.update({ rows }),
      }),
    );
    this.body.hidden = p.collapsed;
    this.scroller.hidden = p.collapsed || !this.zoomed();
    this.scroller.value = String(this.zoomed() ? Math.round(((this.v0 - this.t0) / (this.t1 - this.t0 - (this.v1 - this.v0))) * 1000) : 0);
  }

  private update(p: Partial<TimelinePrefs>): void {
    this.prefs = { ...this.prefs, ...p };
    savePrefs(this.prefs);
    this.renderBar();
    this.draw();
  }

  private zoomed(): boolean {
    return this.v1 - this.v0 < this.t1 - this.t0 - 1;
  }
  private clampView(): void {
    const full = this.t1 - this.t0;
    let span = Math.min(full, Math.max(60, this.v1 - this.v0));
    if (!Number.isFinite(span) || span <= 0) span = full;
    this.v0 = Math.min(this.t1 - span, Math.max(this.t0, this.v0));
    this.v1 = this.v0 + span;
  }
  private zoomAround(t: number, f: number): void {
    const span = (this.v1 - this.v0) * f;
    const k = (t - this.v0) / (this.v1 - this.v0);
    this.v0 = t - span * k;
    this.v1 = this.v0 + span;
    this.refreshView();
  }
  private refreshView(): void {
    this.clampView();
    this.renderBar();
    this.draw();
  }

  // ---- 座標 ----
  private rows(): RowDef[] {
    return ROWS.filter((r) => this.prefs.rows.includes(r.key as string));
  }
  private get width(): number {
    return this.body.clientWidth || 800;
  }
  private X(t: number): number {
    return LEFT + ((t - this.v0) / Math.max(1, this.v1 - this.v0)) * (this.width - LEFT - RIGHT);
  }
  private T(x: number): number {
    return this.v0 + ((x - LEFT) / (this.width - LEFT - RIGHT)) * (this.v1 - this.v0);
  }
  private Y(row: number, r: RowDef, v: number): number {
    const f = r.log ? Math.log(Math.max(r.min, v) / r.min) / Math.log(r.max / r.min) : (v - r.min) / (r.max - r.min);
    return TOP + row * ROW_H + ROW_H - 5 - Math.max(0, Math.min(1, f)) * (ROW_H - 10);
  }
  private V(row: number, r: RowDef, y: number): number {
    const f = Math.max(0, Math.min(1, (TOP + row * ROW_H + ROW_H - 5 - y) / (ROW_H - 10)));
    return r.log ? r.min * (r.max / r.min) ** f : r.min + f * (r.max - r.min);
  }
  private sorted(): { t: number; kf: WeatherKeyframe; i: number }[] {
    return (this.w?.keyframes ?? []).map((kf, i) => ({ t: parseTimeRef(kf.at), kf, i })).sort((a, b) => a.t - b.t);
  }
  private value(kf: WeatherKeyframe, r: RowDef): number | undefined {
    return (kf as unknown as Record<string, number | undefined>)[r.key as string];
  }
  /** その点の画面の位置（風向は行の真ん中） */
  private pointY(row: number, r: RowDef, v: number): number {
    return r.key === 'windDirDeg' ? TOP + row * ROW_H + ROW_H / 2 : this.Y(row, r, v);
  }

  draw(): void {
    if (this.prefs.collapsed) return;
    const c = this.canvas;
    const rows = this.rows();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.width;
    const H = TOP + rows.length * ROW_H + 18;
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext('2d');
    if (!g || !this.w) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTimeline(g, W, H, rows, {
      kfs: this.sorted(),
      ghost: this.ghost,
      marks: this.marks,
      selected: this.selected,
      cursorMin: this.cursorMin,
      t1: this.t1,
      v0: this.v0,
      v1: this.v1,
      X: (t) => this.X(t),
      T: (x) => this.T(x),
      Y: (row, r, val) => this.Y(row, r, val),
      value: (kf, r) => this.value(kf, r),
    });
  }

  // ---- 当たり判定 ----
  private hitSquare(x: number): number {
    let best = -1;
    let bd = 7;
    for (const k of this.sorted()) {
      const d = Math.abs(this.X(k.t) - x);
      if (d < bd) {
        bd = d;
        best = k.i;
      }
    }
    return best;
  }
  private hitPoint(x: number, y: number): { idx: number; row: number } | null {
    const rows = this.rows();
    const row = Math.floor((y - TOP) / ROW_H);
    const r = rows[row];
    if (!r) return null;
    let best: { idx: number; row: number } | null = null;
    let bd = HIT_PX;
    for (const k of this.sorted()) {
      const v = this.value(k.kf, r);
      if (v === undefined) continue;
      const d = Math.hypot(this.X(k.t) - x, this.pointY(row, r, v) - y);
      if (d < bd) {
        bd = d;
        best = { idx: k.i, row };
      }
    }
    return best;
  }

  // ---- 編集 ----
  addAt(tMin: number): void {
    if (!this.w) return;
    const t = Math.max(0, Math.round(tMin / 5) * 5);
    if (this.w.keyframes.some((k) => parseTimeRef(k.at) === t)) {
      this.selected = [this.w.keyframes.findIndex((k) => parseTimeRef(k.at) === t)];
      this.h.select(this.selected);
      return;
    }
    const b = interpolateKeyframes(this.w.keyframes.map((kf) => ({ t: parseTimeRef(kf.at), kf })), t);
    const kf: WeatherKeyframe = {
      at: formatTimeRef(t),
      tempC: Math.round(b.tempC * 10) / 10,
      windMs: Math.round(b.windMs * 10) / 10,
      windDirDeg: Math.round(b.windDirDeg),
      precipMmH: Math.round(b.precipMmH * 10) / 10,
      cloudCover: Math.round(b.cloudCover * 100) / 100,
      cloudBaseM: Math.round(b.cloudBaseM),
      visibilityM: Math.round(b.visibilityM),
      pressureHpa: Math.round(b.pressureHpa),
    };
    if (b.thunder > 0) kf.thunder = Math.round(b.thunder * 100) / 100;
    const kfs = [...structuredClone(this.w.keyframes), kf].sort((x, y) => parseTimeRef(x.at) - parseTimeRef(y.at));
    this.selected = [kfs.findIndex((x) => x.at === kf.at)];
    this.h.edit(kfs, 'キーフレームの追加', true);
    this.h.select(this.selected);
  }

  removeSelected(): void {
    if (!this.w || this.selected.length === 0) return;
    const kfs = this.w.keyframes.filter((_, i) => !this.selected.includes(i));
    if (kfs.length === 0) return;
    this.selected = [];
    this.h.edit(kfs, 'キーフレームの削除', true);
    this.h.select([]);
  }

  private showTip(x: number, y: number, text: string | null): void {
    if (!text) {
      this.tip.hidden = true;
      return;
    }
    this.tip.hidden = false;
    this.tip.textContent = text;
    const w = this.tip.offsetWidth;
    this.tip.style.left = `${Math.min(this.width - w - 4, x + 14)}px`;
    this.tip.style.top = `${Math.max(0, y - 30)}px`;
  }

  private hover(x: number, y: number): void {
    if (!this.w) return;
    const rows = this.rows();
    const tLabel = formatTimeRef(Math.round(this.T(x)));
    if (x < LEFT) {
      this.canvas.style.cursor = 'default';
      return this.showTip(x, y, null);
    }
    if (y < TOP) {
      const i = this.hitSquare(x);
      this.canvas.style.cursor = i >= 0 ? 'ew-resize' : this.zoomed() ? 'grab' : 'pointer';
      return this.showTip(x, y, i >= 0 ? `キーフレーム ${this.w.keyframes[i]!.at}（左右にドラッグで時刻を動かす）` : tLabel);
    }
    const p = this.hitPoint(x, y);
    if (p) {
      const r = rows[p.row]!;
      const v = this.value(this.w.keyframes[p.idx]!, r)!;
      this.canvas.style.cursor = 'ns-resize';
      return this.showTip(x, y, `${r.label} ${r.fmt(v)}（${this.w.keyframes[p.idx]!.at}）上下にドラッグで変える`);
    }
    const r = rows[Math.floor((y - TOP) / ROW_H)];
    this.canvas.style.cursor = 'crosshair';
    if (!r) return this.showTip(x, y, tLabel);
    const v = (interpolateKeyframes(this.sorted(), this.T(x)) as unknown as Record<string, number>)[r.key as string] ?? 0;
    this.showTip(x, y, `${tLabel}　${r.label} ${r.fmt(v)}`);
  }

  private bind(): void {
    let drag: Drag | null = null;
    const pos = (e: MouseEvent): { x: number; y: number } => {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const mk = (kind: Drag['kind'], idx: number, row: number, x: number, y: number, startT: number): Drag => ({ kind, idx, row, x0: x, y0: y, startT, v0: [this.v0, this.v1], orig: structuredClone(this.w!.keyframes), moved: false });
    const select = (idx: number): void => {
      this.selected = [idx];
      this.h.select(this.selected);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.w || e.button !== 0) return;
      this.canvas.focus();
      const { x, y } = pos(e);
      if (x < LEFT) return;
      if (y < TOP) {
        const idx = this.hitSquare(x);
        if (e.shiftKey) drag = mk('range', -1, -1, x, y, this.T(x));
        else if (idx >= 0) {
          drag = mk('time', idx, -1, x, y, parseTimeRef(this.w.keyframes[idx]!.at));
          select(idx);
        } else drag = mk('pan', -1, -1, x, y, 0);
      } else {
        const p = this.hitPoint(x, y);
        if (p) {
          drag = mk('value', p.idx, p.row, x, y, 0);
          select(p.idx);
        } else drag = mk('pan', -1, -1, x, y, 0);
      }
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const { x, y } = pos(e);
      if (!drag || !this.w) return this.hover(x, y);
      if (Math.abs(x - drag.x0) + Math.abs(y - drag.y0) > 3) drag.moved = true;
      if (!drag.moved) return;
      if (drag.kind === 'pan') {
        if (!this.zoomed()) return;
        const dt = ((drag.x0 - x) / (this.width - LEFT - RIGHT)) * (drag.v0[1] - drag.v0[0]);
        [this.v0, this.v1] = [drag.v0[0] + dt, drag.v0[1] + dt];
        this.canvas.style.cursor = 'grabbing';
        return this.refreshView();
      }
      const kfs = structuredClone(drag.orig);
      if (drag.kind === 'time') {
        const t = Math.max(0, Math.round((drag.startT + (this.T(x) - this.T(drag.x0))) / 5) * 5);
        kfs[drag.idx]!.at = formatTimeRef(t);
        this.showTip(x, y, `${formatTimeRef(t)} へ`);
        this.h.edit(kfs, 'キーフレームの時刻', false);
      } else if (drag.kind === 'value') {
        const r = this.rows()[drag.row]!;
        const k = kfs[drag.idx]! as unknown as Record<string, number>;
        let v: number;
        if (r.key === 'windDirDeg') {
          // 風向は上下のドラッグで回す（上へ 1 px で 2°）
          v = ((((k[r.key] ?? 0) + (drag.y0 - y) * 2) % 360) + 360) % 360;
        } else {
          // 動かした量で値を変える（DRAG_FULL_PX で目盛りの全幅。Shift で 5 分の 1）。行の高さに関係なく細かく合わせられる
          const startV = k[r.key as string] ?? this.V(drag.row, r, drag.y0);
          const f0 = r.log ? Math.log(Math.max(r.min, startV) / r.min) / Math.log(r.max / r.min) : (startV - r.min) / (r.max - r.min);
          const f = Math.max(0, Math.min(1, f0 + ((drag.y0 - y) / DRAG_FULL_PX) * (e.shiftKey ? 0.2 : 1)));
          v = r.log ? r.min * (r.max / r.min) ** f : r.min + f * (r.max - r.min);
        }
        v = r.log ? Math.round(v) : Math.round(v / r.step) * r.step;
        k[r.key as string] = Math.max(r.min, Math.min(r.max, v));
        this.showTip(x, y, `${r.label} ${r.fmt(k[r.key as string]!)}`);
        this.h.edit(kfs, r.label, false);
      } else {
        const a = Math.min(drag.startT, this.T(x));
        const b = Math.max(drag.startT, this.T(x));
        this.selected = this.sorted().flatMap((k) => (k.t >= a && k.t <= b ? [k.i] : []));
        this.h.select(this.selected);
        this.draw();
      }
    });
    this.canvas.addEventListener('pointerup', (e) => {
      const d = drag;
      drag = null;
      if (!d || !this.w) return;
      if (d.moved && (d.kind === 'time' || d.kind === 'value')) this.h.edit(this.w.keyframes, d.kind === 'time' ? 'キーフレームの時刻' : '値', true);
      if (!d.moved && d.kind === 'pan') {
        // 空いた所のクリック: 時刻を合わせる（選択は外す）
        this.cursorMin = Math.round(this.T(pos(e).x));
        this.selected = [];
        this.h.select([]);
        this.h.cursor(this.cursorMin);
        this.renderBar();
        this.draw();
      }
      this.hover(pos(e).x, pos(e).y);
    });
    this.canvas.addEventListener('pointerleave', () => this.showTip(0, 0, null));
    this.canvas.addEventListener('dblclick', (e) => {
      const { x, y } = pos(e);
      if (x < LEFT || this.hitPoint(x, y) || (y < TOP && this.hitSquare(x) >= 0)) return;
      this.addAt(this.T(x));
    });
    this.canvas.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        this.removeSelected();
        e.preventDefault();
        e.stopPropagation();
      }
    });
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        const { x } = pos(e);
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.zoomAround(this.T(Math.max(LEFT, x)), e.deltaY > 0 ? 1.25 : 0.8);
        } else if (this.zoomed() && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
          e.preventDefault();
          const d = (e.shiftKey ? e.deltaY : e.deltaX) || e.deltaX;
          const dt = (d / (this.width - LEFT - RIGHT)) * (this.v1 - this.v0);
          this.v0 += dt;
          this.v1 += dt;
          this.refreshView();
        }
        // それ以外（ふつうのホイール）は下の欄のスクロール
      },
      { passive: false },
    );
  }
}
