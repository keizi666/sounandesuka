/**
 * 時間を戻す（タイムラインの時刻へ移る・分岐点の場面へ戻る・過去からやり直す）。simScreen.ts から分けた。
 */
import type { Loop } from '../app/loop';
import type { Timeline, TimelineSnap } from '../app/timeline';
import { JA } from '../i18n/ja';
import type { RecorderState } from '../sim/record/recorder';
import type { StaticContext, World } from '../sim/types';
import { toast } from './dom';
import type { SimResult } from './simCommon';
import type { Hud } from './simHud';

export interface TimeTravelDeps {
  world: World;
  recorder: RecorderState;
  ctx: StaticContext;
  loop: () => Loop;
  timeline: Timeline;
  snapshots: SimResult['choiceSnapshots'];
  hud: Hud;
  /** 開いている選択肢の窓を閉じる */
  closeChoice(): void;
  refresh(force?: boolean): void;
  /** 回答待ちの分岐点の選択肢を出す */
  onChoice(): void;
}

export interface TimeTravel {
  /** タイムラインの時刻へ移る。その時刻以前でいちばん新しい写しを表示し、一時停止する（描く前に applySeek で当てる） */
  seekTo(tMin: number): void;
  applySeek(): void;
  /** 過去を表示していたなら、そこからやり直す（それより先の写し・ログ・分岐点の記録を捨てる） */
  truncateIfPast(): void;
  /**
   * 分岐点の場面へ戻る（ログの「この場面へ」・タイムラインの分岐点の印）。選択肢が出た瞬間の写しに戻し、選択肢の窓を出す。
   * 選び直すと、そこから先をやり直す（それまでは「最新へ」で戻れる）。写しがなければ、その時刻へ移る
   */
  jumpToChoice(tMin: number): void;
  /** 再生に入る直前: 過去を表示していたなら、そこからやり直す */
  beforePlay(): void;
}

/** 写しの中身で、いまの世界と記録を置き換える（同じオブジェクトのまま中身を入れ替える） */
function replaceInPlace(target: object, src: object): void {
  for (const k of Object.keys(target)) delete (target as Record<string, unknown>)[k];
  Object.assign(target, src);
}

export function createTimeTravel(d: TimeTravelDeps): TimeTravel {
  const { world, recorder, timeline, snapshots, hud } = d;
  let queued: number | null = null;
  const atLatest = (): boolean => world.tMin >= timeline.endMin - 1e-6;
  const restore = (w: World, r: RecorderState): void => {
    d.closeChoice();
    replaceInPlace(world, structuredClone(w));
    replaceInPlace(recorder, structuredClone(r));
    d.ctx.events.length = 0;
    const loop = d.loop();
    loop.reset(world);
    loop.paused = true;
    hud.setCutoff(world.tMin < timeline.endMin - 1e-6 ? world.tMin : null);
    d.refresh(true);
  };
  const tt: TimeTravel = {
    seekTo(tMin) {
      if (world.ended) return;
      // いまが最新なら、戻る前に最新の状態も写しておく（「最新へ」で戻れるように）
      if (atLatest()) timeline.capture(world, recorder, true);
      queued = tMin;
    },
    applySeek() {
      if (queued === null) return;
      const snap: TimelineSnap | null = timeline.at(queued);
      queued = null;
      if (!snap || Math.abs(snap.tMin - world.tMin) < 1e-6) return;
      restore(snap.world, snap.recorder);
    },
    truncateIfPast() {
      if (atLatest()) return;
      timeline.truncateAfter(world.tMin);
      for (const [id, sn] of Object.entries(snapshots)) if (sn.world.tMin > world.tMin + 1e-6) delete snapshots[id];
      hud.truncate(world.tMin);
      toast(JA.ui.timelineRewound, 3500);
    },
    jumpToChoice(tMin) {
      if (world.ended) return;
      const found = Object.values(snapshots).find((sn) => Math.abs(sn.world.tMin - tMin) < 0.05);
      if (!found || !found.world.pendingChoice) {
        tt.seekTo(tMin);
        return;
      }
      if (atLatest()) timeline.capture(world, recorder, true);
      restore(found.world, found.recorder);
      toast(JA.ui.jumpedToChoice, 3500);
      d.onChoice();
    },
    beforePlay() {
      tt.truncateIfPast();
      // 分岐点の回答待ちで止まっている時刻へ戻った場合は、選択肢を出し直す
      if (world.pendingChoice) window.setTimeout(() => d.onChoice(), 0);
    },
  };
  return tt;
}
