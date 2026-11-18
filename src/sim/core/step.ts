/**
 * 1 ティックの処理（docs/03 §4）。順番は固定（変えると決定論テストが壊れる）。
 * P4 時点では時刻・太陽・気象・地面・局地気象・移動・生理。後のフェーズで番号の位置に処理を足していく。
 */
import { updateCapacity } from '../climber/capacity';
import { integrateBody, thermalEnvFor, updateAnxiety } from '../climber/physiology';
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
  if (!c.body.alive) {
    c.speedMs = 0;
    c.metAct = 0;
    return;
  }
  const t = ctx.tuning;
  let walking = false;
  let grade = 0;
  // 8d. 状態ごとの行動（移動）
  switch (c.state) {
    case 'WALKING': {
      const r = walkStep(world, ctx, c, DT_SEC);
      walking = r.movedM > 0;
      grade = r.grade;
      break;
    }
    case 'RESTING':
      if (c.plan.restUntilMin !== null && world.tMin >= c.plan.restUntilMin - 1e-9) {
        c.plan.restUntilMin = null;
        transition(world, ctx, c, 'WALKING', 'restEnd');
      }
      break;
    default:
      break;
  }
  if (!walking) {
    c.speedMs = 0;
    c.metAct = t.physiology.stateMet[c.state] ?? t.movement.restMet;
  }
  // 8f. 生理
  const dtMin = DT_SEC / 60;
  integrateBody(c, thermalEnvFor(world, ctx, c), { metAct: c.metAct, grade, walking }, dtMin, t);
  updateAnxiety(world, c, dtMin, t);
  // 8h. 判断力・運動能力・段階・生死
  const checkTick = world.tick % (t.physiology.arrestCheckMin * TICKS_PER_MIN) === 0;
  updateCapacity(world, ctx, c, checkTick);
}
