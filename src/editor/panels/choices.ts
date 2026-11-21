/**
 * タブ 7 分岐点（docs/18 §3）: 一覧（発火条件の要約・選択肢数・推奨の有無・直近の試走での発火）、分岐点の編集
 * （状況の文と変数の候補・展開プレビュー、把握していること、条件ビルダー、選択肢とアクション・バイアス）、テンプレート、汎用分岐点の上書き。
 */
import { partyLeader } from '../../sim/climber/party';
import { expandText } from '../../sim/scenario/text';
import { resolveVar } from '../../sim/scenario/vars';
import type { ChoiceOptionDef, ChoicePointDef, Condition, GenericChoiceKey } from '../../sim/types';
import { JA } from '../../i18n/ja';
import { TEXT_LABELS } from '../../i18n/format';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { actionEditor } from '../forms/ActionEditor';
import { conditionBuilder, summarize } from '../forms/ConditionBuilder';
import { area, button, check, fill, lines, num, keptDetails, section, text } from '../forms/fields';
import { varGroups } from '../forms/varPaths';
import { firstTrueTime, worldAtChoice } from '../probe';
import { nextId } from '../store/project';
import type { Panel } from './types';

const GENERICS: GenericChoiceKey[] = ['lostAware', 'darkness', 'hypothermia', 'injured', 'lightning', 'waterfall', 'straggler', 'rescueFailed'];
let previewText = '';

/** テンプレート（docs/18 §9） */
function fromTemplate(ed: Ed, kind: 'turnaround' | 'rainwear' | 'hut'): ChoicePointDef {
  const s = ed.p.scenario;
  const id = nextId(s.choices.map((c) => c.id), 'cp');
  const route = s.plan.route;
  const mid = route[Math.floor(route.length / 2)] ?? route[0] ?? '';
  const hut = ed.p.map.nodes.find((n) => n.shelter && route.includes(n.id))?.id ?? ed.p.map.nodes.find((n) => n.shelter)?.id ?? mid;
  const opt = (oid: string, label: string, actions: ChoiceOptionDef['actions'], tags: ChoiceOptionDef['tags'], base: number): ChoiceOptionDef => ({ id: oid, label, actions, tags, bias: { base } });
  if (kind === 'turnaround')
    return {
      id,
      title: '引き返し判断',
      trigger: { atNode: mid },
      situation: '{leader.def.name}さんは分岐に着いた。風 {leader.local.windMs} m/s、体感 {leader.local.windChillC}℃。',
      options: [
        opt('go', '予定どおり進む', [{ type: 'continueRoute' }], ['risky'], 1),
        opt('back', '引き返す', [{ type: 'turnBack' }], ['recommended'], 0.5),
        opt('hut', '近くの小屋へ向かう', [{ type: 'goToNode', node: hut, then: 'stay' }], [], 0.4),
      ],
    };
  if (kind === 'rainwear')
    return {
      id,
      title: '雨が降り始めた',
      trigger: { all: [{ event: 'RAIN_START' }, { var: 'leader.rainwearOn', op: '==', value: false }] },
      situation: '雨が降り始めた。',
      options: [
        opt('now', 'すぐに立ち止まって雨具を着る', [{ type: 'wearRainwear' }], ['recommended'], 0.5),
        opt('later', '着いてから着る', [{ type: 'setFlag', flag: 'rainwearLater' }, { type: 'continueRoute' }], ['risky'], 1),
      ],
    };
  return {
    id,
    title: '小屋で泊まるか',
    trigger: { atNode: hut },
    situation: '小屋に着いた。予定より {leader.timeBehindMin} 分遅れている。',
    options: [
      opt('stay', '今日はここに泊まる', [{ type: 'stayInShelter', until: 'dawn' }], ['recommended'], 0.5),
      opt('go', '先へ進む', [{ type: 'continueRoute' }], ['risky'], 1),
      opt('back', '引き返す', [{ type: 'turnBack' }], [], 0.3),
    ],
  };
}

