// みんなの遭難記録のシナリオごとの集計: 結末を 3 つにまとめた割合
import { describe, expect, it } from 'vitest';
import { endingShares } from '../src/ui/community/stats';

describe('endingShares', () => {
  it('無事（途中でやめた・下山・小屋）・自力で脱出／救助・行方不明／死亡に分ける', () => {
    const s = endingShares({ n: 10, counts: { ABORTED: 1, SAFE_RETURN: 2, SAFE_SHELTER: 1, SELF_RESCUE: 1, RESCUED: 2, RESCUED_CRITICAL: 1, MISSING: 1, FATAL: 1 } });
    expect(s).toEqual({ safe: 40, rescued: 40, lost: 20 });
  });
  it('記録がなくても割れない', () => {
    expect(endingShares({ n: 0, counts: {} })).toEqual({ safe: 0, rescued: 0, lost: 0 });
  });
});
