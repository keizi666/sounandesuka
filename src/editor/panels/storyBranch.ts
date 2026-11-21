/**
 * 物語のボードの中で開く、枝分かれの編集（ユーザーの指定: カードを押したら、その場で、選択肢を枝分かれの図として設定したい。
 * 右の欄は離れていて使いにくい）。左に「いつ・状況」、そこから矢印で右に選択肢（選ぶとどうするか）を並べ、その場で直す。
 * できごとは、左に「いつ」、右に「なにが起きる」。
 */
import type { ChoicePointDef, ScriptEventDef } from '../../sim/types';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { area, button, text } from '../forms/fields';
import { whenPicker } from '../forms/whenPicker';
import { nextId } from '../store/project';
import { varInserter } from './choiceDetail';
import type { BoardApi } from './storyBoard';
import { effectEditor } from './storyDetail';
import { optionBox } from './storyInspector';

const bar = (api: BoardApi, label: string): HTMLElement => el('div', { class: 'brx-bar' }, [el('strong', {}, label), el('span', { class: 'spacer' }), el('button', { class: 'small', title: 'たたんでカードに戻す', onclick: () => api.close() }, '✕ 閉じる')]);
const arrow = (): HTMLElement => el('span', { class: 'brx-arrow' }, '▶');
const h = (t: string): HTMLElement => el('h4', { class: 'si-h' }, t);

export function choiceBranch(ed: Ed, api: BoardApi, cp: ChoicePointDef): HTMLElement {
  const s = ed.p.scenario;
  const set = (label: string, f: () => void): void => ed.change(label, f);
  const situ = area('状況の文（プレイヤーに見せる）', cp.situation, (v) => set('状況', () => (cp.situation = v)), 5);
  const src = el('div', { class: 'brx-src k-choice' }, [
    bar(api, '🔀 分かれ道'),
    text('題', cp.title, (v) => set('題', () => (cp.title = v)), { wide: true }),
    h('① いつ出す'),
    whenPicker(cp.trigger, { scenario: s, map: ed.p.map }, (c) => c && set('いつ出す', () => (cp.trigger = c))),
    situ,
    varInserter(() => situ.querySelector('textarea'), cp, ed),
    el('p', { class: 'note' }, '② 右の選択肢から 1 つを選ぶと、登山者はその行動をとります。ID・条件・選ばれやすさ・複製・削除は、右の欄の「くわしい設定」に。'),
  ]);
  const opts = el('div', { class: 'brx-opts' }, [
    ...cp.options.map((o, i) => el('div', { class: `brx-opt${o.tags?.includes('recommended') ? ' rec' : ''}${o.tags?.includes('risky') ? ' risky' : ''}` }, [arrow(), optionBox(ed, cp, o, i)])),
    el('div', { class: 'brx-opt add' }, [arrow(), button('＋ 選択肢を足す', () => set('選択肢の追加', () => cp.options.push({ id: nextId(cp.options.map((o) => o.id), 'o'), label: '', actions: [{ type: 'continueRoute' }], bias: { base: 1 } })), 'sb-add')]),
  ]);
  return el('div', { class: 'brx' }, [src, opts]);
}

export function eventBranch(ed: Ed, api: BoardApi, ev: ScriptEventDef): HTMLElement {
  const set = (label: string, f: () => void): void => ed.change(label, f);
  const src = el('div', { class: 'brx-src k-event' }, [
    bar(api, '⚡ できごと'),
    h('① いつ起きる'),
    whenPicker(ev.trigger, { scenario: ed.p.scenario, map: ed.p.map }, (c) => c && set('いつ起きる', () => (ev.trigger = c)), { chance: true }),
  ]);
  const opts = el('div', { class: 'brx-opts' }, [
    el('div', { class: 'brx-opt' }, [arrow(), el('div', { class: 'si-opt' }, [h('② なにが起きる（上から順に）'), effectEditor(ed, ev.effects, (l) => set('起きること', () => (ev.effects = l)))])]),
  ]);
  return el('div', { class: 'brx' }, [src, opts]);
}
