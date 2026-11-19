/**
 * タイムラインのスライダー。開始からいままでの時間を 1 本の線で表し、出来事の点（分岐点・到着・天気の変化・事故など）を並べる。
 * つまみを動かす・線の上を押す・点を押すと、その時刻へ戻る（進め直すこともできる）。
 */
import { JA } from '../i18n/ja';
import { el } from './dom';
import { icon } from './icons';

export interface TimelinePoint {
  tMin: number;
  text: string;
  /** 分岐点（選択）かどうか */
  choice: boolean;
}

export interface TimelineBarHandlers {
  /** その時刻へ移る（つまみを動かしている間も呼ばれる） */
  seek(tMin: number): void;
  /** いちばん新しい時刻へ戻る */
  latest(): void;
  formatTime(tMin: number): string;
}

export interface TimelineBar {
  el: HTMLElement;
  /** 表示の更新。start〜end が線の全体、now がつまみの位置 */
  update(startMin: number, endMin: number, nowMin: number, points: readonly TimelinePoint[]): void;
  dispose(): void;
}

export function createTimelineBar(h: TimelineBarHandlers): TimelineBar {
  const fill = el('div', { class: 'tl-fill' });
  const thumb = el('div', { class: 'tl-thumb' });
  const pointsEl = el('div', { class: 'tl-points' });
  const tip = el('div', { class: 'tl-tip', hidden: true });
  const track = el('div', { class: 'tl-track', role: 'slider', tabindex: 0, 'aria-label': JA.ui.timeline }, [fill, pointsEl, thumb, tip]);
  const startLbl = el('span', { class: 'tl-lbl' });
  const nowLbl = el('span', { class: 'tl-now' });
  const endLbl = el('span', { class: 'tl-lbl' });
  const latestBtn = el('button', { class: 'tl-latest', type: 'button', title: JA.ui.timelineLatest, 'aria-label': JA.ui.timelineLatest, onclick: () => h.latest() }, [icon('fastForward'), JA.ui.timelineLatest]);
  const root = el('section', { class: 'timeline', 'aria-label': JA.ui.timeline }, [
    el('div', { class: 'tl-head' }, [el('span', { class: 'tl-title' }, [icon('history'), JA.ui.timeline]), nowLbl, latestBtn]),
    el('div', { class: 'tl-row' }, [startLbl, track, endLbl]),
  ]);

  let start = 0;
  let end = 1;
  let now = 0;
  let pointsKey = '';
  let dragging = false;

  const frac = (t: number): number => (end > start ? Math.min(1, Math.max(0, (t - start) / (end - start))) : 1);
  const timeAt = (clientX: number): number => {
    const r = track.getBoundingClientRect();
    return start + Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width))) * (end - start);
  };
  const showTip = (t: number, text: string): void => {
    tip.hidden = false;
    tip.textContent = text ? `${h.formatTime(t)} ${text}` : h.formatTime(t);
    tip.style.left = `${frac(t) * 100}%`;
  };

  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    track.setPointerCapture(e.pointerId);
    h.seek(timeAt(e.clientX));
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => {
    const t = timeAt(e.clientX);
    if (dragging) h.seek(t);
    const p = (e.target as HTMLElement).closest<HTMLElement>('.tl-point');
    showTip(p ? Number(p.dataset['t']) : t, p?.dataset['text'] ?? '');
  });
  const end_ = (e: PointerEvent): void => {
    if (dragging) track.releasePointerCapture(e.pointerId);
    dragging = false;
  };
  track.addEventListener('pointerup', end_);
  track.addEventListener('pointercancel', end_);
  track.addEventListener('pointerleave', () => {
    if (!dragging) tip.hidden = true;
  });
  track.addEventListener('keydown', (e) => {
    const step = (end - start) / 40;
    if (e.key === 'ArrowLeft') h.seek(now - step);
    else if (e.key === 'ArrowRight') h.seek(now + step);
    else if (e.key === 'End') h.latest();
    else if (e.key === 'Home') h.seek(start);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  return {
    el: root,
    update(s, e, n, points) {
      start = s;
      end = Math.max(e, s + 1e-6);
      now = n;
      const f = frac(n);
      fill.style.width = `${f * 100}%`;
      thumb.style.left = `${f * 100}%`;
      startLbl.textContent = h.formatTime(s);
      endLbl.textContent = h.formatTime(e);
      const past = n < e - 0.5;
      nowLbl.textContent = past ? `${h.formatTime(n)}（${JA.ui.timelinePast}）` : h.formatTime(n);
      root.classList.toggle('past', past);
      latestBtn.hidden = !past;
      track.setAttribute('aria-valuetext', h.formatTime(n));
      // 点は、内容が変わったとき・範囲が変わったときに作り直す
      const key = `${points.length}|${Math.round(s)}|${Math.round(e)}`;
      if (key !== pointsKey) {
        pointsKey = key;
        pointsEl.replaceChildren(
          ...points.slice(-160).map((p) => {
            const b = el('button', { class: `tl-point${p.choice ? ' choice' : ''}`, type: 'button', 'data-t': p.tMin, 'data-text': p.text, 'aria-label': `${h.formatTime(p.tMin)} ${p.text}`, style: `left:${frac(p.tMin) * 100}%` });
            b.addEventListener('pointerdown', (ev) => {
              ev.stopPropagation();
              h.seek(p.tMin);
            });
            return b;
          }),
        );
      }
      for (const b of pointsEl.children) (b as HTMLElement).classList.toggle('future', Number((b as HTMLElement).dataset['t']) > n + 0.5);
    },
    dispose() {
      root.remove();
    },
  };
}
