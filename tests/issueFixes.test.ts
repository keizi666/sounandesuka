import { describe, expect, it } from 'vitest';
import type { Issue } from '../src/sim/scenario/validate';
import type { EdgeDef, EditorProject, NodeDef } from '../src/sim/types';
import { fixAll, helpFor } from '../src/editor/issueFixes';

const node = (id: string, x: number, z: number, type = 'junction', name = id): NodeDef => ({ id, name, type, x, z, snap: false }) as NodeDef;
const edge = (id: string, from: string, to: string, waypoints: [number, number][]): EdgeDef =>
  ({ id, name: id, kind: 'trail', from, to, class: 'T2', markers: 0.6, drift: 0.02, sinuosity: 1, waypoints }) as EdgeDef;

/** A〜B に道が 2 本、B〜C に 1 本。PK1 は道のそばの山頂（つながっていない）、J9 は遠くの名前のない分岐点 */
function project(): EditorProject {
  return {
    map: {
      id: 'm', name: 'テスト', size: 6000, resolution: 257,
      geo: { centerLat: 35.8, centerLon: 139.2, projection: 'local-tangent' },
      terrain: { type: 'heightmap', data: '' },
      nodes: [node('A', 0, 0), node('B', 1000, 0), node('C', 2000, 0), node('PK1', 1000, 120, 'peak', '高水山'), node('J9', -2500, 2500)],
      edges: [edge('E1', 'A', 'B', [[500, 300]]), edge('E2', 'A', 'B', [[500, 20]]), edge('E3', 'B', 'C', [[1500, 0]])],
      hazards: [],
      radio: { stations: [] },
      vegetation: { forestLine: 2500, forestLineNoise: 0, broadleafLine: 1600 },
    },
    scenario: { region: { name: 'テスト', real: true }, plan: { route: ['A', 'B', 'C'], goalNodes: [] } },
    editorState: { draftEdgeIds: ['E3'] },
    heightsBuffer: null,
  } as unknown as EditorProject;
}

const issues: Issue[] = [
  { level: 'warning', path: 'map.nodes.PK1', code: 'isolated', message: '高水山 はどの道にもつながっていません' },
  { level: 'warning', path: 'map.nodes.J9', code: 'isolated', message: 'J9 はどの道にもつながっていません' },
  { level: 'warning', path: 'map.nodes', code: 'noTrailhead', message: '下山口（登山口）のノードがありません' },
  { level: 'error', path: 'plan.route[1]', code: 'routeGap', message: 'A と B を結ぶ登山道が 1 本に決まりません' },
  { level: 'warning', path: 'sources', code: 'sources', message: '実在の山のシナリオに sources（データの出どころ）がありません' },
  { level: 'warning', path: 'editorState.draftEdgeIds', code: 'drafts', message: '取り込んだがまだ確定していない道が 1 本あります' },
];

describe('検証の項目の直し方と自動の手当て', () => {
  it('どの項目にも直し方の説明があり、直せるものにはボタンがある', () => {
    const p = project();
    for (const i of issues) expect(helpFor(p, i).hint.length).toBeGreaterThan(10);
    expect(helpFor(p, issues[0]!).fix?.label).toContain('B とつなぐ');
    expect(helpFor(p, issues[1]!).fix?.label).toBe('この分岐点を消す');
    expect(helpFor(p, { level: 'warning', path: 'map.edges.E1', code: 'steep', message: '' }).fix).toBeUndefined();
  });

  it('まとめて直すと、つなぐ・消す・ルート・登山口・出典・下書きがすべて直る', () => {
    const p = project();
    const notes = fixAll(p, null, issues);
    expect(notes.length).toBeGreaterThanOrEqual(5);
    // 山頂はそばの B とつながり、遠くの名前のない分岐点は消える
    expect(p.map.edges.some((e) => (e.from === 'B' && e.to === 'PK1') || (e.from === 'PK1' && e.to === 'B'))).toBe(true);
    expect(p.map.nodes.some((n) => n.id === 'J9')).toBe(false);
    // A〜B は経由点を通り、どの区間も道が 1 本
    const r = p.scenario.plan.route;
    expect(r).toHaveLength(4);
    for (let i = 1; i < r.length; i += 1) expect(p.map.edges.filter((e) => (e.from === r[i - 1] && e.to === r[i]) || (e.from === r[i] && e.to === r[i - 1])).length).toBe(1);
    // ルートの端が登山口、下山口も入る
    expect(p.map.nodes.find((n) => n.id === 'A')!.type).toBe('trailhead');
    expect(p.map.nodes.find((n) => n.id === 'C')!.type).toBe('trailhead');
    expect(p.scenario.plan.goalNodes).toEqual(['C']);
    expect(p.scenario.sources!.length).toBeGreaterThan(0);
    expect(p.editorState.draftEdgeIds).toEqual([]);
  });
});
