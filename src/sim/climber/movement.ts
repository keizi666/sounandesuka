/**
 * 登山道上の移動（docs/07 §1.1）と歩行の代謝（docs/06 §2.1〜2.2）。
 * 速度は実距離（s）あたり。勾配も実距離に対する値（シヌオシティ考慮後）。
 */
import { datan, DEG, dexp } from '../core/dmath';
import { dehydrationF, piecewise } from './capacity';
import { hypoxiaMetF } from './altitude';
import { TUNING, type Tuning } from '../tuning';
import type { ClimberDef, ClimberState, EdgeDef, MapRuntime } from '../types';

/** 速度に効く周りの状態（天候・暗さ・地面）。P3 以降で値が入る */
export interface MoveEnv {
  isDark: boolean;
  moonIllum: number;
  visibilityM: number;
  windMs: number;
  snowCm: number;
  icy: boolean;
  groundWet: number;
  /** 自分の明かりはないが、すぐそばの仲間のヘッドランプで足元が見える */
  sharedLamp?: boolean;
}

export const CLEAR_DAY: MoveEnv = {
  isDark: false,
  moonIllum: 0,
  visibilityM: 20000,
  windMs: 0,
  snowCm: 0,
  icy: false,
  groundWet: 0,
};

/** Tobler の歩行関数（km/h）。grade は上りが正 */
export function toblerKmh(grade: number, tuning: Tuning = TUNING): number {
  const m = tuning.movement;
  return m.toblerMaxKmh * dexp(-m.toblerK * Math.abs(grade + m.toblerOffset));
}

/** 本人のペース係数（既定で約 0.8） */
export function paceOf(def: ClimberDef, tuning: Tuning = TUNING): number {
  const m = tuning.movement;
  return m.paceBase + m.paceExp * def.experience + m.paceFit * (def.fitness - 1);
}

/** エッジ上の位置 s が鎖場の区間か */
export function isChainAt(map: MapRuntime, edgeId: string, s: number): boolean {
  for (const h of map.def.hazards) {
    if (h.type === 'chain' && h.onEdge === edgeId && s >= h.sRange[0] && s <= h.sRange[1]) return true;
  }
  return false;
}

/** 足を骨折して這うときの速さの上限（m/s）。傾斜（度）が急なほど遅い。骨折していなければ Infinity */
export function crawlCapMs(c: ClimberState, slopeDeg: number, tuning: Tuning = TUNING): number {
  if (c.body.injury !== 'legFracture') return Infinity;
  const m = tuning.movement;
  const f = Math.max(m.crawlMinF, 1 - Math.abs(slopeDeg) / m.crawlSlopeStopDeg);
  return (m.crawlKmh / 3.6) * f * c.plan.paceFactor;
}

/**
 * 消耗による歩く速さの係数（0〜1）。エネルギー切れ・脱水・冷えで、足取りが重くなる。
 * 運動能力 M とは別に、速さにだけ掛ける（道の上と外の両方）
 */
export function exhaustionSpeedF(b: ClimberState['body'], tuning: Tuning = TUNING): number {
  const m = tuning.movement;
  return piecewise(m.exhaustGlycogenF, b.glycogenKcal) * piecewise(m.exhaustDehydF, b.waterDeficitL) * piecewise(m.exhaustCoreF, b.coreC);
}

/** 暗いときの速さの係数（自分のランプ・そばの仲間のランプ・明かりなし） */
export function darkSpeedF(c: ClimberState, moonIllum: number, sharedLamp: boolean, tuning: Tuning = TUNING): number {
  const m = tuning.movement;
  if (c.inv.headlamp.on) return m.darkHeadlampF;
  const none = m.darkNoLampBase + m.darkNoLampMoon * moonIllum;
  return sharedLamp ? Math.max(none, m.darkSharedLampF) : none;
}

/**
 * c の明かりがないとき、同じグループの意識のある仲間が sharedLampM 以内でヘッドランプをつけているか。
 * 急いでいるときは、明かりを持つ人が足元を照らしてくれる歩き方をしないので、使えない
 */
export function sharesLampOf(c: ClimberState, climbers: readonly ClimberState[], tuning: Tuning = TUNING): boolean {
  if (c.inv.headlamp.on || c.plan.hurry) return false;
  const r = tuning.movement.sharedLampM;
  return climbers.some((o) => o !== c && o.groupId === c.groupId && o.body.alive && o.body.conscious && o.inv.headlamp.on && (o.x - c.x) * (o.x - c.x) + (o.z - c.z) * (o.z - c.z) <= r * r);
}

