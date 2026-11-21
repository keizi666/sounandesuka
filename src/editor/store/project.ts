/**
 * エディターのプロジェクト（docs/15 §3）: 新規作成、高さの出し入れ、バンドルとの変換、出典の自動付与。
 */
import { decodeHeights, encodeHeights } from '../../sim/terrain/codec';
import type { Attribution, ClimberDef, EditorProject, SounanBundle, HeightmapTerrainDef, MapDef, ScenarioDef } from '../../sim/types';

export const GENERATOR = 'sounan-editor 0.1';

export const ATTR = {
  gsi: { id: 'gsi', text: '出典：国土地理院（標高タイル）を加工して作成', url: 'https://maps.gsi.go.jp/development/ichiran.html', modified: true },
  osm: { id: 'osm', text: '登山道データ © OpenStreetMap contributors（ODbL）', url: 'https://www.openstreetmap.org/copyright', modified: true },
  gsiVector: { id: 'gsi-vector', text: '出典：国土地理院（ベクトルタイル）の植生記号・建物・道路・鉄道を加工して作成', url: 'https://maps.gsi.go.jp/development/vt.html', modified: true },
  openMeteo: { id: 'open-meteo', text: '気象の下書き: Open-Meteo（CC BY 4.0）、Copernicus Climate Change Service の情報を使用', url: 'https://open-meteo.com/', modified: true },
} satisfies Record<string, Attribution>;

export function newId(prefix = 'p'): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const COLORS = ['#d9452b', '#2b7bd9', '#2bb673', '#a855f7', '#e0a100', '#0ea5a4', '#db2777', '#64748b'];

export function pickColor(used: readonly string[]): string {
  return COLORS.find((c) => !used.includes(c)) ?? COLORS[used.length % COLORS.length]!;
}

/** 標準的な登山者（docs/07 §1.3 の標準登山者に近い値） */
export function defaultClimber(id: string, name: string, color: string, leader: boolean): ClimberDef {
  return {
    id,
    name,
    age: 40,
    sex: 'm',
    weightKg: 65,
    packKg: 8,
    experience: 0.5,
    fitness: 1.0,
    navSkill: 0.5,
    riskTolerance: 0.5,
    color,
    leader,
    habits: { eatEveryMin: 120, drinkEveryMin: 60, delaysRainwear: 0.3, gpsCheckEveryMin: null },
    gear: {
      rainwear: 'basic',
      cloWorn: 0.9,
      cloPack: 0.6,
      gloves: 'thin',
      hat: true,
      bivy: 'none',
      headlamp: { has: true, batteryH: 6, inPack: true, spareBatteryH: 0 },
      phone: { has: true, batteryPct: 90, gpsApp: true, trackRecording: false, satelliteSos: false },
      map: true,
      compass: false,
      foodKcal: 1200,
      waterL: 1.5,
      stove: false,
      crampons: false,
      helmet: false,
      trekkingPoles: true,
      whistle: false,
    },
  };
}

