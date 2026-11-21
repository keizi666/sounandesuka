/**
 * 天候のテンプレート（3 日間）: 「ずっと好天」「当日の午後から崩れる」「翌日から崩れる」「最初は悪天候で回復」など、
 * D0 00:00〜D3 00:00 のキーフレームをまとめて作る。気温は季節の日変化（日の出前に最低、14 時に最高、雲が多いと幅が小さい）。
 * 教材用の型であり、実際の気象を正確に表すものではない。エディター専用（sim ではないので Math の超越関数を直接使う）。
 */
import { formatTimeRef } from '../../sim/core/clock';
import type { ScenarioDef, ThunderCellDef, WeatherKeyframe } from '../../sim/types';

type Season = ScenarioDef['season'];

export type WeatherTemplateId = 'fair3' | 'breakAfternoon' | 'breakNextDay' | 'breakDay3' | 'badThenRecover' | 'afternoonThunder' | 'fogCloudy';

export const WEATHER_TEMPLATES: { id: WeatherTemplateId; label: string; hint: string }[] = [
  { id: 'fair3', label: '3 日間ずっと好天', hint: '移動性高気圧。晴れて風が弱い。夜は放射冷却で冷える' },
  { id: 'breakAfternoon', label: '当日の午後から崩れる', hint: '昼前から雲が増え、14 時ごろ雨。夕方から夜は強い雨と風。翌日は冷たい北西風、3 日目は晴れ' },
  { id: 'breakNextDay', label: '翌日から崩れる', hint: '当日は晴れ、夜に雲が増え、翌日の朝から雨・昼過ぎから強い雨と風。3 日目は回復' },
  { id: 'breakDay3', label: 'だんだん崩れて 3 日目に雨', hint: '当日は晴れ、翌日は高い雲が広がり、夜から雨。3 日目は一日雨' },
  { id: 'badThenRecover', label: '最初は悪天候で回復する', hint: '朝は強い雨と風。昼前に雨はやむが、冷たい北西風とガスが残る。夕方から晴れ' },
  { id: 'afternoonThunder', label: '毎日午後に雷雨（夏型）', hint: '朝は晴れ、昼から積乱雲が育ち、14〜16 時に雷雨。雷雲セルを毎日 1 つ置く' },
  { id: 'fogCloudy', label: 'ガスと曇天が続く', hint: '雲底が稜線より低く、山の上は一日中ガスの中。雨は弱い' },
];

/** 天気の状態（その時刻の「型」）。気温は季節の日変化に dT を足す */
interface Cond {
  cover: number;
  precip: number;
  wind: number;
  dir: number;
  /** 雲底の基準標高からの高さ m */
  baseRel: number;
  vis: number;
  pressure: number;
  dT: number;
  thunder: number;
  gust: number;
  /** 雲の中の視程 m（0 なら指定しない） */
  inCloud: number;
}

const C = (c: Partial<Cond>): Cond => ({ cover: 0.15, precip: 0, wind: 3, dir: 300, baseRel: 2500, vis: 40000, pressure: 1022, dT: 0, thunder: 0, gust: 0, inCloud: 0, ...c });

const FAIR = C({});
const HIGH = C({ cover: 0.6, wind: 4, dir: 210, baseRel: 1800, vis: 20000, pressure: 1013 });
const CLOUDY = C({ cover: 0.9, wind: 6, dir: 210, baseRel: 800, vis: 12000, pressure: 1007 });
const RAIN = C({ cover: 1, precip: 4, wind: 9, dir: 220, baseRel: 300, vis: 4000, pressure: 1000, dT: -1, gust: 0.3, inCloud: 60 });
const HEAVY = C({ cover: 1, precip: 8, wind: 13, dir: 240, baseRel: 200, vis: 2500, pressure: 996, dT: -2, gust: 0.5, inCloud: 40 });
const POST = C({ cover: 0.9, precip: 1.5, wind: 12, dir: 300, baseRel: 500, vis: 6000, pressure: 1004, dT: -5, gust: 0.5, inCloud: 60 });
const NW = C({ cover: 0.35, wind: 8, dir: 310, baseRel: 1500, vis: 30000, pressure: 1016, dT: -3, gust: 0.3 });
const FOG = C({ cover: 1, precip: 0.3, wind: 3, dir: 180, baseRel: 0, vis: 8000, pressure: 1010, inCloud: 40 });
const CUMULUS = C({ cover: 0.6, wind: 4, dir: 200, baseRel: 1300, vis: 25000, pressure: 1012 });
const STORM = C({ cover: 0.95, precip: 3, wind: 7, dir: 230, baseRel: 1100, vis: 6000, pressure: 1010, thunder: 0.35, gust: 0.5 });
const AFTER = C({ cover: 0.6, precip: 0.3, wind: 4, dir: 250, baseRel: 1300, vis: 15000, pressure: 1012, thunder: 0.05 });

