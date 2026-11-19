/**
 * いまどこにいるか・何をしているか（セリフ・考え・行動の選び方が、その場に合うように）。
 * 小屋の中で「しゃがんで！」、ビバーク中に「少し休もうか」、のような食い違いをなくすために使う。
 */
import type { ClimberState, MapRuntime } from '../types';

/** 休むのにふつう使う所: 小屋（避難小屋・営業小屋）と、茶屋・休憩所 */
export function restSpot(n: { shelter?: { open?: boolean }; type: string; name: string } | undefined): boolean {
  if (n === undefined) return false;
  // 休業中・閉鎖・廃屋の小屋は、屋根の下で休む所にならない（営業の有無はシナリオの nodeOverrides で変わるので、名前で見る）
  if (/休業|閉鎖|廃/.test(n.name)) return false;
  if (n.shelter !== undefined || n.type === 'hut' || n.type === 'shelter') return true;
  // 名前だけで見るのは茶屋・休憩所など（分岐・鞍部・山頂・境界点は、名前に「小屋」があっても小屋ではない。例: 「巻き道の合流（避難小屋の上）」）
  if (n.type === 'junction' || n.type === 'saddle' || n.type === 'peak' || n.type === 'boundary') return false;
  return /茶屋|小屋|山荘|休憩所/.test(n.name.replace(/（[^）]*）/g, ''));
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
