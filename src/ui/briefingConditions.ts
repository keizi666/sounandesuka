/**
 * ブリーフィングの、条件を変えて試す所（ユーザーの指定）。
 * - 「気象条件を変えて試す」のカード: 天気・気温・季節だけ
 * - 登場人物のカード: 装備の一覧の下で、体調・装備（観光・軽装・登山用・厳冬期用）・体力の倍率・モバイルバッテリー・水を人ごとに選ぶ。
 *   選ぶと、その人の装備の一覧を選んだ条件で描き直す
 */
import type { LoadedScenario } from '../app/data';
import { JA } from '../i18n/ja';
import { fill, phoneWordIn } from '../i18n/format';
import { powerBankPctOf } from '../sim/core/world';
import { eraGear, powerBankAvailable, scenarioYear } from '../sim/scenario/era';
import {
  applyConditions,
  FITNESS_X_CHOICES,
  GEAR_PRESETS,
  isDefaultPerson,
  isDefaultWeather,
  POWER_BANK_CHOICES,
  WATER_L_CHOICES,
  type GearPreset,
  type Health,
  type PersonConditions,
  type SeasonOverride,
  type StartConditions,
  type WeatherOverride,
} from '../sim/scenario/startConditions';
import { TUNING } from '../sim/tuning';
import type { ClimberDef } from '../sim/types';
import { avatar } from './avatar';
import { el } from './dom';
import { icon, type IconName } from './icons';

type Scenario = LoadedScenario['scenario'];

function select<T extends string>(value: T, opts: [T, string][], set: (v: T) => void, label: string): HTMLSelectElement {
  const sel = el('select', { 'aria-label': label }, opts.map(([v, l]) => el('option', { value: v, selected: v === value }, l))) as HTMLSelectElement;
  sel.addEventListener('change', () => set(sel.value as T));
  return sel;
}

/** 装備の 1 項目（アイコン＋文）。持っていないものは薄く出す */
function gearChip(ic: IconName, text: string, has = true): HTMLElement {
  return el('span', { class: `gear${has ? '' : ' none'}` }, [icon(ic), text]);
}

function gearChips(g: ClimberDef['gear']): HTMLElement[] {
  const B = JA.briefing;
  return [
    gearChip('checkroom', `${B.rainwear} ${B.rainwearKind[g.rainwear] ?? g.rainwear}`, g.rainwear !== 'none'),
    gearChip('acUnit', g.cloPack > 0 ? B.warmSpare : B.warmNone, g.cloPack > 0),
    gearChip('flashlightOn', g.headlamp.has ? B.headlamp : B.noHeadlamp, g.headlamp.has),
    gearChip('map', g.phone.gpsApp ? B.mapApp : g.map ? B.paperMap : B.noMap, g.phone.gpsApp || g.map),
    gearChip('camping', g.tent ? B.tent : g.bivy !== 'none' ? B.bivy : B.noBivy, Boolean(g.tent) || g.bivy !== 'none'),
    g.crampons ? gearChip('acUnit', B.crampons) : null,
    gearChip('restaurant', `${g.foodKcal} kcal`),
    gearChip('waterDrop', `${g.waterL} L`),
    g.trekkingPoles ? gearChip('hiking', B.poles) : null,
  ].filter((x): x is HTMLElement => x !== null);
}

