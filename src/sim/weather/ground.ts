/**
 * 地面の状態（docs/05 §3）。標高 50 m 刻みのビンで持ち、1 ゲーム分ごとに更新する。
 * ビンごとの降水・気温は、その標高・露出 1.0・平らな仮想地点で局地補正を評価した代表値。
 * icy は 1 = 凍結。気温が 1℃ を超えている間は 1/60 ずつ減り、60 分続くと 0（途中で冷えたら 1 に戻る）。
 */
import { dexp } from '../core/dmath';
import type { ClimberState, GroundState, ScenarioDef, StaticContext, World } from '../types';
import { precipTypeOf } from './local';

export const GROUND_BIN_M = 50;
export const GROUND_BINS = 61; // 0〜3,050 m

type Snowpack = NonNullable<ScenarioDef['snowpack']>;

/** 始まりの積雪の深さ（cm）。lineM から fullM（省略は lineM+400）まで増える */
export function snowpackDepthAt(sp: Snowpack, elevM: number): number {
  if (sp.depthCm <= 0 || elevM <= sp.lineM) return 0;
  const full = sp.fullM ?? sp.lineM + 400;
  return sp.depthCm * (full > sp.lineM ? Math.min(1, (elevM - sp.lineM) / (full - sp.lineM)) : 1);
}

/**
 * 足元の雪の深さ（cm）。登山道の上で、シナリオが踏み跡の深さ（trailCm）を決めていれば、始まりの積雪はそこまで踏み固められている
 * （その後に降った雪はそのまま積もる）。道を外れれば、積もったままの深さ。
 */
export function footSnowCm(world: World, ctx: StaticContext, c: ClimberState): number {
  const g = groundAt(world.ground, c.elevM).snowCm;
  const sp = ctx.scenario.snowpack;
  if (!sp || sp.trailCm === undefined || c.pos.mode === 'free') return g;
  const base = Math.min(g, snowpackDepthAt(sp, c.elevM));
  return g - base + Math.min(base, sp.trailCm);
}

/** 始まりの地面。snowpack があれば、その標高より上に積もった状態で始める */
export function createGround(snowpack?: Snowpack): GroundState {
  const snowCm = new Array<number>(GROUND_BINS).fill(0);
  if (snowpack && snowpack.depthCm > 0) {
    for (let b = 0; b < GROUND_BINS; b += 1) snowCm[b] = snowpackDepthAt(snowpack, b * GROUND_BIN_M + GROUND_BIN_M / 2);
  }
  return {
    snowCm,
    wet: new Array<number>(GROUND_BINS).fill(0),
    icy: new Array<number>(GROUND_BINS).fill(0),
  };
}

export function groundBin(elevM: number): number {
  const b = Math.floor(elevM / GROUND_BIN_M);
  return b < 0 ? 0 : b >= GROUND_BINS ? GROUND_BINS - 1 : b;
}

export function groundAt(g: GroundState, elevM: number): { snowCm: number; wet: number; icy: boolean } {
  const b = groundBin(elevM);
  return { snowCm: g.snowCm[b] ?? 0, wet: g.wet[b] ?? 0, icy: (g.icy[b] ?? 0) > 0 };
}

/** ビンの代表地点の気温と降水 */
export function binWeather(world: World, ctx: StaticContext, bin: number): { tempC: number; precipMmH: number } {
  const elevM = bin * GROUND_BIN_M + GROUND_BIN_M / 2;
  const g = world.weather;
  const sw = ctx.scenario.weather;
  const tempC = g.tempC - (sw.lapseRateCPer100m * (elevM - sw.refElevM)) / 100;
  const precipMmH = g.precipMmH * (elevM > g.cloudBaseM ? ctx.tuning.weather.inCloudPrecipF : 1);
  return { tempC, precipMmH };
}

/** 1 ゲーム分の更新 */
export function updateGround(world: World, ctx: StaticContext, dtMin = 1): void {
  const gt = ctx.tuning.ground;
  const gr = world.ground;
  for (let b = 0; b < GROUND_BINS; b += 1) {
    const { tempC, precipMmH } = binWeather(world, ctx, b);
    const type = precipTypeOf(tempC, precipMmH, false, ctx.tuning);
    // 積雪
    let snow = gr.snowCm[b]!;
    if (type === 'snow') snow += (precipMmH * gt.snowCmPerMm * dtMin) / 60;
    else if (type === 'sleet') snow += (precipMmH * gt.snowCmPerMm * gt.sleetSnowF * dtMin) / 60;
    if (tempC > gt.meltAboveC) snow -= (gt.meltCmPerHourPerC * (tempC - gt.meltAboveC) * dtMin) / 60;
    if (type === 'rain') snow -= (precipMmH * gt.rainMeltCmPerMm * dtMin) / 60;
    gr.snowCm[b] = Math.max(0, snow);
    // 濡れ（降水中は 1 へ、降水なしで乾く）
    let wet = gr.wet[b]!;
    if (type !== 'none') wet += (1 - wet) * (1 - dexp(-dtMin / gt.wetTauMin));
    else {
      const tau = tempC < gt.dryColdBelowC ? gt.dryTauColdMin : gt.dryTauMin;
      wet -= wet * (1 - dexp(-dtMin / tau));
    }
    gr.wet[b] = wet;
    // 凍結
    let icy = gr.icy[b]!;
    if (wet > gt.icyWetMin && tempC < gt.icyFreezeBelowC) icy = 1;
    else if (icy > 0) icy = tempC > gt.icyThawAboveC ? Math.max(0, icy - dtMin / gt.icyThawMin) : 1;
    gr.icy[b] = icy;
  }
}
