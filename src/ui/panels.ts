/**
 * 登山者パネル・気象パネル・予報（docs/11 §2、§4）。
 * 段階は色だけでなくアイコンと文字でも示す。登山者の視点では数値を出さず、言葉で表す（docs/02 §4）。
 */
import { avatar } from './avatar';
import { hpLevel, hpOf } from './hp';
import { icon, type IconName } from './icons';
import { JA } from '../i18n/ja';
import { fill } from '../i18n/format';
import { phoneLabel } from './phoneWord';
import type { ClimberState, ScenarioDef, World } from '../sim/types';
import { el, LEVEL_ICON, levelOf, type Level } from './dom';
import { activeCells } from '../sim/weather/global';
import { interpolateKeyframes, effectiveKeyframes } from '../sim/weather/global';

function bar(ic: IconName, label: string, frac: number, level: Level, text: string): HTMLElement {
  return el('div', { class: `bar lv-${level}`, role: 'meter', 'aria-label': `${label} ${text}` }, [
    el('span', { class: 'lbl' }, [icon(ic), label]),
    el('span', { class: 'track' }, el('span', { class: 'fill', style: `width:${Math.max(0, Math.min(1, frac)) * 100}%` })),
    el('span', { class: 'val' }, text === '' ? LEVEL_ICON[level] : `${LEVEL_ICON[level]} ${text}`),
  ]);
}

function coreWords(c: number): string {
  if (c >= 36) return '平気';
  if (c >= 35) return '寒い、手がかじかむ';
  if (c >= 32) return '震えが止まらない';
  if (c >= 28) return '震えが止まり、ぼんやりしている';
  return '反応がない';
}

/** 水筒の残りの段階（入れ物の量に対する割合と、残りの量） */
function bottleLevel(leftL: number, capL: number): 'ok' | 'warn' | 'danger' | 'critical' {
  const f = leftL / capL;
  return leftL < 0.05 ? 'critical' : f < 0.2 || leftL < 0.2 ? 'danger' : f < 0.45 ? 'warn' : 'ok';
}

