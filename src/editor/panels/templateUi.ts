/**
 * テンプレートの入力欄: 天候（3 日間）・登山者（人数・性別・年代・経験からランダムに生成）・箱庭岳のステージ（コース）。
 * 各タブの欄と、新規作成のダイアログの欄。
 */
import type { ScenarioDef, ThunderCellDef, WeatherKeyframe } from '../../sim/types';
import { portraitCounts } from '../../ui/avatar';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { button, check, num, section, select } from '../forms/fields';
import type { NewProjectTemplates } from '../templates/apply';
import { applyWeatherTemplate } from '../templates/apply';
import { AGE_OPTIONS, danglingClimberRefs, generateParty, LEVEL_OPTIONS, SEX_OPTIONS, type PartyOpts } from '../templates/party';
import { applySeason, applyStage, HAKONIWA_STAGES, isHakoniwa, routeCourseMin, SEASON_OPTIONS } from '../templates/stages';
import { WEATHER_TEMPLATES, weatherFromTemplate, type WeatherTemplateId } from '../templates/weather';
import { parseHHMM } from '../../sim/core/clock';

type Season = ScenarioDef['season'];

let wt: WeatherTemplateId = 'breakAfternoon';
let wStrength = 1;
let wForecast = true;
let party: Omit<PartyOpts, 'season'> = { count: 3, sex: 'mix', age: 'mix', level: 'mix' };
let stageId = HAKONIWA_STAGES[0]!.id;
/** 生成のあとも欄を開いたままにする */
let partyOpen = false;

/** 天候タブの「テンプレート（3 日間）」。preview でタイムラインに重ねて見せる */
export function weatherTemplateSection(ed: Ed, preview: (g: { keyframes: WeatherKeyframe[]; cells: ThunderCellDef[] } | null) => void): HTMLElement {
  const s = ed.p.scenario;
  const make = (): { keyframes: WeatherKeyframe[]; cells: ThunderCellDef[] } =>
    weatherFromTemplate(wt, { season: s.season, refElevM: s.weather.refElevM, lapseRateCPer100m: s.weather.lapseRateCPer100m, sunriseMin: parseHHMM(s.sun.sunrise), s: wStrength, mapSizeM: ed.p.map.size });
  const hint = WEATHER_TEMPLATES.find((x) => x.id === wt)?.hint ?? '';
  const seasonLabel = SEASON_OPTIONS.find((x) => x[0] === s.season)?.[1] ?? s.season;
  return section('テンプレートから作る（3 日間）', [
    select('天候の推移', wt, WEATHER_TEMPLATES.map((x) => [x.id, x.label]), (v) => {
      wt = v;
      preview(make());
      ed.refresh();
    }),
    el('p', { class: 'note' }, hint),
    num('強さ', wStrength, (v) => {
      wStrength = v;
      preview(make());
    }, { min: 0.5, max: 1.5, step: 0.1, hint: '雨・風・冷え込みの倍率' }),
    check('予報も下書きし直す', wForecast, (v) => (wForecast = v)),
    el('div', {}, [
      button('プレビュー', () => preview(make())),
      button('タイムラインを置き換える', () => {
        preview(null);
        ed.change(`天候のテンプレート: ${WEATHER_TEMPLATES.find((x) => x.id === wt)?.label ?? wt}`, () => applyWeatherTemplate(ed.p.scenario, ed.p.map.size, wt, wStrength, wForecast));
        ed.toast('天候を置き換えました（元に戻すで戻せます）', 3000);
      }, 'primary'),
    ]),
    el('p', { class: 'note' }, `D0 00:00〜D3 00:00 のキーフレームを、季節（${seasonLabel}）の気温で作り直します。いまのキーフレームと雷雲セルは置き換わります。作ったあと「パターンを挿入」やキーフレームの編集で調整できます。`),
  ]);
}

function partyFields(get: () => Omit<PartyOpts, 'season'>, set: (p: Omit<PartyOpts, 'season'>) => void): HTMLElement[] {
  const p = get();
  return [
    num('人数', p.count, (v) => set({ ...get(), count: Math.round(v) }), { min: 1, max: 12, unit: '人' }),
    select('性別', p.sex, SEX_OPTIONS, (v) => set({ ...get(), sex: v })),
    select('年代', p.age, AGE_OPTIONS, (v) => set({ ...get(), age: v })),
    select('経験', p.level, LEVEL_OPTIONS, (v) => set({ ...get(), level: v })),
  ];
}

