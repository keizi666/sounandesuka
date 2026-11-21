/**
 * 検証の「ルートを直す」「ない道を外す」（エディター）。スケルトンの結合で登山道のない区間の道が落ちたとき
 * （ユーザーの指摘: 北鎌尾根で、選択肢のルートと通りかかる人の道のエラーが「まとめて直す」で直らなかった）。
 */
import { describe, expect, it } from 'vitest';
import { fixAll } from '../src/editor/issueFixes';
import { blankScenario } from '../src/editor/store/project';
import { validateScenario } from '../src/sim/scenario/validate';
import type { EditorProject, MapDef, ScenarioDef } from '../src/sim/types';

function project(): EditorProject {
  const map: MapDef = {
    id: 'm', name: 'm', size: 4096, resolution: 257,
    terrain: { type: 'heightmap', encoding: 'u16-base64', minElevM: 0, maxElevM: 1, baseElevation: 0, data: '' } as MapDef['terrain'],
    vegetation: { forestLine: 2500, forestLineNoise: 0, broadleafLine: 1500 },
    nodes: [
      { id: 'DEAI', name: '出合', type: 'trailhead', x: 0, z: 0 },
      { id: 'COL', name: 'コル', type: 'saddle', x: 0, z: -800 },
      { id: 'BASE', name: '基部', type: 'junction', x: -300, z: -900 },
      { id: 'PEAK', name: '山頂', type: 'peak', x: -900, z: -900 },
      { id: 'HUT', name: '山荘', type: 'hut', x: -900, z: -700, shelter: { kind: 'staffed', open: true } },
    ],
    // E2（コル〜基部）・E3（基部〜山頂）は OSM に道がなく、結合で落ちた
    edges: [
      { id: 'E1', name: '出合〜コル', kind: 'trail', from: 'DEAI', to: 'COL', class: 'T2', markers: 0.3, drift: 0.03, sinuosity: 1, waypoints: [] },
      { id: 'E4', name: '山頂〜山荘', kind: 'trail', from: 'PEAK', to: 'HUT', class: 'T3', markers: 0.6, drift: 0.02, sinuosity: 1, waypoints: [] },
    ],
    hazards: [],
    radio: { stations: [] },
  };
  const scenario: ScenarioDef = {
    ...blankScenario(map, 's'),
    plan: { ...blankScenario(map, 's').plan, route: ['DEAI', 'COL', 'BASE', 'PEAK', 'HUT'], goalNodes: ['HUT'] },
    choices: [{ id: 'cp', title: 't', trigger: { atNode: 'COL' }, situation: 's', options: [{ id: 'a', label: 'a', actions: [{ type: 'setRoute', route: ['COL', 'BASE', 'PEAK', 'HUT'], goalNodes: ['HUT'] }], bias: { base: 1 } }] }],
    passersby: [{ edges: ['E1', 'E2', 'E3'], perHour: 1 }, { edges: ['E3'], perHour: 1 }],
  };
  return { id: 'p', name: 'p', createdAt: '', updatedAt: '', map, heightsBuffer: null, scenario, raw: {}, editorState: { mapView: { lat: 0, lon: 0, zoom: 14 }, tab: 'trails', selection: { kind: null, id: null }, draftEdgeIds: [], probePoints: [], rightsConfirmed: false } };
}

const errorsOf = (p: EditorProject): string[] => validateScenario(p.scenario, p.map).filter((i) => i.level === 'error' && (i.code === 'routeGap' || i.code === 'undefinedEdge')).map((i) => `${i.code} ${i.path}`);

describe('検証の「まとめて直す」: ルートとない道', () => {
  it('計画ルートと選択肢のルートの道のない区間を直線の仮の道でつなぎ、通りかかる人のない道を外す', () => {
    const p = project();
    const before = errorsOf(p);
    expect(before.some((e) => e.startsWith('routeGap choices'))).toBe(true);
    expect(before.some((e) => e.startsWith('undefinedEdge passersby'))).toBe(true);
    const notes = fixAll(p, null, validateScenario(p.scenario, p.map));
    expect(notes.join('。')).toContain('直線の仮の道');
    expect(errorsOf(p)).toEqual([]);
    // 仮の直線の道は 2 本（コル〜基部・基部〜山頂。計画ルートと選択肢で同じ区間は 1 本だけ）
    expect(p.map.edges.filter((e) => e.name.endsWith('（仮の直線）')).map((e) => `${e.from}-${e.to}`)).toEqual(['COL-BASE', 'BASE-PEAK']);
    expect(p.scenario.passersby).toEqual([{ edges: ['E1'], perHour: 1 }]);
  });
});
