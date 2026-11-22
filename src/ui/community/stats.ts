/**
 * 「みんなの遭難記録」のシナリオごとの集計（docs/20_community.md §1。ユーザーの指定）。
 * 一覧の「シナリオごとの結果」の表と、結果の画面の「みんなの結果と比べる」。
 * 載せた記録だけの集計（遊んだ人すべてではない）であることを、どちらにも書く。
 */
import { JA } from '../../i18n/ja';
import { fill } from '../../i18n/format';
import { communityApi } from '../../net/communityApi';
import type { ScenarioStats } from '../../net/communityTypes';
import { ENDING_SEVERITY } from '../../sim/scenario/endings';
import { el } from '../dom';
import { cIcon } from './common';
import { ENDING_COLOR } from './endingColors';

const sev = (k: string): number => ENDING_SEVERITY[k as keyof typeof ENDING_SEVERITY] ?? 9;

/** 結末を 3 つにまとめた割合（%）: 無事（途中でやめた・下山・小屋）・自力で脱出／救助・行方不明／死亡 */
export function endingShares(st: Pick<ScenarioStats, 'counts' | 'n'>): { safe: number; rescued: number; lost: number } {
  const n = Math.max(1, st.n);
  let safe = 0;
  let rescued = 0;
  let lost = 0;
  for (const [k, v] of Object.entries(st.counts)) {
    const s = sev(k);
    if (s <= ENDING_SEVERITY.SAFE_SHELTER) safe += v;
    else if (s <= ENDING_SEVERITY.RESCUED_CRITICAL) rescued += v;
    else lost += v;
  }
  return { safe: Math.round((safe / n) * 100), rescued: Math.round((rescued / n) * 100), lost: Math.round((lost / n) * 100) };
}

/** 結末の割合の細い帯（軽い順に並べる） */
export function endingBar(counts: Record<string, number>, cls = 'cm-st-bar'): HTMLElement {
  const kinds = Object.keys(counts).sort((a, b) => sev(a) - sev(b));
  return el(
    'div',
    { class: cls, role: 'img', 'aria-label': kinds.map((k) => `${JA.endings[k]?.title ?? k} ${counts[k]}`).join('、') },
    kinds.map((k) => el('span', { style: `flex:${counts[k] ?? 0};background:${ENDING_COLOR[k] ?? '#6b7280'}`, title: `${JA.endings[k]?.title ?? k} ${counts[k]}` })),
  );
}

/** 一覧の「シナリオごとの結果」の表。行を押すとそのシナリオで絞り込む */
export function statsTable(list: ScenarioStats[], onPick: (id: string) => void): HTMLElement {
  const C = JA.community;
  const rows = list.map((st) => {
    const sh = endingShares(st);
    const pick = (): void => onPick(st.id);
    return el('tr', { tabindex: 0, onclick: pick, onkeydown: (e: Event) => (e as KeyboardEvent).key === 'Enter' && pick() }, [
      el('th', { scope: 'row' }, st.title),
      el('td', { class: 'cm-st-num' }, fill(C.statsRuns, { n: st.n, p: st.players })),
      el('td', { class: 'cm-st-barcell' }, endingBar(st.counts)),
      el('td', { class: 'cm-st-num cm-st-safe' }, `${sh.safe}%`),
      el('td', { class: 'cm-st-num cm-st-lost' }, `${Math.round((st.deathsAny / Math.max(1, st.n)) * 100)}%`),
    ]);
  });
  return el('details', { class: 'cm-stats', open: true }, [
    el('summary', {}, [cIcon('barChart'), C.statsTitle]),
    el('div', { class: 'cm-stats-scroll' }, [
      el('table', { class: 'cm-st-table' }, [
        el('thead', {}, el('tr', {}, C.statsHead.map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, rows),
      ]),
    ]),
    el('p', { class: 'cm-note' }, C.statsNote),
  ]);
}

/** 1 つのシナリオの集計の 1 行（一覧で絞り込んだとき） */
export function statsLine(st: ScenarioStats): HTMLElement {
  const C = JA.community;
  const sh = endingShares(st);
  return el('p', { class: 'cm-st-line' }, [
    fill(C.statsRuns, { n: st.n, p: st.players }),
    ' ・ ',
    fill(C.statsShares, { safe: sh.safe, rescued: sh.rescued, lost: sh.lost }),
    ' ・ ',
    fill(C.statsDeaths, { p: Math.round((st.deathsAny / Math.max(1, st.n)) * 100) }),
  ]);
}

/**
 * 結果の画面の「みんなの結果と比べる」。読み込めなければ何も出さない（通信できないときに、結果の画面を邪魔しない）。
 * 自分の記録を載せたあとなら、自分の記録も数に入っている。
 */
export function compareBox(scenarioId: string, endingKind: string): HTMLElement {
  const C = JA.community;
  const box = el('div', { class: 'cm-compare', hidden: true });
  void communityApi
    .stats(scenarioId)
    .then((res) => {
      const st = res.scenarios.find((x) => x.id === scenarioId);
      box.hidden = false;
      if (!st || st.n === 0) {
        box.replaceChildren(el('h3', {}, [cIcon('barChart'), C.compareTitle]), el('p', { class: 'cm-note' }, C.compareNone));
        return;
      }
      const same = Math.round(((st.counts[endingKind] ?? 0) / st.n) * 100);
      const sh = endingShares(st);
      box.replaceChildren(
        el('h3', {}, [cIcon('barChart'), C.compareTitle]),
        el('p', {}, fill(C.compareLead, { n: st.n, p: st.players })),
        endingBar(st.counts, 'cm-st-bar big'),
        el('p', { class: 'cm-compare-shares' }, fill(C.statsShares, { safe: sh.safe, rescued: sh.rescued, lost: sh.lost })),
        el('p', { class: 'cm-compare-same', style: `--end:${ENDING_COLOR[endingKind] ?? '#6b7280'}` }, [el('i', {}), fill(C.compareSame, { e: JA.endings[endingKind]?.title ?? endingKind, p: same })]),
        el('p', { class: 'cm-note' }, C.statsNote),
      );
    })
    .catch(() => box.remove());
  return box;
}