/** 人と計画タブの「登山者をテンプレートから作る」 */
export function partyTemplateSection(ed: Ed, opened: (i: number) => void): HTMLElement {
  const s = ed.p.scenario;
  return section('登山者をテンプレートから作る', [
    ...partyFields(() => party, (p) => (party = p)),
    el('div', {}, [
      button('生成して入れ替える', async () => {
        partyOpen = true;
        const counts = await portraitCounts();
        const next = generateParty({ ...party, season: s.season }, counts);
        const bad = danglingClimberRefs(s, next.map((c) => c.id));
        if (bad.length && !confirm(`分岐点・イベントなどが、いなくなる登山者（${bad.join('、')}）を参照しています。入れ替えますか？（元に戻すで戻せます）`)) return;
        ed.change('登山者のテンプレート', () => (ed.p.scenario.party = next));
        opened(0);
      }, 'primary'),
      button('条件に合う人を 1 人足す', async () => {
        partyOpen = true;
        const counts = await portraitCounts();
        const ids = new Set(s.party.map((c) => c.id));
        let k = s.party.length + 1;
        while (ids.has(`c${k}`)) k += 1;
        const [c] = generateParty({ ...party, count: 1, age: party.age === 'family' ? 'mix' : party.age, season: s.season }, counts, Math.random, { firstIndex: k, usedNames: s.party.map((x) => x.name), usedColors: s.party.map((x) => x.color) });
        if (!c) return;
        ed.change('登山者の追加', () => ed.p.scenario.party.push(c));
        opened(s.party.length - 1);
      }),
    ]),
    el('p', { class: 'note' }, '名前・顔アイコン・体重・体力・経験・装備をランダムに決めます。押すたびに違う顔ぶれになります。装備は季節と経験から選びます（冬の初心者は防寒が足りない装備）。'),
  ], partyOpen);
}

/** 人と計画タブの「箱庭岳のステージ」（箱庭岳のときだけ） */
export function stageSection(ed: Ed): HTMLElement | null {
  if (!isHakoniwa(ed.p.map)) return null;
  const st = HAKONIWA_STAGES.find((x) => x.id === stageId) ?? HAKONIWA_STAGES[0]!;
  const ct = routeCourseMin(ed.p.map, st.route);
  return section('箱庭岳のステージ（コース）', [
    select('コース', stageId, HAKONIWA_STAGES.map((x) => [x.id, x.label]), (v) => {
      stageId = v;
      ed.refresh();
    }),
    el('p', { class: 'note' }, `${st.hint}。コースタイム ${ct === null ? '—' : `${Math.floor(ct / 60)} 時間 ${ct % 60} 分`}`),
    button('このコースを計画にする', () => ed.change(`コース: ${st.label}`, () => applyStage(ed.p.scenario, ed.p.map, st)), 'primary'),
    el('p', { class: 'note' }, '計画のルート・下山口・予定下山時刻（コースタイム ×1.15）・家族が通報する時刻を置き換えます。'),
  ]);
}

/** 「季節に合わせる」ボタン（開始日・出発時刻・日の出入り） */
export function seasonButton(ed: Ed, season: Season): HTMLElement {
  return button('季節に合わせて開始日・出発時刻・日の出入りを変える', () => ed.change('季節', () => applySeason(ed.p.scenario, season, ed.p.map.geo?.centerLat, ed.p.map.geo?.centerLon)));
}

/** 新規作成のダイアログの欄。read() で選んだテンプレートを返す */
export function newProjectTemplateFields(): { el: HTMLElement; stageBox: HTMLElement; read(): NewProjectTemplates } {
  let season: Season = 'autumn';
  let weather: WeatherTemplateId | '' = 'fair3';
  let usePartyT = true;
  let p: Omit<PartyOpts, 'season'> = { count: 2, sex: 'mix', age: 'mix', level: 'mix' };
  let stage = HAKONIWA_STAGES[0]!.id;
  const stageBox = el('div', {}, [select('ステージ（コース）', stage, HAKONIWA_STAGES.map((x) => [x.id, x.label]), (v) => (stage = v))]);
  const partyBox = el('div', {}, partyFields(() => p, (v) => (p = v)));
  const box = el('div', { class: 'ed-templates' }, [
    el('h3', {}, 'テンプレート（後から各タブで変えられます）'),
    stageBox,
    select('季節', season, SEASON_OPTIONS, (v) => (season = v)),
    select<WeatherTemplateId | ''>('天候', weather, [...WEATHER_TEMPLATES.map((x) => [x.id, x.label] as [WeatherTemplateId, string]), ['', 'あとで決める（晴れの 1 点だけ）']], (v) => (weather = v)),
    check('登山者をテンプレートから作る', usePartyT, (v) => {
      usePartyT = v;
      partyBox.style.display = v ? '' : 'none';
    }),
    partyBox,
  ]);
  return { el: box, stageBox, read: () => ({ season, weather, stage, party: usePartyT ? { ...p, season } : null }) };
}