function optionEditor(ed: Ed, cp: ChoicePointDef, o: ChoiceOptionDef, i: number): HTMLElement {
  const s = ed.p.scenario;
  const set = (label: string, f: () => void): void => ed.change(label, f);
  const ctx = { scenario: s, map: ed.p.map };
  return keptDetails(`opt:${cp.id}:${i}`, `${o.id}: ${o.label || '（無題）'} ${o.tags?.includes('recommended') ? '★推奨' : ''}${o.tags?.includes('risky') ? '⚠危険' : ''}`, [
    text('ID', o.id, (v) => set('選択肢の ID', () => (o.id = v))),
    text('ラベル', o.label, (v) => set('ラベル', () => (o.label = v)), { wide: true }),
    area('補足', o.detail, (v) => set('補足', () => (o.detail = v || undefined)), 2),
    check('推奨（recommended）', o.tags?.includes('recommended') ?? false, (v) => set('タグ', () => (o.tags = [...(o.tags ?? []).filter((t) => t !== 'recommended'), ...(v ? (['recommended'] as const) : [])]))),
    check('危険（risky）', o.tags?.includes('risky') ?? false, (v) => set('タグ', () => (o.tags = [...(o.tags ?? []).filter((t) => t !== 'risky'), ...(v ? (['risky'] as const) : [])]))),
    el('h4', {}, 'アクション'),
    actionEditor(o.actions, s, ed.p.map, (a) => set('アクション', () => (o.actions = a))),
    text('立てるフラグ（空白区切り）', (o.flags ?? []).join(' '), (v) => set('フラグ', () => (o.flags = v.split(/\s+/).filter(Boolean)))),
    section('利用条件', [
      o.available
        ? conditionBuilder(o.available, ctx, (c) => set('利用条件', () => (o.available = c)))
        : button('利用条件を付ける', () => set('利用条件', () => (o.available = { var: 'leader.radio', op: '>=', value: 0.3 }))),
      o.available ? text('選べないときの文', o.unavailableText, (v) => set('文', () => (o.unavailableText = v || undefined))) : null,
      o.available ? check('選べないときは隠す', o.hideIfUnavailable ?? false, (v) => set('隠す', () => (o.hideIfUnavailable = v))) : null,
      o.available ? button('利用条件を外す', () => set('利用条件', () => delete o.available)) : null,
    ], Boolean(o.available)),
    section('自律バイアス（観察のみ・傾向どおりで選ばれる重み）', [
      num('基本の重み', o.bias.base, (v) => set('バイアス', () => (o.bias.base = v)), { min: 0, step: 0.1 }),
      ...(o.bias.mods ?? []).map((m, j) =>
        el('div', { class: 'f-section' }, [
          num('足す重み', m.add, (v) => set('バイアス', () => (o.bias.mods![j]!.add = v)), { step: 0.1 }),
          conditionBuilder(m.when, ctx, (c) => set('バイアスの条件', () => (o.bias.mods![j]!.when = c))),
          button('この補正を消す', () => set('バイアス', () => o.bias.mods!.splice(j, 1))),
        ]),
      ),
      button('条件つきの補正を足す', () => set('バイアス', () => (o.bias.mods = [...(o.bias.mods ?? []), { when: { var: 'leader.def.riskTolerance', op: '>', value: 0.5 }, add: 0.5 }]))),
    ], false),
    el('div', {}, [
      button('↑', () => i > 0 && set('並べ替え', () => cp.options.splice(i - 1, 0, cp.options.splice(i, 1)[0]!))),
      button('この選択肢を削除', () => set('選択肢の削除', () => cp.options.splice(i, 1))),
    ]),
  ]);
}

function varInserter(target: () => HTMLTextAreaElement | null, s: ChoicePointDef | null, ed: Ed): HTMLElement {
  const sel = el('select', {}, [el('option', { value: '' }, '{ 変数を挿入 }'), ...varGroups(ed.p.scenario).map((g) => el('optgroup', { label: g.label }, g.paths.map((p) => el('option', { value: p.path }, p.label))))]);
  sel.addEventListener('change', () => {
    const t = target();
    if (!t || !sel.value) return;
    const pos = t.selectionStart ?? t.value.length;
    t.value = `${t.value.slice(0, pos)}{${sel.value}}${t.value.slice(pos)}`;
    t.dispatchEvent(new Event('change'));
    sel.value = '';
  });
  void s;
  return sel;
}

