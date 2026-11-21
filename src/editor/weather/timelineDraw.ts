/**
 * 天候のタイムラインの描画（Canvas2D）。夜の帯・時刻の目盛り・行ごとの線と点・キーフレームの四角・目印・左の見出しと上限下限の目盛り。
 */
import { formatClock, parseTimeRef } from '../../sim/core/clock';
import type { WeatherKeyframe } from '../../sim/types';
import { interpolateKeyframes } from '../../sim/weather/global';
import { LEFT, RIGHT, ROW_H, TOP, type RowDef, type TimelineMarks } from './timelineRows';

export interface DrawView {
  kfs: { t: number; kf: WeatherKeyframe; i: number }[];
  ghost: WeatherKeyframe[] | null;
  marks: TimelineMarks;
  selected: number[];
  cursorMin: number;
  t1: number;
  v0: number;
  v1: number;
  X(t: number): number;
  T(x: number): number;
  Y(row: number, r: RowDef, v: number): number;
  value(kf: WeatherKeyframe, r: RowDef): number | undefined;
}

export function drawTimeline(g: CanvasRenderingContext2D, W: number, H: number, rows: RowDef[], tv: DrawView): void {
  g.fillStyle = '#1a1d22';
  g.fillRect(0, 0, W, H);
  const bottom = TOP + rows.length * ROW_H;
  g.save();
  g.beginPath();
  g.rect(LEFT, 0, W - LEFT, H);
  g.clip();
  // 夜の帯
  for (let i = 0; i < tv.marks.sunset.length; i += 1) {
    const a = tv.marks.sunset[i]!;
    const b = tv.marks.sunrise.find((x) => x > a) ?? tv.t1;
    g.fillStyle = 'rgba(40,50,90,0.35)';
    g.fillRect(tv.X(a), TOP, tv.X(b) - tv.X(a), bottom - TOP);
  }
  // 時刻の帯（キーフレームの四角を置く所）
  g.fillStyle = '#262a31';
  g.fillRect(LEFT, 0, W - LEFT, TOP - 2);
  // 時刻の目盛り: 表示の幅に合わせて間隔を変える
  const span = tv.v1 - tv.v0;
  const step = span > 2880 ? 360 : span > 1440 ? 180 : span > 600 ? 60 : span > 240 ? 30 : 10;
  g.font = '11px system-ui';
  for (let t = Math.ceil(tv.v0 / step) * step; t <= tv.v1; t += step) {
    const x = tv.X(t);
    g.fillStyle = t % 1440 === 0 ? '#facc15' : '#9aa0a6';
    g.fillText(t % 1440 === 0 ? `D${t / 1440} 0:00` : formatClock(t % 1440), x + 3, 11);
    g.strokeStyle = t % 1440 === 0 ? 'rgba(250,204,21,0.35)' : 'rgba(255,255,255,0.06)';
    g.beginPath();
    g.moveTo(x, 13);
    g.lineTo(x, bottom);
    g.stroke();
  }
  const kfs = tv.kfs;
  const ghost = tv.ghost ? tv.ghost.map((kf) => ({ t: parseTimeRef(kf.at), kf })).sort((a, b) => a.t - b.t) : null;
  rows.forEach((r, row) => {
    const y0 = TOP + row * ROW_H;
    g.fillStyle = row % 2 ? '#1f2329' : '#23272e';
    g.fillRect(LEFT, y0, W - LEFT, ROW_H);
    if (r.key === 'cloudBaseM') {
      for (const n of tv.marks.nodeElevs) {
        const y = tv.Y(row, r, n.elevM);
        g.strokeStyle = 'rgba(120,200,255,0.35)';
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(LEFT, y);
        g.lineTo(W, y);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(120,200,255,0.85)';
        g.font = '10px system-ui';
        g.fillText(`${n.name} ${Math.round(n.elevM)} m`, W - RIGHT - g.measureText(`${n.name} ${Math.round(n.elevM)} m`).width - 2, y - 2);
      }
    }
    if (r.key === 'thunder') {
      for (const cl of tv.marks.cells) {
        g.fillStyle = 'rgba(168,85,247,0.35)';
        g.beginPath();
        g.moveTo(tv.X(cl.from), y0 + ROW_H - 5);
        g.lineTo(tv.X(cl.peak), y0 + 5);
        g.lineTo(tv.X(cl.to), y0 + ROW_H - 5);
        g.fill();
      }
    }
    if (kfs.length === 0) return;
    const line = (list: { t: number; kf: WeatherKeyframe }[], color: string, dash: number[]): void => {
      g.strokeStyle = color;
      g.setLineDash(dash);
      g.lineWidth = 1.6;
      g.beginPath();
      for (let x = LEFT; x <= W - RIGHT; x += 3) {
        const v = (interpolateKeyframes(list, tv.T(x)) as unknown as Record<string, number>)[r.key as string] ?? 0;
        const y = r.key === 'windDirDeg' ? y0 + ROW_H / 2 : tv.Y(row, r, v);
        if (x === LEFT) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.setLineDash([]);
      g.lineWidth = 1;
    };
    if (r.key === 'precipMmH') {
      for (let x = LEFT; x <= W - RIGHT; x += 4) {
        const v = interpolateKeyframes(kfs, tv.T(x)).precipMmH;
        const y = tv.Y(row, r, v);
        g.fillStyle = 'rgba(80,140,230,0.7)';
        g.fillRect(x, y, 3, y0 + ROW_H - 5 - y);
      }
    } else if (r.key !== 'windDirDeg') line(kfs, '#e5e7eb', []);
    if (ghost && r.key !== 'windDirDeg') line(ghost, 'rgba(250,204,21,0.9)', [4, 3]);
    for (const k of kfs) {
      const v = tv.value(k.kf, r);
      if (v === undefined) continue;
      const x = tv.X(k.t);
      const sel = tv.selected.includes(k.i);
      g.fillStyle = sel ? '#facc15' : '#93c5fd';
      if (r.key === 'windDirDeg') {
        // 風が吹いてくる方向から矢印
        const a = ((v + 180) * Math.PI) / 180;
        const cy = y0 + ROW_H / 2;
        g.strokeStyle = g.fillStyle;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x - Math.sin(a) * 9, cy + Math.cos(a) * 9);
        g.lineTo(x + Math.sin(a) * 9, cy - Math.cos(a) * 9);
        g.stroke();
        g.lineWidth = 1;
        g.beginPath();
        g.arc(x + Math.sin(a) * 9, cy - Math.cos(a) * 9, 3, 0, Math.PI * 2);
        g.fill();
      } else {
        g.beginPath();
        g.arc(x, tv.Y(row, r, v), sel ? 5 : 4, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#11151a';
        g.stroke();
      }
    }
  });
  // キーフレームの縦線と、時刻の帯の四角
  for (const k of kfs) {
    const x = tv.X(k.t);
    const sel = tv.selected.includes(k.i);
    g.strokeStyle = sel ? 'rgba(250,204,21,0.9)' : 'rgba(147,197,253,0.35)';
    g.beginPath();
    g.moveTo(x, TOP - 9);
    g.lineTo(x, bottom);
    g.stroke();
    g.fillStyle = sel ? '#facc15' : '#93c5fd';
    g.fillRect(x - 5, TOP - 11, 10, 9);
  }
  // 目印: 分岐点・イベント・カーソル
  const by = bottom + 13;
  g.font = '11px system-ui';
  for (const m of tv.marks.choices) {
    g.fillStyle = '#c8a050';
    g.fillText('◆', tv.X(m.tMin) - 4, by);
  }
  for (const m of tv.marks.events) {
    g.fillStyle = '#ef4444';
    g.fillText('●', tv.X(m.tMin) - 3, by);
  }
  g.strokeStyle = '#22c55e';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(tv.X(tv.cursorMin), 13);
  g.lineTo(tv.X(tv.cursorMin), bottom);
  g.stroke();
  g.lineWidth = 1;
  g.restore();
  // 左の見出し: 行の名前と、上限・下限の目盛り
  g.fillStyle = '#1a1d22';
  g.fillRect(0, 0, LEFT, H);
  g.fillStyle = '#9aa0a6';
  g.font = '10px system-ui';
  g.fillText('時刻 →', 6, 11);
  rows.forEach((r, row) => {
    const y0 = TOP + row * ROW_H;
    g.fillStyle = '#e5e7eb';
    g.font = '12px system-ui';
    g.fillText(r.label, 6, y0 + ROW_H / 2 + 4);
    if (r.key !== 'windDirDeg') {
      g.fillStyle = '#7d848c';
      g.font = '9px system-ui';
      const hi = r.fmt(r.max);
      const lo = r.fmt(r.min);
      g.fillText(hi, LEFT - 4 - g.measureText(hi).width, y0 + 10);
      g.fillText(lo, LEFT - 4 - g.measureText(lo).width, y0 + ROW_H - 4);
    }
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.beginPath();
    g.moveTo(0, y0 + ROW_H);
    g.lineTo(W, y0 + ROW_H);
    g.stroke();
  });
  g.fillStyle = '#7d848c';
  g.font = '10px system-ui';
  g.fillText('◆分岐 ●出来事', 6, by);
}
