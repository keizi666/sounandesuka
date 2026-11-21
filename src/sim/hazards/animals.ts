/**
 * 野生動物（熊・鹿・カモシカ・イノシシ・サル）。シナリオの効果 animal で出て、人が近づくか時間が来ると立ち去る。
 * 位置は時刻の純粋な関数（animalPos）で、sim と画面（src/view/animals.ts）が同じ式を使う。乱数は使わない。
 * 見つけたときにログと不安が出る。熊は、近づいた人に低い確率で向かってきて、けがをさせてから立ち去る（tryAttack）。
 * ふるまい stalk の熊は人に付きまとう（stepStalk）: いちばん近い人へ歩いて近づき、近づくたびに襲うかを引く。
 * 襲わなければ少し止まって、また近づく。人が十分に離れるか時間が来ると立ち去る。位置は毎ティックの動き（a.stalk）からの純粋な関数。
 */
import { partyLeader } from '../climber/party';
import { isIndoors, isMoving } from '../climber/situation';
import { chance, nextFloat } from '../core/rng';
import { injure } from './slip';
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

/** 立ち去る前の位置（cross は横切る、wander は小さな輪を回る、stalk はいまの動き、ほかはその場） */
function stayPos(a: AnimalState, tMin: number, t: AnimalTuning): [number, number, number] {
  const st = speciesTuning(t, a.species);
  if (a.stalk) {
    // 描画では前のティックとの間の時刻も来る（負の経過は、いまの向きに沿って戻した位置）
    const [dx, dz] = dirOf(a.stalk.headingRad);
    const s = a.stalk.ms * 60 * (tMin - a.stalk.atMin);
    return [a.stalk.x + dx * s, a.stalk.z + dz * s, a.stalk.headingRad];
  }
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
  // 人に向かってくる間（向かい始めた位置 → 人の前。着いたら立ち去り始めるまでそこにいる）
  if (a.chargeMin !== undefined && a.leaveMin !== null && tMin >= a.chargeMin && tMin < a.leaveMin) {
    const x0 = a.chargeX ?? a.x;
    const z0 = a.chargeZ ?? a.z;
    const f = Math.min(1, (tMin - a.chargeMin) / Math.max(1e-6, Math.min(t.chargeMin, a.leaveMin - a.chargeMin)));
    return [x0 + (a.leaveX - x0) * f, z0 + (a.leaveZ - z0) * f, headingOf(a.leaveX - x0, a.leaveZ - z0)];
  }
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
    ...(ef.aggression !== undefined ? { aggression: ef.aggression } : {}),
    ...(ef.attackInjury !== undefined ? { attackInjury: [...ef.attackInjury] } : {}),
    ...(behavior === 'stalk' ? { stalk: { x, z, atMin: world.tMin, headingRad: heading, ms: 0, restUntilMin: world.tMin } } : {}),
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

const ATTACK_INJURY = ['bruise', 'sprain', 'legFracture', 'headInjury', 'severeTrauma', 'death'] as const;

/**
 * 人が近づいたとき、熊が向かってくるか（1 回の出会いごとに 1 回だけ引く）。向かってきたら、着いたときにけがをさせ（applyAttack）、
 * 少しそばにいてから立ち去る。けがの種類はここで引いておく。
 * surprise: その人のグループが、近づく前に熊に気づいていなかった（鉢合わせ）
 */
function tryAttack(world: World, ctx: StaticContext, a: AnimalState, c: ClimberState, ax: number, az: number, surprise: boolean): boolean {
  const t = ctx.tuning.animals;
  const st = speciesTuning(t, a.species);
  const base = surprise ? st.attackSurpriseP : st.attackApproachP;
  const table = a.attackInjury ?? st.attackInjury;
  if (base <= 0 || (a.aggression ?? 1) <= 0 || table.length === 0) return false;
  const n = world.climbers.filter((m) => m.groupId === c.groupId && m.body.alive).length;
  const p = Math.min(1, (base * (a.aggression ?? 1) * (isMoving(c) ? 1 : t.attackStillF)) / (1 + t.attackGroupK * Math.max(0, n - 1)));
  if (!chance(world.rng.hazard, p)) return false;
  // けが（表から引く）
  let r = nextFloat(world.rng.hazard);
  let k = 0;
  while (k < table.length - 1 && r >= table[k]!) r -= table[k++]!;
  const injury = ATTACK_INJURY[Math.min(k, ATTACK_INJURY.length - 1)]!;
  // 熊は人のすぐ前まで向かってきて、着いたらけがをさせ、少しそばにいてから来た方へ立ち去る
  const d = Math.max(1e-6, dist(ax, az, c.x, c.z));
  a.chargeMin = world.tMin;
  a.chargeX = ax;
  a.chargeZ = az;
  a.leaveMin = world.tMin + t.chargeMin + t.attackHoldMin;
  a.leaveX = c.x + ((ax - c.x) / d) * t.chargeStopM;
  a.leaveZ = c.z + ((az - c.z) / d) * t.chargeStopM;
  a.leaveHeadingRad = headingOf(ax - c.x, az - c.z);
  a.attack = { climberId: c.id, injury, surprise, applied: false };
  return true;
}

/** 熊が人のところに着いた: けがを負わせ、ログ・フラグ・グループの不安 */
function applyAttack(world: World, ctx: StaticContext, a: AnimalState): void {
  const at = a.attack;
  if (!at || at.applied) return;
  at.applied = true;
  const c = world.climbers.find((x) => x.id === at.climberId);
  if (!c || !c.body.alive || c.offMap) return;
  const t = ctx.tuning.animals;
  const injury = at.injury as (typeof ATTACK_INJURY)[number];
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { bearAttack: a.species, injury, surprise: at.surprise } });
  if (world.flags['bearAttack'] === undefined) world.flags['bearAttack'] = world.tMin;
  for (const m of world.climbers) {
    if (m.groupId !== c.groupId || !m.body.alive || !m.body.conscious) continue;
    m.body.anxiety = Math.min(100, m.body.anxiety + t.attackAnxiety);
  }
  injure(world, ctx, c, injury, 'trauma');
}

