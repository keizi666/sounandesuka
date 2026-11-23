// 選択の振り返りの判定（良い・まずまず・悪い・ほとんど変わらない）
import { describe, expect, it } from 'vitest';
import { judgeChoice } from '../src/sim/record/choiceVerdict';
import type { WhatIfResult } from '../src/sim/record/whatif';
import { TUNING } from '../src/sim/tuning';

const r = (optionId: string, counts: WhatIfResult['counts'], n = 20): WhatIfResult => ({ cpId: 'cp', optionId, n, counts, minCoreHistogram: [], deaths: 0 });

describe('judgeChoice', () => {
  const stay = r('stay', { SAFE_SHELTER: 20 });
  const go = r('go', { SAFE_RETURN: 6, RESCUED: 4, FATAL: 10 });
  const mid = r('mid', { SAFE_RETURN: 13, RESCUED: 7 });

  it('いちばん良い選択肢を選べば「良い判断」', () => {
    expect(judgeChoice([stay, go], 'stay', TUNING)?.verdict).toBe('good');
  });
  it('はっきり悪い選択肢なら「悪い判断」で、いちばん良いものを示す', () => {
    const j = judgeChoice([stay, go, mid], 'go', TUNING)!;
    expect(j.verdict).toBe('bad');
    expect(j.best.optionId).toBe('stay');
    expect(j.chosen.lost).toBeCloseTo(0.5);
  });
  it('少し劣るだけなら「まずまず」', () => {
    expect(judgeChoice([stay, mid], 'mid', TUNING)?.verdict).toBe('fair');
  });
  it('差が揺れの幅に収まるなら「ほとんど変わらない」', () => {
    const a = r('a', { SAFE_RETURN: 17, RESCUED: 3 });
    const b = r('b', { SAFE_RETURN: 16, RESCUED: 4 });
    expect(judgeChoice([a, b], 'b', TUNING)?.verdict).toBe('same');
  });
  it('選択肢が 1 つなら判定しない', () => {
    expect(judgeChoice([stay], 'stay', TUNING)).toBeNull();
  });
});
