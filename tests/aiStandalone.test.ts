/** トップの「AI 向けプロンプト作成」: 自己完結のプロンプト、埋め込む仕様の抜き出し、形式の見本（例）が検証と試走を通ること */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_NODE_LATLON, EXAMPLE_SCENARIO, EXAMPLE_SKELETON } from '../src/editor/aiExample';
import { defaultBinding, hasPosHint, keepHintsOnRecenter } from '../src/editor/geo/skeletonBind';
import { buildAiPrompt } from '../src/editor/aiPrompt';
import { buildStandalonePrompt, cleanUrls, compactJson, type StandaloneInput } from '../src/editor/aiStandalone';
import { formatDoc, jsonTypes, mapNodesEdgesDoc } from '../src/editor/aiSpec';
import { createFictionalProject, fromSkeleton } from '../src/editor/store/project';
import { runHeadless } from '../src/sim/headless';
import { validateMap, validateScenario } from '../src/sim/scenario/validate';
import type { ScenarioDef } from '../src/sim/types';
import { loadSounanDef, sounanMap } from './helpers/map';

const errors = (xs: { level: string; path: string; message: string }[]): string[] => xs.filter((i) => i.level === 'error').map((i) => `${i.path} ${i.message}`);

describe('埋め込む仕様', () => {
  it('型は JSON に書く部分だけ（実行時の World などは入れない）', () => {
    const t = jsonTypes();
    for (const s of ['export interface ScenarioDef', 'export interface MapDef', 'export interface NodeDef', 'export type Condition', 'export type Action', 'export type ScriptEffect', 'export interface ChoicePointDef', 'export interface EndingDef', 'export interface AnimalEffect', 'export type BehaviorState', 'export type SimEventType', 'export type InjuryKind', 'export type IllnessKind', 'export interface SounanBundle', 'export interface GearDef'])
      expect(t, s).toContain(s);
    for (const s of ['export interface World', 'export interface AnimalState', 'export interface ClimberState', 'export interface MapRuntime', 'export interface EditorProject']) expect(t, s).not.toContain(s);
  });
  it('形式の説明（docs/09）は見出しを 1 段下げて全部、地点と道（docs/04 §5）は 5.1〜5.3', () => {
    const f = formatDoc();
    expect(f).toContain('### 1. トップレベル');
    expect(f).not.toContain('09 シナリオ形式');
    expect(f).toContain('### 13. 検証');
    expect(f).not.toMatch(/^# /m);
    const m = mapNodesEdgesDoc();
    expect(m).toContain('courseTimeMin');
    expect(m).toContain('confusers');
    expect(m).not.toContain('5.4');
  });
});

describe('形式の見本（例）', () => {
  it('例 1（箱庭岳のシナリオ）は検証を通り、推奨の方針で無事に下りる', () => {
    expect(errors(validateScenario(EXAMPLE_SCENARIO, loadSounanDef()))).toEqual([]);
    const r = runHeadless(sounanMap().map, EXAMPLE_SCENARIO, { policy: 'recommended' });
    expect(['SAFE_RETURN', 'SAFE_SHELTER']).toContain(r.ending.kind);
  });
  it('例 2（スケルトンマップ）は検証を通り、シナリオと 1 つのバンドルにして読み込める', () => {
    expect(errors(validateMap(EXAMPLE_SKELETON))).toEqual([]);
    const s: ScenarioDef = {
      ...structuredClone(EXAMPLE_SCENARIO),
      mapId: EXAMPLE_SKELETON.id,
      plan: { ...EXAMPLE_SCENARIO.plan, route: ['TH_STATION', 'INARI', 'TAKAO', 'MOMIJI', 'ICHOUDAIRA', 'SHIROYAMA'], goalNodes: ['TH_STATION'] },
      choices: EXAMPLE_SCENARIO.choices.map((c) => ({ ...c, trigger: { atNode: 'SHIROYAMA' } })),
      region: { name: '高尾山', real: true },
    };
    const p = fromSkeleton(EXAMPLE_SKELETON, 35.628, 139.25, s);
    expect(p.map.skeleton).toBe(true);
    expect(p.map.geo?.centerLat).toBe(35.628);
    expect(p.map.nodes.map((n) => n.id)).toEqual(EXAMPLE_SKELETON.nodes.map((n) => n.id));
    expect(p.scenario.mapId).toBe(p.map.id);
    expect(p.scenario.plan.route).toEqual(s.plan.route);
    expect(errors(validateScenario(p.scenario, p.map))).toEqual([]);
    // シナリオなしのスケルトンは、ルートを空にする（従来どおり）
    expect(fromSkeleton(EXAMPLE_SKELETON, 35.6, 139.2).scenario.plan.route).toEqual([]);
  });
});

describe('スケルトンの地点の位置の手がかり（nodeLatLon）', () => {
  it('読み込むと中心からの x・z になり、例 2 の地点は範囲の端から 500 m 以上内側', () => {
    const g = EXAMPLE_SKELETON.geo!;
    const p = fromSkeleton(EXAMPLE_SKELETON, g.centerLat, g.centerLon, undefined, EXAMPLE_NODE_LATLON);
    const half = p.map.size / 2;
    for (const n of p.map.nodes) {
      expect(hasPosHint(n), n.id).toBe(true);
      expect(Math.max(Math.abs(n.x), Math.abs(n.z)), n.id).toBeLessThan(half - 500);
    }
    // 高尾山口駅は中心の東（x > 0）、小仏城山は北西（x < 0、z < 0）
    expect(p.map.nodes.find((n) => n.id === 'TH_STATION')!.x).toBeGreaterThan(1500);
    const sh = p.map.nodes.find((n) => n.id === 'SHIROYAMA')!;
    expect(sh.x).toBeLessThan(0);
    expect(sh.z).toBeLessThan(0);
  });
  it('名前の候補は手がかりの近くのものを選び、候補がなければ手がかりの位置に置く', () => {
    const map = { ...structuredClone(EXAMPLE_SKELETON), nodes: [
      { id: 'A', name: '城山', type: 'peak' as const, x: 1000, z: 0, osmName: '城山' },
      { id: 'B', name: '名もない分岐', type: 'junction' as const, x: -300, z: 200 },
      { id: 'C', name: '城山', type: 'peak' as const, x: 0, z: 0, osmName: '城山' },
    ] };
    const pts = [{ name: '城山', x: -3000, z: 0, kind: 'peak' }, { name: '城山', x: 1200, z: 100, kind: 'peak' }];
    const b = defaultBinding(map, pts, () => 0);
    expect(b['A']).toEqual(pts[1]); // 手がかりの近く
    expect(b['B']).toMatchObject({ x: -300, z: 200, kind: 'hint' });
    expect(b['C']).toEqual(pts[0]); // 手がかりなし: これまでどおり名前だけ（残った候補）
  });
  it('結合の前に範囲の中心を動かしても、手がかりは同じ緯度経度を指す', () => {
    const g = EXAMPLE_SKELETON.geo!;
    const p = fromSkeleton(EXAMPLE_SKELETON, g.centerLat, g.centerLon, undefined, EXAMPLE_NODE_LATLON);
    const before = p.map.nodes.map((n) => ({ ...n }));
    p.map.geo = { ...p.map.geo!, centerLat: g.centerLat + 0.005, centerLon: g.centerLon - 0.004 };
    keepHintsOnRecenter(p.map, g.centerLat, g.centerLon);
    const q = fromSkeleton(EXAMPLE_SKELETON, g.centerLat + 0.005, g.centerLon - 0.004, undefined, EXAMPLE_NODE_LATLON);
    for (const [i, n] of p.map.nodes.entries()) {
      expect(Math.abs(n.x - q.map.nodes[i]!.x), n.id).toBeLessThanOrEqual(1);
      expect(Math.abs(n.z - q.map.nodes[i]!.z), n.id).toBeLessThanOrEqual(1);
      expect(n.z).not.toBe(before[i]!.z);
    }
  });
});

describe('自己完結のプロンプト', () => {
  const base: StandaloneInput = { title: '霧の稜線', urls: ['https://example.com/a', ' ', 'https://example.com/a', 'https://example.com/b '], people: '', story: '霧の中で分岐を見落とす\n二行目', stage: 'real' };
  it('見本の JSON は詰めて書いても元に戻る', () => {
    expect(JSON.parse(compactJson(EXAMPLE_SCENARIO))).toEqual(EXAMPLE_SCENARIO);
    expect(JSON.parse(compactJson(EXAMPLE_SKELETON))).toEqual(EXAMPLE_SKELETON);
  });
  it('URL の欄は空行と重複を除く', () => {
    expect(cleanUrls(base.urls)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });
  it('実在の山: 入力・考え方・スケルトンのバンドルの形・例 1 と 2・付録（形式と型）が入る', () => {
    const t = buildStandalonePrompt(base);
    for (const s of ['霧の稜線', 'https://example.com/b', '> 二行目', '指定なし', '"sounan-bundle"', '"skeleton": true', '"nodeLatLon"', '"TAKAO": [35.6251,139.2436]', '## 例 1', '## 例 2', '## 付録 A', '## 付録 B', '## 付録 C', 'export interface ScenarioDef', 'reportMissing', '実名を出しません', '結合する', 'recommended'])
      expect(t, s).toContain(s);
  });
  it('箱庭岳: 地図の地点と道の ID が入り、スケルトンの話は入らない', () => {
    const map = loadSounanDef();
    const t = buildStandalonePrompt({ ...base, stage: 'fictional', people: '2人、夫婦' }, { map });
    expect(t).toContain('"sounan"');
    expect(t).toContain('2人、夫婦');
    for (const n of map.nodes) expect(t).toContain(n.id);
    expect(t).not.toContain('## 例 2');
    expect(t).not.toContain('sounan-bundle"');
  });
  it('プロジェクトの地図: そのマップ ID とシナリオの登場人物が入る', () => {
    const p = createFictionalProject('x', loadSounanDef());
    p.map.id = 'm_test';
    const t = buildStandalonePrompt({ ...base, stage: 'project' }, { map: p.map, scenario: p.scenario });
    expect(t).toContain('`"m_test"`');
    expect(t).toContain('登山者A');
  });
  it('エディターの AI タブの「会話の AI」向けも付録の形式を入れる（外の AI はソースを読めないので）', () => {
    const p = createFictionalProject('x', loadSounanDef());
    expect(buildAiPrompt(p, { story: 'x', mode: 'chat', real: false })).toContain('## 付録 C');
    expect(buildAiPrompt(p, { story: 'x', mode: 'agent', real: false })).not.toContain('## 付録 C');
  });
});