export function climberCard(c: ClimberState, god: boolean, selected: boolean, onSelect: () => void, collapsed = false, onToggle?: () => void, bodyKnown = true, onZoom?: () => void): HTMLElement {
  const b = c.body;
  const core = levelOf(b.coreC, 36, 35, 32);
  const gly = levelOf(b.glycogenKcal, 600, 300, 100);
  const water = levelOf(b.waterDeficitL, 1, 2, 4, true);
  const fat = levelOf(b.fatigue, 60, 80, 95, true);
  const wet = levelOf(b.wetness, 0.3, 0.6, 0.85, true);
  const anx = levelOf(b.anxiety, 40, 60, 80, true);
  // 救助を待つ状態のまま歩いているのは、用事を終えて仲間のところへ戻る途中
  const stName = c.state === 'WAITING_RESCUE' && c.speedMs > 0.05 ? JA.ui.returningToMates : (JA.labels.state[c.state] ?? c.state);
  const st = c.offMap ? `${stName}・${c.offMap}` : stName;
  const chip = (ic: IconName, text: string): HTMLElement => el('span', { class: 'chip' }, [icon(ic), text]);
  const chipPhone: HTMLElement | null = null;
  const chips = [
    b.rainwearOn ? chip('checkroom', JA.ui.rainwearOn) : null,
    c.inv.headlamp.on ? chip('flashlightOn', JA.ui.headlampOn) : null,
    null as HTMLElement | null,
    b.injury !== 'none' ? chip('healing', JA.labels.injury[b.injury] ?? b.injury) : null,
  ];
  // 総合の体力（HP）とスマホの電池は、小さくしたときも出す
  const hp = hpOf(b);
  const phonePct = c.inv.phone.has && !c.inv.phone.dead ? Math.round(c.inv.phone.batteryPct) : 0;
  const summary = el('div', { class: 'summary' }, [
    // ハードでリーダー以外の人は、体調が分からない（ユーザーの指定）
    bodyKnown ? bar('favorite', JA.ui.hp, hp / 100, hpLevel(hp), god ? `${hp}` : '') : el('p', { class: 'words unknown' }, JA.difficulty.bodyUnknown),
    c.inv.phone.has ? bar('mobile', phoneLabel(c.inv.charging === true), phonePct / 100, levelOf(phonePct, 30, 15, 5), c.inv.phone.dead ? '×' : `${phonePct}%`) : null,
    // モバイルバッテリー（残りはスマホの何回分か）
    c.inv.phone.has && (c.inv.powerBankPct ?? 0) > 0 ? bar('batteryAlert', JA.ui.powerBank, Math.min(1, (c.inv.powerBankPct ?? 0) / 100), 'ok', fill(JA.ui.powerBankLeft, { n: ((c.inv.powerBankPct ?? 0) / 100).toFixed(1) })) : null,
    // 水筒の残り（持ってきた入れ物の量に対して）。本人にも分かるので、神の視点でなくても出す
    c.def.gear.waterL > 0 ? bar('waterBottle', JA.ui.bottle, c.inv.waterL / c.def.gear.waterL, bottleLevel(c.inv.waterL, c.def.gear.waterL), `${c.inv.waterL.toFixed(1)} / ${c.def.gear.waterL.toFixed(1)}L`) : null,
  ]);
  const toggle = el('button', { class: 'fold', type: 'button', title: collapsed ? JA.ui.cardExpand : JA.ui.cardCollapse, 'aria-label': collapsed ? JA.ui.cardExpand : JA.ui.cardCollapse, 'aria-expanded': !collapsed }, icon(collapsed ? 'keyboardArrowDown' : 'keyboardArrowUp'));
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggle?.();
  });
  // 状態の横に、いまいる所の標高（ユーザーの指定）
  const elev = c.offMap ? '' : `・${Math.round(c.elevM).toLocaleString('ja-JP')} m`;
  const head = el('header', { class: 'who' }, [avatar(c.def, 51), el('h3', {}, [`${c.def.name} ${c.def.age}歳`, el('small', {}, ` ${st}${elev}`)]), toggle]);
  // ダブルクリックでその人へ寄る（ユーザーの指定）
  if (collapsed) return el('section', { class: `climber mini${selected ? ' selected' : ''}${b.alive ? '' : ' dead'}`, onclick: onSelect, ondblclick: () => onZoom?.() }, [head, summary]);
  return el('section', { class: `climber${selected ? ' selected' : ''}${b.alive ? '' : ' dead'}`, onclick: onSelect, ondblclick: () => onZoom?.() }, [
    head,
    summary,
    !bodyKnown
      ? null
      : god
      ? el('div', {}, [
          bar('thermostat', JA.ui.core, (b.coreC - 30) / 8, core, `${b.coreC.toFixed(1)}℃（${JA.ui.estimated}）`),
          bar('bolt', JA.ui.energy, b.glycogenKcal / 2000, gly, `${Math.round(b.glycogenKcal)}`),
          bar('waterDrop', JA.ui.water, 1 - b.waterDeficitL / 6, water, `-${b.waterDeficitL.toFixed(1)}L`),
          bar('batteryAlert', JA.ui.fatigue, b.fatigue / 100, fat, `${Math.round(b.fatigue)}`),
          bar('rainy', JA.ui.wetness, b.wetness, wet, `${Math.round(b.wetness * 100)}%`),
          bar('sentimentWorried', JA.ui.anxiety, b.anxiety / 100, anx, `${Math.round(b.anxiety)}`),
          el('p', { class: 'jm' }, [icon('psychology'), `${JA.ui.judgement} ${c.J.toFixed(2)} ・ ${JA.ui.motor} ${c.M.toFixed(2)}`]),
        ])
      : el('p', { class: 'words' }, `${coreWords(b.coreC)}。${b.fatigue > 70 ? '足が重い。' : ''}${b.wetness > 0.6 ? '服が濡れて冷たい。' : ''}`),
    el('p', { class: 'icons' }, chips.filter((x) => x !== chipPhone)),
  ]);
}

function windDir(deg: number): string {
  const names = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8]!;
}

