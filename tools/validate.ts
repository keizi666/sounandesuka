// npm run validate — public/maps と public/scenarios の JSON を検証する（docs/09 §13）
//   npm run validate [-- <file.json> ...]   ファイルを指定するとそれだけを検証する（テスト用の壊れた JSON など）
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { formatIssue, validateMap, validateScenario, type Issue } from '../src/sim/scenario/validate';
import { checkChoosers } from '../src/sim/scenario/validateChooser';
import type { MapDef, ScenarioDef } from '../src/sim/types';
import { ROOT } from './lib/maps';

interface Result {
  errors: number;
  warnings: number;
}

function report(file: string, issues: Issue[], acc: Result): void {
  for (const i of issues) {
    const line = formatIssue(file, i);
    if (i.level === 'error') {
      acc.errors += 1;
      console.error(`✖ ${line}`);
    } else {
      acc.warnings += 1;
      console.warn(`⚠ ${line}`);
    }
  }
}

function readJson(path: string, acc: Result): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    acc.errors += 1;
    console.error(`✖ ${basename(path)}: JSON として読めません: ${(e as Error).message}`);
    return null;
  }
}

function loadMaps(acc: Result): Map<string, MapDef> {
  const dir = resolve(ROOT, 'public', 'maps');
  const maps = new Map<string, MapDef>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const def = readJson(resolve(dir, f), acc) as MapDef | null;
    if (!def) continue;
    report(f, validateMap(def), acc);
    maps.set(def.id, def);
  }
  return maps;
}

function validateScenarioFile(path: string, maps: Map<string, MapDef>, acc: Result): void {
  const s = readJson(path, acc) as ScenarioDef | null;
  if (!s) return;
  const map = maps.get(s.mapId) ?? null;
  const issues = validateScenario(s, map);
  if (!map) issues.unshift({ level: 'error', path: 'mapId', code: 'undefinedMap', message: `マップ "${s.mapId}" が見つかりません` });
  report(basename(path), issues, acc);
}

const acc: Result = { errors: 0, warnings: 0 };
const files = process.argv.slice(2);
const maps = loadMaps(acc);
if (files.length > 0) {
  for (const f of files) validateScenarioFile(resolve(f), maps, acc);
} else {
  const dir = resolve(ROOT, 'public', 'scenarios');
  const index = readJson(resolve(dir, 'index.json'), acc) as { id: string; file?: string; bundle?: string }[] | null;
  for (const e of index ?? []) {
    if (e.file) validateScenarioFile(resolve(dir, e.file), maps, acc);
    // 実在の山（バンドル）は地形がバンドルの中にあるので、地形を使わない検査（分岐点の選ぶ人）だけをする
    else if (e.bundle) {
      const p = resolve(dir, e.bundle.replace(/\.sounan\.json$/, '.json'));
      const s = existsSync(p) ? (readJson(p, acc) as ScenarioDef | null) : null;
      if (s) report(basename(p), checkChoosers(s).map((c) => ({ level: 'warning', path: c.path, code: 'chooser', message: c.message })), acc);
    }
  }
  // 史実シナリオ（historical/）はスケルトンマップを実地形に結合してから検証する（P19）
}
console.log(`validate: エラー ${acc.errors}、警告 ${acc.warnings}`);
process.exit(acc.errors > 0 ? 1 : 0);