/** 時刻（D0 00:00 からの時間）と状態の組。間は直線で補う */
function anchors(id: WeatherTemplateId): [number, Cond][] {
  switch (id) {
    case 'fair3':
      return [[0, FAIR], [72, FAIR]];
    case 'breakAfternoon':
      return [[0, FAIR], [9, HIGH], [12, CLOUDY], [14, RAIN], [17, HEAVY], [21, HEAVY], [24, POST], [30, POST], [36, NW], [48, FAIR], [72, FAIR]];
    case 'breakNextDay':
      return [[0, FAIR], [14, FAIR], [19, HIGH], [24, CLOUDY], [29, RAIN], [34, HEAVY], [41, HEAVY], [46, POST], [54, NW], [64, FAIR], [72, FAIR]];
    case 'breakDay3':
      return [[0, FAIR], [24, FAIR], [33, HIGH], [42, CLOUDY], [48, RAIN], [56, HEAVY], [64, RAIN], [72, RAIN]];
    case 'badThenRecover':
      return [[0, HEAVY], [6, HEAVY], [9, RAIN], [11, POST], [14, NW], [19, FAIR], [72, FAIR]];
    case 'afternoonThunder': {
      const out: [number, Cond][] = [];
      for (let d = 0; d < 3; d += 1) out.push([d * 24, FAIR], [d * 24 + 10, FAIR], [d * 24 + 13, CUMULUS], [d * 24 + 15, STORM], [d * 24 + 17, AFTER], [d * 24 + 20, FAIR]);
      out.push([72, FAIR]);
      return out;
    }
    case 'fogCloudy':
      return [[0, CLOUDY], [6, FOG], [17, FOG], [22, CLOUDY], [30, FOG], [41, FOG], [46, CLOUDY], [54, FOG], [72, FOG]];
  }
}

function lerpCond(a: Cond, b: Cond, f: number): Cond {
  const o = {} as Cond;
  for (const k of Object.keys(a) as (keyof Cond)[]) o[k] = a[k] + (b[k] - a[k]) * f;
  // 雲の中の視程は「指定あり」の側に寄せる
  o.inCloud = a.inCloud && b.inCloud ? o.inCloud : f < 0.5 ? a.inCloud : b.inCloud;
  return o;
}

function condAt(list: [number, Cond][], h: number): Cond {
  if (h <= list[0]![0]) return list[0]![1];
  for (let i = 1; i < list.length; i += 1) {
    const [h1, c1] = list[i]!;
    const [h0, c0] = list[i - 1]!;
    if (h <= h1) return lerpCond(c0, c1, h1 === h0 ? 1 : (h - h0) / (h1 - h0));
  }
  return list[list.length - 1]![1];
}

/** 基準標高 1000 m での季節の最低・最高気温（℃）。作例の 10 月の箱庭岳（最低 5〜9 ℃）に合わせた目安 */
const SEASON_TEMP: Record<Season, { low: number; high: number; wind: number }> = {
  spring: { low: 3, high: 13, wind: 1 },
  summer: { low: 16, high: 25, wind: 0.8 },
  autumn: { low: 5, high: 14, wind: 1 },
  winter: { low: -9, high: -1, wind: 1.3 },
};

