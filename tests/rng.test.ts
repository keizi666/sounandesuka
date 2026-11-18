import { describe, expect, it } from 'vitest';
import {
  createRngStreams,
  deriveSeed,
  hashString32,
  nextFloat,
  nextU32,
  pickWeighted,
  RNG_STREAMS,
  seedState,
  splitmix32,
} from '../src/sim/core/rng';
import type { RngState } from '../src/sim/types';

describe('xoshiro128**', () => {
  it('参照実装の既知ベクトルと一致する（状態 [1,2,3,4]）', () => {
    // xoshiro128** の C 参照実装を Python に写して計算した値
    const s: RngState = [1, 2, 3, 4];
    const out = Array.from({ length: 10 }, () => nextU32(s));
    expect(out).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597, 4258142804,
    ]);
  });

  it('splitmix32 の既知ベクトルと一致する', () => {
    const f = splitmix32(42);
    expect([f(), f(), f(), f()]).toEqual([551831576, 144025891, 322543647, 3034809370]);
  });

  it('seedState(1017) からの出力が固定値と一致する', () => {
    const s = seedState(1017);
    expect([...s]).toEqual([1646459381, 3585918746, 1007493344, 490705526]);
    expect(Array.from({ length: 5 }, () => nextU32(s))).toEqual([394250694, 1847874748, 4091872272, 3518329007, 377684245]);
  });

  it('同じシードなら 1 万回の出力が一致する', () => {
    const a = seedState(20261116);
    const b = seedState(20261116);
    for (let i = 0; i < 10_000; i += 1) {
      const x = nextU32(a);
      const y = nextU32(b);
      if (x !== y) throw new Error(`${i} 回目で不一致`);
    }
    expect(a).toEqual(b);
  });

  it('nextFloat は [0, 1)', () => {
    const s = seedState(7);
    for (let i = 0; i < 10_000; i += 1) {
      const v = nextFloat(s);
      expect(v >= 0 && v < 1).toBe(true);
    }
  });

  it('状態は JSON で往復でき、続きが同じになる', () => {
    const s = seedState(99);
    for (let i = 0; i < 100; i += 1) nextU32(s);
    const t = JSON.parse(JSON.stringify(s)) as RngState;
    expect(nextU32(t)).toBe(nextU32(s));
  });
});

describe('名前付きストリーム', () => {
  it('8 本あり、互いに異なる', () => {
    const st = createRngStreams(1017);
    expect(Object.keys(st).sort()).toEqual([...RNG_STREAMS].sort());
    const firsts = RNG_STREAMS.map((n) => nextU32([...st[n]] as RngState));
    expect(new Set(firsts).size).toBe(RNG_STREAMS.length);
  });

  it('thoughts を回しても nav の出力は変わらない（独立性）', () => {
    const a = createRngStreams(5);
    const b = createRngStreams(5);
    for (let i = 0; i < 1000; i += 1) nextU32(b.thoughts);
    const na = Array.from({ length: 100 }, () => nextU32(a.nav));
    const nb = Array.from({ length: 100 }, () => nextU32(b.nav));
    expect(nb).toEqual(na);
  });

  it('シードが違えば出力が違う', () => {
    expect(nextU32(createRngStreams(1).weather)).not.toBe(nextU32(createRngStreams(2).weather));
  });
});

describe('派生シードと補助', () => {
  it('deriveSeed は決定論的で、部品が違えば値が違う', () => {
    expect(deriveSeed(42, 1)).toBe(deriveSeed(42, 1));
    const seeds = new Set(Array.from({ length: 1000 }, (_, i) => deriveSeed(42, i)));
    expect(seeds.size).toBe(1000);
  });

  it('hashString32 は FNV-1a', () => {
    expect(hashString32('')).toBe(0x811c9dc5);
    expect(hashString32('a')).toBe(0xe40c292c);
  });

  it('pickWeighted は重みに比例する（10,000 回で ±3%）', () => {
    const s = seedState(123);
    const w = [1, 2, 0, 5];
    const count = [0, 0, 0, 0];
    const N = 10_000;
    for (let i = 0; i < N; i += 1) count[pickWeighted(s, w)]! += 1;
    const total = 8;
    w.forEach((wi, i) => expect(Math.abs(count[i]! / N - wi / total)).toBeLessThan(0.03));
    expect(count[2]).toBe(0);
    expect(pickWeighted(s, [0, 0])).toBe(-1);
  });
});
