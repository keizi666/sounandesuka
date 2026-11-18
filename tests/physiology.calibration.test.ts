/**
 * 生理の較正目標 C1〜C9（docs/06 §9）。標準体: 65 kg・fitness 1.0・experience 0.5・40 歳、
 * 開始 core 37.0・glycogen 1500。地形は平坦、局地気象は固定値を直接与える。
 * C10〜C13 は P19（年齢・浸水などを含む史実シナリオ用）で検証する。
 */
import { describe, expect, it } from 'vitest';
import { hoursUntilAbove, hoursUntilBelow, runCalib, WALK_3KMH } from './helpers/calib';
import { applySoak } from '../src/sim/climber/physiology';

const C2_ENV = { tairC: 5, windMs: 10, precipMmH: 4, precipType: 'rain' as const, groundTempC: 4 };
const minCore = (s: { coreC: number }[]): number => Math.min(...s.map((x) => x.coreC));

describe('生理の較正（docs/06 §9）', () => {
  it('C1: 15℃・風 2・乾燥・clo 0.8・3 km/h で 10% の登りを 8 時間 → core が常に 36.6〜37.8', () => {
    const { samples } = runCalib({
      hours: 8,
      env: { tairC: 15, windMs: 2 },
      gear: { cloWorn: 0.8 },
      walk: { speedMs: WALK_3KMH, grade: 0.1 },
      feed: true,
    });
    for (const s of samples) {
      expect(s.coreC, `${s.h.toFixed(2)}h`).toBeGreaterThanOrEqual(36.6);
      expect(s.coreC, `${s.h.toFixed(2)}h`).toBeLessThanOrEqual(37.8);
    }
  });

  it('C2: 5℃・風 10・雨 4 mm/h・雨具なし・clo 1.0・平地 3 km/h → 35℃ 未満まで 2.0〜4.5 時間', () => {
    const { samples } = runCalib({ hours: 8, env: C2_ENV, gear: { cloWorn: 1.0 }, walk: { speedMs: WALK_3KMH, grade: 0 }, feed: true });
    const h = hoursUntilBelow(samples, 35);
    expect(h).toBeGreaterThanOrEqual(2.0);
    expect(h).toBeLessThanOrEqual(4.5);
  });

  it('C3: C2 と同じ条件で goretex 着用 → 6 時間 core ≥ 36.0', () => {
    const { samples } = runCalib({
      hours: 6,
      env: C2_ENV,
      gear: { cloWorn: 1.0, rainwear: 'goretex' },
      body: { rainwearOn: true },
      walk: { speedMs: WALK_3KMH, grade: 0 },
      feed: true,
    });
    expect(minCore(samples)).toBeGreaterThanOrEqual(36.0);
  });

  it('C4: C2 の条件で休憩（MET 1.4）、開始時 wetness 1.0 → 35℃ 未満が 0.75〜2.0 時間、32℃ 未満が 2.5〜5.0 時間', () => {
    const { samples } = runCalib({ hours: 8, env: C2_ENV, gear: { cloWorn: 1.0 }, body: { wetness: 1 }, state: 'RESTING', metAct: 1.4, feed: true });
    const h35 = hoursUntilBelow(samples, 35);
    const h32 = hoursUntilBelow(samples, 32);
    expect(h35).toBeGreaterThanOrEqual(0.75);
    expect(h35).toBeLessThanOrEqual(2.0);
    expect(h32).toBeGreaterThanOrEqual(2.5);
    expect(h32).toBeLessThanOrEqual(5.0);
  });

  it('C5: −2℃・風 15・雪 2・goretex・clo 2.0・シュラフカバー・風下 0.7・ビバーク → 10 時間 core ≥ 34.5', () => {
    // 熱環境は docs/06 §3.1: カバー内は気温 +3、風は 風下 (1 − 0.7) × カバー 0.08、降水の濡れ 0、clo +0.6
    const { samples } = runCalib({
      hours: 10,
      env: { tairC: -2 + 3, windMs: 15 * (1 - 0.7) * 0.08, extraClo: 0.6, wetInputF: 0, condensePerH: 0.01, groundContact: true, groundTempC: 0 },
      gear: { cloWorn: 2.0, rainwear: 'goretex', bivy: 'sack' },
      body: { rainwearOn: true, glycogenKcal: 750, gutKcal: 800, inBivy: true, groundInsulation: true, leeShelter: 0.7 },
      state: 'BIVOUAC',
      metAct: 1.1,
    });
    expect(minCore(samples)).toBeGreaterThanOrEqual(34.5);
  });

  it('C6: C5 からカバーと風下を除き clo 1.2、wetness 0.2、雪の上にマットなしで座る → 35℃ 未満 1.5〜4 時間、34℃ 未満 3〜7 時間', () => {
    const { samples } = runCalib({
      hours: 10,
      env: { tairC: -2, windMs: 15, precipMmH: 2, precipType: 'snow', groundContact: true, groundTempC: 0 },
      gear: { cloWorn: 1.2, rainwear: 'goretex' },
      body: { rainwearOn: true, glycogenKcal: 750, gutKcal: 800, wetness: 0.2 },
      state: 'BIVOUAC',
      metAct: 1.1,
    });
    const h35 = hoursUntilBelow(samples, 35);
    const h34 = hoursUntilBelow(samples, 34);
    expect(h35).toBeGreaterThanOrEqual(1.5);
    expect(h35).toBeLessThanOrEqual(4);
    expect(h34).toBeGreaterThanOrEqual(3);
    expect(h34).toBeLessThanOrEqual(7);
  });

  it('C7: core 34.0 から営業小屋 → 3 時間以内に core ≥ 36.0', () => {
    const { samples } = runCalib({
      hours: 4,
      env: { tairC: 18, windMs: 0, staffed: true, forcedDryPerH: 0.6, wetInputF: 0 },
      body: { coreC: 34 },
      state: 'SHELTERED',
      metAct: 1.2,
    });
    expect(hoursUntilAbove(samples, 36)).toBeLessThanOrEqual(3);
  });

  it('C8: 30℃・風 1・日射 100 W・clo 0.4・15% を 3 km/h・水なし → 3 時間で core ≥ 38.8、4 時間以内に熱疲労', () => {
    const { samples } = runCalib({
      hours: 4,
      env: { tairC: 30, windMs: 1, solarW: 100 },
      gear: { cloWorn: 0.4, waterL: 0 },
      walk: { speedMs: WALK_3KMH, grade: 0.15 },
    });
    const at3 = samples.find((s) => s.h >= 3)!;
    expect(at3.coreC).toBeGreaterThanOrEqual(38.8);
    expect(hoursUntilAbove(samples, 39.0)).toBeLessThanOrEqual(4);
  });

  it('C9: 5℃・風 12・乾燥・clo 0.9・雨具なしで 2 時間急登（MET 8）→ 稜線で 30 分休憩: 汗で濡れ、休憩で 0.3℃ 以上下がる', () => {
    const { samples } = runCalib({
      hours: 2.5,
      env: { tairC: 5, windMs: 12 },
      gear: { cloWorn: 0.9 },
      phases: [
        { untilH: 2, metAct: 8, state: 'WALKING' },
        { untilH: 2.5, metAct: 1.4, state: 'RESTING' },
      ],
    });
    const start = samples.find((s) => s.h >= 2)!;
    const end = samples[samples.length - 1]!;
    expect(start.wetness).toBeGreaterThanOrEqual(0.3);
    expect(start.coreC - end.coreC).toBeGreaterThanOrEqual(0.3);
  });
});

