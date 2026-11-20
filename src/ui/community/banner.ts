/**
 * トップの「みんなの遭難記録」の横長のバナー（ユーザーの指定: 水色の背景、角丸、白い文字）。
 * 押すと一覧へ。最近載せた人の顔と件数を、読めたら添える（読めなくてもバナーは出す）。
 */
import type { AppContext } from '../../app/App';
import { JA } from '../../i18n/ja';
import { fill } from '../../i18n/format';
import { communityApi } from '../../net/communityApi';
import { el } from '../dom';
import { cIcon, userAvatar } from './common';

/** 右の飾りの山並み */
const RIDGE = '<svg viewBox="0 0 320 90" preserveAspectRatio="none" aria-hidden="true"><path d="M0 90 L40 52 L62 66 L110 18 L148 50 L176 34 L222 72 L262 40 L320 70 L320 90 Z" fill="rgba(255,255,255,0.16)"/><path d="M0 90 L58 64 L96 76 L150 44 L196 70 L240 58 L320 84 L320 90 Z" fill="rgba(255,255,255,0.14)"/></svg>';

export function communityBanner(app: AppContext): HTMLElement {
  const C = JA.community;
  const faces = el('span', { class: 'cm-bn-faces' });
  const ridge = el('span', { class: 'cm-bn-ridge' });
  ridge.innerHTML = RIDGE;
  const b = el('button', { type: 'button', class: 'cm-banner', onclick: () => app.go({ name: 'community' }) }, [
    ridge,
    el('span', { class: 'cm-bn-icon' }, cIcon('forum')),
    el('span', { class: 'cm-bn-text' }, [el('strong', {}, C.title), el('small', {}, C.bannerLead)]),
    faces,
    el('span', { class: 'cm-bn-go' }, [C.bannerCta, cIcon('chevronRight')]),
  ]);
  void communityApi
    .list({ limit: 5 })
    .then((r) => {
      if (r.total === 0) return;
      const seen = new Set<number>();
      const users = r.items.filter((x) => !seen.has(x.user.id) && seen.add(x.user.id)).slice(0, 4);
      faces.replaceChildren(...users.map((x) => userAvatar(x.user, 34)), el('small', {}, fill(C.total, { n: r.total })));
    })
    .catch(() => undefined);
  return b;
}
