/**
 * ヘリの捜索のうち、居場所の分からない人とココヘリ（ユーザーの指定）。
 * - ココヘリ（発信機）を持つ人は、ヘリの受信機が電波をとらえて短い時間で見つかる（居場所が分からなくても）
 * - 持たずに、通報した場所・計画の道から離れてしまった人は、上空から探しても簡単には見つからない。
 *   見つかる率はヘリが実際に飛んで探した時間で決まる（1 日 = heliBlindDayMin 分で 10%、2 日で 20%、3 日で 30%）
 */
import { chance, nextFloat } from '../core/rng';
import { resolveRoute } from '../terrain/trails';
import type { ClimberState, NodeId, StaticContext, World } from '../types';

const routePtsCache = new WeakMap<readonly NodeId[], Float64Array>();

/** ルート（の登山道の点）までの最短距離。既定は計画ルート */
export function distToPlannedRoute(ctx: StaticContext, x: number, z: number, route: readonly NodeId[] = ctx.scenario.plan.route): number {
  let pts = routePtsCache.get(route);
  if (!pts) {
    const arr: number[] = [];
    for (const leg of resolveRoute(ctx.map, [...route])) for (const s of ctx.map.trails[leg.edgeId]!.samples) arr.push(s.x, s.z);
    pts = Float64Array.from(arr);
    routePtsCache.set(route, pts);
  }
  let best = Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i]! - x;
    const dz = pts[i + 1]! - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** 探した日数ぶんの、それまでに見つかる率（表の線形補間。最後の点より先は同じ傾きで伸ばし、上限で止める） */
export function blindFoundP(table: readonly (readonly [number, number])[], days: number, maxP: number): number {
  if (table.length === 0 || days <= 0) return 0;
  for (let i = 1; i < table.length; i++) {
    const [d0, p0] = table[i - 1]!;
    const [d1, p1] = table[i]!;
    if (days <= d1) return Math.min(maxP, p0 + ((p1 - p0) * (days - d0)) / Math.max(1e-9, d1 - d0));
  }
  const n = table.length;
  const [da, pa] = table[Math.max(0, n - 2)]!;
  const [db, pb] = table[n - 1]!;
  const slope = db > da ? (pb - pa) / (db - da) : 0;
  return Math.min(maxP, pb + slope * (days - db));
}

/** 居場所が分からないか: 通報した場所があればその範囲（+ 動いた距離のしきい値）の外、なければ探している道から離れている */
export function whereaboutsUnknown(ctx: StaticContext, c: ClimberState, est: { x: number; z: number; radiusM: number } | null, route: readonly NodeId[] | undefined): boolean {
  const rt = ctx.tuning.rescue;
  if (est) {
    const d = Math.sqrt((c.x - est.x) * (c.x - est.x) + (c.z - est.z) * (c.z - est.z));
    return d > est.radiusM + rt.movedAwayM;
  }
  return distToPlannedRoute(ctx, c.x, c.z, route) > rt.heliBlindFromRouteM;
}

/** ココヘリの電波をとらえて見つけるか（ヘリが探している間、毎ティック） */
export function cocoheliFind(world: World, ctx: StaticContext, people: readonly ClimberState[], dtMin: number): ClimberState | null {
  const withBeacon = people.filter((c) => c.def.gear.cocoheli === true);
  if (withBeacon.length === 0) return null;
  if (!chance(world.rng.rescue, Math.min(1, (ctx.tuning.rescue.cocoheliFindPerH * dtMin) / 60))) return null;
  return withBeacon[Math.floor(nextFloat(world.rng.rescue) * withBeacon.length)] ?? withBeacon[0]!;
}

/** 居場所の分からない人を、上空から探して見つけるか。探した時間を足し、その分の見つかる率の増え方で決める */
export function blindHeliFind(world: World, ctx: StaticContext, blind: readonly ClimberState[], dtMin: number): ClimberState | null {
  if (blind.length === 0) return null;
  const rt = ctx.tuning.rescue;
  const r = world.rescue;
  const before = r.heliBlindMin ?? 0;
  const after = before + dtMin;
  r.heliBlindMin = after;
  const f0 = blindFoundP(rt.heliBlindFindP, before / rt.heliBlindDayMin, rt.heliBlindMaxP);
  const f1 = blindFoundP(rt.heliBlindFindP, after / rt.heliBlindDayMin, rt.heliBlindMaxP);
  const p = f1 > f0 && f0 < 1 ? (f1 - f0) / (1 - f0) : 0;
  if (!chance(world.rng.rescue, p)) return null;
  return blind[Math.floor(nextFloat(world.rng.rescue) * blind.length)] ?? blind[0]!;
}
