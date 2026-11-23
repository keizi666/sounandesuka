/**
 * トップの「みんなの遭難記録」の横長のバナー（ユーザーの指定: 水色の背景、角丸、白い文字）。
 * 押すと一覧へ。最近載せた人の顔と件数を、読めたら添える（読めなくてもバナーは出す）。
 */
import type { AppContext } from '../../app/App';
import { JA } from '../../i18n/ja';
import { fill } from '../../i18n/format';
import { communityApi } from '../../net/communityApi';
import type { PublicUser } from '../../net/communityTypes';
import { el } from '../dom';
import { cIcon, userAvatar } from './common';

/** 並べる顔の数 */
const FACES = 4;
/** 顔を集めるために読む記録の上限（同じ人が続けて載せていても、さかのぼって別の人を探す） */
const SCAN_MAX = 200;
const PAGE = 50;

/**
 * 新しい記録から順に、別々の人を FACES 人まで集める（ユーザーの指定: 同じ人の記録が続いても顔の数を減らさない）。
 * 件数（total）も返す
 */
async function recentPeople(): Promise<{ users: PublicUser[]; total: number }> {
  const seen = new Set<number>();
  const users: PublicUser[] = [];
  let total = 0;
  for (let offset = 0; offset < SCAN_MAX; offset += PAGE) {
    const r = await communityApi.list({ offset, limit: PAGE });
    total = r.total;
    for (const x of r.items) {
      if (seen.has(x.user.id)) continue;
      seen.add(x.user.id);
      users.push(x.user);
      if (users.length >= FACES) return { users, total };
    }
    if (r.items.length < PAGE || offset + r.items.length >= r.total) break;
  }
  return { users, total };
}

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
  void recentPeople()
    .then(({ users, total }) => {
      if (total === 0) return;
      faces.replaceChildren(...users.map((u) => userAvatar(u, 34)), el('small', {}, fill(C.total, { n: total })));
    })
    .catch(() => undefined);
  return b;
}
