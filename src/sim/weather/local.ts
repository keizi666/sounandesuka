/**
 * 局地気象（docs/05 §2）: 全体気象を地点の標高・地形・植生で補正する。毎ティック、登山者ごとに呼ぶ。
 */
import { DEG, dcos, dpow, dsin } from '../core/dmath';
import { sampleBilinear, sampleElev, nearestIndex, type HeightGrid } from '../terrain/sample';
import { TUNING, type Tuning } from '../tuning';
import type { GlobalWeather, LocalWeather, MapRuntime, PrecipType, ScenarioDef, StaticContext, World } from '../types';
import { activeCells, cellInfluenceAt } from './global';

/** 風上方向（風が吹いてくる方）の単位ベクトル。x が東、z が南 */
export function upwindVector(windDirDeg: number): { x: number; z: number } {
  const r = windDirDeg * DEG;
  return { x: dsin(r), z: -dcos(r) };
}

/** 風下の守られ具合 0..1（docs/04 §8）: 風上 100 m 以内の地形が地点より何 m 高いか / 30 */
export function shelterFromWind(g: HeightGrid, x: number, z: number, windDirDeg: number, tuning: Tuning = TUNING): number {
  const w = tuning.weather;
  const up = upwindVector(windDirDeg);
  const h0 = sampleElev(g, x, z);
  let maxDiff = 0;
  for (let d = w.shelterStepM; d <= w.shelterLookM + 1e-9; d += w.shelterStepM) {
    const diff = sampleElev(g, x + up.x * d, z + up.z * d) - h0;
    if (diff > maxDiff) maxDiff = diff;
  }
  return Math.min(1, maxDiff / w.shelterFullM);
}

/** 風上斜面の度合い（風が吹いていく向きに地形が上っている勾配。上りで正） */
function upslopeOf(g: HeightGrid, x: number, z: number, windDirDeg: number): number {
  const e = g.cell;
  const dhdx = (sampleElev(g, x + e, z) - sampleElev(g, x - e, z)) / (2 * e);
  const dhdz = (sampleElev(g, x, z + e) - sampleElev(g, x, z - e)) / (2 * e);
  const up = upwindVector(windDirDeg);
  // 風が向かう向き = −風上
  return Math.max(0, -up.x * dhdx + -up.z * dhdz);
}

export function precipTypeOf(tempC: number, precipMmH: number, hail: boolean, tuning: Tuning = TUNING): PrecipType {
  const w = tuning.weather;
  if (precipMmH < w.precipNoneBelowMmH) return 'none';
  if (hail) return 'hail';
  if (tempC < w.snowBelowC) return 'snow';
  if (tempC < w.sleetBelowC) return 'sleet';
  return 'rain';
}

/** 体感温度（JAG/TI の風冷指数）。T ≤ 10℃ かつ V ≥ 4.8 km/h で適用 */
export function windChillC(tempC: number, windMs: number, tuning: Tuning = TUNING): number {
  const v = windMs * 3.6;
  if (v < tuning.weather.windChillMinKmh) return tempC;
  const p = dpow(v, 0.16);
  const jag = (t: number): number => 13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p;
  const maxC = tuning.weather.windChillMaxC;
  if (tempC <= maxC) return jag(tempC);
  // 式の適用範囲（10℃）より暖かいときも、風は体を冷やす。10℃での下がり幅を、fadeC 上の温度で 0 になるように弱めて引く
  const drop = maxC - jag(maxC);
  const fade = Math.max(0, 1 - (tempC - maxC) / tuning.weather.windChillFadeC);
  return tempC - drop * fade;
}

