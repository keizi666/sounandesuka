/**
 * シナリオが終わったときの確認（ユーザーの指定: いきなり結果の画面へ飛ばず、結末を見せてから移る）。
 * 結末の見出しと文を出し、「結果を見る」で結果の画面へ。それまでは 3D の画面が残る（最後の場面を見られる）
 */
import { JA } from '../i18n/ja';
import { el } from './dom';
import { icon } from './icons';
import { endingTone } from './ending';

export function openEndConfirm(o: { kind: string; title: string; text: string; time: string; onGo: () => void }): () => void {
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
