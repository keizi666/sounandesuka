/** タイトル画面（docs/11 §1） */
import type { AppContext } from '../app/App';
import { loadEntry, loadIndex } from '../app/data';
import { loadResume, resumableScenarios } from '../app/storage';
import { JA } from '../i18n/ja';
import { el } from './dom';
import { openSettings } from './settingsDialog';

export function showTitle(app: AppContext): () => void {
  const resumables = resumableScenarios();
  const resumeBtn =
    resumables.length > 0
      ? el('button', {
          class: 'primary',
          onclick: async () => {
            const id = resumables[0]!;
            const idx = await loadIndex();
            const e = idx.find((x) => x.id === id);
            const data = await loadResume(id);
            if (!e || !data) return;
            app.go({ name: 'sim', loaded: await loadEntry(e), resume: data });
          },
        }, JA.ui.resume)
      : null;
  app.root.append(
    el('main', { class: 'title' }, [
      el('h1', {}, JA.app.title),
      el('p', { class: 'note' }, JA.disclaimer.fictional),
      el('div', { class: 'menu' }, [
        resumeBtn,
        el('button', { class: resumeBtn ? '' : 'primary', onclick: () => app.go({ name: 'select' }) }, JA.ui.start),
        el('button', { onclick: () => app.go({ name: 'history' }) }, JA.ui.history),
        el('button', { onclick: () => openSettings(app) }, JA.ui.settings),
        el('a', { href: `${import.meta.env.BASE_URL}editor.html` }, JA.editor.title),
      ]),
    ]),
  );
  return () => {};
}
