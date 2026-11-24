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

describe('手遅れ', () => {
  it('どれを選んでも変わらず、どれも結末が悪いなら「手遅れ」', () => {
    const a = r('a', { MISSING: 6, FATAL: 12, RESCUED: 2 });
    const b = r('b', { MISSING: 5, FATAL: 13, RESCUED: 2 });
    expect(judgeChoice([a, b], 'a', TUNING)?.verdict).toBe('late');
  });
  it('どれを選んでも変わらず、どれも無事なら「ほとんど変わらない」のまま', () => {
    const a = r('a', { SAFE_RETURN: 19, RESCUED: 1 });
    const b = r('b', { SAFE_RETURN: 18, RESCUED: 2 });
    expect(judgeChoice([a, b], 'a', TUNING)?.verdict).toBe('same');
  });
});

describe('行方不明・死亡がはっきり多い選択（ユーザーの指摘: 滝の横の斜面を巻く）', () => {
  it('無事 0% どうしでも、死亡が 2 割増えるなら「悪い判断」で、死亡の少ない選択肢を示す', () => {
    const wait = r('wait', { RESCUED_CRITICAL: 20 });
    const high = r('high', { RESCUED_CRITICAL: 16, FATAL: 4 });
    const j = judgeChoice([wait, high], 'high', TUNING)!;
    expect(j.verdict).toBe('bad');
    expect(j.best.optionId).toBe('wait');
  });
  it('死亡の差が揺れの幅に収まるなら、悪い判断にしない', () => {
    const wait = r('wait', { RESCUED: 20 });
    const high = r('high', { RESCUED: 19, FATAL: 1 });
    expect(judgeChoice([wait, high], 'high', TUNING)?.verdict).not.toBe('bad');
  });
});
