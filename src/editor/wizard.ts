/**
 * 新規作成の流れ（docs/18 §9）: 初回は順に誘導する。プロジェクトの状態から各段の済み・未を判定し、次にやることと該当タブへの移動を出す。
 * いつでも閉じられ、後から各タブで直せる。
 */
import { el } from '../ui/dom';
import type { Ed, TabId } from './context';
import { hasTerrain } from './store/project';

interface Step {
  label: string;
  hint: string;
  tab: TabId;
  done: (ed: Ed) => boolean;
  realOnly?: boolean;
}

const STEPS: Step[] = [
  { label: '範囲を置いて標高を取得', hint: 'タブ 1 で範囲の枠を動かし、「標高を取得する」。3D で確認できます。', tab: 'area', done: (ed) => hasTerrain(ed.p), realOnly: true },
  { label: '登山道を取り込んで確定', hint: 'タブ 2（登山道と地点）で「OpenStreetMap から取り込む」→ 使う道を確定（または手描き・GPX）。', tab: 'trails', done: (ed) => ed.p.map.edges.length > 0 && ed.p.editorState.draftEdgeIds.length === 0, realOnly: true },
  { label: '登山者と計画ルート', hint: 'タブ 5 で登山者を確かめ、「地図でルートを引く」で地点を順にクリック。下山口も決めます。', tab: 'party', done: (ed) => ed.p.scenario.plan.route.length >= 2 && ed.p.scenario.plan.goalNodes.length > 0 },
  { label: '天候', hint: 'タブ 4 で「晴れのまま」「パターンを挿入」「過去の天気を取り込む」のどれかを選びます。', tab: 'weather', done: (ed) => ed.p.scenario.weather.keyframes.length >= 2 || (ed.p.scenario.weather.presetLog?.length ?? 0) > 0 },
  { label: '推奨方針で 1 回試走', hint: 'タブ 7 で「試走する」。結末まで走ることを確かめます。', tab: 'test', done: (ed) => ed.lastRun !== null },
  { label: '物語を作る', hint: 'タブ 6（物語）で「物語の型」を 1 つ選ぶと、分かれ道・できごと・結末がまとめて入ります。', tab: 'story', done: (ed) => ed.p.scenario.choices.length > 0 },
  { label: '書き出す', hint: '右上の「書き出し」でバンドル（*.sounan.json）を保存。「3D でチャレンジ」でそのままチャレンジできます。', tab: 'test', done: (ed) => ed.p.editorState.rightsConfirmed || localStorage.getItem(`hks.ed.exported.${ed.p.id}`) === '1' },
];

const key = (id: string): string => `hks.ed.wizardClosed.${id}`;

export function wizardBar(ed: Ed): HTMLElement | null {
  if (localStorage.getItem(key(ed.p.id)) === '1') return null;
  const steps = STEPS.filter((s) => !s.realOnly || ed.p.map.geo);
  const idx = steps.findIndex((s) => !s.done(ed));
  if (idx < 0) return null;
  const cur = steps[idx]!;
  return el('div', { class: 'wizard' }, [
    el('strong', {}, `はじめての流れ ${idx + 1} / ${steps.length}: ${cur.label}`),
    el('span', {}, cur.hint),
    el('span', { class: 'chips' }, steps.map((s, i) => el('span', { class: `chip${i < idx ? ' done' : i === idx ? ' cur' : ''}` }, `${i < idx ? '✔' : i + 1} ${s.label}`))),
    el('button', { class: 'small', onclick: () => ed.goTab(cur.tab) }, 'そのタブへ'),
    el('button', {
      class: 'small',
      onclick: () => {
        localStorage.setItem(key(ed.p.id), '1');
        ed.refresh();
      },
    }, '閉じる'),
  ]);
}
