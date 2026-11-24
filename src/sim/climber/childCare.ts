/**
 * 子どもや初心者を連れた山行（ユーザーの指定: 陣馬山。弱い子どもを大人が支える）。
 * - takePack: 対象の人が、from の荷物を代わりに持つ（何人かなら分けて）。from は空身になって楽に歩ける
 * - piggyback: 対象の人（1 人）が rider を minutes 分背負って歩く。rider は自分の足で歩かず、体を休める。
 *   背負う人は rider の体重と荷物の分だけ重くなり、列はゆっくり進む（childCare.piggybackPaceF）。時間が来たら下ろす
 * 背負うのは、けが人を運ぶ仕組み（carry.ts の latch carry:<グループ>）を使う
 */
import type { ClimberState, StaticContext, World } from '../types';

/** 荷物を代わりに持つ */
export function takePack(world: World, ctx: StaticContext, takers: readonly ClimberState[], from: ClimberState): void {
  const kg = from.def.packKg + (from.plan.packDeltaKg ?? 0);
  const ok = takers.filter((c) => c !== from && c.body.alive && c.body.conscious);
  if (kg <= 0 || ok.length === 0) return;
  from.plan.packDeltaKg = (from.plan.packDeltaKg ?? 0) - kg;
  for (const c of ok) c.plan.packDeltaKg = (c.plan.packDeltaKg ?? 0) + kg / ok.length;
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: from.id, important: false, data: { takePack: ok.map((c) => c.def.name).join('・'), kg: Math.round(kg * 10) / 10 } });
}

/** 背負って歩く（列はけが人を運ぶのと同じ扱いで、背負われる人は列について動く） */
export function piggyback(world: World, ctx: StaticContext, carrier: ClimberState, rider: ClimberState, minutes: number): void {
  if (carrier === rider || !rider.body.alive || !carrier.body.alive || !carrier.body.conscious || carrier.groupId !== rider.groupId) return;
  const gid = carrier.groupId;
  if (gid === null) return;
  rider.plan.ridingUntilMin = world.tMin + minutes;
  world.latches[`carry:${gid}`] = true;
  world.latches[`piggy:${gid}`] = true;
  carrier.plan.carryKg = rider.def.weightKg + Math.max(0, rider.def.packKg + (rider.plan.packDeltaKg ?? 0));
  for (const c of world.climbers) if (c.groupId === gid) c.plan.paceFactor = Math.min(c.plan.paceFactor, ctx.tuning.childCare.piggybackPaceF);
  // 背負われる人がリーダーなら、背負う人が列を率いる
  const g = world.groups.find((x) => x.id === gid);
  if (g && g.leader === rider.id) g.leader = carrier.id;
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: rider.id, important: true, data: { piggyback: carrier.def.name, minutes: Math.round(minutes) } });
}

/** 1 分ごと: 背負う時間が過ぎたら下ろす */
export function stepChildCare(world: World, ctx: StaticContext): void {
  for (const r of world.climbers) {
    const until = r.plan.ridingUntilMin;
    if (until === undefined || until === null) continue;
    if (world.tMin < until && r.body.alive) continue;
    r.plan.ridingUntilMin = null;
    const gid = r.groupId;
    if (gid === null || world.latches[`piggy:${gid}`] !== true) continue;
    if (world.climbers.some((c) => c.groupId === gid && c.plan.ridingUntilMin !== null && c.plan.ridingUntilMin !== undefined)) continue;
    world.latches[`piggy:${gid}`] = false;
    world.latches[`carry:${gid}`] = false;
    for (const c of world.climbers) {
      if (c.groupId !== gid) continue;
      c.plan.carryKg = 0;
      c.plan.paceFactor = 1;
    }
    if (r.body.alive) ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: r.id, important: false, data: { piggybackEnd: true } });
  }
}
