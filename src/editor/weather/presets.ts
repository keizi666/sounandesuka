/**
 * 天気パターン（docs/17 §4）。既存のキーフレームに重ねる形でキーフレームを作る（パターンの期間の内側の既存キーフレームは置き換える）。
 * 値の基準: Δ は t0 時点の既存の補間値（base）からの差、→ は絶対値、指定なし（維持）はその時刻の既存の補間値。
 * 教材用の型であり、実際の気象を正確に表すものではない。
 */
import { formatTimeRef, parseTimeRef } from '../../sim/core/clock';
import type { ThunderCellDef, WeatherDef, WeatherKeyframe, WeatherPresetId } from '../../sim/types';
import { interpolateKeyframes } from '../../sim/weather/global';

export interface PresetParams {
  t0Min: number;
  s: number;
  /** winterMonsoon: 'sea' | 'pacific'、typhoon: 'east' | 'west' */
  side?: string;
  /** fog: 雲底 m、fog・baiuRain: 持続時間（時間） */
  baseM?: number;
  hours?: number;
  /** summerThunderstorm: 雷雲の進路（2 点以上） */
  path?: [number, number][];
  /** highPressure: 日の出・日の入り（時刻 HH:MM の分） */
  sunriseMin?: number;
  sunsetMin?: number;
}

export const PRESET_LABELS: Record<WeatherPresetId, string> = {
  coldFront: '寒冷前線の通過',
  warmFront: '温暖前線の接近',
  southCoastLow: '南岸低気圧（雪）',
  winterMonsoon: '冬型の季節風',
  summerThunderstorm: '夏の雷雨（熱雷）',
  fog: '霧（層雲・ガス）',
  baiuRain: '梅雨前線の長雨',
  typhoon: '台風の接近',
  highPressure: '移動性高気圧（晴天と放射冷却）',
};

type V = { d: number } | { x: number } | null;
const D = (d: number): V => ({ d });
const X = (x: number): V => ({ x });

interface Step {
  dtMin: number;
  temp?: V;
  wind?: V;
  dir?: V;
  precip?: V;
  cover?: V;
  base?: V;
  vis?: V;
  thunder?: V;
  gust?: V;
  inCloudVis?: V;
}

function keyed(kfs: readonly WeatherKeyframe[]): { t: number; kf: WeatherKeyframe }[] {
  return kfs.map((kf) => ({ t: parseTimeRef(kf.at), kf })).sort((a, b) => a.t - b.t);
}

