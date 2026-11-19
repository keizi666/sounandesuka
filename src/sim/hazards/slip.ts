/**
 * 転倒・滑落（docs/08 §1）。10 m 移動するごとに hazard ストリームで判定する。
 * 突風（局地風 × 突風係数 > 20 m/s）でも転倒しやすくなる（docs/07 §1.1）。
 */
import { datan, DEG } from '../core/dmath';
import { chance, nextFloat, randRange } from '../core/rng';
import { isChainAt } from '../climber/movement';
import { transition } from '../climber/state';
import { nearestIndex, sampleElev, sampleNormal } from '../terrain/sample';
import type { ClimberState, InjuryKind, StaticContext, World } from '../types';
import { VegClass } from '../types';
import { groundAt } from '../weather/ground';

export type SlipClass = 'T1' | 'T2' | 'EXPOSED' | 'OFF' | 'OFF_STEEP' | 'STREAM' | 'CLIFF';

const INJURY_ORDER: InjuryKind[] = ['none', 'bruise', 'sprain', 'legFracture', 'headInjury', 'severeTrauma'];

/**
 * 地形クラス（docs/08 §1.1）。道外の傾斜は「進む方向の勾配」で判定する（沢床を下るときに谷の側壁の傾斜を使わない）。
 * 崖は、滝の半径内か、進む方向の勾配が offCliffDeg を超えるとき。
 */
export function slipClassAt(ctx: StaticContext, c: ClimberState, moveGrade = 0): SlipClass {
  const st = ctx.tuning.slip;
  if (c.pos.mode === 'edge') {
    const e = ctx.map.trails[c.pos.edgeId]!.def;
    if (e.class === 'T3' || isChainAt(ctx.map, c.pos.edgeId, c.pos.s)) return 'EXPOSED';
    return e.class === 'T1' ? 'T1' : 'T2';
  }
  const inWaterfall = ctx.map.def.hazards.some((h) => h.type === 'waterfall' && (h.x - c.x) * (h.x - c.x) + (h.z - c.z) * (h.z - c.z) <= h.radius * h.radius);
  const slope = datan(Math.abs(moveGrade)) / DEG;
  if (inWaterfall || slope > st.offCliffDeg) return 'CLIFF';
  // 沢床（濡れた岩・苔・倒木・淵）は、道外の急斜面と同じかそれ以上に滑りやすい
  if (ctx.map.veg[nearestIndex(ctx.map, c.x, c.z)] === VegClass.STREAM) return 'STREAM';
  return slope > st.offSteepDeg ? 'OFF_STEEP' : 'OFF';
}

/** 10 m あたりの転倒確率（docs/08 §1.2） */
export function slipP10(world: World, ctx: StaticContext, c: ClimberState, cls: SlipClass, downhill: boolean): number {
  const st = ctx.tuning.slip;
  const gr = groundAt(world.ground, c.elevM);
  const slope = ctx.map.slopeDeg[nearestIndex(ctx.map, c.x, c.z)]!;
  const crampons = c.def.gear.crampons;
  let p = ((st.base100[cls] ?? 0) * (st.classScale[cls] ?? 1)) / 10;
  if (gr.wet > 0.5 || cls === 'STREAM') p *= st.wetF;
  if (gr.icy) p *= crampons ? st.icyCramponsF : st.icyF;
  else if (gr.snowCm > 5 && slope > st.snowSlopeDeg) p *= crampons ? st.snowCramponsF : st.snowF;
  // 夜: ヘッドランプの光は狭く、道外では足元の岩・穴・段差が読めない
  const offTrail = cls === 'OFF' || cls === 'OFF_STEEP' || cls === 'STREAM' || cls === 'CLIFF';
  if (world.sun.isDark) p *= c.inv.headlamp.on ? (offTrail ? st.darkLampOffF : st.darkLampF) : st.darkF;
  p *= 1 + c.body.fatigue / st.fatigueDiv;
  p *= 1 + 2 * (1 - c.M);
  p *= 1 + (1 - c.J);
  if (c.plan.hurry) p *= st.hurryF;
  if (c.def.gear.trekkingPoles && cls !== 'CLIFF') p *= st.polesF;
  if (downhill) p *= st.downF;
  const gust = c.local.windMs * world.weather.gust;
  if (gust > st.gustFromMs) p *= 1 + (gust - st.gustFromMs) / st.gustDivMs;
  return Math.min(1, p);
}

