/**
 * スクリーンショット・録画の確認の画面（ユーザーの指定）。保存・画像のコピー・端末の共有（画像や動画を付けて SNS へ送れる）と、
 * 各 SNS の投稿の画面を開くリンク（画像は付けられないので、保存してから添付してもらう）。
 * アプリからは何も送らない（端末の共有は OS の画面、リンクは新しいタブで開くだけ）
 */
import { fill } from '../i18n/format';
import { JA } from '../i18n/ja';
import { el, toast } from './dom';
import { icon } from './icons';
import { shareButtons, type ShareTarget } from './shareButtons';

export interface CaptureItem {
  blob: Blob;
  kind: 'image' | 'video';
  /** 保存するときのファイル名 */
  fileName: string;
  /** 共有の本文と URL */
  share: ShareTarget;
  /** 動画の長さ（秒） */
  sec?: number;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function openCaptureDialog(item: CaptureItem, onClose?: () => void): void {
  const C = JA.capture;
  const url = URL.createObjectURL(item.blob);
  const preview =
    item.kind === 'image'
      ? el('img', { class: 'cap-preview', src: url, alt: C.previewAlt })
      : el('video', { class: 'cap-preview', src: url, controls: true, playsinline: true, muted: false });
  const file = new File([item.blob], item.fileName, { type: item.blob.type });
  const canShareFile = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  const canCopy = item.kind === 'image' && typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
  const sizeMb = (item.blob.size / 1024 / 1024).toFixed(1);

  const save = el('button', { class: 'primary', type: 'button' }, [icon('download'), C.save]);
  save.addEventListener('click', () => {
    download(item.blob, item.fileName);
    toast(C.saved, 3000);
  });
  const copy = canCopy ? el('button', { type: 'button' }, [icon('contentCopy'), C.copyImage]) : null;
  copy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ [item.blob.type]: item.blob })]);
      toast(C.copied, 3000);
    } catch {
      toast(C.copyFailed, 4000);
    }
  });
  const device = canShareFile ? el('button', { type: 'button' }, [icon('share'), C.shareDevice]) : null;
  device?.addEventListener('click', () => {
    navigator.share({ files: [file], text: `${item.share.text} #${JA.share.hashtag}`, url: item.share.url }).catch(() => undefined);
  });

  const dlg = el('dialog', { class: 'cap-dlg', 'aria-label': item.kind === 'image' ? C.snapTitle : C.videoTitle }, [
    el('header', { class: 'cap-head' }, [
      el('h2', {}, [icon(item.kind === 'image' ? 'photoCamera' : 'videocam'), item.kind === 'image' ? C.snapTitle : C.videoTitle]),
      el('button', { class: 'icon', type: 'button', title: `${JA.ui.close} (Esc)`, 'aria-label': JA.ui.close, onclick: () => dlg.close() }, icon('close')),
    ]),
    preview,
    el('p', { class: 'cap-meta' }, item.kind === 'video' ? fill(C.videoMeta, { sec: Math.round(item.sec ?? 0), mb: sizeMb, ext: item.fileName.split('.').pop()?.toUpperCase() ?? '' }) : fill(C.imageMeta, { mb: sizeMb })),
    el('div', { class: 'cap-actions' }, [save, copy, device]),
    el('h3', { class: 'cap-sub' }, C.toSns),
    shareButtons(item.share, { note: canShareFile ? C.snsNoteDevice : C.snsNote }),
    item.kind === 'video' && item.fileName.endsWith('.webm') ? el('p', { class: 'cap-warn' }, C.webmNote) : null,
  ]);
  dlg.addEventListener('close', () => {
    dlg.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    onClose?.();
  });
  document.body.append(dlg);
  dlg.showModal();
}
