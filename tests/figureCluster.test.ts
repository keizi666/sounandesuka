import { describe, expect, it } from 'vitest';
import { clusterHeads } from '../src/ui/figureCluster';

const col = (n: number, gap: number, group = 'g', alive = true) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, groupId: group, alive, x: 100 + i * gap, y: 100 }));
const posOf = (ps: { id: string; x: number; y: number }[]) => new Map(ps.map((p) => [p.id, { x: p.x, y: p.y }]));

describe('顔アイコンを 5 人ずつまとめる', () => {
  it('55 人の詰まった列は、5 人ずつ 11 個にまとまる', () => {
    const ps = col(55, 4);
    const out = clusterHeads(ps, posOf(ps), 5, 64);
    expect(out.length).toBe(11);
    expect(out.every((g) => g.length === 5)).toBe(true);
    expect(out[0]).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });
  it('離れている人はまとめない（1 人だけのまとまりは作らない）', () => {
    const ps = col(6, 100);
    expect(clusterHeads(ps, posOf(ps), 5, 64)).toEqual([]);
  });
  it('別の列（グループ）や、生死の違う人は混ぜない', () => {
    const a = col(3, 4, 'a');
    const b = col(3, 4, 'b').map((p) => ({ ...p, id: `b${p.id}` }));
    const d = col(2, 4, 'a', false).map((p) => ({ ...p, id: `d${p.id}` }));
    const ps = [...a, ...b, ...d];
    const out = clusterHeads(ps, posOf(ps), 5, 64);
    expect(out).toEqual([['p0', 'p1', 'p2'], ['bp0', 'bp1', 'bp2'], ['dp0', 'dp1']]);
  });
  it('画面に映っていない人は数えない', () => {
    const ps = col(7, 4);
    const pos = posOf(ps);
    pos.delete('p2');
    const out = clusterHeads(ps, pos, 5, 64);
    expect(out).toEqual([['p0', 'p1', 'p3', 'p4', 'p5']]);
  });
});

describe('グループのない人', () => {
  it('一人で動いている人（groupId が null）はまとめない', () => {
    const ps = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, groupId: null, alive: true, x: 100 + i, y: 100 }));
    expect(clusterHeads(ps, new Map(ps.map((p) => [p.id, { x: p.x, y: p.y }])), 5, 64)).toEqual([]);
  });
});
