/**
 * 天候のタイムライン（docs/17 §2、Canvas2D）。変数ごとの行に、全変数共通の時刻を持つキーフレームを描く。
 * - 時刻の帯（上端）でキーフレームをドラッグすると時刻が動く。Shift＋ドラッグで範囲選択。
 * - 行の中で上下にドラッグすると、選択中のキーフレームのその変数が変わる（Shift で細かく）。
 * - ダブルクリックでその時刻の補間値からキーフレームを追加、Delete で削除。空いた所のクリックでカーソル時刻。
 */
import { formatClock, formatTimeRef, parseTimeRef } from '../../sim/core/clock';
import type { WeatherDef, WeatherKeyframe } from '../../sim/types';
import { interpolateKeyframes } from '../../sim/weather/global';

export interface RowDef {
  key: keyof WeatherKeyframe | 'cloud';
  label: string;
  min: number;
  max: number;
  log?: boolean;
  fmt: (v: number) => string;
  step: number;
}

export const ROWS: RowDef[] = [
  { key: 'tempC', label: '気温（基準）', min: -20, max: 30, fmt: (v) => `${v.toFixed(1)}℃`, step: 0.5 },
  { key: 'windMs', label: '風速', min: 0, max: 30, fmt: (v) => `${v.toFixed(1)} m/s`, step: 0.5 },
  { key: 'windDirDeg', label: '風向', min: 0, max: 360, fmt: (v) => `${Math.round(v)}°`, step: 5 },
  { key: 'precipMmH', label: '降水', min: 0, max: 20, fmt: (v) => `${v.toFixed(1)} mm/h`, step: 0.5 },
  { key: 'cloudCover', label: '雲量', min: 0, max: 1, fmt: (v) => `${Math.round(v * 100)}%`, step: 0.05 },
  { key: 'cloudBaseM', label: '雲底', min: 500, max: 4500, fmt: (v) => `${Math.round(v)} m`, step: 50 },
  { key: 'visibilityM', label: '視程', min: 30, max: 40000, log: true, fmt: (v) => `${Math.round(v)} m`, step: 1 },
  { key: 'thunder', label: '雷', min: 0, max: 1, fmt: (v) => v.toFixed(2), step: 0.05 },
  { key: 'pressureHpa', label: '気圧', min: 960, max: 1040, fmt: (v) => `${Math.round(v)} hPa`, step: 1 },
  { key: 'gustiness', label: '突風', min: 0, max: 1, fmt: (v) => v.toFixed(2), step: 0.05 },
];

const LEFT = 86;
const TOP = 22;
const ROW_H = 40;

export interface TimelineMarks {
  sunrise: number[];
  sunset: number[];
  choices: { tMin: number; label: string }[];
  events: { tMin: number; label: string }[];
  /** 雲底の行に引く地点の標高 */
  nodeElevs: { name: string; elevM: number }[];
  cells: { id: string; from: number; peak: number; to: number }[];
}

export interface TimelineHandlers {
  /** キーフレームの変更（Undo の単位は呼び出し側）。end=true でドラッグの終わり */
  edit(kfs: WeatherKeyframe[], label: string, end: boolean): void;
  select(indices: number[]): void;
  cursor(tMin: number): void;
}

export class Timeline {
  readonly canvas: HTMLCanvasElement;
  t0 = 0;
  t1 = 1440;
  selected: number[] = [];
  ghost: WeatherKeyframe[] | null = null;
  cursorMin = 0;
  private w: WeatherDef | null = null;
  private marks: TimelineMarks = { sunrise: [], sunset: [], choices: [], events: [], nodeElevs: [], cells: [] };