describe('較正 C10〜C13（トムラウシ型、docs/06 §9）', () => {
  /** 5 時間の低速歩行 → 足首の浸水 → 1 時間立って待機。35℃ 未満になった時刻（歩き始めから） */
  function tomuraushi(def: Partial<Parameters<typeof runCalib>[0]['def']>, glycogenKcal: number): { h35: number; body: ReturnType<typeof runCalib>['climber']['body'] } {
    const env = { tairC: 7.8, windMs: 18, precipMmH: 2, precipType: 'rain' as const };
    const base = { def, gear: { cloWorn: 0.9, rainwear: 'goretex' as const } };
    const walk = runCalib({ ...base, hours: 5, env, body: { rainwearOn: true, wetness: 0.35, glycogenKcal }, metAct: 4 });
    let h35 = hoursUntilBelow(walk.samples, 35);
    applySoak(walk.climber, 'feet', 2, 300);
    const wait = runCalib({ ...base, hours: 4, env: { ...env, tairC: 7 }, body: { ...walk.climber.body }, state: 'STAYING', metAct: 1.4 });
    if (h35 === Infinity) h35 = 5 + hoursUntilBelow(wait.samples, 35);
    const at6 = runCalib({ ...base, hours: 1, env: { ...env, tairC: 7 }, body: { ...walk.climber.body }, state: 'STAYING', metAct: 1.4 });
    return { h35, body: at6.climber.body };
  }
  const elderly = { age: 68, sex: 'f' as const, weightKg: 52 };

  it('C10: 68 歳女性 52 kg → 35℃ 到達が歩き始めから 4.5〜6.5 時間', () => {
    const r = tomuraushi(elderly, 550);
    expect(r.h35).toBeGreaterThanOrEqual(4.5);
    expect(r.h35).toBeLessThanOrEqual(6.5);
  });

  it('C11: C10 の終了状態から、6℃・風 15・wetness 0.6 で地面に倒れたまま → 28℃ 到達が 2.5〜5 時間後', () => {
    const r = tomuraushi(elderly, 550);
    const { samples } = runCalib({
      hours: 8,
      def: elderly,
      gear: { cloWorn: 0.9, rainwear: 'goretex' },
      env: { tairC: 6, windMs: 15, precipMmH: 0.5, precipType: 'rain', groundContact: true, groundTempC: 5 },
      body: { ...r.body, coreC: Math.min(r.body.coreC, 35), wetness: 0.6 },
      state: 'INCAPACITATED',
      metAct: 1.0,
    });
    const h28 = hoursUntilBelow(samples, 28);
    expect(h28).toBeGreaterThanOrEqual(2.5);
    expect(h28).toBeLessThanOrEqual(5);
  });

  it('C12: 34℃ から、テント内（風 ×0.1、気温 +3℃）で横臥・マットあり → 6 時間後も 30℃ 以上', () => {
    const { samples } = runCalib({
      hours: 6,
      def: elderly,
      gear: { cloWorn: 0.9, rainwear: 'goretex' },
      env: { tairC: 9, windMs: 1.5, precipMmH: 0, wetInputF: 0, groundContact: true, groundTempC: 5 },
      body: { coreC: 34, wetness: 0.6, rainwearOn: true, glycogenKcal: 200, groundInsulation: true },
      state: 'BIVOUAC',
      metAct: 1.0,
    });
    expect(samples[samples.length - 1]!.coreC).toBeGreaterThanOrEqual(30);
  });

  it('C13: 同条件の 32 歳男性 65 kg（glycogen 1000）は C10 より 1 時間以上遅い', () => {
    const a = tomuraushi(elderly, 550);
    const b = tomuraushi({ age: 32, sex: 'm', weightKg: 65 }, 1000);
    expect(b.h35 - a.h35).toBeGreaterThanOrEqual(1);
  });
});
