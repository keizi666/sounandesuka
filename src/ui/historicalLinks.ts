/**
 * 史実のシナリオの出典の一覧（公式の記録・Wikipedia などへのリンク。ユーザーの指定）。
 * リンクは利用者が押したときに新しいタブで開くだけで、アプリからは通信しない（鉄則 8 の通信には当たらない）。
 */
import { JA } from '../i18n/ja';
import type { HistoricalDef } from '../sim/types';
import { el } from './dom';
import { icon } from './icons';

export function historicalSources(h: HistoricalDef): HTMLElement {
  return el('div', { class: 'hist-src' }, [
    el('h3', {}, [icon('history'), JA.ui.historicalSources]),
    el('ul', {}, h.sources.map((x) => {
      const meta = [x.publisher, x.year].filter((v) => v !== undefined && v !== '').join('・');
      return el('li', {}, [
        x.url ? el('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.title) : el('span', {}, x.title),
        meta ? el('small', {}, `（${meta}）`) : null,
      ]);
    })),
  ]);
}
