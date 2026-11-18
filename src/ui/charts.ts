/**
 * 振り返りの時系列グラフ（docs/12 §2）。Canvas に自前で描く（依存なし）。
 * 上段: 体温（登山者ごと、大人数は最低・中央値の帯）、下段: 気温・体感（点線）・降水（棒）・風。
 * ◆ 分岐点、● 重要イベント、▲ 実際の記録（史実）。マウスを乗せるとその時刻の値を出す。
 */
import { formatClock } from '../i18n/format';
import { clockMinOf } from '../sim/core/clock';
import type { RunRecord, ScenarioDef } from '../sim/types';

export interface ChartMarks {
  decisions: { tMin: number; label: string }[];
  events: { tMin: number; label: string }[];
  reference: { tMin: number; label: string }[];
}

const PAD_L = 40;
const PAD_R = 40;

export function drawTimeline(canvas: HTMLCanvasElement, rec: RunRecord, s: ScenarioDef, marks: ChartMarks, hoverT: number | null = null): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const W = canvas.width;
  const H = canvas.height;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches || document.documentElement.dataset['theme'] === 'dark';
  const fg = dark ? '#ddd' : '#333';
  const grid = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)';
  g.clearRect(0, 0, W, H);
  const smp = rec.samples;
  if (smp.length < 2) return;
  const t0 = smp[0]!.t;
  const t1 = smp[smp.length - 1]!.t;
  const X = (t: number): number => PAD_L + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD_L - PAD_R);
  const topH = H * 0.5;
  const botY = topH + 18;
  const botH = H - botY - 22;
  // 上段: 体温 30〜38
  const Yc = (c: number): number => 8 + (1 - (c - 30) / 8) * (topH - 16);
  g.font = '11px system-ui, sans-serif';
  g.fillStyle = fg;
  g.strokeStyle = grid;
  for (const c of [32, 34, 35, 36, 37]) {
    g.beginPath();
    g.moveTo(PAD_L, Yc(c));
    g.lineTo(W - PAD_R, Yc(c));
    g.stroke();
    g.fillText(`${c}℃`, 4, Yc(c) + 4);
  }
  // 35℃（低体温症の目安）は強調
  g.strokeStyle = 'rgba(220,80,60,0.5)';
  g.setLineDash([4, 3]);
  g.beginPath();
  g.moveTo(PAD_L, Yc(35));
  g.lineTo(W - PAD_R, Yc(35));
  g.stroke();
  g.setLineDash([]);
  const ids = smp[0]!.climbers.map((c) => c.id);
  const many = ids.length > 6;
  if (many) {
    // 最低値と中央値の帯
    g.fillStyle = 'rgba(80,140,220,0.25)';
    g.beginPath();
    smp.forEach((p, i) => {
      const v = p.climbers.map((c) => c.coreC).sort((a, b) => a - b);
      const y = Yc(v[Math.floor(v.length / 2)]!);
      if (i === 0) g.moveTo(X(p.t), y);
      else g.lineTo(X(p.t), y);
    });
    for (let i = smp.length - 1; i >= 0; i -= 1) {
      const p = smp[i]!;
      g.lineTo(X(p.t), Yc(Math.min(...p.climbers.map((c) => c.coreC))));
    }
    g.fill();
  } else {
    for (const id of ids) {
      const col = s.party.find((p) => p.id === id)?.color ?? '#3b82f6';
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.beginPath();
      smp.forEach((p, i) => {
        const c = p.climbers.find((x) => x.id === id);
        if (!c) return;
        if (i === 0) g.moveTo(X(p.t), Yc(c.coreC));
        else g.lineTo(X(p.t), Yc(c.coreC));
      });
      g.stroke();
    }
    g.lineWidth = 1;
  }
  // 下段: 気温（-15〜30）と体感、降水、風
  const Yt = (t: number): number => botY + (1 - (t + 15) / 45) * botH;
  const Yw = (w: number): number => botY + (1 - w / 30) * botH;
  g.strokeStyle = grid;
  g.strokeRect(PAD_L, botY, W - PAD_L - PAD_R, botH);
  const step = (W - PAD_L - PAD_R) / smp.length;
  g.fillStyle = 'rgba(70,120,220,0.45)';
  for (const p of smp) {
    const h = Math.min(botH, p.local.precipMmH * 6);
    g.fillRect(X(p.t) - step / 2, botY + botH - h, Math.max(1, step), h);
  }
  const line = (f: (p: (typeof smp)[number]) => number, color: string, dash: number[] = []): void => {
    g.strokeStyle = color;
    g.setLineDash(dash);
    g.beginPath();
    smp.forEach((p, i) => (i === 0 ? g.moveTo(X(p.t), f(p)) : g.lineTo(X(p.t), f(p))));
    g.stroke();
    g.setLineDash([]);
  };
  line((p) => Yt(p.local.tempC), '#f97316');
  line((p) => Yt(p.local.windChillC), '#f97316', [2, 3]);
  line((p) => Yw(p.local.windMs), '#a855f7');
  g.fillStyle = fg;
  g.fillText('気温', 4, botY + 12);
  g.fillStyle = '#a855f7';
  g.fillText('風', W - PAD_R + 6, botY + 12);
  // 時刻軸
  g.fillStyle = fg;
  const startH = Math.ceil(t0 / 60);
  const every = t1 - t0 > 900 ? 3 : 1;
  for (let h = startH; h * 60 <= t1; h += 1) {
    if (h % every !== 0) continue;
    const x = X(h * 60);
    g.fillText(formatClock(clockMinOf(h * 60)), x - 14, H - 6);
  }
  // 目印
  const mark = (t: number, y: number, shape: 'diamond' | 'dot' | 'tri', color: string): void => {
    const x = X(t);
    g.fillStyle = color;
    g.beginPath();
    if (shape === 'dot') g.arc(x, y, 3.5, 0, Math.PI * 2);
    else if (shape === 'tri') {
      g.moveTo(x, y - 6);
      g.lineTo(x + 5, y + 3);
      g.lineTo(x - 5, y + 3);
    } else {
      g.moveTo(x, y - 6);
      g.lineTo(x + 5, y);
      g.lineTo(x, y + 6);
      g.lineTo(x - 5, y);
    }
    g.fill();
  };
  for (const d of marks.decisions) mark(d.tMin, topH + 6, 'diamond', '#c8a050');
  for (const e of marks.events) mark(e.tMin, topH + 6, 'dot', '#dc2626');
  for (const r of marks.reference) mark(r.tMin, 10, 'tri', '#2563eb');
  // ホバー
  if (hoverT !== null) {
    const p = smp.reduce((a, b) => (Math.abs(b.t - hoverT) < Math.abs(a.t - hoverT) ? b : a));
    const x = X(p.t);
    g.strokeStyle = fg;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H - 18);
    g.stroke();
    const lines = [
      formatClock(clockMinOf(p.t)),
      ...p.climbers.slice(0, 6).map((c) => `${s.party.find((q) => q.id === c.id)?.name ?? c.id} ${c.coreC.toFixed(1)}℃`),
      `気温 ${p.local.tempC.toFixed(1)}℃ 体感 ${p.local.windChillC.toFixed(1)}℃`,
      `風 ${p.local.windMs.toFixed(0)}m/s 降水 ${p.local.precipMmH.toFixed(1)}mm/h`,
    ];
    const bw = 170;
    const bx = x + 8 + bw > W ? x - 8 - bw : x + 8;
    g.fillStyle = dark ? 'rgba(20,20,20,0.9)' : 'rgba(255,255,255,0.92)';
    g.fillRect(bx, 8, bw, lines.length * 14 + 8);
    g.fillStyle = fg;
    lines.forEach((l, i) => g.fillText(l, bx + 6, 22 + i * 14));
  }
}

/** キャンバスの x 座標からゲーム時刻へ */
export function timeAtX(canvas: HTMLCanvasElement, rec: RunRecord, px: number): number | null {
  const smp = rec.samples;
  if (smp.length < 2) return null;
  const t0 = smp[0]!.t;
  const t1 = smp[smp.length - 1]!.t;
  const f = (px - PAD_L) / (canvas.width - PAD_L - PAD_R);
  return t0 + Math.max(0, Math.min(1, f)) * (t1 - t0);
}
