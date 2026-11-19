/** 行動状態の遷移（docs/07 §2）。遷移は必ずここを通し、STATE イベントを出す */
import type { BehaviorState, ClimberState, StaticContext, World } from '../types';

export function transition(world: World, ctx: StaticContext, c: ClimberState, next: BehaviorState, reason: string): void {
  if (c.state === next) return;
  const prev = c.state;
  c.state = next;
  c.stateSinceMin = world.tMin;
  if (next === 'DESCENDING_DRAINAGE' && world.flags['descendedDrainage'] === undefined) world.flags['descendedDrainage'] = world.tMin;
  ctx.events.push({ tMin: world.tMin, type: 'STATE', climberId: c.id, data: { from: prev, to: next, reason } });
}
