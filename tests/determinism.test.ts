/**
 * 決定論（docs/14 §2、NFR-04）と記録・教訓（docs/12 §1、docs/09 §10）
 */
import { describe, expect, it } from 'vitest';
import { cloneWorld, hashRecord, hashWorld } from '../src/sim/core/snapshot';
import { stepWorld } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { runHeadless } from '../src/sim/headless';
import { selectLessons } from '../src/sim/record/lessons';
import { createRecorder, recordTick, recVars } from '../src/sim/record/recorder';
import { autoResolve } from '../src/sim/scenario/choices';
import type { PolicyName } from '../src/sim/types';
import { hakoniwa } from './helpers/map';
import { loadScenario } from './helpers/scenario';

const IDS = ['s01_cold_front', 's02_fog_descent', 's03_thunder_ridge'];

describe('決定論（docs/14 §2）', () => {
  const { map } = hakoniwa();
  for (const id of IDS) {
    for (const policy of ['recommended', 'bias', 'random'] as PolicyName[]) {
      it(`${id} ${policy}: 同じシード・方針なら記録のハッシュが一致`, () => {
        const a = runHeadless(map, loadScenario(id), { policy, seed: 42 });
        const b = runHeadless(map, loadScenario(id), { policy, seed: 42 });
        expect(hashRecord(b.record!)).toBe(hashRecord(a.record!));
        expect(hashWorld(b.world)).toBe(hashWorld(a.world));
      });
    }
  }

  it('分岐点ごとに保存→復元を挟んでも、挟まない実行と最終ハッシュが一致', () => {
    for (const id of IDS) {
      const sc = loadScenario(id);
      const run = (snap: boolean): string => {
        let w = createWorld(map, sc, 42);
        const ctx = createStaticContext(map, sc, { mode: 'interactive', policy: 'bias' });
        for (let i = 0; i < 20_000 && !w.ended; i += 1) {
          if (w.pendingChoice) {
            if (snap) w = cloneWorld(w);
            autoResolve(w, ctx, 'policy');
          }
          stepWorld(w, ctx);
          ctx.events.length = 0;
        }
        return hashWorld(w);
      };
      expect(run(true), id).toBe(run(false));
    }
  });

  it('シードが違えば結果が違う', () => {
    const a = runHeadless(map, loadScenario('s02_fog_descent'), { policy: 'bias', seed: 1 });
    const b = runHeadless(map, loadScenario('s02_fog_descent'), { policy: 'bias', seed: 2 });
    expect(hashRecord(a.record!)).not.toBe(hashRecord(b.record!));
  });
});

describe('記録と教訓（docs/12 §1、docs/09 §10）', () => {
  const { map } = hakoniwa();

  it('サンプルは 5 分ごと、決定・統計・結末が入る', () => {
    const r = runHeadless(map, loadScenario('s01_cold_front'), { policy: 'recommended' });
    const rec = r.record!;
    expect(rec.samples.length).toBeGreaterThan(50);
    for (let i = 1; i < rec.samples.length - 1; i += 1) expect(rec.samples[i]!.t - rec.samples[i - 1]!.t).toBeCloseTo(5, 6);
    expect(rec.decisions.map((d) => d.cpId)).toContain('cp_eboshi');
    expect(rec.decisions[0]!.label).not.toBe('');
    expect(rec.ending?.kind).toBe(r.ending.kind);
    expect(rec.stats.distanceM).toBeGreaterThan(3000);
    expect(rec.track.length).toBeGreaterThan(100);
  });

  it('雨具の遅れ（降り始めから着用まで）が記録され、教訓の条件に使える', () => {
    const sc = loadScenario('s01_cold_front');
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc, { policy: 'risky' });
    const rs = createRecorder(w);
    while (!w.ended) {
      stepWorld(w, ctx);
      recordTick(rs, w, ctx, ctx.events, 1 / 6);
      ctx.events.length = 0;
    }
    const rec = recVars(rs, w);
    expect(typeof rec['rainwearDelayMin']).toBe('number');
    const lessons = selectLessons(w, ctx, rec);
    // risky では「予定どおり進む」を選ぶので l_eboshi が出る
    expect(lessons.map((l) => l.id)).toContain('l_eboshi');
    for (const l of lessons) expect(l.text).not.toMatch(/\{rec\./);
  });

  it('教訓の評価は World を変えない', () => {
    const r = runHeadless(map, loadScenario('s02_fog_descent'), { policy: 'bias', seed: 3 });
    const sc = loadScenario('s02_fog_descent');
    const ctx = createStaticContext(map, sc);
    const before = hashWorld(r.world);
    selectLessons(r.world, ctx, r.rec!);
    expect(hashWorld(r.world)).toBe(before);
  });
});

describe('速さ（docs/13 P7）', () => {
  it('1 人の 24 時間分の通し実行が十分速い（束ねた Node で約 47 ms。テスト環境では 150 ms 以下を確認）', { retry: 2 }, () => {
    const { map } = hakoniwa();
    const sc = loadScenario('s01_cold_front');
    runHeadless(map, sc, { policy: 'risky', seed: 1 }); // 温める
    const t0 = performance.now();
    let ticks = 0;
    for (let i = 0; i < 5; i += 1) ticks += runHeadless(map, sc, { policy: 'risky', seed: 10 + i }).ticks;
    const per24h = ((performance.now() - t0) / ticks) * 8640;
    expect(per24h).toBeLessThan(150);
  }); // 並列実行で CPU が混むと揺れるため、再試行を許す（it の第 2 引数）
});