/** 倒れて動けない人（意識がない・動けない状態・歩けないけが） */
function down(c: ClimberState): boolean {
  return !c.body.conscious || c.state === 'INCAPACITATED' || c.state === 'UNCONSCIOUS' || c.body.injury === 'legFracture' || c.body.injury === 'headInjury' || c.body.injury === 'severeTrauma';
}

/**
 * stalk の熊の 1 ティック: いちばん近い人（外にいる人）へ近づく。種類ごとの距離（fleeM）まで来たら襲うかを引き、
 * 襲わなければ stalkRestMin 分その場で止まる。見えなくなったグループは、次に見つけたときにまた「見つけた」になる
 * （暗さや霧で気づかないうちに近づかれると、鉢合わせの確率で引く）。
 */
function stepStalk(world: World, ctx: StaticContext, a: AnimalState, ax: number, az: number, seenBefore: readonly string[]): void {
  const t = ctx.tuning.animals;
  const st = speciesTuning(t, a.species);
  // 付きまとう相手は、まだ動ける人（倒れて動けない人に何度も向かっていかない。見せ方の配慮。動ける人がいなければ立ち去る）
  let near: ClimberState | null = null;
  let nearD = Infinity;
  for (const c of world.climbers) {
    if (!c.body.alive || c.offMap || isIndoors(ctx.map, c) || down(c)) continue;
    const d = dist(c.x, c.z, ax, az);
    if (d < nearD) {
      nearD = d;
      near = c;
    }
  }
  if (!near || nearD > t.stalkGiveUpM || world.tMin >= a.untilMin) {
    leave(world, ctx, a, true);
    return;
  }
  // 見えなくなったグループを外す（次に見えたら、また見つけたことになる）
  a.seenBy = a.seenBy.filter((g) =>
    world.climbers.some((c) => (c.groupId ?? '') === g && canSee(ctx, c) && dist(c.x, c.z, ax, az) <= Math.min(st.noticeM, c.local.visibilityM) * (world.sun.isDark ? t.darkNoticeF : 1)),
  );
  const toNear = headingOf(near.x - ax, near.z - az);
  const resting = world.tMin < (a.stalk?.restUntilMin ?? 0);
  if (nearD < st.fleeM && !resting) {
    if (tryAttack(world, ctx, a, near, ax, az, !seenBefore.includes(near.groupId ?? ''))) return;
    a.stalk = { x: ax, z: az, atMin: world.tMin, headingRad: toNear, ms: 0, restUntilMin: world.tMin + t.stalkRestMin };
    return;
  }
  // 止まっている間はこちらを見ている。近すぎるときも、それ以上は寄らない
  const ms = resting || nearD < st.fleeM ? 0 : st.walkMs * t.stalkSpeedF;
  a.stalk = { x: ax, z: az, atMin: world.tMin, headingRad: toNear, ms, restUntilMin: a.stalk?.restUntilMin ?? world.tMin };
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
    // 向かってきた熊が人のところに着いた
    if (a.attack && !a.attack.applied && a.chargeMin !== undefined && world.tMin >= a.chargeMin + t.chargeMin - 1e-9) applyAttack(world, ctx, a);
    const [ax, az] = animalPos(a, world.tMin, t);
    if (a.leaveMin === null) {
      const seenBefore = [...a.seenBy];
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
      if (a.behavior === 'stalk') {
        stepStalk(world, ctx, a, ax, az, seenBefore);
        continue;
      }
      // 人が近づいた（いちばん近い人に向かってくることがある）・時間が来た
      let near: ClimberState | null = null;
      let nearD = st.fleeM;
      for (const c of world.climbers) {
        if (!c.body.alive || c.offMap || isIndoors(ctx.map, c)) continue;
        const d = dist(c.x, c.z, ax, az);
        if (d < nearD) {
          nearD = d;
          near = c;
        }
      }
      if (near && tryAttack(world, ctx, a, near, ax, az, !seenBefore.includes(near.groupId ?? ''))) continue;
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
