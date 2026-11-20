import { describe, expect, it } from 'vitest';
import { runRecordPath } from '../tools/historical-path';
import { loadEntryRuntime, loadIndex } from '../tools/lib/scenarios';

// 史実のシナリオ: 画面で記録どおりに選び続けたら、記録と同じ死者数になる（ユーザーの指定）。
// 画面では乱数の種がシナリオで決まっているので、経過は毎回同じ。エンジンを変えて一致しなくなったら、npm run historical -- --search N で種を選び直す
describe('史実のシナリオ: 記録どおりに選ぶと記録どおりの結果', () => {
  for (const e of loadIndex().filter((x) => x.region?.real)) {
    const r = loadEntryRuntime(e);
    const h = r?.scenario.historical;
    if (!r || !h || h.recordedDeaths === undefined) continue;
    it(`${e.id}: 死者 ${h.recordedDeaths} 人`, () => {
      const w = runRecordPath(r.map, r.scenario, r.scenario.seed);
      expect(w.ended).not.toBeNull();
      expect(w.climbers.filter((c) => !c.body.alive).length).toBe(h.recordedDeaths);
    }, 120000);
  }
});
