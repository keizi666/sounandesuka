/**
 * 1 ティックの処理（docs/03 §4）。順番は固定（変えると決定論テストが壊れる）。
 * P2 時点では時刻・太陽・移動だけ。後のフェーズで番号の位置に処理を足していく。
 */
import { transition } from '../climber/state';
import { walkStep } from '../climber/walk';
import type { ClimberState, StaticContext, World } from '../types';
import { updateSun } from '../weather/sun';

/** シミュレーションの固定刻み（ゲーム内秒） */
export const DT_SEC = 10;

export function stepWorld(world: World, ctx: StaticContext): void {
  if (world.ended) return;
  if (world.pendingChoice && ctx.mode === 'interactive') return;
  // 1. 時刻
  world.tick += 1;
  world.tMin += DT_SEC / 60;
  // 2. 太陽高度・暗さ
  updateSun(world, ctx);
  // 3〜4. 気象・地面（P3） / 6〜7. イベント・分岐点（P5）
  // 8. 登山者（配列順）
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
