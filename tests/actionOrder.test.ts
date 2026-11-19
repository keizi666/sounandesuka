/**
 * アクション列の並びと、話の筋が位置と食い違わないための仕組み（休む → 進む、地図の外へ、離れた人を対象にしない、着いたら通報）
 */
import { describe, expect, it } from 'vitest';
import { applyActions } from '../src/sim/climber/actions';
import { stepWorld } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { validateScenario } from '../src/sim/scenario/validate';
import type { ScenarioDef } from '../src/sim/types';
import { sounanMap } from './helpers/map';
import { loadScenario } from './helpers/scenario';

function party3(): ScenarioDef {
  const s = structuredClone(loadScenario('s03_thunder_ridge'));
  s.choices = [];
  s.events = [];
  s.speech = [];
  s.thoughts = [];
  return s;
}

describe('アクションの並び', () => {
  const { map } = sounanMap();

  it('「休む → 進む」は、休み終えてから進む（休みを打ち消さない）', () => {
    const s = party3();
    const w = createWorld(map, s);
    const ctx = createStaticContext(map, s);
    const [a] = w.climbers;
    applyActions(w, ctx, [{ type: 'rest', minutes: 12 }, { type: 'continueRoute' }], w.climbers, a!);
    expect(a!.state).toBe('RESTING');
    const x0 = a!.x;
    for (let i = 0; i < 6 * 10; i += 1) stepWorld(w, ctx); // 10 分
    expect(a!.x).toBe(x0);
    for (let i = 0; i < 6 * 6; i += 1) stepWorld(w, ctx); // さらに 6 分
    expect(a!.state).toBe('WALKING');
  });

  it('detach で離れた人は、同じ列の後のアクション（who なし）の対象にならない', () => {
    const s = party3();
    const w = createWorld(map, s);
    const ctx = createStaticContext(map, s);
    const [a, b] = w.climbers;
    applyActions(w, ctx, [{ type: 'detach', who: b!.id, then: [{ type: 'continueRoute' }] }, { type: 'rest', minutes: 30 }], w.climbers, a!);
    expect(a!.state).toBe('RESTING');
    expect(b!.state).toBe('WALKING');
  });

  it('leaveMap: 下山した人だけが地図の外へ移る。山の中の人は消さない', () => {
    const s = party3();
    const w = createWorld(map, s);
    const ctx = createStaticContext(map, s);
    const [a, b] = w.climbers;
    applyActions(w, ctx, [{ type: 'leaveMap', who: a!.id, place: '駅' }], w.climbers, a!);
    expect(a!.offMap).toBeUndefined();
    b!.state = 'FINISHED';
    applyActions(w, ctx, [{ type: 'leaveMap', who: b!.id, place: '駅' }], w.climbers, a!);
    expect(b!.offMap).toBe('駅');
    expect(JSON.parse(JSON.stringify(w)).climbers[1].offMap).toBe('駅');
  });

  it('sound / music: 何人いても 1 回だけ出来事を出す。未知の ID は検証で弾く', () => {
    const s = party3();
    const w = createWorld(map, s);
    const ctx = createStaticContext(map, s);
    applyActions(w, ctx, [{ type: 'sound', who: 'all', id: 'phone' }, { type: 'music', id: null }], w.climbers, w.climbers[0]!);
    expect(ctx.events.filter((e) => e.type === 'SOUND')).toHaveLength(1);
    expect(ctx.events.filter((e) => e.type === 'MUSIC')).toHaveLength(1);
    const bad = structuredClone(s);
    bad.events = [{ id: 'e', trigger: { after: 'D0 10:00' }, once: true, effects: [{ type: 'actions', actions: [{ type: 'sound', id: 'nope' }] }] }];
    bad.music = { play: 'nope' };
    const codes = validateScenario(bad, map.def).map((i) => i.code);
    expect(codes.filter((c) => c === 'unknownSound' || c === 'unknownMusic')).toHaveLength(2);
  });
});
