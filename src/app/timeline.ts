/**
 * 時間を戻すための記録（タイムライン）。一定のゲーム内時間ごとに、世界と記録の写しを取っておく。
 * 戻すときは、指定した時刻以前でいちばん新しい写しを使う。戻した先から進め直すと、それより後の写しは捨てる。
 * 写しはメモリにだけ持つ（保存データには入れない）。
 */
import type { RecorderState } from '../sim/record/recorder';
import type { World } from '../sim/types';

export interface TimelineSnap {
  tMin: number;
  world: World;
  recorder: RecorderState;
}

/** 写しの上限。超えたら古い側を 1 つおきに間引く */
const MAX_SNAPS = 420;

export class Timeline {
  private snaps: TimelineSnap[] = [];

  /** everyMin: 写しを取る間隔（ゲーム内分） */
  constructor(private everyMin: number) {}

  /** 前の写しから everyMin 以上たっていれば写しを取る。force で必ず取る */
  capture(world: World, recorder: RecorderState, force = false): void {
    const last = this.snaps[this.snaps.length - 1];
    if (!force && last && world.tMin - last.tMin < this.everyMin) return;
    if (last && Math.abs(world.tMin - last.tMin) < 1e-6) this.snaps.pop();
    this.snaps.push({ tMin: world.tMin, world: structuredClone(world), recorder: structuredClone(recorder) });
    if (this.snaps.length > MAX_SNAPS) {
      // 古い半分を 1 つおきに間引く（最初の 1 つは残す）
      const half = Math.floor(this.snaps.length / 2);
      this.snaps = [...this.snaps.slice(0, half).filter((_, i) => i % 2 === 0), ...this.snaps.slice(half)];
    }
  }

  get startMin(): number {
    return this.snaps[0]?.tMin ?? 0;
  }

  get endMin(): number {
    return this.snaps[this.snaps.length - 1]?.tMin ?? 0;
  }

  get count(): number {
    return this.snaps.length;
  }

  /** tMin 以前でいちばん新しい写し */
  at(tMin: number): TimelineSnap | null {
    let lo = 0;
    let hi = this.snaps.length - 1;
    let best: TimelineSnap | null = this.snaps[0] ?? null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = this.snaps[mid]!;
      if (s.tMin <= tMin + 1e-6) {
        best = s;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best;
  }

  /** tMin より後の写しを捨てる（戻した先から進め直すとき） */
  truncateAfter(tMin: number): void {
    this.snaps = this.snaps.filter((s) => s.tMin <= tMin + 1e-6);
  }
}
