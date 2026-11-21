/**
 * 実在の山のシナリオ（public/scenarios/real/*.json）を、作り方（*.build.json）が指すスケルトンマップに対して検証する。
 * 実地形のバンドルがあれば、推奨の方針で 1 回走らせ、誰も亡くならないことを確かめる（バンドルはリポジトリに含めない）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runHeadless } from '../src/sim/headless';
import { validateScenario } from '../src/sim/scenario/validate';
import { buildMapRuntime } from '../src/sim/terrain/map';
import type { SounanBundle, MapDef, ScenarioDef } from '../src/sim/types';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'public/scenarios/real');
const ids = readdirSync(dir).filter((f) => f.endsWith('.build.json')).map((f) => f.replace(/\.build\.json$/, ''));
const index = JSON.parse(readFileSync(resolve(root, 'public/scenarios/index.json'), 'utf8')) as { id: string }[];
/** 作り終えたが、ユーザーが確かめてから一覧に載せるシナリオ（載せたらここから外す） */
const UNLISTED = new Set<string>([]);

describe.each(ids)('実在の山のシナリオ %s', (id) => {
  const spec = JSON.parse(readFileSync(resolve(dir, `${id}.build.json`), 'utf8')) as { skeleton: string; mapId: string };
  const scenario = JSON.parse(readFileSync(resolve(dir, `${id}.json`), 'utf8')) as ScenarioDef;
  const skeleton = JSON.parse(readFileSync(resolve(root, spec.skeleton), 'utf8')) as MapDef;
  it('スケルトンマップに対して検証エラーがなく、一覧に載っている（確認待ちのものは載っていない）', () => {
    expect(validateScenario(scenario, { ...skeleton, id: scenario.mapId }).filter((i) => i.level === 'error')).toEqual([]);
    expect(scenario.region?.real).toBe(true);
    expect(index.some((e) => e.id === id)).toBe(!UNLISTED.has(id));
  });
  const bundleFile = resolve(dir, `${id}.sounan.json`);
  it.skipIf(!existsSync(bundleFile))('実地形: 推奨の方針では誰も亡くならない', { timeout: 120000 }, () => {
    const b = JSON.parse(readFileSync(bundleFile, 'utf8')) as SounanBundle;
    const rt = buildMapRuntime(b.map).map;
    const r = runHeadless(rt, { ...scenario, mapId: b.map.id }, { policy: 'recommended', seed: 2 });
    expect(r.world.ended).not.toBeNull();
    expect(r.world.climbers.every((c) => c.body.alive)).toBe(true);
  });
});
