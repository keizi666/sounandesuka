// シナリオエディターのエントリポイント（editor.html）。中身は P14 以降で作る。
import '../style.css';
import { JA } from '../i18n/ja';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  document.title = JA.editor.title;
  const h1 = document.createElement('h1');
  h1.textContent = JA.editor.title;
  const p = document.createElement('p');
  p.textContent = JA.editor.preparing;
  app.replaceChildren(h1, p);
}
