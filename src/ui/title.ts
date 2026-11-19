/** タイトル画面（docs/11 §1） */
import { icon } from './icons';
import { versionLabel } from '../app/version';
import type { AppContext } from '../app/App';
import { loadEntry, loadIndex } from '../app/data';
import { loadResume, resumableScenarios } from '../app/storage';
import { JA } from '../i18n/ja';
import { el } from './dom';
import { progressTo, showLoading } from './loading';
import { isLocalHost } from '../app/local';
import { openSettings } from './settingsDialog';

export function showTitle(app: AppContext): () => void {
  const resumables = resumableScenarios();
  const resumeBtn =
    resumables.length > 0
      ? el('button', {
          class: 'primary',
          onclick: async () => {
            const ld = showLoading(JA.ui.loadingTitle);
            ld.step(JA.ui.loadingData, null);
            const id = resumables[0]!;
            const idx = await loadIndex();
            const e = idx.find((x) => x.id === id);
            const data = await loadResume(id);
            // 古い形式の保存は捨てられる。その場合はシナリオ選択へ進む
            if (!e || !data) {
              ld.done();
              app.go({ name: 'select' });
              return;
            }
            try {
              app.go({ name: 'sim', loaded: await loadEntry(e, progressTo(ld, { data: JA.ui.loadingData, terrain: JA.ui.loadingTerrain })), resume: data });
            } catch (err) {
              ld.done();
              throw err;
            }
          },
        }, [icon('playCircle'), JA.ui.resume])
      : null;
  app.root.append(
    el('main', { class: 'title' }, [
      el('h1', {}, JA.app.title),
      el('p', { class: 'note' }, JA.disclaimer.fictional),
      el('p', { class: 'note version' }, versionLabel()),
      el('div', { class: 'menu' }, [
        resumeBtn,
        el('button', { class: resumeBtn ? '' : 'primary', onclick: () => app.go({ name: 'select' }) }, [icon('hiking'), JA.ui.start]),
        el('button', { onclick: () => app.go({ name: 'history' }) }, [icon('history'), JA.ui.history]),
        el('button', { onclick: () => openSettings(app) }, [icon('settings'), JA.ui.settings]),
        // シナリオの作成・編集は手元（localhost）だけ
        isLocalHost() ? el('a', { href: `${import.meta.env.BASE_URL}editor.html` }, [icon('map'), JA.editor.title]) : null,
      ]),
    ]),
  );
  return () => {};
}