function cpEditor(ed: Ed, cp: ChoicePointDef): HTMLElement {
  const s = ed.p.scenario;
  const set = (label: string, f: () => void): void => ed.change(label, f);
  const situ = area('状況の文（{leader.local.windMs} のように変数を書ける）', cp.situation, (v) => set('状況', () => (cp.situation = v)), 4);
  const preview = el('p', { class: 'note' }, previewText);
  return el('div', {}, [
    el('h3', {}, `分岐点 ${cp.id}`),
    text('ID', cp.id, (v) => /^[A-Za-z0-9_]+$/.test(v) && set('分岐点の ID', () => {
      const old = cp.id;
      ed.p.scenario = JSON.parse(JSON.stringify(ed.p.scenario).split(`"${old}"`).join(`"${v}"`)) as typeof ed.p.scenario;
      ed.p.editorState.selection = { kind: 'choice', id: v };
    })),
    text('題', cp.title, (v) => set('題', () => (cp.title = v)), { wide: true }),
    situ,
    varInserter(() => situ.querySelector('textarea'), cp, ed),
    button('直近の試走の値で展開してみる', () => {
      const w = worldAtChoice(ed, cp.id);
      const rt = ed.runtime();
      if (!w || !rt) previewText = 'この分岐点は傾向どおりの試走では出ませんでした';
      else {
        const leader = partyLeader(w);
        previewText = expandText(cp.situation, (p) => resolveVar(p, { world: w, map: rt, scenario: s, leader }), TEXT_LABELS);
      }
      preview.textContent = previewText;
    }),
    preview,
    lines('登山者が把握していること', cp.knowledge, (v) => set('把握', () => (cp.knowledge = v))),
    num('優先度', cp.priority ?? 10, (v) => set('優先度', () => (cp.priority = v))),
    num('制限時間（判断時間制限モード）', cp.timeoutSec ?? 30, (v) => set('制限時間', () => (cp.timeoutSec = v)), { min: 5, unit: '秒' }),
    check('一度だけ出す', cp.once ?? true, (v) => set('一度だけ', () => (cp.once = v))),
    section('発火条件', [conditionBuilder(cp.trigger, { scenario: s, map: ed.p.map, probe: (c) => firstTrueTime(ed, c) }, (c) => set('発火条件', () => (cp.trigger = c)))]),
    section(`選択肢（${cp.options.length}）`, [
      ...cp.options.map((o, i) => optionEditor(ed, cp, o, i)),
      button('選択肢を足す', () => set('選択肢の追加', () => cp.options.push({ id: nextId(cp.options.map((o) => o.id), 'o'), label: '', actions: [{ type: 'continueRoute' }], bias: { base: 1 } }))),
    ]),
    button('この分岐点を複製', () => set('分岐点の複製', () => {
      const c = structuredClone(cp);
      c.id = nextId(s.choices.map((x) => x.id), 'cp');
      s.choices.push(c);
      ed.p.editorState.selection = { kind: 'choice', id: c.id };
    })),
    button('この分岐点を削除', () => set('分岐点の削除', () => {
      s.choices = s.choices.filter((x) => x !== cp);
      ed.p.editorState.selection = { kind: null, id: null };
    })),
  ]);
}

