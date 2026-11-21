/**
 * 野生動物（熊・鹿・カモシカ・イノシシ・サル）。シナリオの効果 animal で出て、人が近づくか時間が来ると立ち去る。
 * 位置は時刻の純粋な関数（animalPos）で、sim と画面（src/view/animals.ts）が同じ式を使う。乱数は使わない。
 * 動物が人を襲うことはモデル化しない（けがはシナリオの injure で書く）。見つけたときにログと不安が出る。
 */
import { partyLeader } from '../climber/party';
import { isIndoors } from '../climber/situation';
import { datan2, dcos, dsin, PI } from '../core/dmath';
import type { AnimalEffect, AnimalSpecies, AnimalState, ClimberState, StaticContext, World } from '../types';
import type { Tuning } from '../tuning';

type AnimalTuning = Tuning['animals'];
type SpeciesTuning = AnimalTuning['species'][string];

export const ANIMAL_SPECIES: readonly AnimalSpecies[] = ['bear', 'brownBear', 'deer', 'serow', 'boar', 'monkey'];

export function speciesTuning(t: AnimalTuning, s: AnimalSpecies): SpeciesTuning {
  return t.species[s] ?? t.species['deer']!;
}

/** 向き（北 = 0、時計回り）→ 単位ベクトル（x 東、z 南） */
function dirOf(h: number): [number, number] {
  return [dsin(h), -dcos(h)];
}

/** ベクトル → 向き（北 = 0、時計回り） */
export function headingOf(dx: number, dz: number): number {
  return datan2(dx, -dz);
}

/** 立ち去る前の位置（cross は横切る、wander は小さな輪を回る、ほかはその場） */
function stayPos(a: AnimalState, tMin: number, t: AnimalTuning): [number, number, number] {
  const st = speciesTuning(t, a.species);
  const el = Math.max(0, tMin - a.fromMin);
  if (a.behavior === 'cross') {
    const [dx, dz] = dirOf(a.headingRad);
    const s = Math.min(t.crossM, st.walkMs * 60 * el) - t.crossM / 2;
    return [a.x + dx * s, a.z + dz * s, a.headingRad];
  }
  if (a.behavior === 'wander') {
    const w = (2 * PI) / t.wanderPeriodMin;
    const ph = w * el;
    // 出た場所から始まる輪（中心は出た場所の右）
    const [rx, rz] = dirOf(a.headingRad + PI / 2);
    const [fx, fz] = dirOf(a.headingRad);
    const u = t.wanderR * (1 - dcos(ph));
    const v = t.wanderR * dsin(ph);
    return [a.x + rx * u + fx * v, a.z + rz * u + fz * v, a.headingRad + ph];
  }
  return [a.x, a.z, a.headingRad];
}

/** 時刻 tMin の位置と向き（x, z, headingRad） */
export function animalPos(a: AnimalState, tMin: number, t: AnimalTuning): [number, number, number] {
  if (a.leaveMin === null || tMin < a.leaveMin) return stayPos(a, tMin, t);
  const st = speciesTuning(t, a.species);
  const [dx, dz] = dirOf(a.leaveHeadingRad);
  const s = st.runMs * 60 * (tMin - a.leaveMin);
  return [a.leaveX + dx * s, a.leaveZ + dz * s, a.leaveHeadingRad];
}

/** 立ち去って見えなくなる時刻 */
export function animalGoneMin(a: AnimalState, t: AnimalTuning): number {
  return a.leaveMin === null ? Infinity : a.leaveMin + t.leaveMoveMin;
}

function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
}

/** 外に出ていて、まわりが見える人 */
function canSee(ctx: StaticContext, c: ClimberState): boolean {
  return c.body.alive && c.body.conscious && !isIndoors(ctx.map, c);
}

