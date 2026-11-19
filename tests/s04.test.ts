/**
 * 史実シナリオ s04（docs/13 P19）。骨組みの検証は常に行い、実地形での試走は、npm run make:s04 で作ったバンドルがあるときだけ行う
 * （バンドルは地理院の標高・OSM 由来のためリポジトリに含めない）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runHeadless } from '../src/sim/headless';
import { validateScenario } from '../src/sim/scenario/validate';
import { buildMapRuntime } from '../src/sim/terrain/map';
import { classify } from '../src/sim/climber/speech';
import type { SounanBundle, MapDef, ScenarioDef } from '../src/sim/types';

const root = resolve(import.meta.dirname, '..');
const scenario = JSON.parse(readFileSync(resolve(root, 'public/scenarios/historical/s04_tomuraushi_2009.json'), 'utf8')) as ScenarioDef;
const skeleton = JSON.parse(readFileSync(resolve(root, 'public/maps/historical/tomuraushi.skeleton.json'), 'utf8')) as MapDef;
const bundleFile = resolve(root, 'public/scenarios/historical/s04_tomuraushi_2009.sounan.json');

describe('s04（史実シナリオ）', () => {
  it('スケルトンマップに対して検証エラーがない', () => {
    expect(validateScenario(scenario, { ...skeleton, id: scenario.mapId }).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('人物は記号で表記し、19 人・グループ定義・記録の選択・注記がある', () => {
    expect(scenario.party).toHaveLength(19);
    expect(scenario.groups?.[0]).toMatchObject({ id: 'main', members: 'all' });
    expect(scenario.historical?.disclaimer.length).toBeGreaterThan(20);
    expect(Object.keys(scenario.historical?.recordedChoices ?? {}).length).toBeGreaterThan(5);
    for (const p of scenario.party) expect(p.name).toMatch(/^(リーダー|ガイド|シェルパ|女性客|男性客)[A-Z]$/);
  });
  it('史実シナリオのセリフは、記録（出典つき）以外すべて架空として扱う', () => {
    expect(classify({}, scenario)).toBe('fictional');
    expect(classify({ documented: true, source: '報告書' }, scenario)).toBe('documented');
  });
  it.skipIf(!existsSync(bundleFile))('実地形のバンドル: 記録どおりの方針で最後まで走り、推奨の方針では誰も亡くならない', { timeout: 120000 }, () => {
    const b = JSON.parse(readFileSync(bundleFile, 'utf8')) as SounanBundle;
    const rt = buildMapRuntime(b.map).map;
    const r = runHeadless(rt, b.scenario, { policy: 'historical', seed: 3, collectEvents: true });
    expect(r.world.ended).not.toBeNull();
    expect(r.world.climbers).toHaveLength(19);
    const r2 = runHeadless(rt, b.scenario, { policy: 'recommended', seed: 3 });
    expect(r2.world.climbers.every((c) => c.body.alive)).toBe(true);
  });
});