/** 登山道上の候補速度（m/s、MET 上限の前） */
export function trailSpeedMs(
  c: ClimberState,
  edge: EdgeDef,
  chain: boolean,
  grade: number,
  env: MoveEnv,
  tuning: Tuning = TUNING,
): number {
  const m = tuning.movement;
  const b = c.body;
  const classF = chain ? m.classF.chain : m.classF[edge.class];
  const darkF = env.isDark ? darkSpeedF(c, env.moonIllum, env.sharedLamp === true, tuning) : 1;
  const visF = env.visibilityM < m.lowVisM ? m.lowVisF : 1;
  let snowF = 1;
  if (env.snowCm > m.snowDeepCm) snowF = m.snowDeepF;
  else if (env.snowCm > m.snowCm) snowF = m.snowF;
  if (env.icy && !c.def.gear.crampons) snowF = Math.min(snowF, m.icyNoCramponsF);
  const wetF = env.groundWet > m.wetGround && edge.class !== 'T1' ? m.wetF : 1;
  const f = b.fatigue / 100;
  const fatigueF = 1 - m.fatigueSpeedK * f * f;
  const injuryDownF = b.injury === 'sprain' && grade < 0 ? m.sprainDownF : 1;
  const hurryF = c.plan.hurry || b.anxiety > m.hurryAnxiety ? m.hurryF : 1;
  const windF = Math.min(1, Math.max(m.windMinF, 1 - Math.max(0, env.windMs - m.windSlowStartMs) / m.windSlowSpanMs));
  const kmh =
    toblerKmh(grade, tuning) *
    paceOf(c.def, tuning) *
    classF *
    darkF *
    visF *
    snowF *
    wetF *
    fatigueF *
    c.M *
    exhaustionSpeedF(b, tuning) *
    injuryDownF *
    hurryF *
    c.plan.paceFactor *
    (edge.paceAdj ?? 1) *
    windF;
  // 足を骨折したら這う（勾配から傾斜の角度にして遅くする）
  const crawl = crawlCapMs(c, datan(Math.abs(grade)) / DEG, tuning);
  return Math.max(0, Math.min(kmh / 3.6, crawl));
}

/** 歩行の MET（ACSM の歩行式を簡略化。docs/06 §2.1） */
export function walkMet(vMs: number, grade: number, def: ClimberDef, windMs: number, tuning: Tuning = TUNING, extraKg = 0): number {
  const m = tuning.movement;
  const v = vMs * 60; // m/min
  const g = Math.abs(grade);
  let climb = 0;
  if (grade > 0) climb = m.vo2PerClimb * v * grade;
  else if (grade < 0) climb = m.vo2PerClimb * v * (g * m.descentGradeF + (g > m.steepDescentGrade ? g * m.steepDescentAddF : 0));
  const vo2 = m.vo2Rest + m.vo2PerSpeed * v + climb;
  // 運ぶために増えた荷物（けが人を背負う・荷物を分けて持つ）も足す
  const load = 1 + (Math.max(0, def.packKg + extraKg) / def.weightKg) * m.loadK;
  const wind = 1 + m.windMetK * Math.max(0, windMs - m.windMetStartMs);
  return (vo2 / m.vo2Rest) * load * wind;
}

/** 使える最大 MET（docs/06 §2.2、脱水 §5.2） */
export function usableMet(c: ClimberState, tuning: Tuning = TUNING): number {
  const m = tuning.movement;
  const maxMet = m.maxMetBase + m.maxMetPerFitness * c.def.fitness;
  const gly = c.body.glycogenKcal < m.lowGlycogenKcal ? m.lowGlycogenMetF : 1;
  const dehyd = dehydrationF(c.body.waterDeficitL, tuning).met;
  // 酸素が薄いと、出せる力の上限が下がる（ユーザーの指定）
  const thin = hypoxiaMetF(c.elevM, tuning);
  return maxMet * thin * gly * dehyd * c.M * (1 - (m.fatigueMetK * c.body.fatigue) / 100);
}

/** 候補速度の MET が持続上限を超えるなら、二分探索で速度を下げる */
export function capSpeedByMet(
  vMs: number,
  grade: number,
  c: ClimberState,
  windMs: number,
  tuning: Tuning = TUNING,
): { vMs: number; met: number } {
  const limit = tuning.movement.sustainableMetRatio * usableMet(c, tuning);
  const extra = c.plan.carryKg ?? 0;
  const met = walkMet(vMs, grade, c.def, windMs, tuning, extra);
  if (met <= limit) return { vMs, met };
  let lo = 0;
  let hi = vMs;
  for (let i = 0; i < tuning.movement.metSearchIterations; i += 1) {
    const mid = (lo + hi) / 2;
    if (walkMet(mid, grade, c.def, windMs, tuning, extra) > limit) hi = mid;
    else lo = mid;
  }
  return { vMs: lo, met: walkMet(lo, grade, c.def, windMs, tuning, extra) };
}
