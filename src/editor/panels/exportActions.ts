/**
 * 書き出し・3D で遊ぶ（docs/18 §6.3、§8、docs/15 §5.2）。
 */
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { toBundle } from '../store/project';

function download(name: string, text: string): void {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/** 初回の権利確認（標高を加工したデータを公開する前に、作者が規約を確認する） */
function confirmRights(ed: Ed): Promise<boolean> {
  if (!ed.p.map.geo || ed.p.editorState.rightsConfirmed) return Promise.resolve(true);
  return new Promise((resolve) => {
    const chk = el('input', { type: 'checkbox' });
    const ok = el('button', { class: 'primary', disabled: true }, '書き出す');
    chk.addEventListener('change', () => (ok.disabled = !chk.checked));
    const dlg = el('dialog', { class: 'ed-dialog' }, [
      el('h2', {}, '書き出しの前に'),
      el('p', {}, 'このバンドルには、国土地理院の標高タイルを加工した地形が含まれます。OpenStreetMap の登山道を含む場合は ODbL の派生データベースになります。'),
      el('p', {}, 'サーバーで一般に公開する前に、国土地理院コンテンツ利用規約と測量法上の承認の要否、OpenStreetMap のライセンス（ODbL）をご自身で確認してください。出典はバンドルに自動で入ります。'),
      el('label', { class: 'f-check' }, [chk, '確認した']),
      el('div', { class: 'actions' }, [ok, el('button', { onclick: () => dlg.close() }, 'やめる')]),
    ]);
    ok.addEventListener('click', () => {
      ed.change('権利確認', () => (ed.p.editorState.rightsConfirmed = true));
      dlg.close('ok');
    });
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

function hasErrors(ed: Ed): boolean {
  const n = ed.issues().filter((i) => i.level === 'error').length;
  if (n > 0) ed.toast(`検証エラーが ${n} 件あります。直してから実行してください。`, 5000);
  return n > 0;
}

export async function exportBundle(ed: Ed): Promise<void> {
  if (hasErrors(ed)) return;
  if (!(await confirmRights(ed))) return;
  const b = toBundle(ed.p);
  download(`${b.scenario.id}.hakoniwa.json`, JSON.stringify(b));
}

/** 既存マップ（箱庭岳など）を使うシナリオのとき、シナリオ JSON だけを書き出す */
export function exportScenarioOnly(ed: Ed): void {
  if (hasErrors(ed)) return;
  download(`${ed.p.scenario.id}.json`, JSON.stringify(ed.p.scenario, null, 2));
}

/** 保存してから、プレイヤー画面を新しいタブで開く（IndexedDB 経由で受け渡す） */
export async function playIn3d(ed: Ed): Promise<void> {
  if (hasErrors(ed)) return;
  await ed.save();
  window.open(`${import.meta.env.BASE_URL}index.html?bundle=editor:${encodeURIComponent(ed.p.id)}`, '_blank');
}