export function blankScenario(map: MapDef, id: string): ScenarioDef {
  const th = map.nodes.find((n) => n.type === 'trailhead');
  return {
    id,
    version: 1,
    title: '新しいシナリオ',
    subtitle: '',
    theme: 'mixed',
    difficulty: 2,
    season: 'autumn',
    estMinutes: 10,
    mapId: map.id,
    seed: 1,
    startDate: '2026-10-17',
    startAt: 'D0 06:00',
    timeLimit: 'D1 12:00',
    sun: { sunrise: '05:52', sunset: '17:04', maxElevDeg: 42 },
    moon: { illumination: 0.5 },
    briefing: { text: '', forecast: [{ label: '朝', text: '晴れ' }] },
    plan: { route: th ? [th.id] : [], goalNodes: th ? [th.id] : [], plannedFinish: 'D0 15:00', submittedPlan: true, reportIfNotBackBy: 'D0 21:00' },
    party: [defaultClimber('c1', '登山者A', COLORS[0]!, true)],
    weather: {
      refElevM: 1000,
      lapseRateCPer100m: 0.65,
      cloudThicknessM: 1500,
      keyframes: [{ at: 'D0 06:00', tempC: 10, windMs: 3, windDirDeg: 270, precipMmH: 0, cloudCover: 0.2, cloudBaseM: 3000, visibilityM: 25000, pressureHpa: 1015 }],
    },
    events: [],
    choices: [],
    endings: [],
    lessons: [],
  } as unknown as ScenarioDef;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyEditorState(lat: number, lon: number): EditorProject['editorState'] {
  return { mapView: { lat, lon, zoom: 13 }, tab: 'area', selection: { kind: null, id: null }, draftEdgeIds: [], probePoints: [], rightsConfirmed: false };
}

/** 架空の箱庭岳で作る（マップは既存の sounan をそのまま使う） */
export function createFictionalProject(name: string, sounan: MapDef): EditorProject {
  const map = structuredClone(sounan);
  const t = nowIso();
  const scenarioId = newId('s_');
  return { id: newId(), name, createdAt: t, updatedAt: t, map, heightsBuffer: null, scenario: blankScenario(map, scenarioId), raw: {}, editorState: { ...emptyEditorState(0, 0), tab: 'trails' } };
}

/** 実在の山で作る（地形は標高の取得後に入る） */
export function createRealProject(name: string, lat: number, lon: number, size: number, resolution: number): EditorProject {
  const t = nowIso();
  const mapId = newId('m_');
  const map: MapDef = {
    id: mapId,
    name,
    size,
    resolution,
    geo: { centerLat: lat, centerLon: lon, projection: 'local-tangent' },
    terrain: { type: 'heightmap', encoding: 'u16-base64', minElevM: 0, maxElevM: 1, baseElevation: 0, smoothingPasses: 1, source: { dem: 'DEM10B', zoom: 14, fetchedAt: '' }, data: '' },
    vegetation: { forestLine: 2500, forestLineNoise: 60, broadleafLine: 1600 },
    nodes: [],
    edges: [],
    hazards: [],
    radio: { stations: [] },
  };
  const scenario = blankScenario(map, newId('s_'));
  scenario.region = { name, real: true };
  return { id: newId(), name, createdAt: t, updatedAt: t, map, heightsBuffer: null, scenario, raw: {}, editorState: emptyEditorState(lat, lon) };
}

/** 地形があるか（架空の箱庭岳、または高さを取得済み） */
export function hasTerrain(p: EditorProject): boolean {
  return p.map.terrain.type !== 'heightmap' || p.heightsBuffer !== null || (p.map.terrain as HeightmapTerrainDef).data !== '';
}

/** 高さを差し替える（Float32 → heightsBuffer、terrain の min/max も更新） */
export function setHeights(p: EditorProject, h: Float32Array, info: { baseElevation: number; smoothing: number; fetchedAt: string }): void {
  let min = Infinity;
  let max = -Infinity;
  for (const v of h) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  p.heightsBuffer = h.slice().buffer;
  p.map.terrain = {
    type: 'heightmap',
    encoding: 'u16-base64',
    minElevM: min,
    maxElevM: max,
    baseElevation: info.baseElevation,
    smoothingPasses: info.smoothing,
    source: { dem: 'DEM10B', zoom: 14, fetchedAt: info.fetchedAt },
    data: '',
  };
}

/** 実行・書き出し用の MapDef（高さを base64 にして埋める） */
export function mapWithHeights(p: EditorProject): MapDef {
  if (p.map.terrain.type !== 'heightmap' || !p.heightsBuffer) return p.map;
  const enc = encodeHeights(new Float32Array(p.heightsBuffer));
  return { ...p.map, terrain: { ...p.map.terrain, minElevM: enc.minElevM, maxElevM: enc.maxElevM, data: enc.data } };
}

/** 使ったデータ源だけの出典（docs/15 §3.2） */
export function attributionFor(p: EditorProject): Attribution[] {
  const out: Attribution[] = [];
  if (p.map.geo && p.map.terrain.type === 'heightmap') out.push(ATTR.gsi);
  if (p.map.urban || p.raw?.gsiVector) out.push(ATTR.gsiVector);
  if (p.map.nodes.some((n) => n.source === 'osm') || p.map.edges.some((e) => e.source === 'osm')) out.push(ATTR.osm);
  if ((p.scenario.sources ?? []).some((s) => s.includes('Open-Meteo'))) out.push(ATTR.openMeteo);
  return out;
}

export function toBundle(p: EditorProject): SounanBundle {
  const map = mapWithHeights(p);
  return { format: 'sounan-bundle', version: 1, createdAt: nowIso(), generator: GENERATOR, map, scenario: { ...p.scenario, mapId: map.id }, attribution: attributionFor(p) };
}

export function fromBundle(b: SounanBundle, name?: string): EditorProject {
  if ((b.format !== 'sounan-bundle' && b.format !== 'hakoniwa-bundle') || b.version !== 1) throw new Error('バンドルの形式が違います');
  const t = nowIso();
  const map = structuredClone(b.map);
  let heightsBuffer: ArrayBuffer | null = null;
  if (map.terrain.type === 'heightmap' && map.terrain.data) {
    heightsBuffer = decodeHeights(map.terrain, map.resolution * map.resolution).buffer as ArrayBuffer;
    map.terrain = { ...map.terrain, data: '' };
  }
  const geo = map.geo;
  return {
    id: newId(),
    name: name ?? b.scenario.title,
    createdAt: t,
    updatedAt: t,
    map,
    heightsBuffer,
    scenario: structuredClone(b.scenario),
    raw: {},
    editorState: { ...emptyEditorState(geo?.centerLat ?? 0, geo?.centerLon ?? 0), tab: 'party' },
  };
}

/** 複製（docs/18 §8）。mapOnly なら同じマップで新しいシナリオ */
export function duplicateProject(p: EditorProject, mapOnly: boolean): EditorProject {
  const q = structuredClone(p);
  q.id = newId();
  q.name = `${p.name}${mapOnly ? '（同じマップ）' : '（複製）'}`;
  q.createdAt = q.updatedAt = nowIso();
  if (mapOnly) {
    q.scenario = blankScenario(q.map, newId('s_'));
    if (p.scenario.region) q.scenario.region = { ...p.scenario.region };
  } else q.scenario.id = newId('s_');
  return q;
}

/** ノード・エッジの連番 ID */
export function nextId(existing: Iterable<string>, prefix: string): string {
  const used = new Set(existing);
  for (let i = 1; ; i += 1) {
    const id = `${prefix}${String(i).padStart(3, '0')}`;
    if (!used.has(id)) return id;
  }
}
