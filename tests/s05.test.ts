/**
 * 架空遭難シナリオ s05（奥多摩・笙ノ岩山）と、そのために足した仕組み（アルコール・捜索の手がかり・スマホの紛失・雨水）。
 * 実地形での試走は、npm run make:s05 で作ったバンドルがあるときだけ行う（バンドルは地理院の標高・OSM 由来のためリポジトリに含めない）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeJ } from '../src/sim/climber/capacity';
import { bacPct } from '../src/sim/climber/physiology';
import { createWorld } from '../src/sim/core/world';
import { runHeadless } from '../src/sim/headless';
import { validateScenario } from '../src/sim/scenario/validate';
import { buildMapRuntime } from '../src/sim/terrain/map';
import type { HakoniwaBundle, MapDef, ScenarioDef } from '../src/sim/types';
import { hakoniwa } from './helpers/map';
import { loadScenario } from './helpers/scenario';

const root = resolve(import.meta.dirname, '..');
const scenario = JSON.parse(readFileSync(resolve(root, 'public/scenarios/real/s05_shounoiwa.json'), 'utf8')) as ScenarioDef;
const skeleton = JSON.parse(readFileSync(resolve(root, 'public/maps/real/shounoiwa.skeleton.json'), 'utf8')) as MapDef;
const bundleFile = resolve(root, 'public/scenarios/real/s05_shounoiwa.hakoniwa.json');

describe('s05（鳥屋戸尾根の転落）', () => {
  it('スケルトンマップに対して検証エラーがない', () => {
    expect(validateScenario(scenario, { ...skeleton, id: scenario.mapId }).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('実在の山の注記と、原案・地形・登山道の出典がある', () => {
    expect(scenario.region?.real).toBe(true);
    expect(scenario.sources?.some((s) => s.includes('note.com'))).toBe(true);
    expect(scenario.sources?.some((s) => s.includes('OpenStreetMap'))).toBe(true);
  });
  it('計画を出していないので、捜索は手がかり（バス・ノート・広域）しだい', () => {
    expect(scenario.plan.submittedPlan).toBe(false);
    expect(scenario.plan.searchLeads?.map((l) => l.id)).toEqual(['shared', 'bus', 'notebook', 'wide']);
  });
  it.skipIf(!existsSync(bundleFile))('実地形のバンドル: 推奨の方針では無事に下りる。記録に近い方針でも最後まで走る', { timeout: 120000 }, () => {
    const b = JSON.parse(readFileSync(bundleFile, 'utf8')) as HakoniwaBundle;
    const rt = buildMapRuntime(b.map).map;
    const s = { ...scenario, mapId: b.map.id };
    const r = runHeadless(rt, s, { policy: 'recommended', seed: 3 });
    expect(r.ending.kind).toBe('SAFE_RETURN');
    const r2 = runHeadless(rt, s, { policy: 'bias', seed: 3 });
    expect(r2.world.ended).not.toBeNull();
  });
});

describe('アルコール', () => {
  const { map } = hakoniwa();
  const w = createWorld(map, loadScenario('s01_cold_front'));
  const c = w.climbers[0]!;
  it('血中濃度は Widmark の式（g ÷ 体重 × r ÷ 10）', () => {
    c.body.alcoholG = 40;
    expect(bacPct(c)).toBeCloseTo(40 / (c.def.weightKg * 0.68) / 10, 5);
  });
  it('飲むと判断力が下がり、抜ければ戻る', () => {
    c.body.alcoholG = 0;
    const j0 = computeJ(c);
    c.body.alcoholG = 40;
    const j1 = computeJ(c);
    expect(j1).toBeLessThan(j0 * 0.9);
    expect(j1).toBeGreaterThan(j0 * 0.7);
    delete c.body.alcoholG;
    expect(computeJ(c)).toBeCloseTo(j0, 6);
  });
});

describe('捜索の手がかり（searchLeads）の検証', () => {
  it('未定義のノードとつながらないルートはエラー', () => {
    const s = loadScenario('s02_fog_descent');
    const map = JSON.parse(readFileSync(resolve(root, 'public/maps/hakoniwa.json'), 'utf8')) as MapDef;
    s.plan.searchLeads = [
      { id: 'a', at: 'D1 08:00', route: ['TH_SAWA', 'NOWHERE'], text: 'x' },
      { id: 'b', at: 'D1 08:00', route: ['TH_SAWA', 'SUMMIT'], text: 'y' },
    ];
    const errs = validateScenario(s, map).filter((i) => i.level === 'error').map((i) => i.path);
    expect(errs).toContain('plan.searchLeads[0].route[1]');
    expect(errs).toContain('plan.searchLeads[1].route[1]');
  });
});
