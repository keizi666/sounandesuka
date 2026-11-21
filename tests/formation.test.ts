/**
 * 列の並び（src/view/formation.ts）: 暗いときは、ランプのない人をランプを持つ人の間に入れる
 */
import { describe, expect, it } from 'vitest';
import type { ClimberState } from '../src/sim/types';
import { formationOrder } from '../src/view/formation';

function c(id: string, lamp: boolean, groupId: string | null = 'g', alive = true): ClimberState {
  return { id, groupId, body: { alive }, inv: { headlamp: { on: lamp } } } as unknown as ClimberState;
}

const ids = (cs: ClimberState[]): string[] => cs.map((x) => x.id);

describe('列の並び', () => {
  it('明るいときはパーティの順', () => {
    expect(ids(formationOrder([c('a', true), c('b', true), c('c', false)], false))).toEqual(['a', 'b', 'c']);
  });

  it('暗いときは、ランプのない人を 2 つのランプの間に', () => {
    expect(ids(formationOrder([c('a', true), c('b', true), c('c', false)], true))).toEqual(['a', 'c', 'b']);
    // ランプが 1 つだけなら、そのまま
    expect(ids(formationOrder([c('a', false), c('b', true), c('c', false)], true))).toEqual(['a', 'b', 'c']);
  });

  it('グループごとに並べ、ほかのグループの人は混ぜない', () => {
    const out = formationOrder([c('a', true, 'g1'), c('x', false, 'g2'), c('b', true, 'g1'), c('c', false, 'g1')], true);
    expect(ids(out)).toEqual(['a', 'c', 'b', 'x']);
  });
});