/** 雲の中・雲底付近と降水による視程（docs/05 §2.4） */
export function visibilityOf(
  g: Pick<GlobalWeather, 'cloudBaseM' | 'cloudCover' | 'visibilityM' | 'inCloudVisibilityM'>,
  elevM: number,
  precipMmH: number,
  type: PrecipType,
  tuning: Tuning = TUNING,
): { visibilityM: number; inCloud: boolean } {
  const w = tuning.weather;
  const foggy = g.cloudCover >= w.cloudCoverForFog;
  let vis = g.visibilityM;
  const inCloud = foggy && elevM >= g.cloudBaseM;
  if (inCloud) vis = g.inCloudVisibilityM;
  else if (foggy && elevM >= g.cloudBaseM - w.cloudFogBandM) {
    const f = (elevM - (g.cloudBaseM - w.cloudFogBandM)) / w.cloudFogBandM;
    vis = g.visibilityM + (g.inCloudVisibilityM - g.visibilityM) * f;
  }
  vis = Math.min(vis, w.visPrecipBaseM / (1 + w.visPrecipK * precipMmH));
  if (type === 'snow') vis = Math.min(vis, w.visSnowBaseM / (1 + w.visSnowK * precipMmH));
  return { visibilityM: vis, inCloud };
}

/** 地点の局地気象 */
export function sampleLocal(
  world: World,
  ctx: { map: MapRuntime; scenario: ScenarioDef; tuning: Tuning },
  x: number,
  z: number,
  elevM: number,
): LocalWeather {
  const t = ctx.tuning;
  const w = t.weather;
  const map = ctx.map;
  const g = world.weather;
  const sw = ctx.scenario.weather;
  const cell = cellInfluenceAt(activeCells(ctx.scenario, world.tMin), x, z, t);

  // 気温
  const tempC = g.tempC - (sw.lapseRateCPer100m * (elevM - sw.refElevM)) / 100 - w.cellCoolingC * cell.core;

  // 風
  const altF = Math.min(w.altWindMax, Math.max(w.altWindMin, 1 + (w.altWindPer1000m * (elevM - sw.refElevM)) / 1000));
  const expF = sampleBilinear(map, map.exposure, x, z);
  const leeF = 1 - w.leeK * shelterFromWind(map, x, z, g.windDirDeg, t);
  const vegF = w.vegWindFactor[map.veg[nearestIndex(map, x, z)]!] ?? 1;
  const windMs = g.windMs * g.gust * altF * expF * leeF * vegF + w.cellGustMs * cell.core;

  // 降水
  const oroF = 1 + w.oroK * Math.min(1, Math.max(0, upslopeOf(map, x, z, g.windDirDeg) * w.oroSlopeK));
  const cloudF = elevM > g.cloudBaseM ? w.inCloudPrecipF : 1;
  const precipMmH = g.precipMmH * oroF * cloudF + cell.heavyRainMmH;
  const precipType = precipTypeOf(tempC, precipMmH, cell.hail, t);

  const vis = visibilityOf(g, elevM, precipMmH, precipType, t);
  const sunElev = world.sun.elevDeg * DEG;
  const solarW =
    w.solarMaxW *
    Math.max(0, dsin(sunElev)) *
    (1 - w.solarCloudK * g.cloudCover) *
    (vis.inCloud ? w.solarInCloudF : 1) *
    sampleBilinear(map, map.skyView, x, z);

  return {
    tempC,
    windMs,
    windDirDeg: g.windDirDeg,
    precipMmH,
    precipType,
    visibilityM: vis.visibilityM,
    windChillC: windChillC(tempC, windMs, t),
    thunder: Math.max(g.thunder, cell.thunder),
    solarW,
    inCloud: vis.inCloud,
  };
}

/** 全登山者の局地気象を更新する（docs/03 §4 の 8a）。同じ地点にいる人は同じ値を使う */
export function updateClimberLocal(world: World, ctx: StaticContext): void {
  let px = NaN;
  let pz = NaN;
  let pe = NaN;
  let prev: LocalWeather | null = null;
  for (const c of world.climbers) {
    if (prev && c.x === px && c.z === pz && c.elevM === pe) {
      c.local = { ...prev };
      continue;
    }
    c.local = sampleLocal(world, ctx, c.x, c.z, c.elevM);
    prev = c.local;
    px = c.x;
    pz = c.z;
    pe = c.elevM;
  }
}
