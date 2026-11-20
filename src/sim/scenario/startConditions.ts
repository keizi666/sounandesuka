/**
 * 始まりの条件を変えて試す（ユーザーの指定）: 天気・気温・季節・登場人物の体調・モバイルバッテリー・水の量。
 * シナリオの写しを書き換える純粋な関数（元のシナリオは変えない）。変えた条件は保存して、再開のときにも同じように当てる。
 * 文章（ブリーフィング・分岐点・結末）はシナリオのままなので、天気や季節を変えると文と合わない所が出ることがある（画面に注記を出す）。
 */
import type { ClimberDef, ForecastEntry, ScenarioDef, WeatherKeyframe } from '../types';

export type WeatherOverride = 'asIs' | 'clear' | 'rain' | 'fog' | 'snow' | 'storm';
export type SeasonOverride = 'asIs' | 'spring' | 'summer' | 'autumn' | 'winter';
export type Health = 'good' | 'sleepy' | 'tired' | 'cold' | 'hangover';

export interface StartConditions {
  weather: WeatherOverride;
  /** 気温のずれ（℃）。全部のキーフレームに足す */
  tempOffsetC: number;
  season: SeasonOverride;
  /** 登場人物ごとの体調（書いていない人は万全） */
  health: Record<string, Health>;
  /** スマホを持つ人のモバイルバッテリーの容量（mAh。0 は持たない）。省略は既定（5000） */
  powerBankMah?: number;
  /** 1 人あたりの水の増減（L）。省略は 0（シナリオのまま） */
  waterDeltaL?: number;
}

/** 選べるモバイルバッテリーの容量（mAh。0 は持たない）と、既定 */
export const POWER_BANK_CHOICES = [0, 5000, 10000, 20000] as const;
export const DEFAULT_POWER_BANK_MAH = 5000;
/** 選べる水の増減（L / 人） */
export const WATER_DELTA_CHOICES = [-1, -0.5, 0, 0.5, 1, 1.5] as const;
/** 水を減らしても残す最小（L） */
const WATER_MIN_L = 0.2;

export const DEFAULT_CONDITIONS: StartConditions = { weather: 'asIs', tempOffsetC: 0, season: 'asIs', health: {} };

/** 何も変えていないか */
export function isDefaultConditions(c: StartConditions | undefined): boolean {
  return !c || (c.weather === 'asIs' && c.tempOffsetC === 0 && c.season === 'asIs' && Object.values(c.health).every((h) => h === 'good') && (c.powerBankMah ?? DEFAULT_POWER_BANK_MAH) === DEFAULT_POWER_BANK_MAH && (c.waterDeltaL ?? 0) === 0);
}

/** 月ごとの平年の気温（東京の平年値を山の季節感の目安に使う。差だけを使う）と、北緯 36 度付近の日の出・日の入り（15 日ごろ） */
const MONTH_TEMP_C = [5.4, 6.1, 9.4, 14.3, 18.8, 21.9, 25.7, 26.9, 23.3, 18.0, 12.5, 7.7];
const MONTH_SUN: [string, string, number][] = [
  ['06:50', '16:50', 33], ['06:30', '17:20', 41], ['05:55', '17:45', 52], ['05:15', '18:10', 63], ['04:40', '18:35', 72], ['04:25', '18:58', 77],
  ['04:40', '18:55', 75], ['05:05', '18:25', 68], ['05:30', '17:45', 57], ['05:55', '17:05', 46], ['06:20', '16:35', 37], ['06:45', '16:30', 31],
];
const SEASON_MONTH: Record<Exclude<SeasonOverride, 'asIs'>, number> = { spring: 5, summer: 7, autumn: 10, winter: 1 };

/** 体調ごとの始まりの体の状態（疲労・糖・水分不足・体温）。判断力と運動能力への影響は tuning（capacity.healthJ / healthM） */
const HEALTH_INITIAL: Record<Health, NonNullable<ClimberDef['initial']>> = {
  good: {},
  sleepy: { fatigue: 12 },
  tired: { fatigue: 30, glycogenKcal: 1150 },
  cold: { fatigue: 15, waterDeficitL: 0.4, coreC: 37.6 },
  // 二日酔い（ユーザーの指定）: 疲れが残り、体の水分が最初から少なく、食べられていないのでエネルギーも少ない。吐き気は behavior（食べる量）
  hangover: { fatigue: 25, waterDeficitL: 1.0, glycogenKcal: 1200 },
};

const FORECAST_TEXT: Record<Exclude<WeatherOverride, 'asIs'>, ForecastEntry> = {
  clear: { label: '今日', text: '晴れ。風は弱い', icon: 'sunny' },
  rain: { label: '今日', text: '雨。昼前から本降り', icon: 'rainy' },
  fog: { label: '今日', text: 'くもり。山は濃い霧', icon: 'foggy' },
  snow: { label: '今日', text: '雪。山は吹雪くおそれ', icon: 'weather_snowy' },
  storm: { label: '今日', text: '荒れた天気。強い風と雨、雷のおそれ', icon: 'thunderstorm' },
};

