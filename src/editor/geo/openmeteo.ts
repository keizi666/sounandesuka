/**
 * 過去の天気の取り込み（docs/17 §5）: Open-Meteo Historical（ERA5 再解析）→ 1 時間ごとのキーフレーム → 間引き。
 * 下書き用。再解析は数十 km 規模の平均で、山の局地的な天気（稜線の強風・谷の霧・雷雨）は再現されない。
 */
import { formatTimeRef } from '../../sim/core/clock';
import type { WeatherKeyframe } from '../../sim/types';

export const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const HOURLY = 'temperature_2m,dew_point_2m,precipitation,snowfall,cloud_cover,cloud_cover_low,wind_speed_100m,wind_direction_100m,wind_gusts_10m,pressure_msl';

export interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  elevation?: number;
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    dew_point_2m: (number | null)[];
    precipitation: (number | null)[];
    snowfall?: (number | null)[];
    cloud_cover: (number | null)[];
    cloud_cover_low: (number | null)[];
    wind_speed_100m: (number | null)[];
    wind_direction_100m: (number | null)[];
    wind_gusts_10m: (number | null)[];
    pressure_msl: (number | null)[];
  };
}

export function openMeteoUrl(lat: number, lon: number, startDate: string, endDate: string): string {
  const q = new URLSearchParams({ latitude: lat.toFixed(4), longitude: lon.toFixed(4), start_date: startDate, end_date: endDate, hourly: HOURLY, wind_speed_unit: 'ms', timezone: 'Asia/Tokyo' });
  return `${OPEN_METEO_ARCHIVE}?${q.toString()}`;
}

export async function fetchOpenMeteo(lat: number, lon: number, startDate: string, endDate: string): Promise<OpenMeteoResponse> {
  const res = await fetch(openMeteoUrl(lat, lon, startDate, endDate));
  if (res.status === 429) throw new Error('Open-Meteo が混雑しています（429）。しばらくしてからやり直してください。');
  if (!res.ok) {
    let reason = '';
    try {
      reason = ((await res.json()) as { reason?: string }).reason ?? '';
    } catch {
      // 本文なし
    }
    throw new Error(`過去の天気を取得できませんでした（${res.status}${reason ? `: ${reason}` : ''}）。直近の数日はまだ取れないことがあります。`);
  }
  return (await res.json()) as OpenMeteoResponse;
}

export interface ConvertOptions {
  refElevM: number;
  lapseRateCPer100m: number;
  /** 格子の標高（応答にないとき作者が入れる） */
  gridElevM?: number;
  /** 風の補正倍率（既定 1） */
  windFactor?: number;
  /** 山岳の降水補正（既定 1.3） */
  precipFactor?: number;
  /** シナリオの開始日（D0） */
  startDate: string;
}

/** 応答 → 1 時間ごとのキーフレーム（docs/17 §5.2 の表） */
export function convertOpenMeteo(r: OpenMeteoResponse, o: ConvertOptions): WeatherKeyframe[] {
  const elev = r.elevation ?? o.gridElevM;
  if (elev === undefined || !Number.isFinite(elev)) throw new Error('格子の標高がありません。手で入力してください。');
  const h = r.hourly;
  const day0 = Date.parse(`${o.startDate}T00:00:00Z`);
  const out: WeatherKeyframe[] = [];
  for (let i = 0; i < h.time.length; i += 1) {
    const T = h.temperature_2m[i];
    const Td = h.dew_point_2m[i];
    if (T === null || T === undefined) continue;
    // time は Asia/Tokyo の現地時刻（"2025-10-12T13:00"）
    const tMin = (Date.parse(`${h.time[i]}:00Z`) - day0) / 60000;
    const wind = (h.wind_speed_100m[i] ?? 0) * (o.windFactor ?? 1);
    const gust = h.wind_gusts_10m[i] ?? 0;
    const wind10 = Math.max(1, (h.wind_speed_100m[i] ?? 0) * 0.75);
    const lcl = elev + 125 * (T - (Td ?? T - 5));
    const low = h.cloud_cover_low[i] ?? 0;
    const precip = (h.precipitation[i] ?? 0) * (o.precipFactor ?? 1.3);
    out.push({
      at: formatTimeRef(tMin),
      tempC: round1(T + (o.lapseRateCPer100m * (elev - o.refElevM)) / 100),
      windMs: round1(wind),
      windDirDeg: Math.round(h.wind_direction_100m[i] ?? 0),
      precipMmH: round1(precip),
      cloudCover: Math.round(h.cloud_cover[i] ?? 0) / 100,
      cloudBaseM: Math.round(low >= 50 ? lcl : Math.max(lcl, 3500)),
      visibilityM: Td !== null && Td !== undefined && T - Td < 1 ? 5000 : 20000,
      thunder: 0,
      pressureHpa: Math.round(h.pressure_msl[i] ?? 1013),
      gustiness: round2(Math.min(0.6, Math.max(0.1, (gust / wind10 - 1) / 2))),
    });
  }
  return out;
}

const THRESH = { tempC: 0.5, windMs: 1, precipMmH: 0.5, cloudBaseM: 100 } as const;

/** 前後から線形補間した値との差がすべて閾値未満のキーフレームを削る（両端は残す） */
export function thinKeyframes(kfs: WeatherKeyframe[], toMin: (at: string) => number): WeatherKeyframe[] {
  const out = [...kfs];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < out.length - 1; i += 1) {
      const a = out[i - 1]!;
      const b = out[i]!;
      const c = out[i + 1]!;
      const ta = toMin(a.at);
      const f = (toMin(b.at) - ta) / (toMin(c.at) - ta || 1);
      const ok = (Object.keys(THRESH) as (keyof typeof THRESH)[]).every((k) => Math.abs(a[k] + (c[k] - a[k]) * f - b[k]) < THRESH[k]);
      if (ok) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

export function sourceNote(date: string, lat: number, lon: number): string {
  return `気象の下書き: Open-Meteo（ERA5 再解析）${date} ${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
