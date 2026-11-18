// プレイヤーのエントリポイント（index.html）。画面は P10 以降で作る。
import './style.css';
import { JA } from './i18n/ja';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  document.title = JA.app.title;
  const h1 = document.createElement('h1');
  h1.textContent = JA.app.title;
  const p = document.createElement('p');
  p.textContent = JA.app.preparing;
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = JA.disclaimer.fictional;
  app.replaceChildren(h1, p, note);
}
