/** 行動状態の遷移（docs/07 §2）。遷移は必ずここを通し、STATE イベントを出す */
import type { BehaviorState, ClimberState, StaticContext, World } from '../types';

/** 遭難が起きたとみなす状態（このあと、生き残った人が全員安全になれば結末にする。scenario/endings.ts） */
const INCIDENT_STATES = new Set<BehaviorState>(['LOST_AWARE', 'BACKTRACKING', 'NAVIGATING_TO_TRAIL', 'DESCENDING_DRAINAGE', 'SEEKING_SIGNAL', 'BIVOUAC', 'WAITING_RESCUE', 'INCAPACITATED', 'UNCONSCIOUS', 'DEAD']);

export function transition(world: World, ctx: StaticContext, c: ClimberState, next: BehaviorState, reason: string): void {
  if (c.state === next) return;
  const prev = c.state;
  c.state = next;
  c.stateSinceMin = world.tMin;
  if (next === 'DESCENDING_DRAINAGE' && world.flags['descendedDrainage'] === undefined) world.flags['descendedDrainage'] = world.tMin;
  if (INCIDENT_STATES.has(next)) world.latches['incident'] = true;
  ctx.events.push({ tMin: world.tMin, type: 'STATE', climberId: c.id, data: { from: prev, to: next, reason } });
}
