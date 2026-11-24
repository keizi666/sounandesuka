/** 列をなして歩くほかの登山者（見た目だけ。scenario.crowds）の検証 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateScenario } from '../src/sim/scenario/validate';
import type { ScenarioDef, SounanBundle } from '../src/sim/types';

const bundlePath = 'public/scenarios/real/s26_fuji_ams.sounan.json';
let bundle: SounanBundle | null = null;
try {
  bundle = JSON.parse(readFileSync(bundlePath, 'utf8')) as SounanBundle;
} catch {
  bundle = null; // 実在の地形データは git に入れていない
}
const s26 = JSON.parse(readFileSync('public/scenarios/real/s26_fuji_ams.json', 'utf8')) as ScenarioDef;

describe.skipIf(!bundle)('crowds の検証', () => {
  it('s26 の列（夜の登り・ご来光の前・下り・昼の登り）は通る', () => {
    expect(s26.crowds?.length).toBeGreaterThan(0);
    const errs = validateScenario({ ...s26, mapId: bundle!.map.id }, bundle!.map).filter((x) => x.level === 'error');
    expect(errs).toEqual([]);
  });
  it('ない地点・書式の違う時刻・0 人はエラー', () => {
    const bad = { ...s26, mapId: bundle!.map.id, crowds: [{ from: 'NOPE', to: 'SANCHO', start: '2:5', end: '25:00', perHour: 0 }] };
    const codes = validateScenario(bad, bundle!.map).filter((x) => x.path.startsWith('crowds')).map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['undefinedNode', 'badTime', 'range']));
  });
});
