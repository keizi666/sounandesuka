import { describe, expect, it } from 'vitest';
import { parseTimeRef } from '../src/sim/core/clock';
import { stepEnvironment } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import {
  activeCells,
  cellInfluenceAt,
  interpolateKeyframes,
  lerpAngleDeg,
  timeNoise,
} from '../src/sim/weather/global';
import { groundBin } from '../src/sim/weather/ground';
import { precipTypeOf, sampleLocal, upwindVector, visibilityOf, windChillC } from '../src/sim/weather/local';
import type { ScenarioDef, WeatherKeyframe, World } from '../src/sim/types';
import { sounanMap } from './helpers/map';
import { loadScenario } from './helpers/scenario';

const kf = (at: string, o: Partial<WeatherKeyframe> = {}): { t: number; kf: WeatherKeyframe } => ({
  t: parseTimeRef(at),
  kf: { at, tempC: 10, windMs: 5, windDirDeg: 0, precipMmH: 0, cloudCover: 0, cloudBaseM: 3000, visibilityM: 20000, ...o },
});

describe('キーフレームの補間（docs/05 §1.1）', () => {
  it('スカラーは線形、前後は端の値を保持', () => {
    const kfs = [kf('D0 06:00', { tempC: 10, precipMmH: 0 }), kf('D0 08:00', { tempC: 20, precipMmH: 4 })];
    expect(interpolateKeyframes(kfs, parseTimeRef('D0 07:00')).tempC).toBeCloseTo(15, 9);
    expect(interpolateKeyframes(kfs, parseTimeRef('D0 07:30')).precipMmH).toBeCloseTo(3, 9);
    expect(interpolateKeyframes(kfs, parseTimeRef('D0 05:00')).tempC).toBe(10);
    expect(interpolateKeyframes(kfs, parseTimeRef('D1 05:00')).tempC).toBe(20);
  });

  it('風向は最短の弧で補間する', () => {
    expect(lerpAngleDeg(350, 10, 0.5)).toBeCloseTo(0, 9);
    expect(lerpAngleDeg(10, 350, 0.5)).toBeCloseTo(0, 9);
    expect(lerpAngleDeg(300, 60, 0.25)).toBeCloseTo(330, 9);
    expect(lerpAngleDeg(90, 270, 0.5)).toBeCloseTo(180, 9);
    const kfs = [kf('D0 06:00', { windDirDeg: 340 }), kf('D0 08:00', { windDirDeg: 20 })];
    expect(interpolateKeyframes(kfs, parseTimeRef('D0 07:00')).windDirDeg).toBeCloseTo(0, 9);
  });

  it('省略したフィールドは既定値（雲中視程 60、雷 0、突風 0.25）', () => {
    const b = interpolateKeyframes([kf('D0 06:00')], 400);
    expect(b.inCloudVisibilityM).toBe(60);
    expect(b.thunder).toBe(0);
    expect(b.gustiness).toBe(0.25);
  });
});

describe('時間ノイズ（docs/05 §1.2）', () => {
  it('決定論的で、値域はおおよそ [-1, 1]、時間で滑らかに変わる', () => {
    for (let t = 0; t < 2000; t += 0.5) {
      const v = timeNoise(42, t);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(timeNoise(42, t)).toBe(v);
      expect(Math.abs(timeNoise(42, t + 1 / 6) - v)).toBeLessThan(0.3);
    }
    expect(timeNoise(42, 100)).not.toBe(timeNoise(43, 100));
  });

  it('突風係数は 1〜1 + 1.6 × gustiness', () => {
    const { map } = sounanMap();
    const sc = loadScenario('s01_cold_front');
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    for (let i = 0; i < 3000; i += 1) {
      stepEnvironment(w, ctx);
      expect(w.weather.gust).toBeGreaterThanOrEqual(1);
      expect(w.weather.gust).toBeLessThanOrEqual(1 + 1.6 * 0.45 + 1e-9);
    }
  });
});

/** s01 を指定時刻まで進める */
function runUntil(sc: ScenarioDef, until: string): { w: World; ctx: ReturnType<typeof createStaticContext> } {
  const { map } = sounanMap();
  const w = createWorld(map, sc);
  const ctx = createStaticContext(map, sc);
  const end = parseTimeRef(until);
  while (w.tMin < end - 1e-9) {
    stepEnvironment(w, ctx);
    ctx.events.length = 0;
  }
  return { w, ctx };
}

