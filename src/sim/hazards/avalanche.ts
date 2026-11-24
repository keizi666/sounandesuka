/**
 * 雪崩（ユーザーの指定: 残雪期の立山。2 人が埋まり、ビーコンで捜し、掘り出し、手当てし、通報する。周りの登山者も手伝う）。
 * - 効果 avalanche: 範囲の中の人を近い順に埋める（深さは範囲から引く）。埋まらなかった人は流されて打ち身を負うことがある。
 *   埋まった人が生きていられる時間は、埋没時間と生存率の曲線（tuning.avalanche.survivalCurve）から引いておく（窒息）。
 * - 行動 avalancheRescue: 埋まっていない人で捜して掘る。場所を見つける時間は、ビーコン（捜す人と埋まった人の両方）・プローブ・何もなし で大きく違う。
 *   掘る時間は、深さ × 1 m あたりの時間 ÷ √人数（シャベルがなければ長い）。手伝う人（helpers）が着けば人数が増える。
 *   1 人ずつ順に掘り出す。掘り出せたときに生きていれば、冷えた体で雪から出る（そのあとの手当て・通報はシナリオの選択肢で）
 * - 埋まっているあいだは動けず、風も雨も当たらない（雪の中）。体は少しずつ冷える
 */
import { chance, nextFloat, randRange } from '../core/rng';
import type { ClimberState, StaticContext, World } from '../types';
import { transition } from '../climber/state';
import { killWith } from './ford';
import { injure } from './slip';

const TERMINAL = new Set(['FINISHED', 'RESCUED', 'DEAD']);
/** 2 点の距離（m）。超越関数を使わず平方根だけで */
const dist = (dx: number, dz: number): number => Math.sqrt(dx * dx + dz * dz);

/** 生存率の曲線から、生きていられる時間（分）を引く（u は 0〜1 の乱数。u が生存率を下回る最後の時刻） */
export function survivalMinutes(u: number, curve: readonly [number, number][]): number {
  for (let i = 1; i < curve.length; i += 1) {
    const [t0, s0] = curve[i - 1]!;
    const [t1, s1] = curve[i]!;
    if (u > s1) {
      // s0 >= u > s1 の区間で、直線で補う
      const f = s0 === s1 ? 0 : (s0 - u) / (s0 - s1);
      return t0 + (t1 - t0) * Math.min(1, Math.max(0, f));
    }
  }
  return curve[curve.length - 1]![0];
}

/** 効果 avalanche */
export function triggerAvalanche(
  world: World,
  ctx: StaticContext,
  ef: { x?: number; z?: number; radiusM: number; maxBuried?: number; depthM?: [number, number]; who?: string[] },
  leader: ClimberState,
): void {
  const t = ctx.tuning.avalanche;
  const cx = ef.x ?? leader.x;
  const cz = ef.z ?? leader.z;
  const inRange = world.climbers
    .filter((c) => c.body.alive && !TERMINAL.has(c.state) && !c.offMap && !c.body.buried && (ef.who ? ef.who.includes(c.id) : dist(c.x - cx, c.z - cz) <= ef.radiusM))
    .sort((a, b) => dist(a.x - cx, a.z - cz) - dist(b.x - cx, b.z - cz) || (a.id < b.id ? -1 : 1));
  const n = Math.min(inRange.length, ef.maxBuried ?? inRange.length);
  const [dLo, dHi] = ef.depthM ?? [0.6, 1.5];
  const buried: string[] = [];
  inRange.forEach((c, i) => {
    if (i < n) {
      const life = survivalMinutes(nextFloat(world.rng.hazard), t.survivalCurve);
      c.body.buried = { atMin: world.tMin, depthM: randRange(world.rng.hazard, dLo, dHi), deathAtMin: world.tMin + life, beacon: c.def.gear.beacon === true };
      c.plan.busyUntilMin = null;
      c.plan.busyWith = null;
      c.speedMs = 0;
      buried.push(c.def.name);
      transition(world, ctx, c, 'INCAPACITATED', 'avalanche');
      if (chance(world.rng.hazard, t.buriedTraumaP)) injure(world, ctx, c, chance(world.rng.hazard, 0.5) ? 'legFracture' : 'severeTrauma', 'trauma');
    } else if (chance(world.rng.hazard, t.sweptInjuryP)) {
      injure(world, ctx, c, chance(world.rng.hazard, 0.7) ? 'bruise' : 'sprain', 'trauma');
    }
  });
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: leader.id, important: true, data: { avalanche: buried.length, names: buried.join('・') } });
}

