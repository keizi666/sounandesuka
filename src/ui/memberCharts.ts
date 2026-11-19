/**
 * 振り返り: メンバーの状態の推移。1 人ずつのグラフに、体力（HP）・体温・エネルギー・水分・疲労・濡れ・不安を重ねて描く。
 * 判断力（J: 体温・疲れ・不安・脱水・飲酒などで下がる）と飲酒（血中アルコール濃度）も出せる。
 * 上の切り替えで出す項目を選べる。グラフの上を指すと、その時刻の値を出す。分岐点（◆）と出来事（●）の時刻に縦の印。
 * 値は記録の 5 分ごとの標本（RecordSample）から。けがと意識は標本にないので、HP は体温と消耗だけから求めた目安。
 */
import { formatClock } from '../i18n/format';
import type { RunRecord, ScenarioDef } from '../sim/types';
import { avatar } from './avatar';
import { el } from './dom';
import { hpOf } from './hp';

interface Series {
  key: string;
  label: string;
  color: string;
  /** 0..1 に直した値 */
  norm: (s: RunRecord['samples'][number]['climbers'][number]) => number;
  /** 表示する値 */
  text: (s: RunRecord['samples'][number]['climbers'][number]) => string;
  dash?: number[];
}

const SERIES: Series[] = [
  {
    key: 'hp',
    label: '体力',
    color: '#4ade80',
    norm: (c) => hpOf({ coreC: c.coreC, glycogenKcal: c.glycogenKcal, waterDeficitL: c.waterDeficitL, fatigue: c.fatigue, injury: 'none', conscious: c.state !== 'UNCONSCIOUS', alive: c.state !== 'DEAD' }) / 100,
    text: (c) => `${hpOf({ coreC: c.coreC, glycogenKcal: c.glycogenKcal, waterDeficitL: c.waterDeficitL, fatigue: c.fatigue, injury: 'none', conscious: c.state !== 'UNCONSCIOUS', alive: c.state !== 'DEAD' })}`,
  },
  { key: 'core', label: '体温', color: '#f87171', norm: (c) => (c.coreC - 30) / 8, text: (c) => `${c.coreC.toFixed(1)}℃` },
  { key: 'energy', label: 'エネルギー', color: '#facc15', norm: (c) => c.glycogenKcal / 2000, text: (c) => `${Math.round(c.glycogenKcal)}` },
  { key: 'water', label: '水分', color: '#38bdf8', norm: (c) => 1 - c.waterDeficitL / 6, text: (c) => `-${c.waterDeficitL.toFixed(1)}L` },
  { key: 'fatigue', label: '疲労', color: '#fb923c', norm: (c) => c.fatigue / 100, text: (c) => `${Math.round(c.fatigue)}`, dash: [5, 3] },
  { key: 'wet', label: '濡れ', color: '#818cf8', norm: (c) => c.wetness, text: (c) => `${Math.round(c.wetness * 100)}%`, dash: [5, 3] },
  { key: 'anx', label: '不安', color: '#c084fc', norm: (c) => c.anxiety / 100, text: (c) => `${Math.round(c.anxiety)}`, dash: [2, 3] },
  { key: 'judge', label: '判断力', color: '#e2e8f0', norm: (c) => c.J, text: (c) => c.J.toFixed(2) },
  // 0.1% を上端に（0.05% で半分の高さ）
  { key: 'bac', label: '飲酒', color: '#f472b6', norm: (c) => (c.bac ?? 0) / 0.1, text: (c) => `${(c.bac ?? 0).toFixed(3)}%`, dash: [6, 2] },
];

export interface MemberChartsOptions {
  marks: { tMin: number; label: string; kind: 'decision' | 'event' }[];
}