describe('局地補正（docs/05 §2、P3 の受け入れ）', () => {
  it('同時刻の SUMMIT と TH_SAWA の気温差 = 気温減率 × 標高差（±0.5℃）', () => {
    const { map } = sounanMap();
    const sc = loadScenario('s01_cold_front');
    const S = map.nodes['SUMMIT']!;
    const T = map.nodes['TH_SAWA']!;
    for (const at of ['D0 06:00', 'D0 10:00', 'D0 14:00', 'D0 20:00']) {
      const { w, ctx } = runUntil(sc, at);
      const d = sampleLocal(w, ctx, T.x, T.z, T.elevM).tempC - sampleLocal(w, ctx, S.x, S.z, S.elevM).tempC;
      expect(Math.abs(d - (0.65 * (S.elevM - T.elevM)) / 100), at).toBeLessThanOrEqual(0.5);
    }
  });

  it('SUMMIT の風速は J_FOREST（森林）の 2 倍以上', () => {
    const { map } = sounanMap();
    const S = map.nodes['SUMMIT']!;
    const J = map.nodes['J_FOREST']!;
    for (const id of ['s01_cold_front', 's02_fog_descent', 's03_thunder_ridge']) {
      const sc = loadScenario(id);
      const w = createWorld(map, sc);
      const ctx = createStaticContext(map, sc);
      for (let i = 0; i < 6 * 60 * 12; i += 1) {
        stepEnvironment(w, ctx);
        ctx.events.length = 0;
        if (i % 60 !== 0) continue;
        const ls = sampleLocal(w, ctx, S.x, S.z, S.elevM);
        const lj = sampleLocal(w, ctx, J.x, J.z, J.elevM);
        if (cellInfluenceAt(activeCells(sc, w.tMin), J.x, J.z).core > 0) continue; // 雷雲直下の突風は除く
        expect(ls.windMs, `${id} t=${w.tMin}`).toBeGreaterThanOrEqual(2 * lj.windMs);
      }
    }
  });

  it('s01: 15:00 以降、2,200 m 以上の降水はみぞれか雪', () => {
    const { map } = sounanMap();
    const sc = loadScenario('s01_cold_front');
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    const from = parseTimeRef('D0 15:00');
    const to = parseTimeRef('D1 12:00');
    const S = map.nodes['SUMMIT']!;
    let checked = 0;
    while (w.tMin < to) {
      stepEnvironment(w, ctx);
      ctx.events.length = 0;
      if (w.tMin < from || w.tick % 6 !== 0) continue;
      // 山頂と、主稜線の 2,200 m 付近（山頂と稜線小屋の間）
      for (const [x, z, e] of [
        [S.x, S.z, S.elevM],
        [480, -200, 2200],
      ] as const) {
        const l = sampleLocal(w, ctx, x, z, e);
        if (l.precipType === 'none') continue;
        checked += 1;
        expect(['sleet', 'snow'], `t=${w.tMin} ${l.tempC.toFixed(1)}℃`).toContain(l.precipType);
      }
      // 地面のビンでも同じ（2,200 m 以上）
      for (let b = groundBin(2200); b < 50; b += 1) {
        const tempC = w.weather.tempC - (0.65 * (b * 50 + 25 - 1000)) / 100;
        const type = precipTypeOf(tempC, w.weather.precipMmH, false);
        if (type !== 'none') expect(['sleet', 'snow']).toContain(type);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('s01: D1 03:00 に 2,300 m の積雪が 1 cm 以上', () => {
    const { w } = runUntil(loadScenario('s01_cold_front'), 'D1 03:00');
    expect(w.ground.snowCm[groundBin(2300)]!).toBeGreaterThanOrEqual(1);
    // 低い所（登山口付近）は高い所より積もらない
    expect(w.ground.snowCm[groundBin(1100)]!).toBeLessThan(w.ground.snowCm[groundBin(2300)]!);
    expect(w.ground.wet[groundBin(1100)]!).toBeGreaterThan(0.5);
  });

  it('雲の中では雲中視程、雲底より十分下では雲の外の視程', () => {
    const g = { cloudBaseM: 1800, cloudCover: 1, visibilityM: 10000, inCloudVisibilityM: 40 };
    expect(visibilityOf(g, 2000, 0, 'none')).toEqual({ visibilityM: 40, inCloud: true });
    expect(visibilityOf(g, 1500, 0, 'none')).toEqual({ visibilityM: 10000, inCloud: false });
    expect(visibilityOf(g, 1750, 0, 'none').visibilityM).toBeCloseTo(5020, 6);
    expect(visibilityOf({ ...g, cloudCover: 0.4 }, 2000, 0, 'none').inCloud).toBe(false);
    expect(visibilityOf(g, 1500, 4, 'rain').visibilityM).toBeCloseTo(20000 / 7, 6);
    expect(visibilityOf(g, 1500, 2, 'snow').visibilityM).toBeCloseTo(8000 / 9, 6);
  });

  it('降水の種別と体感温度', () => {
    expect(precipTypeOf(0.4, 2, false)).toBe('snow');
    expect(precipTypeOf(1.5, 2, false)).toBe('sleet');
    expect(precipTypeOf(5, 2, false)).toBe('rain');
    expect(precipTypeOf(5, 2, true)).toBe('hail');
    expect(precipTypeOf(5, 0.01, false)).toBe('none');
    expect(windChillC(0, 10)).toBeCloseTo(-7.05, 1);
    // 10℃より暖かくても風で下がる（10℃でつながり、暖かいほど下がり幅は小さい）
    expect(windChillC(15, 10)).toBeLessThan(15);
    expect(windChillC(15, 10)).toBeGreaterThan(windChillC(10, 10));
    expect(windChillC(10.001, 10)).toBeCloseTo(windChillC(10, 10), 1);
    expect(windChillC(12, 15)).toBeLessThan(9);
    expect(windChillC(35, 10)).toBe(35);
    expect(windChillC(0, 1)).toBe(0);
  });

  it('風上の向き: 北風（0°）なら風上は北（−z）', () => {
    const v = upwindVector(0);
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.z).toBeCloseTo(-1, 9);
    expect(upwindVector(90).x).toBeCloseTo(1, 9);
  });
});

describe('雷雲セル（docs/05 §1.3）', () => {
  it('s03 の cb1: from で 0、peakAt で中心が最大、経路上を等速で動く', () => {
    const sc = loadScenario('s03_thunder_ridge');
    expect(activeCells(sc, parseTimeRef('D0 09:30'))).toHaveLength(0);
    const atFrom = activeCells(sc, parseTimeRef(sc.weather.thunderCells![0]!.from))[0]!;
    expect(atFrom.env).toBe(0);
    expect([atFrom.x, atFrom.z]).toEqual([2200, -1500]);
    const peak = activeCells(sc, parseTimeRef('D0 11:40'))[0]!;
    expect(peak.env).toBeCloseTo(1, 9);
    const inf = cellInfluenceAt([peak], peak.x, peak.z);
    expect(inf.thunder).toBeCloseTo(1, 9);
    expect(inf.heavyRainMmH).toBeCloseTo(25, 9);
    expect(inf.hail).toBe(true);
    const atTo = activeCells(sc, parseTimeRef(sc.weather.thunderCells![0]!.to))[0]!;
    expect(atTo.x).toBeCloseTo(-1800, 6);
    expect(atTo.z).toBeCloseTo(900, 6);
    // 離れると弱まる
    expect(cellInfluenceAt([peak], peak.x + 3000, peak.z).thunder).toBeLessThan(0.2);
  });

  it('山頂の雷の強さが雷雲の通過時に 0.6 を超え、局地降水はひょうになる時間がある', () => {
    const { map } = sounanMap();
    const sc = loadScenario('s03_thunder_ridge');
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    const S = map.nodes['SUMMIT']!;
    let maxThunder = 0;
    let hail = false;
    while (w.tMin < parseTimeRef('D0 15:30')) {
      stepEnvironment(w, ctx);
      ctx.events.length = 0;
      const l = sampleLocal(w, ctx, S.x, S.z, S.elevM);
      maxThunder = Math.max(maxThunder, l.thunder);
      if (l.precipType === 'hail') hail = true;
    }
    expect(maxThunder).toBeGreaterThan(0.6);
    expect(hail).toBe(true);
  });
});

describe('決定論', () => {
  it('同じシードなら気象・地面が一致する', () => {
    const { map } = sounanMap();
    const sc = loadScenario('s03_thunder_ridge');
    const run = (): string => {
      const w = createWorld(map, sc);
      const ctx = createStaticContext(map, sc);
      for (let i = 0; i < 3000; i += 1) stepEnvironment(w, ctx);
      return JSON.stringify([w.weather, w.ground]);
    };
    expect(run()).toBe(run());
    const other = createWorld(map, sc, 999);
    expect(other.weather.noiseSeed).not.toBe(createWorld(map, sc).weather.noiseSeed);
  });
});
