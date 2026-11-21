/**
 * 計画ルートの一覧（人と計画タブ・登山道と地点のタブで共通）。地点ごとに ↑ ↓ × で順番を入れ替え・外し、「逆向きにする」で向きを変える（ユーザーの指定）。
 * 入れ替えたあと、隣どうしが道でつながっていない所は、最短の道順で埋める（埋められなければそのまま。検証の「道のない区間」で分かる）。
 * 下山口が「最後の地点」だったなら、新しい最後の地点を下山口にする。
 */
import { shortestPath } from '../../sim/terrain/trails';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { button } from '../forms/fields';
import { setPlanRoute } from '../map/routeClick';

/** 隣どうしが道でつながっていない所を、最短の道順で埋める。埋めた数も返す */
function reconnect(ed: Ed, route: readonly string[]): { route: string[]; filled: number } {
  const rt = ed.runtime();
  const map = ed.p.map;
  const out: string[] = route.length ? [route[0]!] : [];
  let filled = 0;
  for (let i = 1; i < route.length; i += 1) {
    const a = out[out.length - 1]!;
    const b = route[i]!;
    if (a === b) continue;
    const direct = map.edges.some((e) => e.kind === 'trail' && e.to && ((e.from === a && e.to === b) || (e.from === b && e.to === a)));
    const path = !direct && rt ? shortestPath(rt, a, b) : null;
    if (path && path.length > 1) {
      out.push(...path.slice(1));
      filled += 1;
    } else out.push(b);
  }
  return { route: out, filled };
}

/** 新しい並びを入れる（つながりを埋め、下山口が最後の地点なら付け替える） */
function apply(ed: Ed, label: string, next: string[]): void {
  const plan = ed.p.scenario.plan;
  const oldLast = plan.route[plan.route.length - 1];
  const { route, filled } = reconnect(ed, next);
  const newLast = route[route.length - 1];
  const goalWasLast = oldLast !== undefined && plan.goalNodes.length === 1 && plan.goalNodes[0] === oldLast;
  setPlanRoute(ed, label, route, () => {
    if (goalWasLast && newLast !== undefined) ed.p.scenario.plan.goalNodes = [newLast];
  });
  if (filled > 0) ed.toast(`道でつながっていない ${filled} か所を、最短の道順で埋めました（Ctrl＋Z で戻せます）`, 5000);
}

/** 計画ルートの一覧と、並びを変えるボタン */
export function routeList(ed: Ed): HTMLElement {
  const route = ed.p.scenario.plan.route;
  const goals = new Set(ed.p.scenario.plan.goalNodes);
  if (route.length === 0) return el('p', {}, '（未設定）');
  const nameOf = (id: string): string => ed.p.map.nodes.find((n) => n.id === id)?.name ?? '';
  const move = (i: number, d: -1 | 1): void => {
    const r = [...route];
    const j = i + d;
    if (j < 0 || j >= r.length) return;
    [r[i], r[j]] = [r[j]!, r[i]!];
    apply(ed, 'ルートの順番', r);
  };
  const rows = route.map((id, i) => {
    const nm = nameOf(id);
    return el('li', { class: 'route-row' }, [
      el('span', { class: 'route-no' }, String(i + 1)),
      el('span', { class: nm ? 'route-name' : 'route-name noname', title: id }, [nm || id, goals.has(id) && i === route.length - 1 ? el('small', {}, ' 下山口') : null]),
      el('button', { class: 'mini', title: '前へ', 'aria-label': `${nm || id} を前へ`, disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
      el('button', { class: 'mini', title: '後ろへ', 'aria-label': `${nm || id} を後ろへ`, disabled: i === route.length - 1, onclick: () => move(i, 1) }, '↓'),
      el('button', { class: 'mini', title: 'ルートから外す', 'aria-label': `${nm || id} をルートから外す`, onclick: () => apply(ed, 'ルートから外す', route.filter((_, k) => k !== i)) }, '×'),
    ]);
  });
  return el('div', { class: 'route-list' }, [
    el('ol', {}, rows),
    button('逆向きにする', () => apply(ed, 'ルートを逆向きに', [...route].reverse())),
  ]);
}
