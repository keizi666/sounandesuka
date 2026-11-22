/**
 * 分かれ道（分岐点）のくわしい設定（docs/18 §3）: 状況の文と変数の候補・展開プレビュー、把握していること、条件ビルダー、
 * 選択肢とアクション・バイアス、汎用分岐点の上書き。物語のタブ（story.ts）の「くわしい設定」から使う。
 */
import { partyLeader } from '../../sim/climber/party';
import { expandText } from '../../sim/scenario/text';
import { resolveVar } from '../../sim/scenario/vars';
import type { ChoiceOptionDef, ChoicePointDef, GenericChoiceKey } from '../../sim/types';
import { JA } from '../../i18n/ja';
import { TEXT_LABELS } from '../../i18n/format';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { actionEditor } from '../forms/ActionEditor';
import { conditionBuilder } from '../forms/ConditionBuilder';
import { area, button, check, fill, lines, num, keptDetails, section, text } from '../forms/fields';
import { varGroups } from '../forms/varPaths';
import { firstTrueTime, worldAtChoice } from '../probe';
import { nextId } from '../store/project';

const GENERICS: GenericChoiceKey[] = ['lostAware', 'darkness', 'hypothermia', 'injured', 'bruised', 'lightning', 'waterfall', 'straggler', 'rescueFailed'];
let previewText = '';

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

export function varInserter(target: () => HTMLTextAreaElement | null, s: ChoicePointDef | null, ed: Ed): HTMLElement {
  const sel = el('select', {}, [el('option', { value: '' }, '{ 数字や名前を文に入れる }'), ...varGroups(ed.p.scenario).map((g) => el('optgroup', { label: g.label }, g.paths.map((p) => el('option', { value: p.path }, p.label))))]);
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

export function cpEditor(ed: Ed, cp: ChoicePointDef): HTMLElement {
  const s = ed.p.scenario;
  const set = (label: string, f: () => void): void => ed.change(label, f);
  const situ = area('状況の文（{leader.local.windMs} のように変数を書ける）', cp.situation, (v) => set('状況', () => (cp.situation = v)), 4);
  const preview = el('p', { class: 'note' }, previewText);
  return el('div', {}, [
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
  ]);
}

export function genericSection(ed: Ed): HTMLElement {
  const s = ed.p.scenario;
  const set = (label: string, f: () => void): void => ed.change(label, f);
  return el('div', {}, [
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
  ]);
}

