/**
 * 全体気象（docs/05 §1）: キーフレームの補間＋時間ノイズ＋雷雲セル。
 * 値は基準標高 refElevM での値。結果は world.weather に入れ、描画もこの値を使う。
 */
import { parseTimeRef } from '../core/clock';
import { dexp } from '../core/dmath';
import { deriveSeed1 } from '../core/rng';
import { preparePolyline, smoothstep, type PreparedPolyline } from '../terrain/geom';
import { TUNING, type Tuning } from '../tuning';
import type { ScenarioDef, StaticContext, ThunderCellDef, WeatherKeyframe, World } from '../types';

/** 補間した基準値（ノイズの前） */
export interface WeatherBase {
  tempC: number;
  windMs: number;
  windDirDeg: number;
  precipMmH: number;
  cloudCover: number;
  cloudBaseM: number;
  visibilityM: number;
  inCloudVisibilityM: number;
  thunder: number;
  pressureHpa: number;
  gustiness: number;
}

interface TimedKf {
  t: number;
  kf: WeatherKeyframe;
}

interface CellRuntime {
  def: ThunderCellDef;
  from: number;
  peakAt: number;
  to: number;
  path: PreparedPolyline;
}

interface WeatherRuntime {
  keyframes: TimedKf[];
  cells: CellRuntime[];
}

// シナリオの解析結果のキャッシュ（World には入れない。同じ定義なら同じ結果なので決定論は保たれる）
const runtimeCache = new WeakMap<ScenarioDef['weather'], WeatherRuntime>();

export function weatherRuntime(scenario: ScenarioDef): WeatherRuntime {
  const w = scenario.weather;
  let rt = runtimeCache.get(w);
  if (!rt) {
    rt = {
      keyframes: w.keyframes.map((kf) => ({ t: parseTimeRef(kf.at), kf })),
      cells: (w.thunderCells ?? []).map((def) => ({
        def,
        from: parseTimeRef(def.from),
        peakAt: parseTimeRef(def.peakAt),
        to: parseTimeRef(def.to),
        path: preparePolyline(def.path),
      })),
    };
    runtimeCache.set(w, rt);
  }
  return rt;
}

function baseOf(kf: WeatherKeyframe, tuning: Tuning): WeatherBase {
  const d = tuning.weather;
  return {
    tempC: kf.tempC,
    windMs: kf.windMs,
    windDirDeg: kf.windDirDeg,
    precipMmH: kf.precipMmH,
    cloudCover: kf.cloudCover,
    cloudBaseM: kf.cloudBaseM,
    visibilityM: kf.visibilityM,
    inCloudVisibilityM: kf.inCloudVisibilityM ?? d.defaultInCloudVisibilityM,
    thunder: kf.thunder ?? 0,
    pressureHpa: kf.pressureHpa ?? d.defaultPressureHpa,
    gustiness: kf.gustiness ?? d.defaultGustiness,
  };
}

/** 風向の補間（最短の弧）。0〜360 に正規化 */
export function lerpAngleDeg(a: number, b: number, f: number): number {
  let diff = (((b - a) % 360) + 540) % 360 - 180;
  if (diff === -180) diff = 180;
  const r = a + diff * f;
  return ((r % 360) + 360) % 360;
}

/** キーフレームの補間。最初より前は最初の値、最後より後は最後の値 */
export function interpolateKeyframes(kfs: readonly TimedKf[], tMin: number, tuning: Tuning = TUNING): WeatherBase {
  if (kfs.length === 0) throw new Error('weather.keyframes が空です');
  const first = kfs[0]!;
  if (tMin <= first.t) return baseOf(first.kf, tuning);
  const last = kfs[kfs.length - 1]!;
  if (tMin >= last.t) return baseOf(last.kf, tuning);
  let i = 0;
  while (i + 1 < kfs.length && kfs[i + 1]!.t <= tMin) i += 1;
  const a = kfs[i]!;
  const b = kfs[i + 1]!;
  const f = b.t > a.t ? (tMin - a.t) / (b.t - a.t) : 1;
  const A = a.kf;
  const B = b.kf;
  const d = tuning.weather;
  const icA = A.inCloudVisibilityM ?? d.defaultInCloudVisibilityM;
  const icB = B.inCloudVisibilityM ?? d.defaultInCloudVisibilityM;
  const thA = A.thunder ?? 0;
  const thB = B.thunder ?? 0;
  const prA = A.pressureHpa ?? d.defaultPressureHpa;
  const prB = B.pressureHpa ?? d.defaultPressureHpa;
  const guA = A.gustiness ?? d.defaultGustiness;
  const guB = B.gustiness ?? d.defaultGustiness;
  return {
    tempC: A.tempC + (B.tempC - A.tempC) * f,
    windMs: A.windMs + (B.windMs - A.windMs) * f,
    windDirDeg: lerpAngleDeg(A.windDirDeg, B.windDirDeg, f),
    precipMmH: A.precipMmH + (B.precipMmH - A.precipMmH) * f,
    cloudCover: A.cloudCover + (B.cloudCover - A.cloudCover) * f,
    cloudBaseM: A.cloudBaseM + (B.cloudBaseM - A.cloudBaseM) * f,
    visibilityM: A.visibilityM + (B.visibilityM - A.visibilityM) * f,
    inCloudVisibilityM: icA + (icB - icA) * f,
    thunder: thA + (thB - thA) * f,
    pressureHpa: prA + (prB - prA) * f,
    gustiness: guA + (guB - guA) * f,
  };
}

