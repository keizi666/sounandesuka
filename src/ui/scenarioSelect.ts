/** シナリオ選択（FR-01、FR-74）。カード一覧と、バンドルのファイル読み込み（ドラッグ＆ドロップ可） */
import type { AppContext } from '../app/App';
import { buildRuntime, loadEntry, loadIndex } from '../app/data';
import { JA } from '../i18n/ja';
import { fill } from '../i18n/format';
import type { HakoniwaBundle } from '../sim/types';
import { el, toast } from './dom';

async function openBundle(app: AppContext, file: File): Promise<void> {
  try {
    const b = JSON.parse(await file.text()) as HakoniwaBundle;
    if (b.format !== 'hakoniwa-bundle') throw new Error('format');
    app.go({ name: 'briefing', loaded: { scenario: b.scenario, map: await buildRuntime(b.map), attribution: b.attribution } });
  } catch {
    toast('バンドルを読み込めませんでした');
  }
}

export function showScenarioSelect(app: AppContext): () => void {
  const list = el('div', { class: 'cards' }, el('p', {}, JA.ui.loading));
  const input = el('input', { type: 'file', accept: '.json,application/json', onchange: (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void openBundle(app, f);
  } });
  const drop = el('label', { class: 'drop' }, [JA.ui.loadFile, input, el('small', {}, JA.ui.dropHint)]);
  drop.addEventListener('dragover', (e) => e.preventDefault());
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f) void openBundle(app, f);
  });
  app.root.append(
    el('main', { class: 'select' }, [
      el('header', {}, [el('button', { onclick: () => app.go({ name: 'title' }) }, JA.ui.back), el('h1', {}, JA.ui.selectTitle)]),
      list,
      drop,
    ]),
  );
  void loadIndex().then((idx) => {
    list.replaceChildren(
      ...idx.map((e) =>
        el('button', { class: 'card', onclick: async () => {
          list.setAttribute('aria-busy', 'true');
          app.go({ name: 'briefing', loaded: await loadEntry(e) });
        } }, [
          el('h2', {}, e.title),
          el('p', {}, e.subtitle ?? ''),
          el('p', { class: 'meta' }, [
            `${JA.labels.theme[e.theme] ?? e.theme} ・ ${JA.labels.season[e.season] ?? e.season} ・ ${JA.ui.difficulty} ${'★'.repeat(e.difficulty)}${'☆'.repeat(5 - e.difficulty)} ・ ${fill(JA.ui.minutes, { m: e.estMinutes })}`,
          ]),
          e.region?.real ? el('p', { class: 'note' }, JA.disclaimer.realMountain) : null,
        ]),
      ),
    );
  });
  return () => {};
}
