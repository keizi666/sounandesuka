/**
 * 検証の窓: 項目ごとに、何が問題か・どう直すか・「直す」「場所を開く」のボタン。上に「自動で直せるものをまとめて直す」。
 */
import type { Issue } from '../sim/scenario/validate';
import { el } from '../ui/dom';
import type { Ed } from './context';
import { toLatLon } from './geo/projection';
import { fixAll, helpFor } from './issueFixes';

function locate(ed: Ed, i: Issue, close: () => void): void {
  const h = helpFor(ed.p, i);
  if (!h.locate) return;
  close();
  ed.goTab(h.locate.tab);
  const { kind, id } = h.locate;
  if (kind && id) {
    ed.select(kind, id);
    const n = kind === 'node' ? ed.p.map.nodes.find((x) => x.id === id) : null;
    const e = kind === 'edge' ? ed.p.map.edges.find((x) => x.id === id) : null;
    const at = n ?? (e ? (e.waypoints[Math.floor(e.waypoints.length / 2)] ? { x: e.waypoints[Math.floor(e.waypoints.length / 2)]![0], z: e.waypoints[Math.floor(e.waypoints.length / 2)]![1] } : ed.p.map.nodes.find((x) => x.id === e.from)) : null);
    if (at) {
      const ll = toLatLon(ed.view.lat0, ed.view.lon0, at.x, at.z);
      ed.view.setView(ll.lat, ll.lon, Math.max(ed.view.zoom, 15));
    }
  }
}

export function showIssuesDialog(ed: Ed): void {
  const dlg = el('dialog', { class: 'ed-dialog wide ed-issues-dlg' });
  const close = (): void => dlg.close();
  const render = (): void => {
    const iss = ed.issues();
    const fixable = iss.filter((i) => helpFor(ed.p, i).fix).length;
    const nErr = iss.filter((i) => i.level === 'error').length;
    const kids: (HTMLElement | null)[] = [
      el('h2', {}, '検証'),
      iss.length === 0
        ? el('p', {}, '問題はありません。')
        : el('p', { class: 'note' }, `${nErr ? `エラー（✖）が ${nErr} 件あります。エラーがあると試走・書き出しができません。` : 'エラーはありません。'}警告（⚠）は、そのままでも動きます。`),
      fixable > 0
        ? el('button', {
            class: 'primary',
            onclick: () => {
              let notes: string[] = [];
              ed.change('検証の項目をまとめて直す', () => (notes = fixAll(ed.p, ed.runtime(), ed.issues())), true);
              ed.toast(notes.length ? `${notes.join('。')}（Ctrl＋Z で戻せます）` : '自動で直せるものはありませんでした', 9000);
              render();
            },
          }, `自動で直せるものをまとめて直す（${fixable} 件）`)
        : null,
      iss.length === 0
        ? null
        : el(
            'ul',
            { class: 'issues' },
            iss.map((i) => {
              const h = helpFor(ed.p, i);
              return el('li', { class: i.level }, [
                el('div', { class: 'iss-head' }, [i.level === 'error' ? '✖ ' : '⚠ ', el('span', { class: 'iss-msg' }, i.message), el('code', {}, i.path)]),
                el('div', { class: 'iss-hint' }, h.hint),
                el('div', { class: 'iss-acts' }, [
                  h.fix
                    ? el('button', {
                        class: 'small primary',
                        onclick: () => {
                          let note = '';
                          ed.change(h.fix!.label, () => (note = h.fix!.run(ed.p, ed.runtime())), true);
                          if (note) ed.toast(`${note}（Ctrl＋Z で戻せます）`, 7000);
                          render();
                        },
                      }, `直す: ${h.fix.label}`)
                    : null,
                  h.locate ? el('button', { class: 'small', onclick: () => locate(ed, i, close) }, h.locate.id ? '地図で見る' : 'そのタブへ') : null,
                ]),
              ]);
            }),
          ),
      el('div', { class: 'actions' }, [el('button', { onclick: close }, '閉じる')]),
    ];
    dlg.replaceChildren(...kids.filter((k): k is HTMLElement => k !== null));
  };
  render();
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
