import { describe, expect, it } from 'vitest';
import { parseTimeRef } from '../src/sim/core/clock';
import { convertOpenMeteo, openMeteoUrl, thinKeyframes, type OpenMeteoResponse } from '../src/editor/geo/openmeteo';

function response(hours: number, f: (h: number) => Partial<Record<keyof OpenMeteoResponse['hourly'], number>>): OpenMeteoResponse {
  const hourly: OpenMeteoResponse['hourly'] = { time: [], temperature_2m: [], dew_point_2m: [], precipitation: [], cloud_cover: [], cloud_cover_low: [], wind_speed_100m: [], wind_direction_100m: [], wind_gusts_10m: [], pressure_msl: [] };
  for (let h = 0; h < hours; h += 1) {
    const v = f(h);
    const d = Math.floor(h / 24);
    hourly.time.push(`2025-10-${String(12 + d).padStart(2, '0')}T${String(h % 24).padStart(2, '0')}:00`);
    hourly.temperature_2m.push(v.temperature_2m ?? 10);
    hourly.dew_point_2m.push(v.dew_point_2m ?? 5);
    hourly.precipitation.push(v.precipitation ?? 0);
    hourly.cloud_cover.push(v.cloud_cover ?? 20);
    hourly.cloud_cover_low.push(v.cloud_cover_low ?? 0);
    hourly.wind_speed_100m.push(v.wind_speed_100m ?? 4);
    hourly.wind_direction_100m.push(v.wind_direction_100m ?? 270);
    hourly.wind_gusts_10m.push(v.wind_gusts_10m ?? 6);
    hourly.pressure_msl.push(v.pressure_msl ?? 1015);
  }
  return { latitude: 36.4, longitude: 137.7, elevation: 1600, hourly };
}

describe('Open-Meteo の取り込み（docs/17 §5）', () => {
  it('URL は archive API で 1 時間ごと・m/s・日本時間', () => {
    const u = openMeteoUrl(36.4, 137.71, '2025-10-12', '2025-10-13');
    expect(u).toMatch(/^https:\/\/archive-api\.open-meteo\.com\/v1\/archive\?/);
    expect(u).toContain('wind_speed_unit=ms');
    expect(u).toContain('timezone=Asia%2FTokyo');
  });
  it('基準標高へ換算し、雲底は持ち上げ凝結高度の近似', () => {
    const k = convertOpenMeteo(response(3, (h) => ({ temperature_2m: 5, dew_point_2m: 3, cloud_cover_low: h === 0 ? 80 : 0, precipitation: 2 })), { refElevM: 1000, lapseRateCPer100m: 0.65, startDate: '2025-10-12' });
    expect(k).toHaveLength(3);
    expect(k[0]!.at).toBe('D0 00:00');
    // 格子 1,600 m の 5℃ → 基準 1,000 m では 5 + 0.65×6 = 8.9℃
    expect(k[0]!.tempC).toBeCloseTo(8.9, 5);
    expect(k[0]!.cloudBaseM).toBe(1850);
    expect(k[1]!.cloudBaseM).toBe(3500);
    expect(k[0]!.precipMmH).toBeCloseTo(2.6, 5);
    expect(k[0]!.thunder).toBe(0);
  });
  it('格子の標高がないときはエラー（作者に入力を求める）、入力すれば換算できる', () => {
    const r = response(1, () => ({}));
    delete r.elevation;
    expect(() => convertOpenMeteo(r, { refElevM: 1000, lapseRateCPer100m: 0.65, startDate: '2025-10-12' })).toThrow();
    expect(convertOpenMeteo(r, { refElevM: 1000, lapseRateCPer100m: 0.65, startDate: '2025-10-12', gridElevM: 1000 })[0]!.tempC).toBe(10);
  });
  it('一定の天気は両端だけに間引かれ、変化のある時間帯は残る', () => {
    const flat = convertOpenMeteo(response(24, () => ({})), { refElevM: 1000, lapseRateCPer100m: 0.65, startDate: '2025-10-12' });
    expect(thinKeyframes(flat, parseTimeRef)).toHaveLength(2);
    const front = convertOpenMeteo(response(48, (h) => ({ temperature_2m: h < 20 ? 12 : 4, precipitation: h >= 18 && h < 24 ? 6 : 0, wind_speed_100m: h < 20 ? 4 : 12 })), { refElevM: 1000, lapseRateCPer100m: 0.65, startDate: '2025-10-12' });
    const thin = thinKeyframes(front, parseTimeRef);
    expect(thin.length).toBeGreaterThan(3);
    expect(thin.length).toBeLessThan(front.length);
    expect(thin.some((k) => k.at === 'D0 18:00')).toBe(true);
    expect(front[30]!.at).toBe('D1 06:00');
  });
});