function stepsFor(id: WeatherPresetId, p: PresetParams, ref: number): Step[] {
  const s = p.s;
  const H = 60;
  switch (id) {
    case 'coldFront':
      return [
        { dtMin: -3 * H, wind: { x: NaN }, dir: X(220), precip: X(0), cover: X(0.7), base: D(-300) },
        { dtMin: -1 * H, wind: { x: NaN }, dir: X(220), precip: X(2 * s), cover: X(1), base: X(ref + 900), vis: X(8000) },
        { dtMin: 0, temp: D(-1 * s), wind: X(9 * s), dir: X(260), precip: X(8 * s), cover: X(1), base: X(ref + 700), vis: X(3000) },
        { dtMin: 1 * H, temp: D(-3 * s), wind: X(9 * s), dir: X(300), precip: X(6 * s), cover: X(1), base: X(ref + 700), vis: X(3000) },
        { dtMin: 3 * H, temp: D(-5 * s), wind: X(8 * s), dir: X(310), precip: X(3 * s), cover: X(1), base: X(ref + 800), vis: X(4000) },
        { dtMin: 6 * H, temp: D(-6 * s), wind: X(6 * s), dir: X(320), precip: X(1), cover: X(0.8), base: X(ref + 1100), vis: X(8000) },
      ];
    case 'warmFront':
      return [
        { dtMin: -12 * H, cover: X(0.5), base: X(ref + 4000) },
        { dtMin: -6 * H, cover: X(0.8), base: X(ref + 2000) },
        { dtMin: -2 * H, precip: X(0.5), base: X(ref + 800), vis: X(10000), cover: X(0.95) },
        { dtMin: 0, precip: X(3 * s), base: X(ref + 300), vis: X(3000), dir: X(140), wind: X(5 * s), cover: X(1) },
        { dtMin: 4 * H, temp: D(3 * s), precip: X(1), base: X(ref + 600), cover: X(1) },
      ];
    case 'southCoastLow':
      return [
        { dtMin: -9 * H, cover: X(0.9), dir: X(45), wind: X(3) },
        { dtMin: -3 * H, precip: X(2 * s), dir: X(45), cover: X(1) },
        { dtMin: 0, precip: X(4 * s), dir: X(45), wind: X(7 * s), temp: X(0), base: X(ref), cover: X(1), vis: X(2000) },
        { dtMin: 6 * H, precip: X(1), dir: X(315), wind: X(6), temp: X(-1), cover: X(0.9) },
        { dtMin: 9 * H, cover: X(0.5), dir: X(315), wind: X(8), temp: D(-3), precip: X(0) },
      ];
    case 'winterMonsoon':
      return p.side === 'pacific'
        ? [
            { dtMin: 0, dir: X(310), wind: X(10 * s), temp: D(-5), precip: X(0), cover: X(0.3), vis: X(30000) },
            { dtMin: 6 * H, dir: X(310), wind: X(14 * s) },
            { dtMin: 18 * H, dir: X(310), wind: X(10 * s) },
            { dtMin: 30 * H, dir: X(310), wind: X(6) },
          ]
        : [
            { dtMin: 0, dir: X(310), wind: X(10 * s), temp: D(-5), precip: X(1.5 * s), cover: X(1), base: X(ref + 300), vis: X(2000) },
            { dtMin: 6 * H, dir: X(310), wind: X(14 * s), precip: X(2.5 * s) },
            { dtMin: 18 * H, dir: X(310), wind: X(10 * s), precip: X(1) },
            { dtMin: 30 * H, dir: X(310), wind: X(6), precip: X(0.3), cover: X(0.7) },
          ];
    case 'summerThunderstorm':
      return [
        { dtMin: -4 * H, cover: X(0.4) },
        { dtMin: -2 * H, cover: X(0.6), thunder: X(0.1) },
        { dtMin: 0, cover: X(0.95), base: X(ref + 1100), precip: X(2), thunder: X(0.3), gust: X(0.5) },
        { dtMin: 2 * H, cover: X(0.7), thunder: X(0.1), precip: X(0.5) },
        { dtMin: 4 * H, cover: X(0.4), thunder: X(0), precip: X(0) },
      ];
    case 'fog': {
      const b = p.baseM ?? ref + 500;
      const d = (p.hours ?? 4) * H;
      return [
        { dtMin: -1 * H, cover: X(0.9), base: X(b + 300) },
        { dtMin: 0, cover: X(1), base: X(b), inCloudVis: X(40), precip: X(0.3) },
        { dtMin: d, cover: X(1), base: X(b), inCloudVis: X(40), precip: X(0.3) },
        { dtMin: d + 2 * H, cover: X(0.7), base: X(b + 800), precip: X(0) },
      ];
    }
    case 'baiuRain': {
      const d = (p.hours ?? 12) * H;
      const out: Step[] = [];
      for (let t = 0; t <= d; t += 90) {
        const ph = Math.sin((t / 180) * Math.PI);
        out.push({ dtMin: t, precip: X((5 + 3 * ph) * s * (t === 0 ? 0.4 : 1)), base: X(ref + 500), cover: X(1), dir: X(225), wind: X(4), vis: X(5000) });
      }
      return out;
    }
    case 'typhoon': {
      const east = p.side !== 'west';
      return [
        { dtMin: -24 * H, wind: X(6), cover: X(0.8) },
        { dtMin: -12 * H, wind: X(10 * s), precip: X(3 * s), cover: X(1), dir: X(east ? 135 : 90) },
        { dtMin: -3 * H, wind: X(18 * s), precip: X(15 * s), vis: X(1500), dir: X(east ? 150 : 60) },
        { dtMin: 0, wind: X(22 * s), precip: X(25 * s), vis: X(1000), dir: X(east ? 180 : 20) },
        { dtMin: 6 * H, wind: X(12), precip: X(3), dir: X(east ? 225 : 0) },
        { dtMin: 12 * H, wind: X(10), precip: X(0), cover: X(0.6), dir: X(east ? 270 : 330), vis: X(20000) },
      ];
    }
    case 'highPressure': {
      const day = Math.floor(p.t0Min / 1440) * 1440;
      const rise = p.sunriseMin ?? 360;
      const set = p.sunsetMin ?? 1080;
      const marks = [0, set - (p.t0Min - day), rise + 1440 - (p.t0Min - day), 720 + 1440 - (p.t0Min - day), 1440];
      return marks
        .filter((m) => m >= 0 && m <= 1440)
        .sort((a, b) => a - b)
        .map((m) => {
          const clock = (p.t0Min + m) % 1440;
          const night = clock < rise || clock > set;
          return { dtMin: m, cover: X(0.1), wind: X(2), precip: X(0), vis: X(40000), temp: D(night ? -6 * s : 2) };
        });
    }
  }
}

