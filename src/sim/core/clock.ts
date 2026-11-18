/**
 * 時刻（docs/09 §1 TimeRef、docs/05 §4 太陽）。
 * tMin はシナリオ開始日（D0）0:00 からの経過分。表示用の日本語整形は UI 側で行う。
 */
import { TUNING, type Tuning } from '../tuning';
import type { ScenarioDef, TimeRef } from '../types';
import { dsin, PI } from './dmath';

export const MIN_PER_DAY = 1440;
export const TIME_REF_RE = /^D(\d) ([01]\d|2[0-3]):([0-5]\d)$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "D0 05:30" → 330。書式が違えば null */
export function tryParseTimeRef(ref: string): number | null {
  const m = TIME_REF_RE.exec(ref);
  if (!m) return null;
  return Number(m[1]) * MIN_PER_DAY + Number(m[2]) * 60 + Number(m[3]);
}

/** "D0 05:30" → 330。書式が違えば例外 */
export function parseTimeRef(ref: TimeRef): number {
  const t = tryParseTimeRef(ref);
  if (t === null) throw new Error(`TimeRef の書式が不正です: "${ref}"（例: "D0 05:30"）`);
  return t;
}

/** "05:52" → 352。書式が違えば例外 */
export function parseHHMM(hhmm: string): number {
  const m = HHMM_RE.exec(hhmm);
  if (!m) throw new Error(`時刻の書式が不正です: "${hhmm}"（例: "05:52"）`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** その日の 0:00 からの分（0 ≤ 値 < 1440） */
export function clockMinOf(tMin: number): number {
  return ((tMin % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
}

/** 経過日（D の数） */
export function dayOf(tMin: number): number {
  return Math.floor(tMin / MIN_PER_DAY);
}

const pad2 = (v: number): string => (v < 10 ? `0${v}` : String(v));

/** 330.7 → "05:30"（分は切り捨て） */
export function formatClock(tMin: number): string {
  const c = Math.floor(clockMinOf(tMin));
  return `${pad2(Math.floor(c / 60))}:${pad2(c % 60)}`;
}

/** 330 → "D0 05:30" */
export function formatTimeRef(tMin: number): TimeRef {
  return `D${dayOf(tMin)} ${formatClock(tMin)}`;
}

// ---------- 日付（Date を使わない純粋な暦計算。Howard Hinnant の days_from_civil） ----------

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

function daysFromCivil(y0: number, m: number, d: number): number {
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z0: number): CivilDate {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** "2026-10-17" を解析する */
export function parseDate(date: string): CivilDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`日付の書式が不正です: "${date}"（例: "2026-10-17"）`);
  const r = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const back = civilFromDays(daysFromCivil(r.year, r.month, r.day));
  if (back.month !== r.month || back.day !== r.day) throw new Error(`存在しない日付です: "${date}"`);
  return r;
}

/** startDate から tMin の時点の日付 */
export function dateAt(startDate: string, tMin: number): CivilDate {
  const s = parseDate(startDate);
  return civilFromDays(daysFromCivil(s.year, s.month, s.day) + dayOf(tMin));
}

// ---------- 太陽高度（docs/05 §4） ----------

export interface SunParams {
  sunriseMin: number;
  sunsetMin: number;
  maxElevDeg: number;
  /** 真夜中の伏角（正の値） */
  nightDepthDeg: number;
}

export function sunParamsOf(
  sun: ScenarioDef['sun'],
  season: ScenarioDef['season'],
  tuning: Tuning = TUNING,
): SunParams {
  const sunriseMin = parseHHMM(sun.sunrise);
  const sunsetMin = parseHHMM(sun.sunset);
  if (sunsetMin <= sunriseMin) throw new Error(`日の入り（${sun.sunset}）が日の出（${sun.sunrise}）より前です`);
  const maxElevDeg = sun.maxElevDeg ?? tuning.sun.maxElevDegBySeason[season];
  const nightDepthDeg = Math.max(tuning.sun.minNightDepthDeg, tuning.sun.noonPlusMidnightDepthDeg - maxElevDeg);
  return { sunriseMin, sunsetMin, maxElevDeg, nightDepthDeg };
}

/** 太陽高度（度）。日中は日の出→南中→日の入りを半正弦、夜は負の半正弦 */
export function solarElevationDeg(tMin: number, p: SunParams): number {
  const c = clockMinOf(tMin);
  const dayLen = p.sunsetMin - p.sunriseMin;
  if (c >= p.sunriseMin && c <= p.sunsetMin) {
    return p.maxElevDeg * dsin((PI * (c - p.sunriseMin)) / dayLen);
  }
  const nightLen = MIN_PER_DAY - dayLen;
  const since = c > p.sunsetMin ? c - p.sunsetMin : c + MIN_PER_DAY - p.sunsetMin;
  return -p.nightDepthDeg * dsin((PI * since) / nightLen);
}

/** tMin より後の最初の日の出の tMin */
export function nextSunriseTMin(tMin: number, p: SunParams): number {
  const candidate = dayOf(tMin) * MIN_PER_DAY + p.sunriseMin;
  return candidate > tMin ? candidate : candidate + MIN_PER_DAY;
}
