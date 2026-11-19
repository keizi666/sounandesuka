// テスト用: 箱庭岳の MapRuntime を 1 回だけ作って使い回す
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMapRuntime, type BuildMapResult } from '../../src/sim/terrain/map';
import type { MapDef } from '../../src/sim/types';

export function loadSounanDef(): MapDef {
  const path = resolve(import.meta.dirname, '..', '..', 'public', 'maps', 'sounan.json');
  return JSON.parse(readFileSync(path, 'utf8')) as MapDef;
}

let cached: (BuildMapResult & { ms: number }) | null = null;

export function sounanMap(): BuildMapResult & { ms: number } {
  if (!cached) {
    const t0 = performance.now();
    const r = buildMapRuntime(loadSounanDef());
    cached = { ...r, ms: performance.now() - t0 };
  }
  return cached;
}