/** 行動 avalancheRescue: 捜して掘り出す順と時刻を決める */
export function startAvalancheRescue(world: World, ctx: StaticContext, members: readonly ClimberState[], helpers = 0, helpersAfterMin = 0): void {
  const t = ctx.tuning.avalanche;
  const crew = members.filter((c) => c.body.alive && c.body.conscious && !c.body.buried && !TERMINAL.has(c.state) && c.state !== 'INCAPACITATED');
  const victims = world.climbers.filter((c) => c.body.alive && c.body.buried && !(world.avalancheDig ?? []).some((d) => d.victim === c.id));
  if (crew.length === 0 && helpers === 0) return;
  if (victims.length === 0) return;
  const beacons = crew.some((c) => c.def.gear.beacon === true);
  const probes = crew.some((c) => c.def.gear.probe === true);
  const shovels = crew.filter((c) => c.def.gear.shovel === true).length;
  const helpAt = world.tMin + helpersAfterMin;
  // 近い順（先頭の人から）に 1 人ずつ
  const lead = crew[0] ?? members[0]!;
  victims.sort((a, b) => dist(a.x - lead.x, a.z - lead.z) - dist(b.x - lead.x, b.z - lead.z) || (a.id < b.id ? -1 : 1));
  let now = world.tMin;
  const plan: { victim: string; atMin: number }[] = [];
  victims.forEach((v, i) => {
    const people = crew.length + (now >= helpAt ? helpers : 0);
    let locate: number;
    if (beacons && v.body.buried!.beacon) locate = i === 0 ? t.beaconLocateMin : t.beaconNextMin;
    else if (probes || now >= helpAt) locate = t.probeLocateMin / Math.sqrt(Math.max(1, people) / t.probeCrewRef);
    else locate = t.noGearLocateMin;
    now += locate;
    const diggers = Math.max(1, crew.length + (now >= helpAt ? helpers : 0));
    const shovelF = shovels > 0 || now >= helpAt ? 1 : t.noShovelF;
    now += (v.body.buried!.depthM * t.digMinPerM * shovelF) / Math.sqrt(diggers);
    plan.push({ victim: v.id, atMin: now });
  });
  world.avalancheDig = [...(world.avalancheDig ?? []), ...plan];
  for (const c of crew) {
    c.plan.busyUntilMin = now;
    c.plan.busyWith = 'avalancheRescue';
  }
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: lead.id, important: true, data: { avalancheSearch: beacons ? 'beacon' : probes ? 'probe' : 'none', helpers } });
}

/** 毎ティック: 埋まった人の窒息と、掘り出し */
export function stepAvalanche(world: World, ctx: StaticContext): void {
  const due = world.avalancheDig;
  for (const c of world.climbers) {
    const b = c.body.buried;
    if (!b || !c.body.alive) continue;
    // 雪の中: 風も雨も当たらない（0℃ 前後の雪に囲まれる）
    c.local = { ...c.local, windMs: 0, precipMmH: 0, windChillC: Math.min(c.local.tempC, 0), tempC: Math.min(c.local.tempC, 0), solarW: 0 };
    const dig = due?.find((d) => d.victim === c.id);
    if (dig && world.tMin >= dig.atMin) {
      // 掘り出せた（まだ生きていれば）
      c.body.buried = undefined;
      c.body.coreC -= ctx.tuning.avalanche.dugCoreDropC;
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { dugOut: Math.round(world.tMin - b.atMin) } });
      continue;
    }
    if (world.tMin >= b.deathAtMin) {
      killWith(world, ctx, c, 'asphyxia');
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { buriedDead: Math.round(world.tMin - b.atMin) } });
    }
  }
  // 亡くなった人も、掘り出す時刻になれば雪から出す（ログに残す）
  if (due) {
    for (const d of due) {
      const c = world.climbers.find((x) => x.id === d.victim);
      if (c && !c.body.alive && c.body.buried && world.tMin >= d.atMin) {
        const at = c.body.buried.atMin;
        c.body.buried = undefined;
        ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { dugOutDead: Math.round(world.tMin - at) } });
      }
    }
    world.avalancheDig = due.filter((d) => {
      const c = world.climbers.find((x) => x.id === d.victim);
      return c !== undefined && c.body.buried !== undefined;
    });
    if (world.avalancheDig.length === 0) world.avalancheDig = undefined;
  }
}