export function weatherPanel(world: World, c: ClimberState | undefined, god: boolean): HTMLElement {
  if (!c) return el('section', {});
  const l = c.local;
  const pt = JA.labels.precipType[l.precipType] ?? l.precipType;
  if (!god) {
    const words = [
      l.tempC < 0 ? '凍えるほど寒い' : l.tempC < 8 ? '冷たい空気' : l.tempC > 25 ? '暑い' : '過ごしやすい',
      l.windMs > 15 ? '体を持っていかれそうな風' : l.windMs > 8 ? '強い風' : l.windMs > 3 ? '風がある' : '風は弱い',
      l.precipMmH > 5 ? `激しい${pt}` : l.precipMmH > 0.5 ? `${pt}が降っている` : '降っていない',
      l.visibilityM < 60 ? `霧で ${Math.round(l.visibilityM)}m 先が見えない` : l.visibilityM < 500 ? '霧が出ている' : '見通しはよい',
      l.thunder > 0.5 ? '雷鳴が近い' : l.thunder > 0.1 ? '遠くで雷鳴' : '',
    ].filter(Boolean);
    return el('section', { class: 'weather' }, [el('h3', {}, [icon('partlyCloudyDay'), JA.ui.weather]), el('ul', {}, words.map((w) => el('li', {}, w)))]);
  }
  const row = (ic: IconName, k: string, v: string): HTMLElement => el('div', { class: 'kv' }, [el('span', { class: 'k' }, [icon(ic), k]), el('span', {}, v)]);
  return el('section', { class: 'weather' }, [
    el('h3', {}, [icon('partlyCloudyDay'), JA.ui.weather]),
    row('deviceThermostat', JA.ui.temp, `${l.tempC.toFixed(1)}℃`),
    row('acUnit', JA.ui.feels, `${l.windChillC.toFixed(1)}℃`),
    row('air', JA.ui.wind, `${l.windMs.toFixed(0)} m/s ${windDir(l.windDirDeg)}`),
    row('rainy', JA.ui.precip, l.precipMmH > 0.05 ? `${pt} ${l.precipMmH.toFixed(1)}mm/h` : JA.ui.none),
    row('foggy', JA.ui.visibility, `${l.visibilityM >= 10000 ? '10km以上' : Math.round(l.visibilityM) + ' m'}`),
    row('cloud', JA.ui.cloudBase, `${Math.round(world.weather.cloudBaseM).toLocaleString()} m`),
    row('thunderstorm', JA.ui.thunder, l.thunder > 0.05 ? `${Math.round(Math.min(1, l.thunder) * 100)}%` : JA.ui.none),
  ]);
}

/** 予報（出発前に見たもの）と、神の視点では今後 6 時間のスパークライン */
export function forecastPanel(world: World, scenario: ScenarioDef, c: ClimberState | undefined, god: boolean): HTMLElement {
  const list = el('ul', { class: 'forecast' }, (c?.perception.forecast ?? scenario.briefing.forecast).map((f) => el('li', {}, `${f.label}: ${f.text}`)));
  if (!god) return el('section', {}, [el('h4', {}, JA.ui.forecast), list]);
  const canvas = el('canvas', { width: 220, height: 60, class: 'spark' });
  const g = canvas.getContext('2d');
  if (g) {
    const kfs = effectiveKeyframes(world, scenario);
    const pts = Array.from({ length: 37 }, (_, i) => interpolateKeyframes(kfs, world.tMin + i * 10));
    const draw = (vals: number[], lo: number, hi: number, color: string): void => {
      g.strokeStyle = color;
      g.beginPath();
      vals.forEach((v, i) => {
        const x = (i / (vals.length - 1)) * 220;
        const y = 58 - ((v - lo) / (hi - lo || 1)) * 54;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
    };
    pts.forEach((p, i) => {
      g.fillStyle = 'rgba(70,120,220,0.5)';
      const h = Math.min(54, p.precipMmH * 5);
      g.fillRect((i / 36) * 220, 58 - h, 6, h);
    });
    draw(pts.map((p) => p.tempC), -5, 30, '#f97316');
    draw(pts.map((p) => p.windMs), 0, 20, '#a855f7');
    void activeCells;
  }
  return el('section', {}, [el('h4', {}, JA.ui.forecast), list, el('small', {}, '今後 6 時間（橙: 気温、紫: 風、青: 降水）'), canvas]);
}
