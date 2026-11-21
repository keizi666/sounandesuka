/**
 * できごと・心の声・セリフ・結末・教訓のくわしい設定（docs/18 §4）。物語のタブ（story.ts）の「くわしい設定」から使う。
 */
import type { EndingKind, ScriptEffect, ScriptEventDef } from '../../sim/types';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { JA } from '../../i18n/ja';
import { actionEditor, plainActions } from '../forms/ActionEditor';
import { animalEffectEditor, animalLeaveEditor } from '../forms/animalEffect';
import { conditionBuilder } from '../forms/ConditionBuilder';
import { button, check, lines, num, select, text } from '../forms/fields';
import { firstTrueTime } from '../probe';

export const ENDING_KINDS: EndingKind[] = ['SAFE_RETURN', 'SAFE_SHELTER', 'ABORTED', 'SELF_RESCUE', 'RESCUED', 'RESCUED_CRITICAL', 'MISSING', 'FATAL'];
type EffType = ScriptEffect['type'];
const EFFECTS: [EffType, string][] = [
  ['log', 'ナレーション（ログに文を出す）'],
  ['forecastUpdate', '予報の更新が届く'],
  ['setFlag', '目印（フラグ）を立てる'],
  ['clearFlag', '目印（フラグ）を消す'],
  ['actions', '登山者に行動させる'],
  ['triggerChoice', '分かれ道を出す'],
  ['say', 'セリフを言う'],
  ['injure', 'けがをさせる'],
  ['rockfall', '落石'],
  ['fall', '滑落する'],
  ['fillWater', '水を汲む'],
  ['heatIllness', '熱中症になる'],
  ['soak', '濡れる'],
  ['weatherOverride', '天気を差し込む'],
  ['pin', '地図に印'],
  ['animal', '動物が出る（熊・鹿など）'],
  ['animalLeave', '動物が立ち去る'],
];

/** 起きることを 1 行ずつの言葉にする（カードに出す） */
export function plainEffects(list: ScriptEffect[], ed: Ed): string[] {
  const who = (w: string): string => (w === 'leader' ? 'リーダー' : w === 'all' ? '全員' : w === 'any' ? 'だれか' : ed.p.scenario.party.find((c) => c.id === w)?.name ?? w);
  return list.map((e) => {
    switch (e.type) {
      case 'log':
        return `📝 ${e.text}`;
      case 'say':
        return `💬 ${who(e.who)}「${e.text}」`;
      case 'forecastUpdate':
        return `📻 予報が届く: ${e.entries.map((x) => `${x.label} ${x.text}`).join('、')}`;
      case 'injure':
        return `🩹 ${who(e.who)}が${INJURIES.find((x) => x[0] === e.injury)?.[1] ?? 'けが'}`;
      case 'rockfall':
        return `🪨 落石（${Math.round(e.p * 100)}% で当たる）`;
      case 'soak':
        return `💧 ${who(e.who)}が${SOAKS.find((x) => x[0] === e.level)?.[1] ?? ''}濡れる`;
      case 'actions':
        return `▶ ${plainActions(e.actions, ed.p.map)}`;
      case 'triggerChoice':
        return `🔀 分かれ道「${ed.p.scenario.choices.find((c) => c.id === e.cp)?.title ?? e.cp}」を出す`;
      case 'animal':
        return `🐾 ${JA.log.animal[e.species] ?? e.species}が出る`;
      case 'setFlag':
      case 'clearFlag':
        return '';
      default:
        return EFFECTS.find((x) => x[0] === e.type)?.[1] ?? e.type;
    }
  }).filter(Boolean);
}

function defaultEffect(t: EffType, ed: Ed): ScriptEffect {
  const s = ed.p.scenario;
  switch (t) {
    case 'log':
      return { type: t, text: '', important: true };
    case 'forecastUpdate':
      return { type: t, entries: [{ label: '午後', text: '雨' }], requiresSignal: true };
    case 'setFlag':
    case 'clearFlag':
      return { type: t, flag: 'flag' };
    case 'actions':
      return { type: t, actions: [{ type: 'rest', minutes: 10 }] };
    case 'triggerChoice':
      return { type: t, cp: s.choices[0]?.id ?? '' };
    case 'say':
      return { type: t, who: 'leader', text: '' };
    case 'injure':
      return { type: t, who: 'leader', injury: 'sprain' };
    case 'rockfall':
      return { type: t, who: 'leader', p: 0.3, injuryTable: 'T2' };
    case 'fall':
      return { type: t, who: 'any', outcomes: { bruise: 0.5, sprain: 0.4, legFracture: 0.1 } };
    case 'fillWater':
      return { type: t, who: 'all', toL: 2 };
    case 'heatIllness':
      return { type: t, who: 'leader' };
    case 'soak':
      return { type: t, who: 'all', level: 'knees' };
    case 'weatherOverride':
      return { type: t, keyframe: structuredClone(s.weather.keyframes[0]!) };
    case 'pin':
      return { type: t, x: 0, z: 0, label: '' };
    case 'animal':
      return { type: t, species: 'deer', count: 2, aheadM: 50, sideM: 15 };
    case 'animalLeave':
      return { type: t };
  }
}

