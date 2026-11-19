// tools 用: public/scenarios の一覧・シナリオ・マップを読み、MapRuntime をキャッシュする
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMapRuntime } from '../../src/sim/terrain/map';
import type { HakoniwaBundle, MapDef, MapRuntime, ScenarioDef, ScenarioIndexEntry } from '../../src/sim/types';
import { loadMapDef, ROOT } from './maps';

export function loadIndex(): ScenarioIndexEntry[] {
  return JSON.parse(readFileSync(resolve(ROOT, 'public', 'scenarios', 'index.json'), 'utf8')) as ScenarioIndexEntry[];
}

export function loadScenarioById(id: string): ScenarioDef {
  const e = loadIndex().find((x) => x.id === id);
  const file = e?.file ?? `${id}.json`;
  return JSON.parse(readFileSync(resolve(ROOT, 'public', 'scenarios', file), 'utf8')) as ScenarioDef;
}

const maps = new Map<string, MapRuntime>();

export function mapRuntimeFor(mapId: string): MapRuntime {
  let m = maps.get(mapId);
  if (!m) {
    const def: MapDef = loadMapDef(mapId);
    m = buildMapRuntime(def).map;
    maps.set(mapId, m);
  }
  return m;
}

/**
 * 一覧の項目からシナリオとマップを読む。バンドル（実地形）は、ファイルがなければ null（npm run make:s05 などで作る。リポジトリには含めない）。
 * バンドルの中のシナリオではなく、public/scenarios/<id> の元の JSON があればそちらを使う（シナリオを直したあとにバンドルを作り直さなくてよい）
 */
export function loadEntryRuntime(e: ScenarioIndexEntry): { scenario: ScenarioDef; map: MapRuntime } | null {
  if (!e.bundle) {
    const s = loadScenarioById(e.id);
    return { scenario: s, map: mapRuntimeFor(s.mapId) };
  }
  const file = resolve(ROOT, 'public', 'scenarios', e.bundle);
  if (!existsSync(file)) return null;
  const b = JSON.parse(readFileSync(file, 'utf8')) as HakoniwaBundle;
  let m = maps.get(`bundle:${e.id}`);
  if (!m) {
    m = buildMapRuntime(b.map).map;
    maps.set(`bundle:${e.id}`, m);
  }
  const src = resolve(ROOT, 'public', 'scenarios', e.bundle.replace(/\.hakoniwa\.json$/, '.json'));
  const scenario = existsSync(src) ? { ...(JSON.parse(readFileSync(src, 'utf8')) as ScenarioDef), mapId: b.map.id } : b.scenario;
  return { scenario, map: m };
}
