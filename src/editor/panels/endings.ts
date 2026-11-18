/**
 * タブ 8 結末（docs/18 §4）: スクリプトイベント（条件＋効果）、思考テンプレート、結末（種類ごと・上から評価）、教訓（{rec.*} の候補）。
 */
import type { EndingDef, EndingKind, ScriptEffect, ScriptEventDef } from '../../sim/types';
import { JA } from '../../i18n/ja';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { actionEditor } from '../forms/ActionEditor';
import { conditionBuilder, summarize } from '../forms/ConditionBuilder';
import { area, button, check, fill, lines, num, section, select, text } from '../forms/fields';
import { firstTrueTime } from '../probe';
import { nextId } from '../store/project';
import type { Panel } from './types';

const KINDS: EndingKind[] = ['SAFE_RETURN', 'SAFE_SHELTER', 'ABORTED', 'SELF_RESCUE', 'RESCUED', 'RESCUED_CRITICAL', 'MISSING', 'FATAL'];
type EffType = ScriptEffect['type'];
const EFFECTS: [EffType, string][] = [
  ['log', 'ログに文を出す'],
  ['forecastUpdate', '予報の更新が届く'],
  ['setFlag', 'フラグを立てる'],
  ['clearFlag', 'フラグを消す'],
  ['actions', 'アクション'],
  ['triggerChoice', '分岐点を出す'],
  ['say', 'セリフ'],
  ['injure', 'けがをさせる'],
  ['rockfall', '落石'],
  ['soak', '濡れる'],
  ['weatherOverride', '天気を差し込む'],
  ['pin', '地図に印'],
];

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
    case 'soak':
      return { type: t, who: 'all', level: 'knees' };
    case 'weatherOverride':
      return { type: t, keyframe: structuredClone(s.weather.keyframes[0]!) };
    case 'pin':
      return { type: t, x: 0, z: 0, label: '' };
  }
}

function effectEditor(ed: Ed, list: ScriptEffect[], commit: (l: ScriptEffect[]) => void): HTMLElement {
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
        body = el('div', {}, [text('誰が（leader / any / ID / role:役割）', e.who, (v) => set({ who: v as typeof e.who })), text('文', e.text, (v) => set({ text: v }), { wide: true }), select('調子', e.tone ?? 'normal', [['normal', '普通'], ['shout', '叫ぶ'], ['whisper', '小声'], ['sound', '擬音']], (v) => set({ tone: v })), check('記録に残る発言（史実）', e.documented ?? false, (v) => set({ documented: v })), e.documented ? text('出典', e.source, (v) => set({ source: v })) : null].filter((x): x is HTMLElement => x !== null));
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
    return el('div', { class: 'f-section' }, [el('div', { class: 'cond-row' }, [el('small', {}, `${i + 1}.`), tsel, el('button', { class: 'small', onclick: () => commit(list.filter((_, j) => j !== i)) }, '✕')]), body]);
  });
  return el('div', {}, [...rows, button('+ 効果', () => commit([...list, defaultEffect('log', ed)]))]);
}

function eventEditor(ed: Ed, ev: ScriptEventDef, i: number): HTMLElement {
  const s = ed.p.scenario;
  const set = (label: string, f: () => void): void => ed.change(label, f);
  return el('details', { class: 'f-section' }, [
    el('summary', {}, `${ev.id}: ${summarize(ev.trigger, s, ed.p.map)}`),
    text('ID', ev.id, (v) => set('イベントの ID', () => (ev.id = v))),
    check('一度だけ', ev.once ?? true, (v) => set('一度だけ', () => (ev.once = v))),
    el('h4', {}, '発火条件'),
    conditionBuilder(ev.trigger, { scenario: s, map: ed.p.map, probe: (c) => firstTrueTime(ed, c) }, (c) => set('イベントの条件', () => (ev.trigger = c))),
    el('h4', {}, '効果'),
    effectEditor(ed, ev.effects, (l) => set('効果', () => (ev.effects = l))),
    button('このイベントを削除', () => set('イベントの削除', () => s.events.splice(i, 1))),
  ]);
}

