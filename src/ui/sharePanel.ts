/**
 * プレイ中の「共有」のパネル（ユーザーの指定）。この場面の URL（短い URL）と、その QR コードを出す。
 * その場にいる人がスマホで QR コードを読めば、同じ場面からすぐに始められる。リンクのコピーと、SNS の投稿の画面・端末の共有（shareButtons）も。
 * アプリからは何も送らない（短い URL は自前の API で作る。端末の共有は OS の画面、SNS は新しいタブで開くだけ）
 */
import { JA } from '../i18n/ja';
import { el, toast } from './dom';
import { icon } from './icons';
import { qrCanvas } from './qr';
import { shareButtons, type ShareTarget } from './shareButtons';

/** link: この場面の短い URL と本文（作れなければ元の URL）。開いている間は onOpen/onClose で一時停止する */
export function openSharePanel(link: Promise<ShareTarget>, hooks: { onOpen?: () => void; onClose?: () => void } = {}): void {
  const C = JA.sharePanel;
  const qrBox = el('div', { class: 'shp-qr', role: 'img', 'aria-label': C.qrAlt }, el('p', { class: 'shp-wait' }, C.making));
  const input = el('input', { class: 'shp-url', type: 'text', readonly: true, value: '', 'aria-label': C.urlLabel, placeholder: C.making }) as HTMLInputElement;
  input.addEventListener('focus', () => input.select());
  const copy = el('button', { class: 'primary', type: 'button', disabled: true }, [icon('contentCopy'), C.copy]) as HTMLButtonElement;
  let ready: ShareTarget | null = null;
  copy.addEventListener('click', async () => {
    if (!ready) return;
    try {
      await navigator.clipboard.writeText(ready.url);
      toast(JA.ui.shareCopied, 3000);
    } catch {
      input.focus();
      input.select();
      toast(JA.ui.shareCopyManual, 4000);
    }
  });
  void link
    .then((t) => {
      ready = t;
      input.value = t.url;
      copy.disabled = false;
      const c = qrCanvas(t.url, 6);
      qrBox.replaceChildren(c ?? el('p', { class: 'shp-wait' }, C.tooLong));
    })
    .catch(() => qrBox.replaceChildren(el('p', { class: 'shp-wait' }, C.failed)));

  const dlg = el('dialog', { class: 'cap-dlg shp-dlg', 'aria-label': C.title }, [
    el('header', { class: 'cap-head' }, [
      el('h2', {}, [icon('share'), C.title]),
      el('button', { class: 'icon', type: 'button', title: `${JA.ui.close} (Esc)`, 'aria-label': JA.ui.close, onclick: () => dlg.close() }, icon('close')),
    ]),
    el('div', { class: 'shp-body' }, [
      qrBox,
      el('div', { class: 'shp-side' }, [
        el('p', { class: 'shp-lead' }, C.lead),
        el('div', { class: 'shp-row' }, [input]),
        el('div', { class: 'cap-actions shp-actions' }, [copy]),
        el('p', { class: 'shp-note' }, C.note),
      ]),
    ]),
    el('h3', { class: 'cap-sub' }, JA.capture.toSns),
    shareButtons(link, { noCopy: true }),
  ]);
  dlg.addEventListener('close', () => {
    dlg.remove();
    hooks.onClose?.();
  });
  document.body.append(dlg);
  hooks.onOpen?.();
  dlg.showModal();
}
