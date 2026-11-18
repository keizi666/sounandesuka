/**
 * 1 ティックの処理（docs/03 §4）。順番は固定（変えると決定論テストが壊れる）。
 * P3 時点では時刻・太陽・気象・地面・局地気象・移動。後のフェーズで番号の位置に処理を足していく。
 */
import { transition } from '../climber/state';
import { walkStep } from '../climber/walk';
import type { ClimberState, StaticContext, World } from '../types';
import { updateGlobal } from '../weather/global';
import { updateGround } from '../weather/ground';
import { updateClimberLocal } from '../weather/local';
import { updateSun } from '../weather/sun';
import { scenarioStartMin } from './clock';

/** シミュレーションの固定刻み（ゲーム内秒） */
export const DT_SEC = 10;
/** 1 ゲーム分あたりのティック数 */
export const TICKS_PER_MIN = 60 / DT_SEC;

export function stepWorld(world: World, ctx: StaticContext): void {
  if (world.ended) return;
  if (world.pendingChoice && ctx.mode === 'interactive') return;
  // 1. 時刻（足し算の誤差をためないよう、開始時刻とティック数から求める）
  world.tick += 1;
  world.tMin = scenarioStartMin(ctx.scenario) + world.tick / TICKS_PER_MIN;
  // 2. 太陽高度・暗さ
  updateSun(world, ctx);
  // 3. 全体気象
  updateGlobal(world, ctx);
  // 4. 地面（1 ゲーム分ごと）
  if (world.tick % TICKS_PER_MIN === 0) updateGround(world, ctx);
  // 6〜7. イベント・分岐点（P5）
  // 8a. 局地気象
  updateClimberLocal(world, ctx);
  // 8b〜. 登山者（配列順）
  for (const c of world.climbers) stepClimber(world, ctx, c);
  // 9〜12. パーティ・救助・結末・記録（P5〜P7）
}

function stepClimber(world: World, ctx: StaticContext, c: ClimberState): void {
  switch (c.state) {
    case 'WALKING':
      walkStep(world, ctx, c, DT_SEC);
      break;
    case 'RESTING':
      c.speedMs = 0;
      c.metAct = ctx.tuning.movement.restMet;
      if (c.plan.restUntilMin !== null && world.tMin >= c.plan.restUntilMin - 1e-9) {
        c.plan.restUntilMin = null;
        transition(world, ctx, c, 'WALKING', 'restEnd');
      }
      break;
    default:
      c.speedMs = 0;
      c.metAct = ctx.tuning.movement.restMet;
  }
}
