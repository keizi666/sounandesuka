// tools 用: public/scenarios の一覧・シナリオ・マップを読み、MapRuntime をキャッシュする
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMapRuntime } from '../../src/sim/terrain/map';
import type { MapDef, MapRuntime, ScenarioDef, ScenarioIndexEntry } from '../../src/sim/types';
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
