/**
 * タブ 5 人と計画（docs/18 §1〜2）: シナリオ情報（日の出入りの自動計算）、登山者カードと装備プリセット、計画ルートと予定時刻表。
 */
import { avatar, PORTRAIT_GROUPS, portraitCounts, portraitGroup, type PortraitGroup } from '../../ui/avatar';
import { formatTimeRef, parseTimeRef, scenarioStartMin } from '../../sim/core/clock';
import { legCourseTimeMin, resolveRoute } from '../../sim/terrain/trails';
import type { ClimberDef, GearDef, ScenarioDef, Theme } from '../../sim/types';

type Season = ScenarioDef['season'];
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { area, button, check, fill, num, section, select, slider, text, timeRef } from '../forms/fields';
import { hhmm, sunTimes } from '../geo/sunrise';
import { hitNode } from '../map/tools';
import { clickRouteNode, fixAmbiguousRoute } from '../map/routeClick';
import { routeList } from './routeList';
import type { MapTool } from '../map/TileMapView';
import { standardLegMin } from '../pace';
import { defaultClimber, pickColor } from '../store/project';
import type { Panel } from './types';
import { GEAR_PRESETS } from '../templates/party';
import { partyTemplateSection, seasonButton, stageSection } from './templateUi';

let routeMode = false;
let openCard = 0;


const words = {
  experience: (v: number): string => (v < 0.3 ? '数回' : v < 0.6 ? '数年・日帰り中心' : v < 0.85 ? '積雪期も行く' : 'ガイド級'),
  fitness: (v: number): string => (v < 0.8 ? '体力に自信がない' : v < 1.05 ? '標準' : v < 1.2 ? '健脚' : 'とても健脚'),
  navSkill: (v: number): string => (v < 0.3 ? '地図はほぼ読めない' : v < 0.6 ? '道標頼り' : v < 0.85 ? '地図とコンパスが使える' : '読図に強い'),
  riskTolerance: (v: number): string => (v < 0.3 ? '慎重' : v < 0.6 ? 'ふつう' : v < 0.8 ? '行けると思えば行く' : '強行しがち'),
  delays: (v: number): string => (v < 0.2 ? 'すぐ着る' : v < 0.5 ? '少し迷う' : '着るのを先延ばし'),
};

const GROUP_LABEL: Record<PortraitGroup, string> = { child_m: '子供・男', child_f: '子供・女', young_m: '若者・男', young_f: '若者・女', mid_m: '中年・男', mid_f: '中年・女', senior_m: '高齢・男', senior_f: '高齢・女' };

/** 顔アイコンを選ぶ欄。「自動」は年齢・性別と ID から選ぶ。年齢・性別に合う区分を先に出す */
function portraitPicker(c: ClimberDef, set: (v: string | undefined) => void): HTMLElement {
  const grid = el('div', { class: 'portrait-grid' });
  const auto = el('button', { type: 'button', class: `portrait-opt auto${c.portrait ? '' : ' on'}`, title: '年齢・性別から自動で選ぶ' }, [avatar({ ...c, portrait: undefined }, 60), el('small', {}, '自動')]);
  auto.addEventListener('click', () => set(undefined));
  void portraitCounts().then((counts) => {
    if (!counts) {
      grid.append(el('p', { class: 'hint' }, '顔アイコンの画像がありません（tools/make-portraits.py で作れます）'));
      return;
    }
    const mine = portraitGroup(c);
    const order = [mine, ...PORTRAIT_GROUPS.filter((g) => g !== mine)];
    for (const g of order) {
      const n = counts[g] ?? 0;
      if (n === 0) continue;
      const items = Array.from({ length: n }, (_, k) => {
        const v = `${g}:${k + 1}`;
        const b = el('button', { type: 'button', class: `portrait-opt${c.portrait === v ? ' on' : ''}`, title: `${GROUP_LABEL[g]} ${k + 1}` }, avatar({ ...c, portrait: v }, 60));
        b.addEventListener('click', () => set(v));
        return b;
      });
      grid.append(el('details', { class: 'portrait-group', open: g === mine || c.portrait?.startsWith(`${g}:`) }, [el('summary', {}, GROUP_LABEL[g] + (g === mine ? '（年齢・性別に合う）' : '')), el('div', { class: 'portrait-row' }, items)]));
    }
  });
  return el('div', { class: 'f-row portrait-pick' }, [el('span', { class: 'f-label' }, '顔アイコン'), el('div', {}, [auto, grid])]);
}

