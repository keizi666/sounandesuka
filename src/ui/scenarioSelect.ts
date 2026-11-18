/** シナリオ選択（FR-01、FR-74）。カード一覧と、バンドルのファイル読み込み（ドラッグ＆ドロップ可） */
import type { AppContext } from '../app/App';
import { buildRuntime, loadEntry, loadIndex } from '../app/data';
import { JA } from '../i18n/ja';
import { fill } from '../i18n/format';
import { validateScenario } from '../sim/scenario/validate';
import type { HakoniwaBundle } from '../sim/types';
import { el, toast } from './dom';

/** バンドル（*.hakoniwa.json）を読み、検証してからブリーフィングへ（FR-74、docs/18 §7） */
async function openBundle(app: AppContext, file: File): Promise<void> {
  let b: HakoniwaBundle;
  try {
    b = JSON.parse(await file.text()) as HakoniwaBundle;
    if (b.format !== 'hakoniwa-bundle' || b.version !== 1 || !b.map || !b.scenario) throw new Error('format');
  } catch {
    toast(JA.ui.bundleBroken, 5000);
    return;
  }
  const errors = validateScenario(b.scenario, b.map).filter((x) => x.level === 'error');
  if (errors.length > 0) {
    toast(`${JA.ui.bundleInvalid}: ${errors.slice(0, 3).map((x) => `${x.path} ${x.message}`).join(' / ')}`, 8000);
    return;
  }
  try {
    app.go({ name: 'briefing', loaded: { scenario: b.scenario, map: await buildRuntime(b.map), attribution: b.attribution ?? [] } });
  } catch (e) {
    toast(`${JA.ui.bundleBroken}（${String(e)}）`, 8000);
  }
}

export function showScenarioSelect(app: AppContext): () => void {
  const list = el('div', { class: 'cards' }, el('p', {}, JA.ui.loading));
  const input = el('input', { type: 'file', accept: '.json,application/json', onchange: (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void openBundle(app, f);
  } });
  const drop = el('label', { class: 'drop' }, [JA.ui.loadFile, input, el('small', {}, JA.ui.dropHint)]);
  // 画面のどこに落としても読み込む
  const onOver = (e: DragEvent): void => {
    e.preventDefault();
    drop.classList.add('over');
  };
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer?.files[0];
    if (f) void openBundle(app, f);
  };
  document.addEventListener('dragover', onOver);
  document.addEventListener('drop', onDrop);
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
  return () => {
    document.removeEventListener('dragover', onOver);
    document.removeEventListener('drop', onDrop);
  };
}
