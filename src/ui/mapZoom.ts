/**
 * 2D 地図の拡大縮小とスクロール（振り返りの地図。ユーザーの指定）。
 * ホイール・ピンチ・ダブルクリックで拡大縮小（指した所を中心に）、ドラッグでスクロール、＋／−／全体のボタン。
 */
import { el } from './dom';
import { icon } from './icons';
import type { MapView } from './map2d';

const K_MAX = 10;

export function zoomableMap(canvas: HTMLCanvasElement, redraw: (view: MapView) => void): HTMLElement {
  const view: MapView = { u0: 0, v0: 0, k: 1 };
  let queued = false;
  const draw = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      redraw(view);
      zoomOut.disabled = view.k <= 1.0001;
      reset.disabled = view.k <= 1.0001;
      zoomIn.disabled = view.k >= K_MAX - 1e-4;
    });
  };
  const clampView = (): void => {
    view.k = Math.min(K_MAX, Math.max(1, view.k));
    const span = 1 / view.k;
    view.u0 = Math.min(1 - span, Math.max(0, view.u0));
    view.v0 = Math.min(1 - span, Math.max(0, view.v0));
  };
  /** 画面上の点 (fx, fy)（0..1）を動かさずに、拡大率を f 倍にする */
  const zoomAt = (fx: number, fy: number, f: number): void => {
    const u = view.u0 + fx / view.k;
    const v = view.v0 + fy / view.k;
    view.k *= f;
    clampView();
    view.u0 = u - fx / view.k;
    view.v0 = v - fy / view.k;
    clampView();
    draw();
  };
  const frac = (clientX: number, clientY: number): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [(clientX - r.left) / r.width, (clientY - r.top) / r.height];
  };
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const [fx, fy] = frac(e.clientX, e.clientY);
      zoomAt(fx, fy, Math.exp(-e.deltaY * 0.0018));
    },
    { passive: false },
  );
  canvas.addEventListener('dblclick', (e) => {
    const [fx, fy] = frac(e.clientX, e.clientY);
    zoomAt(fx, fy, e.shiftKey ? 0.5 : 2);
  });
  // ドラッグでスクロール、2 本指でピンチ
  const pts = new Map<number, { x: number; y: number }>();
  let pinchD = 0;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinchD = Math.hypot(a.x - b.x, a.y - b.y);
    }
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const r = canvas.getBoundingClientRect();
    if (pts.size === 1) {
      view.u0 -= (e.clientX - p.x) / r.width / view.k;
      view.v0 -= (e.clientY - p.y) / r.height / view.k;
      clampView();
      draw();
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD > 0 && d > 0) {
        const [fx, fy] = frac((a.x + b.x) / 2, (a.y + b.y) / 2);
        zoomAt(fx, fy, d / pinchD);
      }
      pinchD = d;
    }
  });
  const up = (e: PointerEvent): void => {
    pts.delete(e.pointerId);
    pinchD = 0;
    if (pts.size === 0) canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  const zoomIn = el('button', { type: 'button', class: 'mz-btn', title: '拡大', 'aria-label': '拡大', onclick: () => zoomAt(0.5, 0.5, 1.6) }, icon('add'));
  const zoomOut = el('button', { type: 'button', class: 'mz-btn', title: '縮小', 'aria-label': '縮小', onclick: () => zoomAt(0.5, 0.5, 1 / 1.6) }, icon('remove'));
  const reset = el('button', { type: 'button', class: 'mz-btn', title: '全体を表示', 'aria-label': '全体を表示', onclick: () => ((view.k = 1), (view.u0 = 0), (view.v0 = 0), draw()) }, icon('fitScreen'));
  draw();
  return el('div', { class: 'map-zoom' }, [canvas, el('div', { class: 'mz-ctrl' }, [zoomIn, zoomOut, reset]), el('p', { class: 'mz-hint' }, 'ホイール・ピンチで拡大縮小、ドラッグで移動')]);
}
