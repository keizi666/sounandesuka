/**
 * シナリオが終わったときの確認（ユーザーの指定: いきなり結果の画面へ飛ばず、結末を見せてから移る）。
 * 結末の見出しと文を出し、「結果を見る」で結果の画面へ。それまでは 3D の画面が残る（最後の場面を見られる）。
 * これまでの選択の一覧も出し、選ぶとその分岐点の場面に戻って選び直せる（ユーザーの指定）
 */
import { JA } from '../i18n/ja';
import { el } from './dom';
import { icon } from './icons';
import { endingTone } from './ending';

export interface EndChoice {
  time: string;
  label: string;
  /** その分岐点の場面へ戻る */
  onPick: () => void;
}

export function openEndConfirm(o: { kind: string; title: string; text: string; time: string; onGo: () => void; choices?: EndChoice[] }): () => void {
  let done = false;
  const go = (): void => {
    if (done) return;
    done = true;
    dlg.close();
    o.onGo();
  };
  const dlg = el('dialog', { class: `end-confirm tone-${endingTone(o.kind)}`, 'aria-label': JA.ui.endConfirmTitle }, [
    el('p', { class: 'ec-kicker' }, [JA.ui.endConfirmTitle, el('time', {}, o.time)]),
    el('h2', {}, o.title),
    o.text ? el('p', { class: 'ec-text' }, o.text) : null,
    o.choices && o.choices.length > 0
      ? el('details', { class: 'ec-choices' }, [
          el('summary', {}, [icon('history'), JA.ui.endBackToChoice]),
          el('p', { class: 'ec-choices-note' }, JA.ui.endBackToChoiceNote),
          el(
            'ol',
            {},
            o.choices.map((c) =>
              el('li', {}, [
                el('button', {
                  type: 'button',
                  onclick: () => {
                    if (done) return;
                    done = true;
                    dlg.remove();
                    c.onPick();
                  },
                }, [el('time', {}, c.time), el('span', { class: 'ec-dia', 'aria-hidden': 'true' }, '◆'), el('span', {}, c.label), icon('chevronRight')]),
              ]),
            ),
          ),
        ])
      : null,
    el('div', { class: 'ec-actions' }, [el('button', { class: 'primary big', type: 'button', onclick: go }, [JA.ui.endConfirmGo, icon('chevronRight')])]),
  ]);
  // Esc でも閉じずに結果へ（閉じるだけで先へ進めなくなるのを避ける）
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    go();
  });
  document.body.append(dlg);
  dlg.showModal();
  return () => {
    done = true;
    dlg.remove();
  };
}
