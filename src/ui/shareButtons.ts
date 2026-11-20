/**
 * SNS で共有するボタン（ユーザーの指定）。結果の画面と、トップ（このサービス自体）で使う。
 * 各サービスの「投稿の画面」を新しいタブで開くリンクだけで、アプリからは何も送らない（SDK・外部のスクリプトは読まない。NFR-09・鉄則 8）。
 * 押した後に URL を作るとポップアップとして止められるので、リンクの href は先に作っておく。
 */
import { fill } from '../i18n/format';
import { JA } from '../i18n/ja';
import { el, toast } from './dom';
import { icon } from './icons';

export interface ShareTarget {
  /** 本文（ハッシュタグは付けずに渡す） */
  text: string;
  url: string;
}

interface Service {
  id: string;
  label: string;
  /** ボタンの丸の中の字 */
  mark: string;
  href(t: ShareTarget, withTag: string): string;
}

const enc = encodeURIComponent;

const SERVICES: Service[] = [
  { id: 'x', label: 'X', mark: '𝕏', href: (t, tag) => `https://x.com/intent/post?text=${enc(tag)}&url=${enc(t.url)}` },
  { id: 'bsky', label: 'Bluesky', mark: 'B', href: (t, tag) => `https://bsky.app/intent/compose?text=${enc(`${tag}\n${t.url}`)}` },
  { id: 'threads', label: 'Threads', mark: '@', href: (t, tag) => `https://www.threads.net/intent/post?text=${enc(`${tag}\n${t.url}`)}` },
  { id: 'fb', label: 'Facebook', mark: 'f', href: (t) => `https://www.facebook.com/sharer/sharer.php?u=${enc(t.url)}` },
  { id: 'line', label: 'LINE', mark: 'L', href: (t) => `https://social-plugins.line.me/lineit/share?url=${enc(t.url)}&text=${enc(t.text)}` },
  { id: 'hatena', label: 'はてブ', mark: 'B!', href: (t) => `https://b.hatena.ne.jp/add?mode=confirm&url=${enc(t.url)}&title=${enc(t.text)}` },
];

/** このサービスの URL（公開先のトップ） */
export function siteUrl(): string {
  return new URL(import.meta.env.BASE_URL, location.origin).href;
}

/** 共有のボタンの並び。target が Promise なら、できるまで押せない */
export function shareButtons(target: ShareTarget | Promise<ShareTarget>, opts: { note?: string } = {}): HTMLElement {
  const C = JA.share;
  const links = SERVICES.map((s) =>
    el('a', { class: `sh-btn sh-${s.id}`, target: '_blank', rel: 'noopener noreferrer', 'aria-disabled': 'true', title: fill(C.on, { name: s.label }) }, [
      el('span', { class: 'sh-mark', 'aria-hidden': 'true' }, s.mark),
      el('span', { class: 'sh-lbl' }, s.label),
    ]) as HTMLAnchorElement,
  );
  let ready: ShareTarget | null = null;
  const copy = el('button', { class: 'sh-btn sh-copy', type: 'button', disabled: true, title: C.copy }, [el('span', { class: 'sh-mark', 'aria-hidden': 'true' }, icon('link')), el('span', { class: 'sh-lbl' }, C.copy)]);
  copy.addEventListener('click', async () => {
    if (!ready) return;
    try {
      await navigator.clipboard.writeText(ready.url);
      toast(C.copied, 3000);
    } catch {
      window.prompt(C.copyManual, ready.url);
    }
  });
  // 端末の共有（スマホなど。使えるときだけ出す）
  const device =
    typeof navigator.share === 'function'
      ? el('button', { class: 'sh-btn sh-device', type: 'button', disabled: true, title: C.device }, [el('span', { class: 'sh-mark', 'aria-hidden': 'true' }, icon('share')), el('span', { class: 'sh-lbl' }, C.device)])
      : null;
  device?.addEventListener('click', () => {
    if (!ready) return;
    navigator.share({ text: `${ready.text} #${C.hashtag}`, url: ready.url }).catch(() => undefined);
  });
  const apply = (t: ShareTarget): void => {
    ready = t;
    const tagged = `${t.text} #${C.hashtag}`;
    SERVICES.forEach((s, i) => {
      links[i]!.href = s.href(t, tagged);
      links[i]!.removeAttribute('aria-disabled');
    });
    (copy as HTMLButtonElement).disabled = false;
    if (device) (device as HTMLButtonElement).disabled = false;
  };
  if (target instanceof Promise) void target.then(apply).catch(() => apply({ text: C.siteText, url: siteUrl() }));
  else apply(target);
  return el('div', { class: 'share' }, [
    el('div', { class: 'sh-row' }, [...links, device, copy]),
    el('p', { class: 'sh-note' }, opts.note ?? C.note),
  ]);
}