function weatherFrame(k: WeatherKeyframe, w: Exclude<WeatherOverride, 'asIs'>, refElevM: number): WeatherKeyframe {
  switch (w) {
    case 'clear':
      return { ...k, precipMmH: 0, cloudCover: Math.min(k.cloudCover, 0.15), cloudBaseM: Math.max(k.cloudBaseM, refElevM + 2000), visibilityM: 40000, windMs: k.windMs * 0.7, thunder: 0 };
    case 'rain':
      return { ...k, precipMmH: Math.max(k.precipMmH, 5), cloudCover: 0.95, cloudBaseM: Math.min(k.cloudBaseM, refElevM + 300), visibilityM: Math.min(k.visibilityM, 4000), windMs: Math.max(k.windMs, 5) };
    case 'fog':
      return { ...k, precipMmH: Math.max(k.precipMmH, 0.3), cloudCover: 1, cloudBaseM: Math.min(k.cloudBaseM, refElevM - 300), visibilityM: Math.min(k.visibilityM, 2000), inCloudVisibilityM: 60 };
    case 'snow':
      return { ...k, precipMmH: Math.max(k.precipMmH, 2), cloudCover: 1, cloudBaseM: Math.min(k.cloudBaseM, refElevM - 100), visibilityM: Math.min(k.visibilityM, 800), inCloudVisibilityM: 80, windMs: Math.max(k.windMs, 7) };
    case 'storm':
      return { ...k, precipMmH: Math.max(k.precipMmH, 9), cloudCover: 1, cloudBaseM: Math.min(k.cloudBaseM, refElevM), visibilityM: Math.min(k.visibilityM, 300), inCloudVisibilityM: 40, windMs: Math.max(k.windMs * 2, 16), thunder: Math.max(k.thunder ?? 0, 0.5), pressureHpa: Math.min(k.pressureHpa ?? 1000, 992) };
  }
}

/** 条件を当てたシナリオの写し */
export function applyConditions(s0: ScenarioDef, c: StartConditions | undefined): ScenarioDef {
  if (!c || isDefaultConditions(c)) return s0;
  const s = JSON.parse(JSON.stringify(s0)) as ScenarioDef;
  let dT = c.tempOffsetC;
  // 季節: 日付の月を代表の月にし、日の出・日の入りと気温（平年の差）を合わせる
  if (c.season !== 'asIs') {
    const m0 = Number(s.startDate.slice(5, 7));
    const m1 = SEASON_MONTH[c.season];
    if (m1 !== m0) {
      const day = Math.min(28, Number(s.startDate.slice(8, 10)) || 15);
      s.startDate = `${s.startDate.slice(0, 4)}-${String(m1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const [sr, ss, el] = MONTH_SUN[m1 - 1]!;
      s.sun = { sunrise: sr, sunset: ss, maxElevDeg: el };
      dT += MONTH_TEMP_C[m1 - 1]! - MONTH_TEMP_C[m0 - 1]!;
    }
    s.season = c.season;
  }
  const w = c.weather;
  // 雪は気温を氷点下に寄せる（基準の高さで -2℃ 以下）
  s.weather.keyframes = s.weather.keyframes.map((k0) => {
    let k: WeatherKeyframe = { ...k0, tempC: Math.round((k0.tempC + dT) * 10) / 10 };
    if (w !== 'asIs') k = weatherFrame(k, w, s.weather.refElevM);
    if (w === 'snow') k.tempC = Math.min(k.tempC, -2);
    return k;
  });
  if (w === 'clear' || w === 'snow') s.weather.thunderCells = [];
  if (w !== 'asIs') s.briefing = { ...s.briefing, forecast: [FORECAST_TEXT[w]] };
  // 体調
  s.party = s.party.map((p) => {
    const h = c.health[p.id] ?? 'good';
    if (h === 'good') return p;
    return { ...p, health: h, initial: { ...(p.initial ?? {}), ...HEALTH_INITIAL[h] } };
  });
  // モバイルバッテリー（スマホを持つ人）と水の量
  const bank = c.powerBankMah ?? DEFAULT_POWER_BANK_MAH;
  const dW = c.waterDeltaL ?? 0;
  if (bank !== DEFAULT_POWER_BANK_MAH || dW !== 0) {
    s.party = s.party.map((p) => ({
      ...p,
      gear: {
        ...p.gear,
        ...(bank !== DEFAULT_POWER_BANK_MAH && p.gear.phone.has ? { powerBankMah: bank } : {}),
        ...(dW !== 0 ? { waterL: Math.max(WATER_MIN_L, Math.round((p.gear.waterL + dW) * 10) / 10) } : {}),
      },
    }));
  }
  return s;
}
