/**
 * シミュレーション画面のキー操作（Space: 再生・一時停止、1〜4: 速さ、G: 神の視点、C: カメラ）。simScreen.ts から分けた。
 */
import type { Loop, Speed } from '../app/loop';

const SPEED_KEYS: Speed[] = [1, 4, 15, 60];

export function createKeyHandler(d: {
  /** 選択肢の窓が開いているなど、キーを受け付けないとき */
  blocked(): boolean;
  loop(): Loop;
  beforePlay(): void;
  cycleCamera(): void;
  refresh(): void;
}): (e: KeyboardEvent) => void {
  return (e) => {
    if (d.blocked() || (e.target as HTMLElement).closest('input,select,textarea,dialog')) return;
    const loop = d.loop();
    if (e.key === ' ') {
      if (loop.paused) d.beforePlay();
      loop.paused = !loop.paused;
      e.preventDefault();
    } else if (/^[1-4]$/.test(e.key)) {
      loop.speed = SPEED_KEYS[Number(e.key) - 1]!;
      d.beforePlay();
      loop.paused = false;
    } else if (e.key === 'c' || e.key === 'C') d.cycleCamera();
    else return;
    d.refresh();
  };
}
