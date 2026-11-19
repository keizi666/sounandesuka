/**
 * 沢の水を飲む（ユーザーの指摘: 沢にいて「沢で水は飲める」と言っているのに、水分が減り続けていた）
 */
import { describe, expect, it } from 'vitest';
import { stepWorld } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { vertexX, vertexZ, sampleElev } from '../src/sim/terrain/sample';
import { hakoniwa } from './helpers/map';
import { loadScenario } from './helpers/scenario';

describe('沢の水', () => {
  it('沢に手が届く所にいれば、のどの渇きが減り、水筒も満たされる', () => {
    const { map } = hakoniwa();
    const s = structuredClone(loadScenario('s01_cold_front'));
    s.choices = [];
    s.events = [];
    s.party = [s.party[0]!];
    const w = createWorld(map, s);
    const ctx = createStaticContext(map, s);
    const c = w.climbers[0]!;
    const i = map.stream.findIndex((v) => v === 1);
    expect(i).toBeGreaterThanOrEqual(0);
    c.x = vertexX(map, i % map.n);
    c.z = vertexZ(map, Math.floor(i / map.n));
    c.elevM = sampleElev(map, c.x, c.z);
    c.pos = { mode: 'free', x: c.x, z: c.z };
    c.state = 'STAYING';
    c.body.waterDeficitL = 3;
    c.inv.waterL = 0;
    for (let k = 0; k < 360; k += 1) stepWorld(w, ctx); // 1 時間
    expect(c.body.waterDeficitL).toBeLessThan(2);
    expect(c.inv.waterL).toBeGreaterThan(0.5);
  });
});
