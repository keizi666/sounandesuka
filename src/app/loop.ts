/**
 * メインループ（docs/03 §6）: rAF ごとに経過時間から進めるティック数を決め、固定刻みで stepWorld する。
 * 描画は前後 2 状態を補間する。分岐点・結末で止まる。タブが隠れたら止める。
 */
import { stepWorld } from '../sim/core/step';
import type { SimEvent, StaticContext, World } from '../sim/types';
import { poseOf, type Pose } from '../view/sceneView';

/** 速度: 1 実秒あたりのティック数（×1 = ゲーム 1 分 / 実 1 秒 = 6 ティック） */
export const SPEEDS = { 0: 0, 1: 6, 4: 24, 15: 90, 60: 360 } as const;
export type Speed = keyof typeof SPEEDS;
const MAX_STEPS_PER_FRAME = 400;

export interface LoopHooks {
  render(world: World, prev: Record<string, Pose> | null, alpha: number, timeSec: number): void;
  onEvents(events: readonly SimEvent[]): void;
  onChoice(): void;
  onEnded(): void;
  /** UI の更新（4Hz） */
  onUi(): void;
  /** 自動一時停止するか（重要イベント） */
  shouldPause(e: SimEvent): boolean;
}

export class Loop {
  /** 既定の速さは ×4（ユーザーの指定） */
  speed: Speed = 4;
  paused = false;
  private acc = 0;
  private last = 0;
  private prev: Record<string, Pose> | null = null;
  private raf = 0;
  private lastUi = 0;
  private running = false;

  constructor(
    public world: World,
    public ctx: StaticContext,
    private hooks: LoopHooks,
  ) {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = (): void => {
    if (document.hidden) this.stop();
    else this.start();
  };

  /** 世界を差し替える（やり直し・再開） */
  reset(world: World): void {
    this.world = world;
    this.prev = null;
    this.acc = 0;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    const realDt = Math.min(now - this.last, 100);
    this.last = now;
    const w = this.world;
    if (!this.paused && !w.ended && !(w.pendingChoice && this.ctx.mode === 'interactive')) {
      this.acc += (realDt / 1000) * SPEEDS[this.speed];
    }
    let steps = 0;
    while (this.acc >= 1 && steps < MAX_STEPS_PER_FRAME) {
      this.prev = poseOf(w);
      stepWorld(w, this.ctx);
      steps += 1;
      this.acc -= 1;
      const evs = this.ctx.events.splice(0);
      this.hooks.onEvents(evs);
      if (evs.some((e) => this.hooks.shouldPause(e))) {
        this.paused = true;
        this.acc = 0;
        break;
      }
      if (w.pendingChoice && this.ctx.mode !== 'headless') {
        this.acc = 0;
        this.hooks.onChoice();
        break;
      }
      if (w.ended) {
        this.acc = 0;
        this.hooks.onEnded();
        break;
      }
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0;
    const alpha = Math.min(1, Math.max(0, this.acc));
    this.hooks.render(w, this.prev, alpha, now / 1000);
    if (now - this.lastUi > 250) {
      this.lastUi = now;
      this.hooks.onUi();
    }
    this.raf = requestAnimationFrame(this.frame);
  };
}
