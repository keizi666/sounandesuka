/**
 * URL の状況から場面を作り直す（src/app/shareState.ts）。最初から同じ選択で進め直し、URL の時刻で止める。
 * シミュレーションは決定論的なので、同じシナリオ・条件・選択・遊び方なら、同じ場面になる。
 * 画面で選んだ選択は同じ選択肢を選び直し、その人らしく自動で決めた選択は同じように自動で決め直す（乱数の進み方を合わせる）。
 */
import type { SharedState } from '../app/shareState';
import { stepWorld } from '../sim/core/step';
import { autoResolve, resolveChoice } from '../sim/scenario/choices';
import type { SimEvent, StaticContext, World } from '../sim/types';

export interface ReplayResult {
  /** 記録の選択を最後まで当てられたか（シナリオが変わったなどで合わなければ false。そこまでの場面で止まる） */
  complete: boolean;
}

/** 時刻の一致の許し（分） */
const T_EPS = 1e-3;
/** 進め直す上限（無限ループよけ。10 秒刻みで 30 日分） */
const MAX_TICKS = 30 * 24 * 360;

/**
 * world を state の場面まで進める。onEvents にはティックと選択で出た出来事を順に渡す（tick: ティックの中で出たか）
 */
export function replayTo(world: World, ctx: StaticContext, state: SharedState, onEvents: (evs: readonly SimEvent[], tick: boolean) => void): ReplayResult {
  const ds = state.d;
  let i = 0;
  for (let n = 0; n < MAX_TICKS && !world.ended; n += 1) {
    const next = ds[i];
    // 記録の選択の時刻を過ぎたのに、その分岐点が出ていない: もう合わない
    if (next && next[2] < world.tMin - T_EPS) return { complete: false };
    const p = world.pendingChoice;
    if (p) {
      if (next && next[0] === p.cpId && Math.abs(next[2] - world.tMin) < T_EPS) {
        if (next[3] === 'u') resolveChoice(world, ctx, next[1], 'user');
        else if (autoResolve(world, ctx, 'bias') !== next[1]) {
          onEvents(ctx.events.splice(0), false);
          return { complete: false };
        }
        i += 1;
        onEvents(ctx.events.splice(0), false);
        continue;
      }
      // 選ぶ前の場面（時間制限ありでは、待つ間も時間が進む）
      if (ctx.mode !== 'timed') return { complete: i >= ds.length };
    }
    if (world.tMin >= state.t - T_EPS && (!next || next[2] > world.tMin + T_EPS)) break;
    stepWorld(world, ctx);
    onEvents(ctx.events.splice(0), true);
  }
  return { complete: i >= ds.length };
}
