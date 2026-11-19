/**
 * いまどこにいるか・何をしているか（セリフ・考え・行動の選び方が、その場に合うように）。
 * 小屋の中で「しゃがんで！」、ビバーク中に「少し休もうか」、のような食い違いをなくすために使う。
 */
import type { ClimberState, MapRuntime } from '../types';

/** 休むのにふつう使う所: 小屋（避難小屋・営業小屋）と、茶屋・休憩所 */
export function restSpot(n: { shelter?: unknown; type: string; name: string } | undefined): boolean {
  return n !== undefined && (n.shelter !== undefined || n.type === 'hut' || n.type === 'shelter' || /茶屋|小屋|山荘|休憩所/.test(n.name));
}

export const HUT_HERE_M = 80;

/** 小屋・茶屋のところにいるか（その地点か、いま通った地点がそれで 80 m 以内。1 ティックで地点を通り過ぎることがあるので） */
export function hutHere(map: MapRuntime, c: ClimberState): boolean {
  if (c.pos.mode === 'node') return restSpot(map.nodes[c.pos.nodeId]);
  const id = c.plan.route[c.plan.routeIndex - 1];
  const n = id !== undefined ? map.nodes[id] : undefined;
  return n !== undefined && restSpot(n) && (n.x - c.x) * (n.x - c.x) + (n.z - c.z) * (n.z - c.z) <= HUT_HERE_M * HUT_HERE_M;
}

/** 屋根の下にいるか（小屋に入っている、小屋・茶屋で休んでいる）。下山・救助の後は外の天気に関係しない */
export function isIndoors(map: MapRuntime, c: ClimberState): boolean {
  if (c.state === 'SHELTERED' || c.state === 'FINISHED' || c.state === 'RESCUED' || c.offMap) return true;
  return c.state === 'RESTING' && hutHere(map, c);
}

/** 歩いて動いているか（道の上でも外でも） */
export const MOVING_STATES = new Set(['WALKING', 'OFFROUTE_UNAWARE', 'LOST_AWARE', 'BACKTRACKING', 'NAVIGATING_TO_TRAIL', 'DESCENDING_DRAINAGE', 'SEEKING_SIGNAL']);
export function isMoving(c: ClimberState): boolean {
  return MOVING_STATES.has(c.state);
}