function climberCard(ed: Ed, c: ClimberDef, i: number): HTMLElement {
  const set = (label: string, f: () => void): void => ed.change(label, f);
  const g = c.gear;
  const presetSel = el('select', {}, [el('option', { value: '' }, '装備プリセット…'), ...Object.keys(GEAR_PRESETS).map((k) => el('option', { value: k }, k))]);
  presetSel.addEventListener('change', () => presetSel.value && set('装備プリセット', () => (c.gear = GEAR_PRESETS[presetSel.value]!(c.gear))));
  // 開いたカードを覚えて描き直しても開いたままにする。閉じたら忘れる（忘れないと、ほかのボタンで描き直したときにまた開く）
  const ontoggle = (e: Event): void => {
    if (e.target !== e.currentTarget) return;
    if ((e.target as HTMLDetailsElement).open) openCard = i;
    else if (openCard === i) openCard = -1;
  };
  return el('details', { class: 'f-section', open: openCard === i, ontoggle }, [
    el('summary', { class: 'climber-sum' }, [avatar(c, 39), `${c.name}（${c.age}歳）${c.leader ? ' リーダー' : ''}`]),
    portraitPicker(c, (v) => set('顔アイコン', () => (c.portrait = v))),
    text('名前', c.name, (v) => set('名前', () => (c.name = v))),
    text('ID', c.id, (v) => /^[a-z][a-z0-9_]*$/i.test(v) && set('ID', () => {
      const old = c.id;
      ed.p.scenario = JSON.parse(JSON.stringify(ed.p.scenario).split(`"${old}"`).join(`"${v}"`)) as typeof ed.p.scenario;
    })),
    text('役割', c.role ?? '', (v) => set('役割', () => (c.role = v || undefined))),
    num('年齢', c.age, (v) => set('年齢', () => (c.age = v)), { min: 10, max: 90 }),
    select('性別', c.sex, [['m', '男性'], ['f', '女性']], (v) => set('性別', () => (c.sex = v))),
    num('体重', c.weightKg, (v) => set('体重', () => (c.weightKg = v)), { min: 30, max: 120, unit: 'kg' }),
    num('荷物', c.packKg, (v) => set('荷物', () => (c.packKg = v)), { min: 0, max: 30, unit: 'kg' }),
    slider('経験', c.experience, (v) => set('経験', () => (c.experience = v)), { min: 0, max: 1, step: 0.05, words: words.experience }),
    slider('体力', c.fitness, (v) => set('体力', () => (c.fitness = v)), { min: 0.5, max: 1.3, step: 0.05, words: words.fitness }),
    slider('読図力', c.navSkill, (v) => set('読図力', () => (c.navSkill = v)), { min: 0, max: 1, step: 0.05, words: words.navSkill }),
    slider('危険を許す', c.riskTolerance, (v) => set('危険を許す', () => (c.riskTolerance = v)), { min: 0, max: 1, step: 0.05, words: words.riskTolerance }),
    slider('雨具を先延ばし', c.habits.delaysRainwear, (v) => set('習慣', () => (c.habits.delaysRainwear = v)), { min: 0, max: 1, step: 0.05, words: words.delays }),
    num('食べる間隔', c.habits.eatEveryMin, (v) => set('習慣', () => (c.habits.eatEveryMin = v || null)), { min: 0, unit: '分（0 = 食べない）' }),
    num('飲む間隔', c.habits.drinkEveryMin, (v) => set('習慣', () => (c.habits.drinkEveryMin = v || null)), { min: 0, unit: '分' }),
    check('リーダー', c.leader ?? false, (v) => set('リーダー', () => ed.p.scenario.party.forEach((p) => (p.leader = v ? p === c : Boolean(p.leader) && p !== c)))),
    section('装備', [
      presetSel,
      select('雨具', g.rainwear, [['none', 'なし'], ['poncho', 'ポンチョ'], ['basic', '普通'], ['goretex', '透湿防水']], (v) => set('雨具', () => (g.rainwear = v))),
      num('着ている服', g.cloWorn, (v) => set('服', () => (g.cloWorn = v)), { min: 0.3, max: 3, step: 0.1, unit: 'clo' }),
      num('予備の防寒着', g.cloPack, (v) => set('服', () => (g.cloPack = v)), { min: 0, max: 3, step: 0.1, unit: 'clo' }),
      select('手袋', g.gloves, [['none', 'なし'], ['thin', '薄手'], ['waterproof', '防水']], (v) => set('手袋', () => (g.gloves = v))),
      select('ツェルト', g.bivy, [['none', 'なし'], ['tarp', 'タープ'], ['sack', 'ツェルト']], (v) => set('ツェルト', () => (g.bivy = v))),
      check('帽子', g.hat, (v) => set('帽子', () => (g.hat = v))),
      check('ヘッドランプ', g.headlamp.has, (v) => set('ヘッドランプ', () => (g.headlamp.has = v))),
      check('ヘッドランプはザックの奥', g.headlamp.inPack, (v) => set('ヘッドランプ', () => (g.headlamp.inPack = v))),
      num('予備電池', g.headlamp.spareBatteryH, (v) => set('電池', () => (g.headlamp.spareBatteryH = v)), { min: 0, unit: '時間' }),
      check('スマホ', g.phone.has, (v) => set('スマホ', () => (g.phone.has = v))),
      num('スマホの電池', g.phone.batteryPct, (v) => set('スマホ', () => (g.phone.batteryPct = v)), { min: 0, max: 100, unit: '%' }),
      check('地図アプリ', g.phone.gpsApp, (v) => set('スマホ', () => (g.phone.gpsApp = v))),
      check('衛星 SOS', g.phone.satelliteSos, (v) => set('スマホ', () => (g.phone.satelliteSos = v))),
      check('紙の地図', g.map, (v) => set('地図', () => (g.map = v))),
      check('コンパス', g.compass, (v) => set('コンパス', () => (g.compass = v))),
      num('食料', g.foodKcal, (v) => set('食料', () => (g.foodKcal = v)), { min: 0, step: 100, unit: 'kcal' }),
      num('水', g.waterL, (v) => set('水', () => (g.waterL = v)), { min: 0, step: 0.1, unit: 'L' }),
      check('笛', g.whistle, (v) => set('笛', () => (g.whistle = v))),
      check('ココヘリ', g.cocoheli === true, (v) => set('ココヘリ', () => (g.cocoheli = v))),
      check('アイゼン', g.crampons, (v) => set('アイゼン', () => (g.crampons = v))),
      check('ヘルメット', g.helmet, (v) => set('ヘルメット', () => (g.helmet = v))),
    ], false),
    ed.p.scenario.party.length > 1 ? button('この登山者を削除', () => set('登山者の削除', () => ed.p.scenario.party.splice(i, 1))) : null,
  ]);
}