function genericSection(ed: Ed): HTMLElement {
  const s = ed.p.scenario;
  const set = (label: string, f: () => void): void => ed.change(label, f);
  return section('汎用の分岐点（道迷い・暗くなった・雷など）', [
    el('p', { class: 'note' }, '状況に応じて自動で出る分岐点です。止めたり、文を上書きしたりできます（選択肢は既定のもの）。'),
    ...GENERICS.map((k) => {
      const o = s.genericOverrides?.[k];
      const g = JA.generic[k];
      return el('div', { class: 'f-section' }, [
        check(`${g?.title ?? k}（${k}）を出す`, o?.enabled !== false, (v) => set('汎用分岐点', () => {
          s.genericOverrides = { ...(s.genericOverrides ?? {}), [k]: { ...(o ?? {}), enabled: v } };
        })),
        area('状況の文（空なら既定）', o?.situation ?? '', (v) => set('汎用分岐点の文', () => {
          s.genericOverrides = { ...(s.genericOverrides ?? {}), [k]: { ...(o ?? {}), situation: v || undefined } };
        }), 2),
      ]);
    }),
  ], false);
}

export const choicesPanel: Panel = {
  id: 'choices',
  label: '分岐点',
  render(ed) {
    const s = ed.p.scenario;
    const sel = ed.p.editorState.selection;
    const cp = sel.kind === 'choice' ? s.choices.find((c) => c.id === sel.id) : undefined;
    const fired = new Map<string, number>();
    for (const d of ed.lastRun?.record?.decisions ?? []) fired.set(d.cpId, (fired.get(d.cpId) ?? 0) + 1);
    const add = (k: 'turnaround' | 'rainwear' | 'hut'): void =>
      ed.change('テンプレート', () => {
        const c = fromTemplate(ed, k);
        s.choices.push(c);
        ed.p.editorState.selection = { kind: 'choice', id: c.id };
      });
    fill(
      ed.inspector,
      el('h2', {}, '分岐点'),
      cp ? cpEditor(ed, cp) : el('p', { class: 'note' }, '下の一覧から選ぶか、テンプレートから作ってください。'),
      genericSection(ed),
    );
    ed.bottom.replaceChildren(
      el('div', { style: 'padding:6px' }, [
        el('div', {}, [
          button('＋ 空の分岐点', () => ed.change('分岐点の追加', () => {
            const id = nextId(s.choices.map((c) => c.id), 'cp');
            s.choices.push({ id, title: '新しい分岐点', trigger: { after: s.startAt }, situation: '', options: [{ id: 'o1', label: '進む', actions: [{ type: 'continueRoute' }], bias: { base: 1 } }] });
            ed.p.editorState.selection = { kind: 'choice', id };
          })),
          button('テンプレート: 引き返し判断', () => add('turnaround')),
          button('テンプレート: 雨具', () => add('rainwear')),
          button('テンプレート: 小屋で泊まるか', () => add('hut')),
          button('テンプレート: 道迷いに気づいた（汎用の文を上書き）', () => ed.change('汎用分岐点', () => (s.genericOverrides = { ...(s.genericOverrides ?? {}), lostAware: { enabled: true, situation: '見覚えのない沢筋に出た。{leader.def.name}さんは、道を外れたことに気づいた。' } }))),
          button('テンプレート: 雷（汎用の文を上書き）', () => ed.change('汎用分岐点', () => (s.genericOverrides = { ...(s.genericOverrides ?? {}), lightning: { enabled: true, situation: '雷鳴が近い。稜線の上にいる。' } }))),
        ]),
        el('table', { class: 'ed-table' }, [
          el('tr', {}, ['ID', '題', '発火条件', '選択肢', '推奨', '直近の試走'].map((x) => el('th', {}, x))),
          ...s.choices.map((c) =>
            el('tr', { class: c === cp ? 'sel' : '', onclick: () => ed.select('choice', c.id) }, [
              el('td', {}, c.id),
              el('td', {}, c.title),
              el('td', {}, summarize(c.trigger, s, ed.p.map)),
              el('td', {}, String(c.options.length)),
              el('td', {}, c.options.some((o) => o.tags?.includes('recommended')) ? '★' : '⚠ なし'),
              el('td', {}, ed.lastRun ? (fired.get(c.id) ? `発火（${ed.lastRun.record?.decisions.find((d) => d.cpId === c.id)?.optionId}）` : '⚠ 発火しなかった') : '—'),
            ]),
          ),
        ]),
      ]),
    );
    void ({} as Condition);
  },
};