/** 「だれが」を選ぶ欄（リーダー・全員／だれか・登山者の名前）。役割（role:…）などの書き方はそのまま残す */
export function whoSelect(ed: Ed, value: string, set: (v: string) => void, extra: 'all' | 'any'): HTMLSelectElement {
  const opts: [string, string][] = [['leader', 'リーダー'], extra === 'all' ? ['all', '全員'] : ['any', 'だれか（近くの人）'], ...ed.p.scenario.party.map((c) => [c.id, c.name] as [string, string])];
  if (!opts.some((o) => o[0] === value)) opts.push([value, value]);
  const sel = el('select', {}, opts.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
  sel.addEventListener('change', () => set(sel.value));
  return sel;
}
const INJURIES: [string, string][] = [['bruise', '打ち身'], ['sprain', 'ねんざ'], ['legFracture', '足の骨折'], ['headInjury', '頭のけが'], ['severeTrauma', '重いけが']];
const SOAKS: [string, string][] = [['feet', '足首まで'], ['knees', '膝まで'], ['waist', '腰まで'], ['full', '全身']];
const pick = (value: string, opts: [string, string][], set: (v: string) => void): HTMLSelectElement => {
  const sel = el('select', {}, opts.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
  sel.addEventListener('change', () => set(sel.value));
  return sel;
};

export function effectEditor(ed: Ed, list: ScriptEffect[], commit: (l: ScriptEffect[]) => void): HTMLElement {
  const s = ed.p.scenario;
  const rows = list.map((e, i) => {
    const set = (patch: Partial<ScriptEffect> | ScriptEffect): void => {
      const n = [...list];
      n[i] = { ...e, ...patch } as ScriptEffect;
      commit(n);
    };
    const tsel = el('select', {}, EFFECTS.map(([v, l]) => el('option', { value: v, selected: v === e.type }, l)));
    tsel.addEventListener('change', () => set(defaultEffect(tsel.value as EffType, ed)));
    let body: HTMLElement;
    switch (e.type) {
      case 'log':
        body = el('div', {}, [text('文', e.text, (v) => set({ text: v }), { wide: true }), check('重要', e.important ?? false, (v) => set({ important: v }))]);
        break;
      case 'forecastUpdate':
        body = el('div', {}, [lines('予報（「ラベル: 文」）', e.entries.map((x) => `${x.label}: ${x.text}`), (v) => set({ entries: v.map((l) => ({ label: l.split(':')[0]!.trim(), text: l.split(':').slice(1).join(':').trim() })) })), check('電波が必要', e.requiresSignal ?? false, (v) => set({ requiresSignal: v }))]);
        break;
      case 'setFlag':
      case 'clearFlag':
        body = text('フラグ', e.flag, (v) => set({ flag: v }));
        break;
      case 'actions':
        body = actionEditor(e.actions, s, ed.p.map, (a) => set({ actions: a }));
        break;
      case 'triggerChoice':
        body = select('分岐点', e.cp, s.choices.map((c) => [c.id, c.title || c.id]), (v) => set({ cp: v }));
        break;
      case 'say':
        body = el('div', {}, [el('div', { class: 'cond-row' }, ['だれが', whoSelect(ed, e.who, (v) => set({ who: v as typeof e.who }), 'any')]), text('セリフ', e.text, (v) => set({ text: v }), { wide: true }), select('調子', e.tone ?? 'normal', [['normal', '普通'], ['shout', '叫ぶ'], ['whisper', '小声'], ['sound', '擬音']], (v) => set({ tone: v })), check('記録に残る発言（史実）', e.documented ?? false, (v) => set({ documented: v })), e.documented ? text('出典', e.source, (v) => set({ source: v })) : null].filter((x): x is HTMLElement => x !== null));
        break;
      case 'injure':
        body = el('div', { class: 'cond-row' }, ['だれが', whoSelect(ed, e.who, (v) => set({ who: v }), 'all'), 'どんなけが', pick(e.injury, INJURIES, (v) => set({ injury: v as typeof e.injury }))]);
        break;
      case 'soak':
        body = el('div', { class: 'cond-row' }, ['だれが', whoSelect(ed, e.who, (v) => set({ who: v }), 'all'), 'どこまで', pick(e.level, SOAKS, (v) => set({ level: v as typeof e.level }))]);
        break;
      case 'rockfall': {
        const pct = el('input', { type: 'number', min: 0, max: 100, step: 5, value: Math.round(e.p * 100), style: 'width:4.5em' });
        pct.addEventListener('change', () => set({ p: Math.max(0, Math.min(100, Number(pct.value))) / 100 }));
        body = el('div', { class: 'cond-row' }, ['だれに', whoSelect(ed, e.who, (v) => set({ who: v }), 'all'), '当たる確率', pct, '%']);
        break;
      }
      case 'animal':
        body = animalEffectEditor(e, ed.p.map, (patch) => set(patch));
        break;
      case 'animalLeave':
        body = animalLeaveEditor(e, (patch) => set(patch));
        break;
      default: {
        // その他は JSON で
        const t = el('textarea', { class: 'mono', rows: 4, style: 'min-height:0' });
        t.value = JSON.stringify(e, null, 1);
        t.addEventListener('change', () => {
          try {
            set(JSON.parse(t.value) as ScriptEffect);
          } catch (err) {
            ed.toast(`JSON の誤り: ${String(err)}`);
          }
        });
        body = t;
      }
    }
    return el('div', { class: 'f-section' }, [el('div', { class: 'cond-row' }, [el('small', {}, `${i + 1}.`), tsel, el('button', { class: 'small', disabled: i === 0, title: '上へ', onclick: () => commit(list.map((_, j) => list[j === i - 1 ? i : j === i ? i - 1 : j]!)) }, '↑'), el('button', { class: 'small', onclick: () => commit(list.filter((_, j) => j !== i)) }, '✕')]), body]);
  });
  return el('div', {}, [...rows, button('＋ 起きることを足す', () => commit([...list, defaultEffect('log', ed)]))]);
}

/** できごとのくわしい設定 */
export function eventDetail(ed: Ed, ev: ScriptEventDef): HTMLElement[] {
  const s = ed.p.scenario;
  const set = (label: string, f: () => void): void => ed.change(label, f);
  return [
    text('ID', ev.id, (v) => set('イベントの ID', () => (ev.id = v))),
    check('一度だけ', ev.once ?? true, (v) => set('一度だけ', () => (ev.once = v))),
    el('h4', {}, '起きる条件'),
    conditionBuilder(ev.trigger, { scenario: s, map: ed.p.map, probe: (c) => firstTrueTime(ed, c) }, (c) => set('イベントの条件', () => (ev.trigger = c))),
  ];
}

/** 心の声のくわしい設定 */
export function thoughtDetail(ed: Ed, i: number): HTMLElement[] {
  const th = ed.p.scenario.thoughts![i]!;
  const set = (label: string, f: () => void): void => ed.change(label, f);
  return [
    text('キー', th.key, (v) => set('思考のキー', () => (th.key = v))),
    num('優先度', th.priority ?? 0, (v) => set('優先度', () => (th.priority = v))),
    conditionBuilder(th.when, { scenario: ed.p.scenario, map: ed.p.map }, (c) => set('思考の条件', () => (th.when = c))),
  ];
}

/** セリフのくわしい設定 */
export function speechDetail(ed: Ed, i: number): HTMLElement[] {
  const sp = ed.p.scenario.speech![i]!;
  const set = (label: string, f: () => void): void => ed.change(label, f);
  return [
    text('キー', sp.key, (v) => set('セリフのキー', () => (sp.key = v))),
    text('話し手（leader / any / ID / role:役割）', sp.who, (v) => set('話し手', () => (sp.who = v as typeof sp.who))),
    text('話しかける相手（任意）', sp.to ?? '', (v) => set('相手', () => (sp.to = (v || undefined) as typeof sp.to))),
    select('調子', sp.tone ?? 'normal', [['normal', '普通'], ['shout', '叫ぶ'], ['whisper', '小声'], ['sound', '擬音']], (v) => set('調子', () => (sp.tone = v))),
    num('優先度', sp.priority ?? 20, (v) => set('優先度', () => (sp.priority = v))),
    num('同じセリフの間隔', sp.cooldownMin ?? 60, (v) => set('間隔', () => (sp.cooldownMin = v)), { min: 0, unit: '分' }),
    conditionBuilder(sp.when, { scenario: ed.p.scenario, map: ed.p.map }, (c) => set('セリフの条件', () => (sp.when = c))),
  ];
}

/** 結末・教訓の条件のくわしい設定 */
export function whenDetail(ed: Ed, o: { when?: import('../../sim/types').Condition }, label: string): HTMLElement[] {
  const set = (f: () => void): void => ed.change(label, f);
  return o.when
    ? [conditionBuilder(o.when, { scenario: ed.p.scenario, map: ed.p.map }, (c) => set(() => (o.when = c))), button('条件を外す（いつも）', () => set(() => delete o.when))]
    : [button('条件を付ける', () => set(() => (o.when = { var: 'rec.minCoreC', op: '<', value: 35 })))];
}