export const endingsPanel: Panel = {
  id: 'endings',
  label: '結末',
  render(ed) {
    const s = ed.p.scenario;
    const set = (label: string, f: () => void): void => ed.change(label, f);
    const ctx = { scenario: s, map: ed.p.map };
    const recHint = el('p', { class: 'note' }, '教訓の文では {rec.rainwearDelayMin}・{rec.minCoreC}・{rec.lostMinutes}・{rec.fallCount}・{rec.deathCount} などの記録の値を使えます。');
    fill(
      ed.inspector,
      el('h2', {}, 'イベント・思考・結末・教訓'),
      section(`スクリプトイベント（${s.events.length}）`, [
        ...s.events.map((ev, i) => eventEditor(ed, ev, i)),
        button('イベントを足す', () => set('イベントの追加', () => s.events.push({ id: nextId(s.events.map((e) => e.id), 'ev'), trigger: { after: s.startAt }, once: true, effects: [{ type: 'log', text: '', important: true }] }))),
      ]),
      section(`思考（${s.thoughts?.length ?? 0}）`, [
        ...(s.thoughts ?? []).map((th, i) =>
          el('details', { class: 'f-section' }, [
            el('summary', {}, `${th.key}: ${th.lines[0] ?? ''}`),
            text('キー', th.key, (v) => set('思考のキー', () => (th.key = v))),
            num('優先度', th.priority ?? 0, (v) => set('優先度', () => (th.priority = v))),
            conditionBuilder(th.when, ctx, (c) => set('思考の条件', () => (th.when = c))),
            lines('文', th.lines, (v) => set('思考の文', () => (th.lines = v))),
            button('削除', () => set('思考の削除', () => s.thoughts!.splice(i, 1))),
          ]),
        ),
        button('思考を足す', () => set('思考の追加', () => (s.thoughts = [...(s.thoughts ?? []), { key: nextId((s.thoughts ?? []).map((t) => t.key), 'th'), when: { var: 'leader.coreC', op: '<', value: 35.5 }, lines: ['寒い……'] }]))),
      ], false),
      section(`セリフのテンプレート（${s.speech?.length ?? 0}）`, [
        el('p', { class: 'note' }, '条件に合うと、登山者が声に出して言います（行動は変えません）。'),
        ...(s.speech ?? []).map((sp, i) =>
          el('details', { class: 'f-section' }, [
            el('summary', {}, `${sp.key}: ${sp.lines[0] ?? ''}`),
            text('キー', sp.key, (v) => set('セリフのキー', () => (sp.key = v))),
            text('話し手（leader / any / ID / role:役割）', sp.who, (v) => set('話し手', () => (sp.who = v as typeof sp.who))),
            text('話しかける相手（任意）', sp.to ?? '', (v) => set('相手', () => (sp.to = (v || undefined) as typeof sp.to))),
            select('調子', sp.tone ?? 'normal', [['normal', '普通'], ['shout', '叫ぶ'], ['whisper', '小声'], ['sound', '擬音']], (v) => set('調子', () => (sp.tone = v))),
            num('優先度', sp.priority ?? 20, (v) => set('優先度', () => (sp.priority = v))),
            num('同じセリフの間隔', sp.cooldownMin ?? 60, (v) => set('間隔', () => (sp.cooldownMin = v)), { min: 0, unit: '分' }),
            check('一度だけ', sp.once ?? false, (v) => set('一度だけ', () => (sp.once = v))),
            conditionBuilder(sp.when, ctx, (c) => set('セリフの条件', () => (sp.when = c))),
            lines('セリフ', sp.lines, (v) => set('セリフ', () => (sp.lines = v))),
            sp.to ? lines('返事', sp.replies?.lines, (v) => set('返事', () => (sp.replies = { who: (sp.to ?? 'any') as typeof sp.who, lines: v }))) : null,
            button('削除', () => set('セリフの削除', () => s.speech!.splice(i, 1))),
          ]),
        ),
        button('セリフを足す', () => set('セリフの追加', () => (s.speech = [...(s.speech ?? []), { key: nextId((s.speech ?? []).map((x) => x.key), 'sp'), who: 'leader', when: { event: 'RAIN_START' }, lines: ['降ってきた'] }]))),
      ], false),
      section(`結末（${s.endings.length}）`, [
        el('p', { class: 'note' }, '同じ種類の結末は上から順に評価し、条件が合った最初の文を使います（条件なしは最後に置く）。どれも合わなければ既定の文です。'),
        ...s.endings.map((e: EndingDef, i: number) =>
          el('details', { class: 'f-section' }, [
            el('summary', {}, `${i + 1}. ${JA.endings[e.kind]?.title ?? e.kind}: ${e.title}${e.when ? '（条件つき）' : ''}`),
            select('種類', e.kind, KINDS.map((k) => [k, JA.endings[k]?.title ?? k]), (v) => set('結末の種類', () => (e.kind = v))),
            text('題', e.title, (v) => set('結末の題', () => (e.title = v)), { wide: true }),
            area('文', e.text, (v) => set('結末の文', () => (e.text = v)), 3),
            e.when ? conditionBuilder(e.when, ctx, (c) => set('結末の条件', () => (e.when = c))) : button('条件を付ける', () => set('結末の条件', () => (e.when = { var: 'rec.minCoreC', op: '<', value: 35 }))),
            e.when ? button('条件を外す', () => set('結末の条件', () => delete e.when)) : null,
            el('div', {}, [button('↑', () => i > 0 && set('並べ替え', () => s.endings.splice(i - 1, 0, s.endings.splice(i, 1)[0]!))), button('削除', () => set('結末の削除', () => s.endings.splice(i, 1)))]),
          ]),
        ),
        button('結末を足す', () => set('結末の追加', () => s.endings.push({ kind: 'SAFE_RETURN', title: '無事下山', text: '' }))),
      ]),
      section(`教訓（${s.lessons.length}）`, [
        recHint,
        ...s.lessons.map((l, i) =>
          el('details', { class: 'f-section' }, [
            el('summary', {}, `${l.id}: ${l.title}`),
            text('ID', l.id, (v) => set('教訓の ID', () => (l.id = v))),
            text('題', l.title, (v) => set('教訓の題', () => (l.title = v)), { wide: true }),
            area('文', l.text, (v) => set('教訓の文', () => (l.text = v)), 3),
            conditionBuilder(l.when, ctx, (c) => set('教訓の条件', () => (l.when = c))),
            button('削除', () => set('教訓の削除', () => s.lessons.splice(i, 1))),
          ]),
        ),
        button('教訓を足す', () => set('教訓の追加', () => s.lessons.push({ id: nextId(s.lessons.map((x) => x.id), 'l'), when: { var: 'rec.rainwearDelayMin', op: '>', value: 20 }, title: '', text: '' }))),
      ]),
    );
    ed.bottom.replaceChildren();
  },
};