/** 効果 animal: 動物を出す */
export function spawnAnimal(world: World, ctx: StaticContext, ef: AnimalEffect, evId: string): void {
  const t = ctx.tuning.animals;
  const st = speciesTuning(t, ef.species);
  const leader = partyLeader(world);
  let x = leader.x;
  let z = leader.z;
  const node = ef.at ? ctx.map.nodes[ef.at] : undefined;
  if (node) {
    x = node.x;
    z = node.z;
  } else if (ef.x !== undefined && ef.z !== undefined) {
    x = ef.x;
    z = ef.z;
  }
  const [fx, fz] = dirOf(leader.headingRad);
  const ahead = ef.aheadM ?? 0;
  const side = ef.sideM ?? 0;
  // 右 = 進む向きを時計回りに 90°（fx, fz）→（-fz, fx）
  x += fx * ahead - fz * side;
  z += fz * ahead + fx * side;
  const behavior = ef.behavior ?? st.behavior;
  let heading: number;
  if (ef.headingDeg !== undefined) heading = (ef.headingDeg * PI) / 180;
  else if (behavior === 'cross') heading = leader.headingRad + (side > 0 ? -PI / 2 : PI / 2);
  else heading = headingOf(leader.x - x, leader.z - z);
  const list = (world.animals ??= []);
  const id = ef.id ?? `${evId}:${list.length}`;
  const crossMin = st.walkMs > 0 ? t.crossM / (st.walkMs * 60) : 0;
  const duration = ef.durationMin ?? (behavior === 'cross' ? crossMin : st.durationMin);
  const a: AnimalState = {
    id,
    species: ef.species,
    behavior,
    count: Math.max(1, Math.min(t.maxCount, Math.round(ef.count ?? 1))),
    x,
    z,
    headingRad: heading,
    fromMin: world.tMin,
    untilMin: world.tMin + (behavior === 'flee' ? 0 : Math.max(0, duration)),
    leaveMin: null,
    leaveX: x,
    leaveZ: z,
    leaveHeadingRad: heading,
    anxiety: ef.anxiety ?? st.anxiety,
    quiet: ef.quiet ?? false,
    seenBy: [],
  };
  // 同じ ID の動物がまだいれば置き換える
  const k = list.findIndex((o) => o.id === id);
  if (k >= 0) list.splice(k, 1, a);
  else list.push(a);
}

/** 立ち去り始める（人から離れる向きへ）。自分から離れたときは、見つけていた人たちのログに 1 行 */
function leave(world: World, ctx: StaticContext, a: AnimalState, auto: boolean): void {
  if (a.leaveMin !== null) return;
  if (auto && a.seenBy.length > 0) ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', data: { animalLeft: a.species, count: a.count } });
  const t = ctx.tuning.animals;
  const [x, z, h] = stayPos(a, world.tMin, t);
  let best: ClimberState | null = null;
  let bestD = t.awayFromM;
  for (const c of world.climbers) {
    if (!c.body.alive || c.offMap) continue;
    const d = dist(c.x, c.z, x, z);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  a.leaveMin = world.tMin;
  a.leaveX = x;
  a.leaveZ = z;
  a.leaveHeadingRad = best && bestD > 0.01 ? headingOf(x - best.x, z - best.z) : h;
}

/** 効果 animalLeave */
export function dismissAnimals(world: World, ctx: StaticContext, id: string | undefined, species: AnimalSpecies | undefined): void {
  for (const a of world.animals ?? []) {
    if (id !== undefined && a.id !== id) continue;
    if (species !== undefined && a.species !== species) continue;
    leave(world, ctx, a, false);
  }
}

/** 毎ティック: 見つける・不安・立ち去る・消える */
export function stepAnimals(world: World, ctx: StaticContext): void {
  const list = world.animals;
  if (!list || list.length === 0) return;
  const t = ctx.tuning.animals;
  for (const a of list) {
    const st = speciesTuning(t, a.species);
    const [ax, az] = animalPos(a, world.tMin, t);
    if (a.leaveMin === null) {
      // 見つける（グループごとに一度）
      for (const c of world.climbers) {
        const g = c.groupId ?? '';
        if (a.seenBy.includes(g) || !canSee(ctx, c)) continue;
        const range = Math.min(st.noticeM, c.local.visibilityM) * (world.sun.isDark ? t.darkNoticeF : 1);
        const d = dist(c.x, c.z, ax, az);
        if (d > range) continue;
        a.seenBy.push(g);
        ctx.events.push({ tMin: world.tMin, type: 'ANIMAL', climberId: c.id, important: a.anxiety >= 10, data: { animal: a.id, species: a.species, count: a.count, distM: Math.max(10, Math.round(d / 10) * 10), quiet: a.quiet, dark: world.sun.isDark } });
        if (a.anxiety !== 0) {
          for (const m of world.climbers) {
            if (m.groupId !== c.groupId || !m.body.alive || !m.body.conscious) continue;
            m.body.anxiety = Math.min(100, Math.max(0, m.body.anxiety + a.anxiety));
          }
        }
      }
      // 人が近づいた・時間が来た
      let near = false;
      for (const c of world.climbers) if (c.body.alive && !c.offMap && dist(c.x, c.z, ax, az) < st.fleeM) near = true;
      if (near || world.tMin >= a.untilMin) leave(world, ctx, a, true);
    }
  }
  world.animals = list.filter((a) => world.tMin < animalGoneMin(a, t));
}

/** リーダーから、いる（立ち去り始めていない）動物までの最短距離（m）。いなければ 99999 */
export function nearestAnimalM(world: World, tuning: Tuning, from: ClimberState, species: AnimalSpecies | 'any'): number {
  let best = 99999;
  for (const a of world.animals ?? []) {
    if (a.leaveMin !== null || (species !== 'any' && a.species !== species)) continue;
    const [x, z] = animalPos(a, world.tMin, tuning.animals);
    best = Math.min(best, dist(from.x, from.z, x, z));
  }
  return best;
}
