import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/sim/tuning';
import { VegClass } from '../src/sim/types';

const root = resolve(import.meta.dirname, '..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8').replaceAll('\r\n', '\n');

describe('型定義と調整定数', () => {
  it('src/sim/types.ts は docs/appendix/types.ts と同じ内容（変えたら両方を直す）', () => {
    expect(read('src/sim/types.ts')).toBe(read('docs/appendix/types.ts'));
  });

  it('VegClass の値は docs/04 §4 の表どおり', () => {
    expect(VegClass).toEqual({ BROADLEAF: 0, CONIFER: 1, KRUMMHOLZ: 2, ALPINE: 3, ROCK: 4, STREAM: 5, CLIFF: 6, URBAN: 7 });
    // 植生ごとの表は、どの植生にも値がある
    const n = Object.keys(VegClass).length;
    expect(TUNING.movement.vegSpeed).toHaveLength(n);
    expect(TUNING.weather.vegWindFactor).toHaveLength(n);
  });

  it('TUNING は JSON で往復できる', () => {
    expect(JSON.parse(JSON.stringify(TUNING))).toEqual(TUNING);
  });
});