/** 登場人物のカード。cond を書き換えられるのは、条件を変えて試せるとき（editable） */
export function climberCard(p: ClimberDef, s: Scenario, cond: StartConditions, editable: boolean): HTMLElement {
  const B = JA.briefing;
  const C = JA.conditions;
  const chips = el('div', { class: 'bf-gear' });
  const card = el('li', { class: 'bf-climber', style: `--c:${p.color}` });
  const people = (cond.people ??= {});
  const pc = (): PersonConditions => (people[p.id] ??= {});
  const repaint = (): void => {
    const now = applyConditions(s, cond).party.find((x) => x.id === p.id) ?? p;
    chips.replaceChildren(...gearChips(eraGear(now.gear, scenarioYear(s), TUNING)));
    card.classList.toggle('changed', !isDefaultPerson(people[p.id]) || (cond.health[p.id] ?? 'good') !== 'good');
  };
  const field = (label: string, ctrl: HTMLElement): HTMLElement => el('label', { class: 'bf-adj' }, [el('span', {}, label), ctrl]);
  const set = (f: () => void): void => {
    f();
    repaint();
  };
  let adjust: HTMLElement | null = null;
  if (editable) {
    const healthOpts: [Health, string][] = (['good', 'sleepy', 'tired', 'cold', 'hangover'] as const).map((h) => [h, C.health[h]]);
    const gearOpts: [string, string][] = [['asIs', C.asIs], ...GEAR_PRESETS.map((g): [string, string] => [g, C.gearKind[g] ?? g])];
    const fitOpts: [string, string][] = FITNESS_X_CHOICES.map((x) => [String(x), x === 1 ? fill(C.fitnessAsIs, { x: '1.0' }) : fill(C.fitnessX, { x: x.toFixed(1) })]);
    // 水: 選べる量に、シナリオの量を足して並べる
    const waters = [...new Set([...WATER_L_CHOICES, p.gear.waterL])].sort((a, b) => a - b);
    const waterOpts: [string, string][] = waters.map((l) => [String(l), l === p.gear.waterL ? fill(C.waterScenario, { l }) : `${l} L`]);
    // モバイルバッテリー: その年代にあり、スマホを持つ人だけ
    const hasPhone = powerBankAvailable(s, TUNING) && eraGear(p.gear, scenarioYear(s), TUNING).phone.has;
    const bank0 = p.gear.powerBankMah ?? TUNING.devices.powerBankDefaultMah;
    const banks = [...new Set([...POWER_BANK_CHOICES, bank0])].sort((a, b) => a - b);
    const bankLabel = (m: number): string => (m === 0 ? C.powerBankNone : phoneWordIn(s, fill(C.powerBankMah, { mah: m.toLocaleString(), n: (powerBankPctOf(m) / 100).toFixed(1) })));
    const bankOpts: [string, string][] = banks.map((m) => [String(m), m === bank0 ? fill(C.scenarioMark, { v: bankLabel(m) }) : bankLabel(m)]);
    const cur = people[p.id] ?? {};
    adjust = el('details', { class: 'bf-adjust' }, [
      el('summary', {}, [icon('tune'), C.adjust]),
      el('div', { class: 'bf-adj-grid' }, [
        field(C.healthShort, select<Health>(cond.health[p.id] ?? 'good', healthOpts, (v) => set(() => (cond.health[p.id] = v)), `${p.name} ${C.healthShort}`)),
        field(C.gear, select<string>(cur.gear ?? 'asIs', gearOpts, (v) => set(() => (pc().gear = v === 'asIs' ? undefined : (v as GearPreset))), `${p.name} ${C.gear}`)),
        field(C.fitness, select<string>(String(cur.fitnessX ?? 1), fitOpts, (v) => set(() => (pc().fitnessX = Number(v) === 1 ? undefined : Number(v))), `${p.name} ${C.fitness}`)),
        hasPhone ? field(C.powerBank, select<string>(String(cur.powerBankMah ?? bank0), bankOpts, (v) => set(() => (pc().powerBankMah = Number(v) === bank0 ? undefined : Number(v))), `${p.name} ${C.powerBank}`)) : null,
        field(C.waterShort, select<string>(String(cur.waterL ?? p.gear.waterL), waterOpts, (v) => set(() => (pc().waterL = Number(v) === p.gear.waterL ? undefined : Number(v))), `${p.name} ${C.waterShort}`)),
      ]),
    ]);
    if (!isDefaultPerson(cur) || (cond.health[p.id] ?? 'good') !== 'good') (adjust as HTMLDetailsElement).open = true;
  }
  card.append(
    avatar(p, 64),
    el('div', { class: 'bf-who' }, [
      el('div', { class: 'bf-name' }, [el('strong', {}, p.name), el('span', {}, `${p.age}${B.yearsOld}`), p.leader ? el('span', { class: 'badge' }, B.leader) : null, p.role ? el('span', { class: 'role' }, p.role) : null]),
      chips,
      p.estimated?.length ? el('small', { class: 'estimated' }, `${JA.ui.estimated}: ${p.estimated.join(', ')}`) : null,
      adjust,
    ]),
  );
  repaint();
  return card;
}

/** 気象条件を変えて試すカード（天気・気温・季節。選ぶと cond を書き換える） */
export function weatherCard(cond: StartConditions): HTMLElement {
  const C = JA.conditions;
  const summary = el('p', { class: 'hint' });
  const refresh = (): void => {
    summary.textContent = isDefaultWeather(cond) ? C.asScenario : C.changedNote;
    card.classList.toggle('changed', !isDefaultWeather(cond));
  };
  const temp = el('input', { type: 'range', min: -10, max: 10, step: 1, value: cond.tempOffsetC, 'aria-label': C.temp }) as HTMLInputElement;
  const tempLabel = el('output', {}, '');
  const showTemp = (): void => {
    tempLabel.textContent = `${cond.tempOffsetC > 0 ? '+' : ''}${cond.tempOffsetC}℃`;
  };
  temp.addEventListener('input', () => {
    cond.tempOffsetC = Number(temp.value);
    showTemp();
    refresh();
  });
  showTemp();
  const row = (label: string, ctrl: HTMLElement | HTMLElement[]): HTMLElement => el('label', { class: 'bf-cond-row' }, [el('span', {}, label), ...(Array.isArray(ctrl) ? ctrl : [ctrl])]);
  const pick = <T extends string>(value: T, opts: [T, string][], setV: (v: T) => void, label: string): HTMLSelectElement =>
    select<T>(value, opts, (v) => {
      setV(v);
      refresh();
    }, label);
  const seasons: [SeasonOverride, string][] = [['asIs', C.asIs], ...(['spring', 'summer', 'autumn', 'winter'] as const).map((x): [SeasonOverride, string] => [x, JA.labels.season[x] ?? x])];
  const card = el('section', { class: 'bf-card bf-cond' }, [
    el('h2', {}, [icon('thermostat'), C.title]),
    row(C.weather, pick<WeatherOverride>(cond.weather, [['asIs', C.asIs], ['clear', C.w.clear], ['rain', C.w.rain], ['fog', C.w.fog], ['snow', C.w.snow], ['storm', C.w.storm]], (v) => (cond.weather = v), C.weather)),
    row(C.temp, [temp, tempLabel]),
    row(C.season, pick<SeasonOverride>(cond.season, seasons, (v) => (cond.season = v), C.season)),
    summary,
    el('p', { class: 'hint' }, C.personHint),
  ]);
  refresh();
  return card;
}