  constructor(private h: TimelineHandlers) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'timeline';
    this.canvas.tabIndex = 0;
    this.bind();
  }

  set(w: WeatherDef, range: [number, number], marks: TimelineMarks): void {
    this.w = w;
    [this.t0, this.t1] = range;
    this.marks = marks;
    this.draw();
  }

  private get width(): number {
    return this.canvas.clientWidth || 800;
  }
  private X(t: number): number {
    return LEFT + ((t - this.t0) / Math.max(1, this.t1 - this.t0)) * (this.width - LEFT - 8);
  }
  private T(x: number): number {
    return this.t0 + ((x - LEFT) / (this.width - LEFT - 8)) * (this.t1 - this.t0);
  }
  private Y(row: number, r: RowDef, v: number): number {
    const f = r.log ? Math.log(Math.max(r.min, v) / r.min) / Math.log(r.max / r.min) : (v - r.min) / (r.max - r.min);
    return TOP + row * ROW_H + ROW_H - 4 - Math.max(0, Math.min(1, f)) * (ROW_H - 8);
  }
  private V(row: number, r: RowDef, y: number): number {
    const f = Math.max(0, Math.min(1, (TOP + row * ROW_H + ROW_H - 4 - y) / (ROW_H - 8)));
    return r.log ? r.min * (r.max / r.min) ** f : r.min + f * (r.max - r.min);
  }
  private times(): number[] {
    return (this.w?.keyframes ?? []).map((k) => parseTimeRef(k.at));
  }

  draw(): void {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.width;
    const H = TOP + ROWS.length * ROW_H + 18;
    c.style.height = `${H}px`;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext('2d');
    if (!g || !this.w) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#1a1d22';
    g.fillRect(0, 0, W, H);
    g.font = '11px system-ui';
    // 夜の帯
    for (let i = 0; i < this.marks.sunset.length; i += 1) {
      const a = this.marks.sunset[i]!;
      const b = this.marks.sunrise.find((x) => x > a) ?? this.t1;
      g.fillStyle = 'rgba(40,50,90,0.35)';
      g.fillRect(this.X(a), TOP, this.X(b) - this.X(a), ROWS.length * ROW_H);
    }
    // 時刻軸
    g.fillStyle = '#aaa';
    const step = this.t1 - this.t0 > 1800 ? 180 : 60;
    for (let t = Math.ceil(this.t0 / step) * step; t <= this.t1; t += step) {
      const x = this.X(t);
      g.fillText(t % 1440 === 0 ? `D${t / 1440}` : formatClock(t % 1440), x - 12, 12);
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.moveTo(x, TOP);
      g.lineTo(x, TOP + ROWS.length * ROW_H);
      g.stroke();
    }
    const kfs = [...this.w.keyframes].map((kf) => ({ t: parseTimeRef(kf.at), kf })).sort((a, b) => a.t - b.t);
    const ghost = this.ghost ? this.ghost.map((kf) => ({ t: parseTimeRef(kf.at), kf })).sort((a, b) => a.t - b.t) : null;
    ROWS.forEach((r, row) => {
      const y0 = TOP + row * ROW_H;
      g.fillStyle = row % 2 ? '#1f2329' : '#22262d';
      g.fillRect(LEFT, y0, W - LEFT, ROW_H);
      g.fillStyle = '#ccc';
      g.fillText(r.label, 4, y0 + 16);
      if (kfs.length === 0) return;
      // 雲底の行: 主要地点の標高
      if (r.key === 'cloudBaseM') {
        for (const n of this.marks.nodeElevs) {
          const y = this.Y(row, r, n.elevM);
          g.strokeStyle = 'rgba(120,200,255,0.35)';
          g.setLineDash([3, 3]);
          g.beginPath();
          g.moveTo(LEFT, y);
          g.lineTo(W, y);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = 'rgba(120,200,255,0.8)';
          g.fillText(n.name, W - 70, y - 2);
        }
      }
      // 雷の行: セルの包絡
      if (r.key === 'thunder') {
        for (const cl of this.marks.cells) {
          g.fillStyle = 'rgba(168,85,247,0.35)';
          g.beginPath();
          g.moveTo(this.X(cl.from), y0 + ROW_H - 4);
          g.lineTo(this.X(cl.peak), y0 + 6);
          g.lineTo(this.X(cl.to), y0 + ROW_H - 4);
          g.fill();
          g.fillStyle = '#d8b4fe';
          g.fillText(cl.id, this.X(cl.peak) + 3, y0 + 14);
        }
      }
      const line = (list: { t: number; kf: WeatherKeyframe }[], color: string, dash: number[]): void => {
        g.strokeStyle = color;
        g.setLineDash(dash);
        g.lineWidth = 1.5;
        g.beginPath();
        for (let x = LEFT; x <= W - 8; x += 3) {
          const b = interpolateKeyframes(list, this.T(x)) as unknown as Record<string, number>;
          const v = b[r.key as string] ?? 0;
          const y = this.Y(row, r, v);
          if (x === LEFT) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        g.setLineDash([]);
        g.lineWidth = 1;
      };
      if (r.key === 'precipMmH') {
        // 棒
        for (let x = LEFT; x <= W - 8; x += 4) {
          const v = interpolateKeyframes(kfs, this.T(x)).precipMmH;
          const y = this.Y(row, r, v);
          g.fillStyle = 'rgba(80,140,230,0.7)';
          g.fillRect(x, y, 3, y0 + ROW_H - 4 - y);
        }
      } else line(kfs, '#e5e7eb', []);
      if (ghost) line(ghost, 'rgba(250,204,21,0.9)', [4, 3]);
      // 点
      kfs.forEach((k, i) => {
        const v = (k.kf as unknown as Record<string, number | undefined>)[r.key as string];
        if (v === undefined) return;
        const x = this.X(k.t);
        const y = this.Y(row, r, v);
        g.fillStyle = this.selected.includes(this.indexOf(k.kf)) ? '#facc15' : '#93c5fd';
        if (r.key === 'windDirDeg') {
          // 風が吹いてくる方向から矢印
          const a = ((v + 180) * Math.PI) / 180;
          g.strokeStyle = g.fillStyle;
          g.beginPath();
          g.moveTo(x - Math.sin(a) * 8, y0 + ROW_H / 2 + Math.cos(a) * 8);
          g.lineTo(x + Math.sin(a) * 8, y0 + ROW_H / 2 - Math.cos(a) * 8);
          g.stroke();
          g.beginPath();
          g.arc(x + Math.sin(a) * 8, y0 + ROW_H / 2 - Math.cos(a) * 8, 2.5, 0, Math.PI * 2);
          g.fill();
        } else {
          g.beginPath();
          g.arc(x, y, 3.5, 0, Math.PI * 2);
          g.fill();
        }
        void i;
      });
    });
    // キーフレームの縦線と時刻の帯
    for (const k of kfs) {
      const x = this.X(k.t);
      const sel = this.selected.includes(this.indexOf(k.kf));
      g.strokeStyle = sel ? 'rgba(250,204,21,0.9)' : 'rgba(147,197,253,0.4)';
      g.beginPath();
      g.moveTo(x, TOP - 6);
      g.lineTo(x, TOP + ROWS.length * ROW_H);
      g.stroke();
      g.fillStyle = sel ? '#facc15' : '#93c5fd';
      g.fillRect(x - 4, TOP - 8, 8, 8);
    }
    // 目印: 分岐点・イベント・カーソル
    const by = TOP + ROWS.length * ROW_H + 12;
    for (const m of this.marks.choices) {
      g.fillStyle = '#c8a050';
      g.fillText('◆', this.X(m.tMin) - 4, by);
    }
    for (const m of this.marks.events) {
      g.fillStyle = '#ef4444';
      g.fillText('●', this.X(m.tMin) - 3, by);
    }
    g.strokeStyle = '#22c55e';
    g.beginPath();
    g.moveTo(this.X(this.cursorMin), TOP);
    g.lineTo(this.X(this.cursorMin), TOP + ROWS.length * ROW_H);
    g.stroke();
  }

  private indexOf(kf: WeatherKeyframe): number {
    return this.w?.keyframes.indexOf(kf) ?? -1;
  }

  private hitKf(x: number): number {
    const ts = this.times();
    let best = -1;
    let bd = 6;
    ts.forEach((t, i) => {
      const d = Math.abs(this.X(t) - x);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  private bind(): void {
    let drag: null | { kind: 'time' | 'value' | 'range'; idx: number; row: number; x0: number; y0: number; startT: number; orig: WeatherKeyframe[]; moved: boolean } = null;
    const pos = (e: MouseEvent): { x: number; y: number } => {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.w) return;
      const { x, y } = pos(e);
      const row = Math.floor((y - TOP) / ROW_H);
      const idx = this.hitKf(x);
      const orig = structuredClone(this.w.keyframes);
      if (y < TOP) {
        if (e.shiftKey) drag = { kind: 'range', idx: -1, row: -1, x0: x, y0: y, startT: this.T(x), orig, moved: false };
        else if (idx >= 0) {
          drag = { kind: 'time', idx, row: -1, x0: x, y0: y, startT: this.times()[idx]!, orig, moved: false };
          this.selected = [idx];
          this.h.select(this.selected);
        }
      } else if (row >= 0 && row < ROWS.length && this.selected.length === 1) {
        const sel = this.selected[0]!;
        if (idx === sel || idx < 0) drag = { kind: 'value', idx: sel, row, x0: x, y0: y, startT: 0, orig, moved: false };
      }
      if (drag) this.canvas.setPointerCapture(e.pointerId);
      else if (idx >= 0) {
        this.selected = [idx];
        this.h.select(this.selected);
        this.draw();
      } else {
        this.cursorMin = Math.round(this.T(x));
        this.h.cursor(this.cursorMin);
        this.draw();
      }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag || !this.w) return;
      const { x, y } = pos(e);
      if (Math.abs(x - drag.x0) + Math.abs(y - drag.y0) > 2) drag.moved = true;
      if (!drag.moved) return;
      const kfs = structuredClone(drag.orig);
      if (drag.kind === 'time') {
        const t = Math.max(0, Math.round((drag.startT + (this.T(x) - this.T(drag.x0))) / 5) * 5);
        kfs[drag.idx]!.at = formatTimeRef(t);
        this.h.edit(kfs, 'キーフレームの時刻', false);
      } else if (drag.kind === 'value') {
        const r = ROWS[drag.row]!;
        const k = kfs[drag.idx]! as unknown as Record<string, number>;
        const startV = k[r.key as string] ?? this.V(drag.row, r, drag.y0);
        const target = this.V(drag.row, r, y);
        let v = e.shiftKey ? startV + (target - startV) * 0.2 : target;
        v = r.log ? Math.round(v) : Math.round(v / r.step) * r.step;
        k[r.key as string] = Math.max(r.min, Math.min(r.max, v));
        this.h.edit(kfs, `${r.label}`, false);
      } else {
        const a = Math.min(drag.startT, this.T(x));
        const b = Math.max(drag.startT, this.T(x));
        this.selected = this.times().flatMap((t, i) => (t >= a && t <= b ? [i] : []));
        this.h.select(this.selected);
        this.draw();
      }
    });
    this.canvas.addEventListener('pointerup', () => {
      if (drag?.moved && drag.kind !== 'range' && this.w) this.h.edit(this.w.keyframes, drag.kind === 'time' ? 'キーフレームの時刻' : '値', true);
      drag = null;
    });
    this.canvas.addEventListener('dblclick', (e) => {
      if (!this.w) return;
      const t = Math.round(this.T(pos(e).x) / 5) * 5;
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
    });
    this.canvas.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.w && this.selected.length > 0) {
        const kfs = this.w.keyframes.filter((_, i) => !this.selected.includes(i));
        if (kfs.length === 0) return;
        this.selected = [];
        this.h.edit(kfs, 'キーフレームの削除', true);
        this.h.select([]);
        e.preventDefault();
      }
    });
  }
}
