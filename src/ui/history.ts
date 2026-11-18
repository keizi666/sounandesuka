/** 実行履歴（FR-41） */
import type { AppContext } from '../app/App';
import { loadHistory } from '../app/storage';
import { JA } from '../i18n/ja';
import { el } from './dom';

export function showHistory(app: AppContext): () => void {
  const h = loadHistory().slice().reverse();
  app.root.append(
    el('main', { class: 'history' }, [
      el('header', {}, [el('button', { onclick: () => app.go({ name: 'title' }) }, JA.ui.back), el('h1', {}, JA.ui.historyTitle)]),
      h.length === 0
        ? el('p', {}, JA.ui.noHistory)
        : el('table', {}, [
            el('tr', {}, ['日時', 'シナリオ', '結末', '選択'].map((x) => el('th', {}, x))),
            ...h.map((e) =>
              el('tr', {}, [
                el('td', {}, new Date(e.at).toLocaleString('ja-JP')),
                el('td', {}, e.title),
                el('td', {}, JA.endings[e.ending]?.title ?? e.ending),
                el('td', {}, e.choices.join('、')),
              ]),
            ),
          ]),
    ]),
  );
  return () => {};
}
