/**
 * 記録への「参考になった」（ユーザーの指定: リピーターを増やす）。押すと記録を載せた人のトップページの「お知らせ」に届く。
 * 自分の記録には押せない（数だけ出す）。プロフィールがなければ、作ってから押せる。点数を競う形にはせず、静かな反応にとどめる。
 */
import { JA } from '../../i18n/ja';
import { communityApi } from '../../net/communityApi';
import type { RunSummary } from '../../net/communityTypes';
import { loadProfile } from '../../net/profile';
import { el, toast } from '../dom';
import { icon } from '../icons';
import { errorText } from './common';
import { openProfileDialog } from './profileDialog';

/** 押せるボタン（詳細の画面） */
export function likeButton(r: Pick<RunSummary, 'id' | 'mine' | 'likes' | 'liked'>): HTMLElement {
  const S = JA.social;
  let n = r.likes ?? 0;
  let on = r.liked === true;
  const b = el('button', { type: 'button', class: 'small lk-btn' }) as HTMLButtonElement;
  const paint = (): void => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.replaceChildren(icon(on ? 'thumbUpFill' : 'thumbUp'), S.like, ...(n > 0 ? [el('span', { class: 'lk-n' }, String(n))] : []));
  };
  paint();
  if (r.mine) {
    b.disabled = true;
    return b;
  }
  b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (!loadProfile()) {
      toast(S.likeNeedProfile, 5000);
      openProfileDialog(() => undefined);
      return;
    }
    b.disabled = true;
    try {
      const res = await communityApi.like(r.id, !on);
      n = res.likes;
      on = res.liked;
      paint();
    } catch (e) {
      toast(errorText(e), 5000);
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

/** 数だけ（一覧のカード。0 なら出さない） */
export function likeCount(r: Pick<RunSummary, 'likes' | 'liked'>): HTMLElement | null {
  if (!r.likes) return null;
  return el('span', { class: `lk-count${r.liked ? ' on' : ''}`, title: JA.social.like }, [icon(r.liked ? 'thumbUpFill' : 'thumbUp'), String(r.likes)]);
}