/** ルートの区間ごとの予定時刻表（コースタイムと試算） */
function legTable(ed: Ed): HTMLElement {
  const rt = ed.runtime();
  const s = ed.p.scenario;
  if (!rt) return el('p');
  let legs;
  try {
    legs = resolveRoute(rt, s.plan.route);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    return el('div', {}, [
      el('p', { class: 'error' }, msg),
      msg.includes('一意に決まりません') ? button('自動で決める（短いほうの道に経由点を足して通す）', () => fixAmbiguousRoute(ed), 'primary') : null,
    ]);
  }
  let t = scenarioStartMin(s);
  let ts = t;
  const rows = legs.map((l) => {
    const ct = legCourseTimeMin(rt, l);
    const sim = standardLegMin(rt, l.edgeId, l.dir) / (rt.trails[l.edgeId]?.def.paceAdj ?? 1);
    t += ct;
    ts += sim * 1.15;
    return el('tr', {}, [rt.nodes[l.from]?.name || l.from, rt.nodes[l.to]?.name || l.to, `${Math.round(ct)} 分`, `${Math.round(sim)} 分`, formatTimeRef(ts)].map((x) => el('td', {}, x)));
  });
  return el('div', {}, [
    el('table', { class: 'ed-table' }, [el('tr', {}, ['から', 'まで', 'コースタイム', '試算', '予定（休憩込み）'].map((x) => el('th', {}, x))), ...rows]),
    button(`予定下山時刻を提案（${formatTimeRef(Math.ceil(ts / 30) * 30)}）`, () => ed.change('予定下山', () => (s.plan.plannedFinish = formatTimeRef(Math.ceil(ts / 30) * 30)))),
  ]);
}

function routeTool(ed: Ed): MapTool | null {
  if (!routeMode) return null;
  return {
    cursor: 'crosshair',
    click(p) {
      const n = hitNode(ed.view, ed.p.map, p.px, p.py);
      if (n) clickRouteNode(ed, n);
    },
  };
}

