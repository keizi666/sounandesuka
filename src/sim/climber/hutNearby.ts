/**
 * すぐそこに小屋がある（ユーザーの指摘: s18 で頂上宿舎の 160 m 手前で、ツェルトにくるまったまま全員が倒れた）。
 * - 歩ける人: 開いている小屋から hutNearM 以内で止まっている（ビバーク・救助待ち・その場で待つ）なら、列を離れて小屋へ入る
 *   （動けない仲間がいると列ごと止まるので、仲間を残して小屋へ助けを呼びに行く）
 * - 動けない人: 営業小屋に仲間が入っていて、小屋から hutHelpM 以内にいれば、hutHelpDelayMin 分後に小屋の人が運び込む
 * 1 分ごとに判定する
 */
import { dawnRef, enterShelter } from './route';
import { detach } from './groups';
import { applyActions } from './actions';
import type { ClimberState, NodeDef, StaticContext, World } from '../types';

const TERMINAL = new Set(['FINISHED', 'RESCUED', 'DEAD']);
/** 止まって外で夜を過ごそうとしている・待っている */
const STUCK = new Set(['BIVOUAC', 'WAITING_RESCUE', 'STAYING', 'INCAPACITATED', 'UNCONSCIOUS']);
const TICKS_PER_CHECK = 6;

function canWalk(c: ClimberState): boolean {
  const b = c.body;
  return b.alive && b.conscious && c.state !== 'INCAPACITATED' && c.state !== 'UNCONSCIOUS' && b.injury !== 'legFracture' && b.injury !== 'severeTrauma' && c.M >= 0.2;
}

type Hut = NodeDef & { elevM: number };
/** 開いている小屋（シナリオと地図ごとに決まるので覚えておく。World には入れない） */
const hutCache = new WeakMap<StaticContext, Hut[]>();
function openShelters(ctx: StaticContext): Hut[] {
  let hs = hutCache.get(ctx);
  if (!hs) {
    hs = Object.values(ctx.map.nodes).filter((nd) => nd.shelter && (ctx.scenario.nodeOverrides?.[nd.id]?.open ?? nd.shelter.open));
    hutCache.set(ctx, hs);
  }
  return hs;
}

/**
 * 歩いているのに、stallMin 分で stallM も進んでいない（列が動けない人に合わせて止まっている）。
 * 位置と時刻を flags に覚えて比べる（World に入れる値は数だけ）
 */
function stalled(world: World, ctx: StaticContext, c: ClimberState): boolean {
  const bt = ctx.tuning.behavior;
  const k = `hutStall:${c.id}`;
  const t0 = world.flags[`${k}:t`];
  // 小屋から離れていた間は見ていないので、古い記録は捨てて測り直す
  if (t0 === undefined || c.state !== 'WALKING' || world.tMin - t0 > bt.hutStallMin * 2) {
    world.flags[`${k}:t`] = world.tMin;
    world.flags[`${k}:x`] = c.x;
    world.flags[`${k}:z`] = c.z;
    return false;
  }
  if (world.tMin - t0 < bt.hutStallMin) return false;
  const dx = c.x - (world.flags[`${k}:x`] ?? c.x);
  const dz = c.z - (world.flags[`${k}:z`] ?? c.z);
  world.flags[`${k}:t`] = world.tMin;
  world.flags[`${k}:x`] = c.x;
  world.flags[`${k}:z`] = c.z;
  return dx * dx + dz * dz < bt.hutStallM * bt.hutStallM;
}

export function stepHutNearby(world: World, ctx: StaticContext): void {
  if (world.tick % TICKS_PER_CHECK !== 0) return;
  const bt = ctx.tuning.behavior;
  const huts = openShelters(ctx);
  if (huts.length === 0) return;
  for (const h of huts) {
    const d2 = (c: ClimberState): number => (c.x - h.x) * (c.x - h.x) + (c.z - h.z) * (c.z - h.z);
    // 歩ける人は小屋へ（止まっている、または列が遅い人に合わせて歩いてもほとんど進んでいない）
    for (const c of world.climbers) {
      if (TERMINAL.has(c.state) || c.body.shelterNodeId || c.offMap || d2(c) > bt.hutNearM * bt.hutNearM || !canWalk(c)) continue;
      // もう一人で小屋へ向かっている人は飛ばす（列のまま向かおうとして止まっている人は、列から離す）
      if (c.groupId === `solo_${c.id}` && c.plan.goTo?.node === h.id) continue;
      if (!STUCK.has(c.state) && !stalled(world, ctx, c)) continue;
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { toHutInstead: h.id } });
      detach(world, ctx, c, [{ type: 'goToNode', node: h.id, then: 'stay' }], (acts, group, l) => applyActions(world, ctx, acts, group, l));
    }
    // 営業小屋に仲間がいれば、小屋の人が近くで動けない人を運び込む
    if (h.shelter?.kind !== 'staffed') continue;
    if (!world.climbers.some((c) => c.body.shelterNodeId === h.id && c.body.alive)) continue;
    for (const c of world.climbers) {
      if (TERMINAL.has(c.state) || !c.body.alive || c.body.shelterNodeId || c.offMap || !STUCK.has(c.state)) continue;
      if (d2(c) > bt.hutHelpM * bt.hutHelpM) continue;
      const key = `hutHelp:${c.id}`;
      const since = world.flags[key];
      if (since === undefined) {
        world.flags[key] = world.tMin;
        continue;
      }
      if (world.tMin - since < bt.hutHelpDelayMin) continue;
      c.x = h.x;
      c.z = h.z;
      c.elevM = h.elevM;
      c.pos = { mode: 'node', nodeId: h.id };
      if (enterShelter(world, ctx, c, h.id, dawnRef(world, ctx))) ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { hutCarried: h.id } });
    }
  }
}
