/**
 * 読み込み中の表示（シナリオのデータの取得、地形の準備、3D の山と森を作る間）。
 * 画面の上に重ねて、いまの段階と進み具合（分かるときは割合、分からないときは流れる帯）を出す。
 * 3D を作る間はメインスレッドが止まるが、回転と帯の動きは CSS の transform のアニメーションなので止まらない。
 * 1 つだけ出す（続けて呼ぶと同じ表示の段階を変える）。
 */
import { el } from './dom';

export interface Loading {
  /** 段階と進み具合（0..1。null なら不定） */
  step(label: string, frac?: number | null): void;
  done(): void;
}

let current: { ui: Loading; root: HTMLElement } | null = null;

export function showLoading(title: string): Loading {
  if (current) {
    current.root.querySelector('.ld-title')!.textContent = title;
    return current.ui;
  }
  const label = el('p', { class: 'ld-step' }, '');
  const bar = el('div', { class: 'ld-bar indeterminate' }, el('div', { class: 'ld-fill' }));
  const fill = bar.firstElementChild as HTMLElement;
  const root = el('div', { class: 'loading-overlay', role: 'status', 'aria-live': 'polite' }, [
    el('div', { class: 'ld-card' }, [el('div', { class: 'ld-spin', 'aria-hidden': 'true' }), el('p', { class: 'ld-title' }, title), label, bar]),
  ]);
  document.body.append(root);
  const ui: Loading = {
    step(text, frac = null) {
      label.textContent = text;
      if (frac === null || !Number.isFinite(frac)) {
        bar.classList.add('indeterminate');
        fill.style.transform = '';
      } else {
        bar.classList.remove('indeterminate');
        fill.style.transform = `scaleX(${Math.max(0.02, Math.min(1, frac))})`;
      }
    },
    done() {
      root.classList.add('out');
      setTimeout(() => root.remove(), 250);
      if (current?.root === root) current = null;
    },
  };
  current = { ui, root };
  return ui;
}

/** loadEntry の段階を表示の文に */
export function progressTo(ld: Loading, labels: { data: string; terrain: string }): (stage: 'data' | 'terrain', frac: number | null) => void {
  return (stage, frac) => ld.step(labels[stage], stage === 'data' ? frac : null);
}

/** 画面に描かせてから続ける（重い処理の前に、読み込み中の表示を先に出す） */
export function nextPaint(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}
