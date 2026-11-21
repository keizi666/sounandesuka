import { describe, expect, it } from 'vitest';
import { cleanName, nameVariants, parsePlaces, placeQuery } from '../src/editor/geo/placeSearch';
import type { OsmJson } from '../src/editor/geo/overpass';

describe('地名・山名の検索', () => {
  it('引用符・バックスラッシュを取り除き、「〜山」「〜岳」などの書き方を並べる', () => {
    expect(cleanName(' 白馬"岳\\ ')).toBe('白馬岳');
    const v = nameVariants('白馬岳');
    expect(v[0]).toBe('白馬岳');
    expect(v).toContain('白馬');
    expect(v).toContain('白馬山');
    expect(v).toContain('白馬村');
    expect(new Set(v).size).toBe(v.length);
    expect(nameVariants('  ')).toEqual([]);
    const q = placeQuery('槍ヶ岳');
    expect(q).toContain('node["name"="槍ヶ岳"](20,122,46,154);');
    expect(q).toContain('node["name"="槍岳"]');
    // 日本全体の正規表現は時間切れになるので使わない
    expect(q).not.toContain('~');
  });

  it('移動先にならない点を除き、一致の度合い・山かどうか・標高で並べる', () => {
    const json: OsmJson = {
      elements: [
        { type: 'node', id: 1, lat: 36.76, lon: 137.76, tags: { natural: 'peak', name: '白馬鑓ヶ岳', ele: '2903' } },
        { type: 'node', id: 2, lat: 36.70, lon: 137.86, tags: { place: 'village', name: '白馬村' } },
        { type: 'node', id: 3, lat: 36.759, lon: 137.759, tags: { natural: 'peak', name: '白馬岳', ele: '2932' } },
        { type: 'node', id: 4, lat: 36.8, lon: 137.8, tags: { natural: 'peak', name: '小白馬' } },
        { type: 'node', id: 5, lat: 36.759, lon: 137.759, tags: { natural: 'peak', name: '白馬岳', ele: '2932' } },
        { type: 'node', id: 6, lat: 36.0, lon: 137.0, tags: { natural: 'peak' } },
        { type: 'node', id: 7, lat: 36.7, lon: 137.85, tags: { railway: 'station', name: '白馬' } },
      ],
    };
    const hits = parsePlaces(json, '白馬');
    expect(hits.map((h) => h.name)).toEqual(['白馬岳', '白馬鑓ヶ岳', '白馬村', '小白馬']);
    expect(hits[0]).toMatchObject({ kind: '山頂', elevM: 2932 });
    expect(hits[2]!.kind).toBe('村');
  });
});