export const partyPanel: Panel = {
  id: 'party',
  label: '人と計画',
  tool: routeTool,
  render(ed) {
    const s = ed.p.scenario;
    const set = (label: string, f: () => void): void => ed.change(label, f);
    const geo = ed.p.map.geo;
    const lat = geo?.centerLat ?? 36;
    const lon = geo?.centerLon ?? 138;
    const plan = s.plan;
    const nodeName = (id: string): string => ed.p.map.nodes.find((n) => n.id === id)?.name || id;
    fill(
      ed.inspector,
      el('h2', {}, '人と計画'),
      section('シナリオ情報', [
        text('題名', s.title, (v) => set('題名', () => (s.title = v))),
        text('副題', s.subtitle ?? '', (v) => set('副題', () => (s.subtitle = v))),
        text('ID', s.id, (v) => /^[A-Za-z0-9_]+$/.test(v) && set('ID', () => (s.id = v))),
        select<Theme>('テーマ', s.theme, [['hypothermia', '低体温症'], ['lost', '道迷い'], ['lightning', '落雷'], ['fall', '転倒・滑落'], ['heat', '熱中症'], ['mixed', '複合']], (v) => set('テーマ', () => (s.theme = v))),
        num('難易度', s.difficulty, (v) => set('難易度', () => (s.difficulty = v as typeof s.difficulty)), { min: 1, max: 5 }),
        select<Season>('季節', s.season, [['spring', '春'], ['summer', '夏'], ['autumn', '秋'], ['winter', '冬']], (v) => set('季節', () => (s.season = v))),
        seasonButton(ed, s.season),
        num('所要時間の目安', s.estMinutes, (v) => set('所要時間', () => (s.estMinutes = v)), { min: 1, unit: '分' }),
        num('乱数シード', s.seed, (v) => set('シード', () => (s.seed = v))),
        text('開始日', s.startDate, (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && set('開始日', () => (s.startDate = v)), { placeholder: '2026-10-17' }),
        timeRef('開始時刻', s.startAt, (v) => set('開始時刻', () => (s.startAt = v))),
        timeRef('制限時刻', s.timeLimit, (v) => set('制限時刻', () => (s.timeLimit = v))),
        text('日の出', s.sun.sunrise, (v) => set('日の出', () => (s.sun.sunrise = v))),
        text('日の入り', s.sun.sunset, (v) => set('日の入り', () => (s.sun.sunset = v))),
        button('日の出・日の入りを計算する', () => {
          const t = sunTimes(s.startDate, lat, lon);
          set('日の出入り', () => (s.sun = { ...s.sun, sunrise: hhmm(t.sunriseMin), sunset: hhmm(t.sunsetMin) }));
        }),
        num('月の明るさ', s.moon?.illumination ?? 0.5, (v) => set('月', () => (s.moon = { illumination: v })), { min: 0, max: 1, step: 0.1 }),
        text('地域の表示', s.region?.name ?? '', (v) => set('地域', () => (s.region = v ? { name: v, real: s.region?.real ?? Boolean(geo) } : undefined))),
        check('実在の山', s.region?.real ?? false, (v) => set('実在', () => (s.region = { name: s.region?.name ?? ed.p.name, real: v }))),
        el('p', { class: 'note' }, '実在の遭難事故をなぞる場合でも、登場人物は架空にし、実名や個人を特定できる記述は使わないでください。'),
        area('ブリーフィングの文', s.briefing.text, (v) => set('ブリーフィング', () => (s.briefing.text = v)), 4),
      ], false),
      partyTemplateSection(ed, (i) => (openCard = i)),
      section(`登山者（${s.party.length} 人）`, [
        ...s.party.map((c, i) => climberCard(ed, c, i)),
        button('登山者を追加', () => set('登山者の追加', () => {
          const id = `c${s.party.length + 1}`;
          s.party.push(defaultClimber(id, `登山者${String.fromCharCode(65 + s.party.length)}`, pickColor(s.party.map((p) => p.color)), false));
          openCard = s.party.length - 1;
        })),
      ]),
      stageSection(ed),
      section('計画', [
        routeList(ed),
        button(routeMode ? 'ルートを引くのをやめる' : '地図でルートを引く（地点を順にクリック）', () => {
          routeMode = !routeMode;
          ed.refresh();
        }),
        button('ルートを空にする', () => set('ルート', () => (plan.route = []))),
        button('最後の地点を取り消す', () => set('ルート', () => (plan.route = plan.route.slice(0, -1)))),
        text('下山口（ID を空白区切り）', plan.goalNodes.join(' '), (v) => set('下山口', () => (plan.goalNodes = v.split(/\s+/).filter(Boolean)))),
        timeRef('予定下山時刻', plan.plannedFinish, (v) => set('予定下山', () => (plan.plannedFinish = v))),
        check('計画書を出した', plan.submittedPlan, (v) => set('計画書', () => (plan.submittedPlan = v))),
        timeRef('家族が通報する時刻', plan.reportIfNotBackBy, (v) => set('通報時刻', () => (plan.reportIfNotBackBy = v))),
        legTable(ed),
      ]),
    );
    ed.bottom.replaceChildren();
    void parseTimeRef;
  },
};