/** けがを負わせる（重い方を残す）。即死なら死亡 */
export function injure(world: World, ctx: StaticContext, c: ClimberState, injury: InjuryKind | 'death', cause: 'fall' | 'lightning' | 'trauma'): void {
  const st = ctx.tuning.slip;
  if (injury === 'death') {
    c.body.alive = false;
    c.body.conscious = false;
    c.body.deathCause = cause;
    c.J = 0;
    c.M = 0;
    transition(world, ctx, c, 'DEAD', cause);
    ctx.events.push({ tMin: world.tMin, type: 'DEATH', climberId: c.id, important: true, data: { cause } });
    return;
  }
  if (injury === 'none') return;
  if (INJURY_ORDER.indexOf(injury) > INJURY_ORDER.indexOf(c.body.injury)) {
    c.body.injury = injury;
    c.body.injuryAtMin = world.tMin;
  }
  c.body.anxiety = Math.min(100, c.body.anxiety + (st.anxiety[injury] ?? 0));
  if (injury === 'severeTrauma' && c.memo.traumaDeathAtMin === null) {
    const p = world.rescue.status === 'contacted' ? st.traumaDeathRescuedP : st.traumaDeathP;
    if (chance(world.rng.hazard, p)) c.memo.traumaDeathAtMin = world.tMin + nextFloat(world.rng.hazard) * st.traumaDeathMaxMin;
  }
  if (injury === 'headInjury' && chance(world.rng.hazard, st.headUnconsciousP)) {
    c.memo.unconsciousUntilMin = world.tMin + randRange(world.rng.hazard, st.headUnconsciousMinMin, st.headUnconsciousMaxMin);
  }
  ctx.events.push({ tMin: world.tMin, type: 'INJURY', climberId: c.id, important: true, data: { injury } });
}

/** 斜面の下方へ distM 落ちる（道外になる） */
function fallDownslope(world: World, ctx: StaticContext, c: ClimberState, distM: number): void {
  const nrm = sampleNormal(ctx.map, c.x, c.z);
  const hx = nrm.x;
  const hz = nrm.z;
  const len = Math.sqrt(hx * hx + hz * hz) || 1;
  c.x += (hx / len) * distM;
  c.z += (hz / len) * distM;
  c.x = Math.max(-ctx.map.half, Math.min(ctx.map.half, c.x));
  c.z = Math.max(-ctx.map.half, Math.min(ctx.map.half, c.z));
  c.elevM = sampleElev(ctx.map, c.x, c.z);
  c.pos = { mode: 'free', x: c.x, z: c.z };
  // 仲間はリーダーと nav を共有しているので、新しいオブジェクトにしてから書き換える
  c.nav = { ...c.nav, path: [] };
  if (c.state === 'WALKING') {
    c.perception.knowsPosition = true;
    c.perception.knowsPositionAt = { x: c.x, z: c.z };
  }
}

/** 10 m ごとの転倒判定。転倒したら結果の表で負傷を決める */
export function slipCheck(world: World, ctx: StaticContext, c: ClimberState, moveGrade: number): void {
  const downhill = moveGrade < 0;
  if (!c.body.alive) return;
  const st = ctx.tuning.slip;
  const cls = slipClassAt(ctx, c, moveGrade);
  const p = slipP10(world, ctx, c, cls, downhill);
  if (!chance(world.rng.hazard, p)) return;
  const table = st.outcomes[cls]!;
  let r = nextFloat(world.rng.hazard);
  let k = 0;
  while (k < table.length - 1 && r >= table[k]!) r -= table[k++]!;
  const outcome: (InjuryKind | 'death')[] = ['none', 'bruise', 'sprain', 'legFracture', 'headInjury', 'severeTrauma', 'death'];
  const injury = outcome[k]!;
  const gust = c.local.windMs * world.weather.gust > st.gustFromMs;
  ctx.events.push({ tMin: world.tMin, type: gust ? 'GUST_FALL' : 'FALL', climberId: c.id, important: injury !== 'none', data: { severity: injury, injury, cls, x: c.x, z: c.z } });
  if ((cls === 'EXPOSED' || cls === 'OFF_STEEP' || cls === 'CLIFF') && injury !== 'none') {
    fallDownslope(world, ctx, c, randRange(world.rng.hazard, st.fallMinM, st.fallMaxM));
  }
  injure(world, ctx, c, injury, 'fall');
}

/** 重度外傷の死亡と、頭部外傷の意識の戻り（毎ティック） */
export function injuryTimers(world: World, ctx: StaticContext, c: ClimberState): void {
  if (!c.body.alive) return;
  const m = c.memo;
  if (m.traumaDeathAtMin !== null && world.tMin >= m.traumaDeathAtMin) {
    m.traumaDeathAtMin = null;
    injure(world, ctx, c, 'death', 'trauma');
  }
}
