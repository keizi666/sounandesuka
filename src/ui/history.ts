/**
 * 自分のプレイ記録（FR-41。ユーザーの指定: シナリオ別・結末別に分け、プレイ日時・亡くなった人数・プレイ回数で並び替える）。
 * この端末で結末まで遊んだ記録（src/app/storage.ts の履歴）。シナリオ・結末で絞り、並び替える。押すとそのシナリオで遊べる
 */
import type { AppContext } from '../app/App';
import { loadEntry, loadIndex } from '../app/data';
import { playCounts } from '../app/playStats';
import { loadHistory, type HistoryEntry } from '../app/storage';
import { fill } from '../i18n/format';
import { JA } from '../i18n/ja';
import type { ScenarioIndexEntry } from '../sim/types';
import { ENDING_COLOR } from './community/endingColors';
import { el, toast } from './dom';
import { icon } from './icons';
import { progressTo, showLoading } from './loading';

type SortKey = 'date' | 'deaths' | 'count';
const STATE_KEY = 'hks.v1.historyView';

const ENDING_ORDER = ['SAFE_RETURN', 'SAFE_SHELTER', 'ABORTED', 'SELF_RESCUE', 'RESCUED', 'RESCUED_CRITICAL', 'MISSING', 'FATAL'];

function hm(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} 時間 ${m} 分` : `${m} 分`;
}

async function play(app: AppContext, scenarioId: string): Promise<void> {
  const entry = (await loadIndex().catch(() => [] as ScenarioIndexEntry[])).find((e) => e.id === scenarioId);
  if (!entry) {
    toast(JA.community.notPlayable, 5000);
    return;
  }
  const ld = showLoading(JA.ui.loadingTitle);
  try {
    const loaded = await loadEntry(entry, progressTo(ld, { data: JA.ui.loadingData, terrain: JA.ui.loadingTerrain }));
    ld.done();
    app.go({ name: 'briefing', loaded });
  } catch (e) {
    ld.done();
    toast(String(e), 6000);
  }
}

export function showHistory(app: AppContext): () => void {
  const M = JA.myPlays;
  const all = loadHistory();
  const counts = playCounts();
  // 何回目のプレイか（古い順に数える）
  const nth = new Map<HistoryEntry, number>();
  const seen: Record<string, number> = {};
  for (const h of all) {
    seen[h.scenarioId] = (seen[h.scenarioId] ?? 0) + 1;
    nth.set(h, seen[h.scenarioId]!);
  }
  let state: { scenario: string; ending: string; sort: SortKey } = { scenario: '', ending: '', sort: 'date' };
  try {
    state = { ...state, ...(JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') as Partial<typeof state>) };
  } catch {
    // 既定のまま
  }
  const save = (): void => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      // 覚えられなくても絞れる
    }
  };

  // シナリオの選び方（記録のあるシナリオ。題は記録のもの）
  const titles = new Map<string, string>();
  for (const h of all) titles.set(h.scenarioId, h.title);
  const scenarioSel = el('select', { 'aria-label': M.allScenarios }, [
    el('option', { value: '' }, M.allScenarios),
    ...[...titles].sort((a, b) => (counts[b[0]] ?? 0) - (counts[a[0]] ?? 0)).map(([id, t]) => el('option', { value: id }, `${t}（${all.filter((h) => h.scenarioId === id).length}）`)),
  ]) as HTMLSelectElement;
  const kinds = ENDING_ORDER.filter((k) => all.some((h) => h.ending === k));
  const endingSel = el('select', { 'aria-label': M.allEndings }, [
    el('option', { value: '' }, M.allEndings),
    ...kinds.map((k) => el('option', { value: k }, `${JA.endings[k]?.title ?? k}（${all.filter((h) => h.ending === k).length}）`)),
  ]) as HTMLSelectElement;
  const sortSel = el('select', { 'aria-label': M.sortLabel }, [
    el('option', { value: 'date' }, M.sortDate),
    el('option', { value: 'deaths' }, M.sortDeaths),
    el('option', { value: 'count' }, M.sortCount),
  ]) as HTMLSelectElement;
  scenarioSel.value = titles.has(state.scenario) ? state.scenario : '';
  endingSel.value = kinds.includes(state.ending) ? state.ending : '';
  sortSel.value = state.sort;

  const countEl = el('span', { class: 'hs-count' });
  const list = el('ol', { class: 'hs-list' });

  const row = (h: HistoryEntry): HTMLElement => {
    const color = ENDING_COLOR[h.ending] ?? '#6b7280';
    const deaths = h.deaths;
    return el('li', { class: 'hs-item', style: `--end:${color}` }, [
      el('div', { class: 'hs-main' }, [
        el('div', { class: 'hs-top' }, [
          el('time', { datetime: h.at }, new Date(h.at).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
          el('span', { class: 'hs-nth' }, fill(M.times, { n: nth.get(h) ?? 1 })),
          h.conditions ? el('span', { class: 'tag' }, M.conditions) : null,
        ]),
        el('strong', { class: 'hs-title' }, h.title),
        el('div', { class: 'hs-end' }, [
          el('span', { class: 'hs-kind' }, JA.endings[h.ending]?.title ?? h.ending),
          h.endingTitle && h.endingTitle !== JA.endings[h.ending]?.title ? el('span', { class: 'hs-etitle' }, h.endingTitle) : null,
        ]),
        el('div', { class: 'hs-facts' }, [
          deaths !== undefined ? el('span', { class: deaths > 0 ? 'hs-dead' : 'hs-alive' }, deaths > 0 ? fill(M.deaths, { n: deaths }) : M.noDeaths) : null,
          h.partySize !== undefined ? el('span', {}, `${h.partySize} 人`) : null,
          h.durationMin !== undefined ? el('span', {}, hm(h.durationMin)) : null,
          el('span', {}, fill(M.total, { n: counts[h.scenarioId] ?? 0 })),
        ]),
        h.choices.length > 0 ? el('p', { class: 'hs-choices' }, [el('small', {}, `${M.choices}: `), h.choices.join(' → ')]) : null,
      ]),
      el('button', { class: 'small hs-play', type: 'button', onclick: () => void play(app, h.scenarioId) }, [icon('playArrow'), JA.community.playScenario]),
    ]);
  };

  const render = (): void => {
    state = { scenario: scenarioSel.value, ending: endingSel.value, sort: sortSel.value as SortKey };
    save();
    let hs = all.filter((h) => (!state.scenario || h.scenarioId === state.scenario) && (!state.ending || h.ending === state.ending));
    const byDate = (a: HistoryEntry, b: HistoryEntry): number => b.at.localeCompare(a.at);
    hs = [...hs].sort((a, b) =>
      state.sort === 'deaths' ? (b.deaths ?? -1) - (a.deaths ?? -1) || byDate(a, b) : state.sort === 'count' ? (counts[b.scenarioId] ?? 0) - (counts[a.scenarioId] ?? 0) || a.scenarioId.localeCompare(b.scenarioId) || byDate(a, b) : byDate(a, b),
    );
    countEl.textContent = fill(M.count, { n: hs.length });
    list.replaceChildren(...(hs.length > 0 ? hs.map(row) : [el('li', { class: 'hs-empty' }, all.length === 0 ? M.none : M.noMatch)]));
  };
  for (const s of [scenarioSel, endingSel, sortSel]) s.addEventListener('change', render);

  app.root.append(
    el('main', { class: 'cm-screen hs-screen' }, [
      el('header', { class: 'cm-bar' }, [
        el('div', { class: 'cm-bar-in' }, [
          el('button', { class: 'cap', type: 'button', onclick: () => app.go({ name: 'title' }) }, [icon('arrowBack'), el('span', { class: 'cm-cap-t' }, JA.ui.back)]),
          el('h1', {}, [icon('history'), M.title]),
        ]),
      ]),
      el('div', { class: 'hs-wrap' }, [
        el('p', { class: 'hs-lead' }, M.lead),
        el('div', { class: 'hs-tools' }, [
          el('label', { class: 'hs-field' }, [icon('filterList'), scenarioSel]),
          el('label', { class: 'hs-field' }, [icon('flag'), endingSel]),
          el('label', { class: 'hs-field' }, [icon('sort'), sortSel]),
          countEl,
        ]),
        list,
      ]),
    ]),
  );
  render();
  return () => {};
}