/** -1（日の出のころ）〜 +1（14 時）の日変化 */
function diurnal(clockH: number, riseH: number): number {
  const peak = 14;
  const h = ((clockH % 24) + 24) % 24;
  if (h >= riseH && h <= peak) return -Math.cos((Math.PI * (h - riseH)) / (peak - riseH));
  const since = h > peak ? h - peak : h + 24 - peak;
  return Math.cos((Math.PI * since) / (riseH + 24 - peak));
}

export interface WeatherTemplateOpts {
  season: Season;
  refElevM: number;
  lapseRateCPer100m: number;
  /** 日の出（その日の 0 時からの分） */
  sunriseMin: number;
  /** 強さ（雨・風・冷え込みの倍率）0.5〜1.5 */
  s: number;
  /** 雷雲セルの進路に使う、マップの一辺 m */
  mapSizeM: number;
  /** キーフレームの間隔（時間）。既定 2 */
  stepH?: number;
}

/** テンプレートから D0 00:00〜D3 00:00 のキーフレーム（と雷雲セル）を作る */
export function weatherFromTemplate(id: WeatherTemplateId, o: WeatherTemplateOpts): { keyframes: WeatherKeyframe[]; cells: ThunderCellDef[] } {
  const list = anchors(id);
  const st = SEASON_TEMP[o.season];
  const shift = -((o.refElevM - 1000) * o.lapseRateCPer100m) / 100;
  const mid = (st.low + st.high) / 2 + shift;
  const amp = (st.high - st.low) / 2;
  const riseH = o.sunriseMin / 60;
  const s = o.s;
  const step = o.stepH ?? 2;
  const hours = new Set<number>();
  for (let h = 0; h <= 72; h += step) hours.add(h);
  for (const [h] of list) hours.add(h);
  const keyframes = [...hours]
    .sort((a, b) => a - b)
    .map((h): WeatherKeyframe => {
      const c = condAt(list, h);
      const wind = (FAIR.wind + (c.wind - FAIR.wind) * s) * st.wind;
      const tempC = mid + amp * (1 - 0.55 * c.cover) * diurnal(h, riseH) + c.dT * s;
      const kf: WeatherKeyframe = {
        at: formatTimeRef(Math.round(h * 60)),
        tempC: r1(tempC),
        windMs: r1(Math.max(0, wind)),
        windDirDeg: Math.round(c.dir),
        precipMmH: r1(c.precip * s),
        cloudCover: Math.round(Math.min(1, c.cover) * 100) / 100,
        cloudBaseM: Math.round((o.refElevM + c.baseRel) / 10) * 10,
        visibilityM: Math.round(c.vis / 100) * 100,
        pressureHpa: Math.round(c.pressure),
      };
      if (c.inCloud > 0) kf.inCloudVisibilityM = Math.round(c.inCloud);
      if (c.thunder > 0.01) kf.thunder = Math.round(Math.min(1, c.thunder * s) * 100) / 100;
      if (c.gust > 0.01) kf.gustiness = Math.round(Math.min(1, c.gust * s) * 100) / 100;
      return kf;
    });
  const cells: ThunderCellDef[] = [];
  if (id === 'afternoonThunder') {
    const h = o.mapSizeM / 2;
    for (let d = 0; d < 3; d += 1) {
      const peak = d * 1440 + 15 * 60;
      // 南西から北東へ（日ごとに少しずらす）
      const off = (d - 1) * h * 0.3;
      cells.push({
        id: `cb${d + 1}`,
        from: formatTimeRef(peak - 80),
        peakAt: formatTimeRef(peak),
        to: formatTimeRef(peak + 80),
        path: [[-h * 0.9, h * 0.9 + off], [h * 0.9, -h * 0.9 + off]].map(([x, z]) => [Math.round(x!), Math.round(z!)] as [number, number]),
        radiusM: Math.round(1400 * s),
        peak: Math.min(1, s),
        heavyRainMmH: Math.round(25 * s),
        hail: s >= 1,
      });
    }
  }
  return { keyframes, cells };
}

function r1(v: number): number {
  return Math.round(v * 10) / 10;
}
