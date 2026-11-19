/**
 * ログの 1 行に付ける「そのときの登山者の状態」と、その見せ方。
 * - snapOf: ログを出した瞬間の状態を小さな写しにする（保存データにも入る。あとから見ても当時の値）
 * - ringGauge: 顔アイコンの下の丸いメーター（体力・スマホの電池）
 * - openLogDetail: 行の「＞」を押したときの詳細のポップアップ
 */
import { JA } from '../i18n/ja';
import type { ClimberDef, ClimberState } from '../sim/types';
import { avatar } from './avatar';
import { el, LEVEL_ICON, levelOf, type Level } from './dom';
import { hpLevel, hpOf } from './hp';
import { icon, type IconName } from './icons';

/** ログの行に付ける状態の写し（JSON 互換） */
export interface LogSnap {
  state: string;
  hp: number;
  /** スマホの電池（%）。持っていなければ null、切れていれば 0 */
  phone: number | null;
  coreC: number;
  gly: number;
  waterL: number;
  fatigue: number;
  wet: number;
  anxiety: number;
  elevM: number;
  tempC: number;
  chillC: number;
  windMs: number;
  precipMmH: number;
  visM: number;
}

export function snapOf(c: ClimberState): LogSnap {
  const b = c.body;
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  return {
    state: c.state,
    hp: hpOf(b),
    phone: c.inv.phone.has ? (c.inv.phone.dead ? 0 : Math.round(c.inv.phone.batteryPct)) : null,
    coreC: r1(b.coreC),
    gly: Math.round(b.glycogenKcal),
    waterL: r1(b.waterDeficitL),
    fatigue: Math.round(b.fatigue),
    wet: Math.round(b.wetness * 100),
    anxiety: Math.round(b.anxiety),
    elevM: Math.round(c.elevM),
    tempC: r1(c.local.tempC),
    chillC: r1(c.local.windChillC),
    windMs: Math.round(c.local.windMs),
    precipMmH: r1(c.local.precipMmH),
    visM: Math.round(c.local.visibilityM),
  };
}

const LEVEL_COLOR: Record<Level, string> = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)', critical: 'var(--critical)' };

/** 丸いメーター: 輪の長さで割合（0..1）、色で段階、中央にアイコン */
export function ringGauge(ic: IconName, frac: number, level: Level, label: string): HTMLElement {
  const f = Math.max(0, Math.min(1, frac));
  const R = 10;
  const C = 2 * Math.PI * R;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 26 26');
  svg.setAttribute('class', 'ring');
  const circle = (stroke: string, dash?: string): SVGCircleElement => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '13');
    c.setAttribute('cy', '13');
    c.setAttribute('r', String(R));
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke', stroke);
    c.setAttribute('stroke-width', '3.2');
    if (dash) {
      c.setAttribute('stroke-dasharray', dash);
      c.setAttribute('stroke-linecap', 'round');
      c.setAttribute('transform', 'rotate(-90 13 13)');
    }
    return c;
  };
  svg.append(circle('rgba(255,255,255,0.16)'));
  if (f > 0.005) svg.append(circle(LEVEL_COLOR[level], `${(C * f).toFixed(2)} ${C.toFixed(2)}`));
  return el('span', { class: `gauge lv-${level}`, title: label, role: 'img', 'aria-label': label }, [svg, icon(ic)]);
}

/** 顔アイコンの下に並べる 2 つのメーター（体力・スマホ） */
export function snapGauges(s: LogSnap): HTMLElement {
  return el('span', { class: 'gauges' }, [
    ringGauge('favorite', s.hp / 100, hpLevel(s.hp), `${JA.ui.hp} ${s.hp}`),
    s.phone !== null ? ringGauge('mobile', s.phone / 100, levelOf(s.phone, 30, 15, 5), `${JA.ui.phoneBattery} ${s.phone}%`) : null,
  ]);
}

let openPop: { el: HTMLElement; off: () => void } | null = null;

export function closeLogDetail(): void {
  openPop?.off();
  openPop?.el.remove();
  openPop = null;
}

export interface LogDetailInput {
  who: ClimberDef;
  time: string;
  text: string;
  snap: LogSnap;
  /** 数値を出すか（神の視点）。登山者の視点では棒だけ */
  god: boolean;
  /** ポップアップを出す基準の要素（押したボタン） */
  anchor: HTMLElement;
  /** 下の注記（省略時は「ログが出た時点の値です。」） */
  note?: string;
}

