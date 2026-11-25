/**
 * 営業小屋の前を通るときに水を買う（ユーザーの指摘: 槍ヶ岳山荘で水が買えるとログに出るのに、水筒の水が増えない）。
 * 営業中（開いている）の営業小屋から hutShopRadiusM 以内を、昼（hutShopFromClockMin〜hutShopToClockMin）に通ると、
 * 水筒を持ってきた量まで満たし、その場で hutShopDrinkL まで飲む。同じ人は同じ小屋で 1 回だけ。
 * 小屋に着いた（visitedNodes に入った）あとで買う（記録が「着いた」の後になる）。そばにいる同じ組の人もまとめて買い、記録に 1 行出す。小屋に泊まる・入って休むときは physiology（env.staffed）が受け持つ。
 */
import { clockMinOf } from '../core/clock';
import type { ClimberState, MapRuntime, StaticContext, World } from '../types';

type MapNode = MapRuntime['nodes'][string];

const hutsCache = new WeakMap<StaticContext, MapNode[]>();

/** 開いている営業小屋 */
function staffedHuts(ctx: StaticContext): MapNode[] {
  let hs = hutsCache.get(ctx);
  if (!hs) {
    hs = Object.values(ctx.map.nodes).filter((nd) => nd.shelter?.kind === 'staffed' && (ctx.scenario.nodeOverrides?.[nd.id]?.open ?? nd.shelter.open));
    hutsCache.set(ctx, hs);
  }
  return hs;
}

function canBuy(c: ClimberState): boolean {
  return c.body.alive && c.body.conscious && !c.offMap && c.body.shelterNodeId === null && c.state !== 'UNCONSCIOUS' && c.state !== 'DEAD';
}

export function stepHutShop(world: World, ctx: StaticContext, c: ClimberState): void {
  // 史実のシナリオは変えない（記録どおりに選べば記録どおりの結果になるように。passersby と同じ）
  if (!canBuy(c) || ctx.scenario.historical) return;
  const t = ctx.tuning.behavior;
  const clock = clockMinOf(world.tMin);
  if (clock < t.hutShopFromClockMin || clock > t.hutShopToClockMin) return;
  const r2 = t.hutShopRadiusM * t.hutShopRadiusM;
  for (const nd of staffedHuts(ctx)) {
    if ((nd.x - c.x) * (nd.x - c.x) + (nd.z - c.z) * (nd.z - c.z) > r2) continue;
    if (world.latches[`hutShop:${c.id}:${nd.id}`]) continue;
    // 着いた記録（小屋に着いたこと）のあとに買う
    if (world.visitedNodes[nd.id] === undefined) continue;
    // そばにいる同じ組の人もまとめて
    const who = world.climbers.filter(
      (o) => (o === c || (o.groupId === c.groupId && (o.x - nd.x) * (o.x - nd.x) + (o.z - nd.z) * (o.z - nd.z) <= r2)) && canBuy(o) && !world.latches[`hutShop:${o.id}:${nd.id}`],
    );
    let bought = false;
    for (const o of who) {
      world.latches[`hutShop:${o.id}:${nd.id}`] = true;
      const cap = o.def.gear.waterL;
      if (cap > 0 && o.inv.waterL < cap - t.hutShopMinNeedL) {
        o.inv.waterL = cap;
        bought = true;
      }
      if (o.body.waterDeficitL > t.hutShopMinNeedL) {
        o.body.waterDeficitL = Math.max(0, o.body.waterDeficitL - t.hutShopDrinkL);
        bought = true;
      }
    }
    if (bought) ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, data: { hutShop: nd.id, names: who.map((o) => o.def.name).join('・') } });
  }
}
