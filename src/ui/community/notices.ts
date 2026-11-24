/**
 * トップの「お知らせ」（ユーザーの指定: リピーターを増やす）。前に見たとき（端末に覚えた時刻）より後に、
 * 自分の記録に付いた「参考になった」と、自分の挑戦状への答えを出す。プロフィールがなければ出さない。
 * 初めてのときは時刻を覚えるだけ（それまでのものは出さない）。出したら時刻を進める。
 */
import type { AppContext } from '../../app/App';
import { JA } from '../../i18n/ja';
import { fill } from '../../i18n/format';
import { communityApi } from '../../net/communityApi';
import { loadProfile } from '../../net/profile';
import { el } from '../dom';
import { icon } from '../icons';
import { userAvatar } from './common';

const SINCE_KEY = 'hks.v1.noticeSince';

function readSince(): string {
  try {
    return localStorage.getItem(SINCE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeSince(iso: string): void {
  try {
    localStorage.setItem(SINCE_KEY, iso);
  } catch {
    // 覚えられなければ、次も同じものが出る
  }
}

/** お知らせの欄（何もなければ隠れたまま） */
export function noticesStrip(app: AppContext): HTMLElement {
  const S = JA.social;
  const box = el('section', { class: 'nt-strip', hidden: true, 'aria-live': 'polite' });
  if (!loadProfile()) return box;
  const since = readSince();
  void communityApi
    .notices(since)
    .then((r) => {
      writeSince(r.now);
      const rows: HTMLElement[] = [];
      for (const l of r.likes)
        rows.push(el('li', {}, [el('button', { type: 'button', class: 'nt-row', onclick: () => app.go({ name: 'communityRun', id: l.runId }) }, [icon('thumbUpFill'), el('span', {}, fill(S.noticeLikes, { title: l.scenarioTitle, n: l.n }))])]));
      for (const a of r.answers)
        rows.push(el('li', {}, [el('div', { class: 'nt-row' }, [a.user ? userAvatar(a.user, 22) : icon('mail'), el('span', {}, fill(S.noticeAnswer, { who: a.user?.nickname ?? S.anonymous, title: a.scenarioTitle, ending: a.endingTitle }))])]));
      if (rows.length === 0) return;
      const close = el('button', { type: 'button', class: 'nt-close', title: S.close, 'aria-label': S.close, onclick: () => (box.hidden = true) }, icon('close'));
      box.replaceChildren(el('h2', {}, [icon('notifications'), S.noticesTitle]), close, el('ul', {}, rows));
      box.hidden = false;
    })
    .catch(() => undefined);
  return box;
}
