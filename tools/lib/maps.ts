// tools 用: public/maps の JSON を読む
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MapDef } from '../../src/sim/types';

export const ROOT = resolve(import.meta.dirname, '..', '..');

export function loadMapDef(id: string): MapDef {
  const path = resolve(ROOT, 'public', 'maps', `${id}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as MapDef;
}