/** 行の詳細のポップアップ。外を押す・Esc・×で閉じる */
export function openLogDetail(d: LogDetailInput): void {
  closeLogDetail();
  const s = d.snap;
  const D = JA.logDetail;
  const row = (ic: IconName, label: string, frac: number, level: Level, text: string): HTMLElement =>
    el('div', { class: `bar lv-${level}`, role: 'meter', 'aria-label': `${label} ${text}` }, [
      el('span', { class: 'lbl' }, [icon(ic), label]),
      el('span', { class: 'track' }, el('span', { class: 'fill', style: `width:${Math.max(0, Math.min(1, frac)) * 100}%` })),
      el('span', { class: 'val' }, d.god && text !== '' ? `${LEVEL_ICON[level]} ${text}` : LEVEL_ICON[level]),
    ]);
  const kv = (ic: IconName, k: string, v: string): HTMLElement => el('div', { class: 'kv' }, [el('span', { class: 'k' }, [icon(ic), k]), el('span', {}, v)]);
  const close = el('button', { class: 'pop-close', type: 'button', title: JA.ui.close, 'aria-label': JA.ui.close, onclick: () => closeLogDetail() }, icon('close'));
  const pop = el('div', { class: 'log-pop', role: 'dialog', 'aria-label': D.title }, [
    el('header', {}, [
      avatar(d.who, 56),
      el('div', { class: 'pop-who' }, [el('strong', {}, `${d.who.name} ${d.who.age}`), el('small', {}, `${d.time} ・ ${JA.labels.state[s.state] ?? s.state} ・ ${s.elevM.toLocaleString()} m`)]),
      close,
    ]),
    d.text ? el('p', { class: 'pop-text' }, d.text) : null,
    el('h4', {}, D.body),
    row('favorite', JA.ui.hp, s.hp / 100, hpLevel(s.hp), `${s.hp}`),
    s.phone !== null ? row('mobile', JA.ui.phoneBattery, s.phone / 100, levelOf(s.phone, 30, 15, 5), s.phone === 0 ? '×' : `${s.phone}%`) : null,
    row('thermostat', JA.ui.core, (s.coreC - 30) / 8, levelOf(s.coreC, 36, 35, 32), `${s.coreC.toFixed(1)}℃`),
    row('bolt', JA.ui.energy, s.gly / 2000, levelOf(s.gly, 600, 300, 100), `${s.gly}`),
    row('waterDrop', JA.ui.water, 1 - s.waterL / 6, levelOf(s.waterL, 1, 2, 4, true), `-${s.waterL.toFixed(1)}L`),
    row('batteryAlert', JA.ui.fatigue, s.fatigue / 100, levelOf(s.fatigue, 60, 80, 95, true), `${s.fatigue}`),
    row('rainy', JA.ui.wetness, s.wet / 100, levelOf(s.wet, 30, 60, 85, true), `${s.wet}%`),
    row('sentimentWorried', JA.ui.anxiety, s.anxiety / 100, levelOf(s.anxiety, 40, 60, 80, true), `${s.anxiety}`),
    d.god
      ? el('section', { class: 'weather' }, [
          el('h4', {}, D.weather),
          kv('deviceThermostat', JA.ui.temp, `${s.tempC.toFixed(1)}℃（${JA.ui.feels} ${s.chillC.toFixed(1)}℃）`),
          kv('air', JA.ui.wind, `${s.windMs} m/s`),
          kv('rainy', JA.ui.precip, s.precipMmH > 0.05 ? `${s.precipMmH.toFixed(1)} mm/h` : JA.ui.none),
          kv('foggy', JA.ui.visibility, s.visM >= 10000 ? '10km以上' : `${s.visM} m`),
        ])
      : null,
    el('p', { class: 'pop-note' }, d.note ?? D.note),
  ]);
  document.body.append(pop);
  // 押したボタンの近くに、画面からはみ出さないように置く
  const a = d.anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const x = Math.max(8, Math.min(window.innerWidth - w - 8, a.right + 10));
  const y = Math.max(8, Math.min(window.innerHeight - h - 8, a.top - 40));
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;
  const onDown = (e: Event): void => {
    if (!pop.contains(e.target as Node) && e.target !== d.anchor && !d.anchor.contains(e.target as Node)) closeLogDetail();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeLogDetail();
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey);
  openPop = {
    el: pop,
    off: () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    },
  };
  close.focus();
}
