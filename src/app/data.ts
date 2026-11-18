/**
 * データの読み込み（public/ の JSON、バンドル）。fetch は BASE_URL を前置する（docs/03 §10）。
 * マップの派生レイヤーは本体で作り、重い電波圏だけ Worker で計算して待つ（sim の結果を Node と一致させるため）。
 */
import { buildMapRuntime } from '../sim/terrain/map';
import type { HakoniwaBundle, MapDef, MapRuntime, ScenarioDef, ScenarioIndexEntry } from '../sim/types';

export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(assetUrl(path));
  if (!r.ok) throw new Error(`${path} を読み込めませんでした（${r.status}）`);
  return (await r.json()) as T;
}

export function loadIndex(): Promise<ScenarioIndexEntry[]> {
  return getJson<ScenarioIndexEntry[]>('scenarios/index.json');
}

export function loadMapDef(id: string): Promise<MapDef> {
  return getJson<MapDef>(`maps/${id}.json`);
}

export function loadScenarioFile(file: string): Promise<ScenarioDef> {
  return getJson<ScenarioDef>(`scenarios/${file}`);
}

export function loadBundleFile(file: string): Promise<HakoniwaBundle> {
  return getJson<HakoniwaBundle>(`scenarios/${file}`);
}

const runtimeCache = new Map<string, Promise<MapRuntime>>();

/** MapRuntime を作る（電波圏は Worker）。同じ定義はキャッシュする */
export function buildRuntime(def: MapDef): Promise<MapRuntime> {
  const key = `${def.id}:${def.size}:${def.resolution}`;
  let p = runtimeCache.get(key);
  if (!p) {
    p = (async () => {
      const worker = new Worker(new URL('../workers/coverage.worker.ts', import.meta.url), { type: 'module' });
      const radio = new Promise<Float32Array>((resolve, reject) => {
        worker.onmessage = (ev: MessageEvent<{ radio: Float32Array }>) => resolve(ev.data.radio);
        worker.onerror = (e) => reject(new Error(e.message));
      });
      worker.postMessage({ def });
      const { map } = buildMapRuntime(def, { radio: false });
      map.radio = await radio;
      worker.terminate();
      return map;
    })();
    runtimeCache.set(key, p);
  }
  return p;
}

export interface LoadedScenario {
  scenario: ScenarioDef;
  map: MapRuntime;
  attribution: HakoniwaBundle['attribution'];
}

export async function loadEntry(e: ScenarioIndexEntry): Promise<LoadedScenario> {
  if (e.bundle) {
    const b = await loadBundleFile(e.bundle);
    return { scenario: b.scenario, map: await buildRuntime(b.map), attribution: b.attribution };
  }
  const scenario = await loadScenarioFile(e.file ?? `${e.id}.json`);
  const map = await buildRuntime(await loadMapDef(scenario.mapId));
  return { scenario, map, attribution: [] };
}