function resolve(v: V | undefined, base0: number, here: number): number {
  if (v === undefined || v === null) return here;
  if ('d' in v) return base0 + v.d;
  return Number.isNaN(v.x) ? here : v.x;
}

/** パターンを適用したキーフレーム列（と雷雲セル）を返す。元の配列は変えない */
export function applyPreset(w: WeatherDef, id: WeatherPresetId, p: PresetParams): { keyframes: WeatherKeyframe[]; cells: ThunderCellDef[] } {
  const ref = w.refElevM;
  const kfs = keyed(w.keyframes);
  const base0 = interpolateKeyframes(kfs, p.t0Min);
  const steps = stepsFor(id, p, ref);
  const gen: WeatherKeyframe[] = steps.map((st) => {
    const t = Math.max(0, Math.round(p.t0Min + st.dtMin));
    const here = interpolateKeyframes(kfs, t);
    let wind = resolve(st.wind, base0.windMs, here.windMs);
    // 寒冷前線の「×1.2」「×1.5」
    if (id === 'coldFront' && st.dtMin === -180) wind = base0.windMs * 1.2;
    if (id === 'coldFront' && st.dtMin === -60) wind = base0.windMs * 1.5;
    const kf: WeatherKeyframe = {
      at: formatTimeRef(t),
      tempC: round1(resolve(st.temp, base0.tempC, here.tempC)),
      windMs: round1(Math.max(0, wind)),
      windDirDeg: Math.round(resolve(st.dir, base0.windDirDeg, here.windDirDeg)),
      precipMmH: round1(Math.max(0, resolve(st.precip, base0.precipMmH, here.precipMmH))),
      cloudCover: Math.round(Math.min(1, Math.max(0, resolve(st.cover, base0.cloudCover, here.cloudCover))) * 100) / 100,
      cloudBaseM: Math.round(resolve(st.base, base0.cloudBaseM, here.cloudBaseM)),
      visibilityM: Math.round(resolve(st.vis, base0.visibilityM, here.visibilityM)),
      pressureHpa: Math.round(here.pressureHpa),
    };
    const th = resolve(st.thunder, base0.thunder, here.thunder);
    if (th > 0) kf.thunder = round2(th);
    const gu = resolve(st.gust, base0.gustiness, here.gustiness);
    if (st.gust !== undefined) kf.gustiness = round2(gu);
    if (st.inCloudVis !== undefined) kf.inCloudVisibilityM = resolve(st.inCloudVis, 0, here.inCloudVisibilityM);
    return kf;
  });
  const t0 = parseTimeRef(gen[0]!.at);
  const t1 = parseTimeRef(gen[gen.length - 1]!.at);
  const keep = w.keyframes.filter((k) => {
    const t = parseTimeRef(k.at);
    return t < t0 || t > t1;
  });
  const keyframes = [...keep, ...gen].sort((a, b) => parseTimeRef(a.at) - parseTimeRef(b.at));
  const cells: ThunderCellDef[] = [];
  if (id === 'summerThunderstorm') {
    const path = p.path && p.path.length >= 2 ? p.path : ([[1500, 1500], [-1500, -1500]] as [number, number][]);
    cells.push({
      id: `cb${(w.thunderCells?.length ?? 0) + 1}`,
      from: formatTimeRef(p.t0Min - 70),
      peakAt: formatTimeRef(p.t0Min),
      to: formatTimeRef(p.t0Min + 80),
      path,
      radiusM: Math.round(1400 * p.s),
      peak: Math.min(1, p.s),
      heavyRainMmH: Math.round(25 * p.s),
      hail: p.s >= 1,
    });
  }
  return { keyframes, cells };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