/** シナリオのキーフレームと、途中で挿入されたもの（weatherOverride）を時刻順に合わせる */
export function effectiveKeyframes(world: World, scenario: ScenarioDef): TimedKf[] {
  const base = weatherRuntime(scenario).keyframes;
  if (world.weather.overrides.length === 0) return base;
  const extra = world.weather.overrides.map((kf) => ({ t: parseTimeRef(kf.at), kf }));
  // 同じ時刻なら挿入した方を後に置く（後の値が勝つ）
  return [...base, ...extra].map((k, i) => ({ k, i })).sort((x, y) => x.k.t - y.k.t || x.i - y.i).map((x) => x.k);
}

// ---------- 時間ノイズ ----------

/** 格子点 i の値 [-1, 1]（シードと整数から決まる） */
function lattice(seed: number, i: number): number {
  return (deriveSeed1(seed, i) / 4294967296) * 2 - 1;
}

/** 1 次元バリューノイズ（2 オクターブ）。おおよそ [-1, 1] */
export function timeNoise(seed: number, tMin: number, tuning: Tuning = TUNING): number {
  const periods = tuning.weather.noisePeriodsMin;
  const amps = tuning.weather.noiseOctaveAmps;
  let sum = 0;
  for (let o = 0; o < periods.length; o += 1) {
    const s = deriveSeed1(seed, o);
    const x = tMin / periods[o]!;
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    const a = lattice(s, i);
    const b = lattice(s, i + 1);
    sum += amps[o]! * (a + (b - a) * u);
  }
  return sum;
}

// ---------- 雷雲セル ----------

export interface ActiveCell {
  def: ThunderCellDef;
  x: number;
  z: number;
  /** 時間包絡 0..1 */
  env: number;
}

export function activeCells(scenario: ScenarioDef, tMin: number): ActiveCell[] {
  const out: ActiveCell[] = [];
  for (const c of weatherRuntime(scenario).cells) {
    if (tMin < c.from || tMin > c.to) continue;
    const env = tMin <= c.peakAt ? smoothstep(c.from, c.peakAt, tMin) : 1 - smoothstep(c.peakAt, c.to, tMin);
    const u = c.to > c.from ? (tMin - c.from) / (c.to - c.from) : 0;
    const pos = pointAlong(c.path, u);
    out.push({ def: c.def, x: pos.x, z: pos.z, env });
  }
  return out;
}

function pointAlong(pl: PreparedPolyline, u: number): { x: number; z: number } {
  const n = pl.xs.length;
  if (n === 1) return { x: pl.xs[0]!, z: pl.zs[0]! };
  const total = pl.cum[n - 1]!;
  const d = Math.min(1, Math.max(0, u)) * total;
  let i = 0;
  while (i < n - 2 && pl.cum[i + 1]! < d) i += 1;
  const seg = pl.cum[i + 1]! - pl.cum[i]!;
  const f = seg > 0 ? (d - pl.cum[i]!) / seg : 0;
  return { x: pl.xs[i]! + (pl.xs[i + 1]! - pl.xs[i]!) * f, z: pl.zs[i]! + (pl.zs[i + 1]! - pl.zs[i]!) * f };
}

/** 地点の雷雲の影響（docs/05 §1.3）。core は直下の強さ（境目で滑らかに 0） */
export function cellInfluenceAt(
  cells: readonly ActiveCell[],
  x: number,
  z: number,
  tuning: Tuning = TUNING,
): { thunder: number; core: number; heavyRainMmH: number; hail: boolean } {
  const wt = tuning.weather;
  let thunder = 0;
  let core = 0;
  let rain = 0;
  let hail = false;
  for (const c of cells) {
    const dx = x - c.x;
    const dz = z - c.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const r = c.def.radiusM;
    const gauss = dexp(-(d / r) * (d / r));
    thunder = Math.max(thunder, c.def.peak * c.env * gauss);
    const k = c.env * gauss * (1 - smoothstep(wt.cellCoreFadeFrom * r, wt.cellCoreRatio * r, d));
    if (k > core) core = k;
    rain += c.def.heavyRainMmH * k;
    if (c.def.hail && c.env > wt.hailEnvMin && d < wt.cellCoreRatio * r) hail = true;
  }
  return { thunder, core, heavyRainMmH: rain, hail };
}

// ---------- 更新 ----------

export function updateGlobal(world: World, ctx: StaticContext): void {
  const t = ctx.tuning;
  const b = interpolateKeyframes(effectiveKeyframes(world, ctx.scenario), world.tMin, t);
  const seed = world.weather.noiseSeed;
  const n1 = timeNoise(deriveSeed1(seed, 1), world.tMin, t);
  const n2 = timeNoise(deriveSeed1(seed, 2), world.tMin, t);
  const n3 = timeNoise(deriveSeed1(seed, 3), world.tMin, t);
  const w = world.weather;
  w.tempC = b.tempC + t.weather.tempNoiseC * n2;
  w.windMs = b.windMs;
  w.windDirDeg = b.windDirDeg;
  w.precipMmH = Math.max(0, b.precipMmH * (1 + t.weather.precipNoiseK * n3));
  w.cloudCover = b.cloudCover;
  w.cloudBaseM = b.cloudBaseM;
  w.visibilityM = b.visibilityM;
  w.inCloudVisibilityM = b.inCloudVisibilityM;
  w.thunder = b.thunder;
  w.pressureHpa = b.pressureHpa;
  w.gust = 1 + b.gustiness * Math.max(0, n1) * t.weather.gustK;
  w.cells = activeCells(ctx.scenario, world.tMin).map((c) => ({
    id: c.def.id,
    x: c.x,
    z: c.z,
    strength: c.def.peak * c.env,
    radiusM: c.def.radiusM,
  }));
}
