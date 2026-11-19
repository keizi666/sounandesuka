/**
 * タイムラインのスライダー。表示中の時刻を中央に固定し、左が過去・右が未来。表示する時間の幅（窓）は時刻に合わせて動く。
 * - 線の上を押すとその時刻へ、左右にドラッグすると時間を前後に動かす（つまみは中央のまま、目盛りと点が流れる）
 * - 出来事の点（分岐点はひし形）を押すとその時刻へ。まだ来ていない未来（記録の先）は斜線で、そこへは進めない
 * - 窓の幅は 1・2・4・8 時間から選べる
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
  /** その時刻へ移る（ドラッグしている間も呼ばれる） */
  seek(tMin: number): void;
  /** いちばん新しい時刻へ戻る */
  latest(): void;
  formatTime(tMin: number): string;
}

export interface TimelineBar {
  el: HTMLElement;
  /** startMin: 記録の最初、endMin: 記録の最新（それより先へは進めない）、nowMin: 表示中の時刻 */
  update(startMin: number, endMin: number, nowMin: number, points: readonly TimelinePoint[]): void;
  dispose(): void;
}

const SPANS = [60, 120, 240, 480];

export function createTimelineBar(h: TimelineBarHandlers): TimelineBar {
  const past = el('div', { class: 'tl-past' });
  const future = el('div', { class: 'tl-future' });
  const ticks = el('div', { class: 'tl-ticks' });
  const pointsEl = el('div', { class: 'tl-points' });
  const thumb = el('div', { class: 'tl-thumb' });
  const tip = el('div', { class: 'tl-tip', hidden: true });
  const track = el('div', { class: 'tl-track', role: 'slider', tabindex: 0, 'aria-label': JA.ui.timeline }, [past, future, ticks, pointsEl, thumb, tip]);
  const leftLbl = el('span', { class: 'tl-lbl' });
  const rightLbl = el('span', { class: 'tl-lbl' });
  const nowLbl = el('span', { class: 'tl-now' });
  const latestBtn = el('button', { class: 'tl-latest', type: 'button', title: JA.ui.timelineLatest, 'aria-label': JA.ui.timelineLatest, onclick: () => h.latest() }, [icon('fastForward'), JA.ui.timelineLatest]);
  let spanIdx = 1;
  const spanBtns = SPANS.map((m, i) => {
    const b = el('button', { class: 'tl-span', type: 'button', title: `${m / 60}時間` }, `${m / 60}h`);
    b.addEventListener('click', () => {
      spanIdx = i;
      redraw(true);
    });
    return b;
  });
  const root = el('section', { class: 'timeline', 'aria-label': JA.ui.timeline }, [
    el('div', { class: 'tl-head' }, [el('span', { class: 'tl-title' }, [icon('history'), JA.ui.timeline]), nowLbl, el('span', { class: 'tl-spans', role: 'group', 'aria-label': JA.ui.timelineSpan }, spanBtns), latestBtn]),
    el('div', { class: 'tl-row' }, [leftLbl, track, rightLbl]),
  ]);

  let start = 0;
  let end = 0;
  let now = 0;
  let points: readonly TimelinePoint[] = [];
  let pointsKey = '';

  const span = (): number => SPANS[spanIdx]!;
  const winStart = (): number => now - span() / 2;
  const frac = (t: number): number => (t - winStart()) / span();
  const clampT = (t: number): number => Math.min(end, Math.max(start, t));
  const width = (): number => Math.max(1, track.getBoundingClientRect().width);
  const timeAtX = (clientX: number): number => winStart() + ((clientX - track.getBoundingClientRect().left) / width()) * span();

  function redraw(force = false): void {
    const ws = winStart();
    const we = ws + span();
    // 記録のある範囲（過去）と、まだ来ていない範囲（未来）
    const pa = Math.max(0, Math.min(1, frac(start)));
    const pb = Math.max(0, Math.min(1, frac(end)));
    past.style.left = `${pa * 100}%`;
    past.style.width = `${Math.max(0, pb - pa) * 100}%`;
    future.style.left = `${pb * 100}%`;
    future.style.width = `${Math.max(0, 1 - pb) * 100}%`;
    leftLbl.textContent = h.formatTime(ws);
    rightLbl.textContent = h.formatTime(we);
    const isPast = now < end - 0.5;
    nowLbl.textContent = isPast ? `${h.formatTime(now)}（${JA.ui.timelinePast}）` : h.formatTime(now);
    root.classList.toggle('past', isPast);
    latestBtn.hidden = !isPast;
    spanBtns.forEach((b, i) => b.classList.toggle('on', i === spanIdx));
    track.setAttribute('aria-valuetext', h.formatTime(now));
    // 目盛り: 窓の幅に合わせて 15 分・30 分・1 時間ごと
    const step = span() <= 60 ? 15 : span() <= 120 ? 30 : 60;
    const key = `${Math.floor(ws / step)}|${span()}|${points.length}|${Math.round(end)}`;
    if (key !== pointsKey || force) {
      pointsKey = key;
      const tk: HTMLElement[] = [];
      for (let t = Math.ceil(ws / step) * step; t <= we; t += step) {
        const major = t % 60 === 0;
        tk.push(el('span', { class: `tl-tick${major ? ' major' : ''}`, 'data-t': t }, major ? h.formatTime(t) : ''));
      }
      ticks.replaceChildren(...tk);
      pointsEl.replaceChildren(
        ...points
          .filter((p) => p.tMin >= ws - span() && p.tMin <= we + span())
          .map((p) => {
            const b = el('button', { class: `tl-point${p.choice ? ' choice' : ''}`, type: 'button', 'data-t': p.tMin, 'data-text': p.text, 'aria-label': `${h.formatTime(p.tMin)} ${p.text}` });
            b.addEventListener('pointerdown', (ev) => {
              ev.stopPropagation();
              h.seek(p.tMin);
            });
            return b;
          }),
      );
    }
    for (const t of ticks.children) (t as HTMLElement).style.left = `${frac(Number((t as HTMLElement).dataset['t'])) * 100}%`;
    for (const b of pointsEl.children) {
      const e = b as HTMLElement;
      const f = frac(Number(e.dataset['t']));
      e.style.left = `${f * 100}%`;
      e.hidden = f < -0.02 || f > 1.02;
    }
  }

  // ドラッグ: 少し動かしたら時間を前後に動かす（右へ動かすと先へ）。動かさずに離したら、押した所の時刻へ
  let drag: { id: number; x0: number; t0: number; moved: boolean } | null = null;
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, t0: now, moved: false };
    track.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x0;
      if (Math.abs(dx) > 4) drag.moved = true;
      if (drag.moved) h.seek(clampT(drag.t0 + (dx / width()) * span()));
    }
    const p = (e.target as HTMLElement).closest<HTMLElement>('.tl-point');
    const t = p ? Number(p.dataset['t']) : timeAtX(e.clientX);
    tip.hidden = false;
    tip.textContent = p?.dataset['text'] ? `${h.formatTime(t)} ${p.dataset['text']}` : h.formatTime(t);
    tip.style.left = `${Math.max(0, Math.min(1, frac(t))) * 100}%`;
  });
  const up = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) h.seek(clampT(timeAtX(e.clientX)));
    track.releasePointerCapture(e.pointerId);
    drag = null;
  };
  track.addEventListener('pointerup', up);
  track.addEventListener('pointercancel', () => (drag = null));
  track.addEventListener('pointerleave', () => {
    if (!drag) tip.hidden = true;
  });
  track.addEventListener('keydown', (e) => {
    const step = span() / 24;
    if (e.key === 'ArrowLeft') h.seek(clampT(now - step));
    else if (e.key === 'ArrowRight') h.seek(clampT(now + step));
    else if (e.key === 'End') h.latest();
    else if (e.key === 'Home') h.seek(start);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  return {
    el: root,
    update(s, e, n, pts) {
      start = s;
      end = Math.max(e, s);
      now = n;
      points = pts;
      redraw();
    },
    dispose() {
      root.remove();
    },
  };
}