export function memberCharts(rec: RunRecord, s: ScenarioDef, o: MemberChartsOptions): HTMLElement {
  // 飲酒は記録にあるときだけ最初から出す
  const on = new Set(['hp', 'core', 'energy', 'fatigue', 'judge']);
  if (rec.samples.some((sm) => sm.climbers.some((c) => (c.bac ?? 0) > 0))) on.add('bac');
  const ids = rec.samples[0]?.climbers.map((c) => c.id) ?? [];
  const defs = new Map(s.party.map((p) => [p.id, p]));
  const charts: { canvas: HTMLCanvasElement; id: string; draw: (hoverT: number | null) => void }[] = [];
  const t0 = rec.samples[0]?.t ?? 0;
  const t1 = rec.samples[rec.samples.length - 1]?.t ?? t0 + 1;
  let hoverT: number | null = null;

  const chips = el(
    'div',
    { class: 'mc-chips', role: 'group', 'aria-label': '出す項目' },
    SERIES.map((se) => {
      const b = el('button', { type: 'button', class: `mc-chip${on.has(se.key) ? ' on' : ''}`, style: `--c:${se.color}`, 'aria-pressed': on.has(se.key) }, se.label);
      b.addEventListener('click', () => {
        if (on.has(se.key)) on.delete(se.key);
        else on.add(se.key);
        b.classList.toggle('on', on.has(se.key));
        b.setAttribute('aria-pressed', String(on.has(se.key)));
        for (const c of charts) c.draw(hoverT);
      });
      return b;
    }),
  );

  const L = 44;
  const R = 10;
  const T = 10;
  const B = 22;
  const rows = ids.map((id) => {
    const def = defs.get(id);
    const canvas = el('canvas', { width: 820, height: 170, class: 'mc-canvas', 'aria-label': `${def?.name ?? id} の状態の推移` });
    const readout = el('div', { class: 'mc-readout' });
    const draw = (ht: number | null): void => {
      const g = canvas.getContext('2d');
      if (!g) return;
      const W = canvas.width;
      const H = canvas.height;
      const x = (t: number): number => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
      const y = (v: number): number => T + (1 - Math.max(0, Math.min(1, v))) * (H - T - B);
      g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,0.03)';
      g.fillRect(L, T, W - L - R, H - T - B);
      // 目盛り: 横線 25% ごと、時刻は 1 時間ごと
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 1;
      g.font = '11px system-ui, sans-serif';
      g.fillStyle = '#9aa0a6';
      for (let k = 0; k <= 4; k += 1) {
        const yy = y(k / 4);
        g.beginPath();
        g.moveTo(L, yy);
        g.lineTo(W - R, yy);
        g.stroke();
      }
      g.textAlign = 'center';
      for (let t = Math.ceil(t0 / 60) * 60; t <= t1; t += t1 - t0 > 900 ? 120 : 60) {
        g.fillText(formatClock(t), x(t), H - 6);
        g.beginPath();
        g.moveTo(x(t), T);
        g.lineTo(x(t), H - B);
        g.stroke();
      }
      // 分岐点・出来事の印
      for (const m of o.marks) {
        if (m.tMin < t0 || m.tMin > t1) continue;
        g.strokeStyle = m.kind === 'decision' ? 'rgba(200,160,80,0.7)' : 'rgba(239,68,68,0.55)';
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(x(m.tMin), T);
        g.lineTo(x(m.tMin), H - B);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = g.strokeStyle;
        g.fillText(m.kind === 'decision' ? '◆' : '●', x(m.tMin), T + 9);
      }
      // 項目の線
      for (const se of SERIES) {
        if (!on.has(se.key)) continue;
        g.strokeStyle = se.color;
        g.lineWidth = se.key === 'hp' ? 2.6 : 1.6;
        g.setLineDash(se.dash ?? []);
        g.beginPath();
        let first = true;
        for (const sm of rec.samples) {
          const c = sm.climbers.find((q) => q.id === id);
          if (!c) continue;
          const px = x(sm.t);
          const py = y(se.norm(c));
          if (first) g.moveTo(px, py);
          else g.lineTo(px, py);
          first = false;
        }
        g.stroke();
        g.setLineDash([]);
      }
      // 体温 35℃ の線（低体温症の境目）
      if (on.has('core')) {
        g.strokeStyle = 'rgba(248,113,113,0.45)';
        g.setLineDash([2, 4]);
        g.beginPath();
        g.moveTo(L, y((35 - 30) / 8));
        g.lineTo(W - R, y((35 - 30) / 8));
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(248,113,113,0.8)';
        g.textAlign = 'right';
        g.fillText('35℃', L - 4, y((35 - 30) / 8) + 4);
      }
      // 指している時刻
      if (ht !== null) {
        const sm = rec.samples.reduce((a, b) => (Math.abs(b.t - ht) < Math.abs(a.t - ht) ? b : a), rec.samples[0]!);
        const c = sm.climbers.find((q) => q.id === id);
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.beginPath();
        g.moveTo(x(sm.t), T);
        g.lineTo(x(sm.t), H - B);
        g.stroke();
        if (c) readout.replaceChildren(el('time', {}, formatClock(sm.t)), ...SERIES.filter((se) => on.has(se.key)).map((se) => el('span', { style: `--c:${se.color}` }, `${se.label} ${se.text(c)}`)));
      } else readout.replaceChildren();
    };
    const move = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * canvas.width;
      hoverT = t0 + ((px - L) / (canvas.width - L - R)) * (t1 - t0);
      hoverT = Math.max(t0, Math.min(t1, hoverT));
      for (const ch of charts) ch.draw(hoverT);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', move);
    canvas.addEventListener('pointerleave', () => {
      hoverT = null;
      for (const ch of charts) ch.draw(null);
    });
    charts.push({ canvas, id, draw });
    draw(null);
    const last = rec.samples[rec.samples.length - 1]?.climbers.find((q) => q.id === id);
    return el('div', { class: 'mc-row', style: `--c:${def?.color ?? '#888'}` }, [
      el('div', { class: 'mc-who' }, [def ? avatar(def, 44) : null, el('strong', {}, def?.name ?? id), last ? el('small', {}, `最低体温 ${Math.min(...rec.samples.map((sm) => sm.climbers.find((q) => q.id === id)?.coreC ?? 37)).toFixed(1)}℃`) : null]),
      el('div', { class: 'mc-plot' }, [canvas, readout]),
    ]);
  });
  return el('div', { class: 'member-charts' }, [chips, ...rows]);
}
