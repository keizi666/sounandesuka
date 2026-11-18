import { describe, expect, it } from 'vitest';
import { parseTimeRef } from '../src/sim/core/clock';
import type { WeatherDef, WeatherPresetId } from '../src/sim/types';
import { interpolateKeyframes } from '../src/sim/weather/global';
import { applyPreset, PRESET_LABELS } from '../src/editor/weather/presets';

const fine: WeatherDef = {
  refElevM: 1000,
  lapseRateCPer100m: 0.65,
  cloudThicknessM: 1500,
  keyframes: [
    { at: 'D0 05:00', tempC: 10, windMs: 3, windDirDeg: 230, precipMmH: 0, cloudCover: 0.2, cloudBaseM: 3000, visibilityM: 25000 },
    { at: 'D1 12:00', tempC: 10, windMs: 3, windDirDeg: 230, precipMmH: 0, cloudCover: 0.2, cloudBaseM: 3000, visibilityM: 25000 },
  ],
};
const at = (kfs: WeatherDef['keyframes'], ref: string) => interpolateKeyframes(kfs.map((kf) => ({ t: parseTimeRef(kf.at), kf })), parseTimeRef(ref));

describe('天気パターン（docs/17 §4）', () => {
  it('寒冷前線 s=1: 通過時に西寄りの風 9 m/s・降水 8 mm/h、6 時間後に 6℃ 下がる', () => {
    const r = applyPreset(fine, 'coldFront', { t0Min: parseTimeRef('D0 13:00'), s: 1 });
    const k = r.keyframes;
    const t0 = at(k, 'D0 13:00');
    expect(t0.windMs).toBe(9);
    expect(t0.windDirDeg).toBe(260);
    expect(t0.precipMmH).toBe(8);
    expect(t0.cloudBaseM).toBe(1700);
    expect(at(k, 'D0 19:00').tempC).toBe(4);
    // 前後の既存キーフレームは残る
    expect(k[0]!.at).toBe('D0 05:00');
    expect(k[k.length - 1]!.at).toBe('D1 12:00');
    // 3 時間前は風 ×1.2
    expect(at(k, 'D0 10:00').windMs).toBeCloseTo(3.6, 5);
  });
  it('強さ s で振れ幅が変わる', () => {
    const a = applyPreset(fine, 'coldFront', { t0Min: parseTimeRef('D0 13:00'), s: 0.5 });
    const b = applyPreset(fine, 'coldFront', { t0Min: parseTimeRef('D0 13:00'), s: 1.5 });
    expect(at(a.keyframes, 'D0 13:00').precipMmH).toBeLessThan(at(b.keyframes, 'D0 13:00').precipMmH);
  });
  it('夏の雷雨は雷雲セルを 1 つ足す', () => {
    const r = applyPreset(fine, 'summerThunderstorm', { t0Min: parseTimeRef('D0 13:00'), s: 1, path: [[0, 0], [1000, -1000]] });
    expect(r.cells).toHaveLength(1);
    expect(r.cells[0]).toMatchObject({ from: 'D0 11:50', peakAt: 'D0 13:00', to: 'D0 14:20', radiusM: 1400, peak: 1, heavyRainMmH: 25, hail: true });
    expect(at(r.keyframes, 'D0 13:00').thunder).toBeCloseTo(0.3, 5);
  });
  it('9 種すべてが時刻順のキーフレームを作り、値が範囲内', () => {
    for (const id of Object.keys(PRESET_LABELS) as WeatherPresetId[]) {
      const r = applyPreset(fine, id, { t0Min: parseTimeRef('D0 14:00'), s: 1, side: 'sea', hours: 6, baseM: 1500, sunriseMin: 350, sunsetMin: 1030 });
      const ts = r.keyframes.map((k) => parseTimeRef(k.at));
      for (let i = 1; i < ts.length; i += 1) expect(ts[i]!).toBeGreaterThanOrEqual(ts[i - 1]!);
      for (const k of r.keyframes) {
        expect(k.cloudCover).toBeGreaterThanOrEqual(0);
        expect(k.cloudCover).toBeLessThanOrEqual(1);
        expect(k.precipMmH).toBeGreaterThanOrEqual(0);
        expect(k.windMs).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
