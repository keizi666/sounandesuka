import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stepWorld } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { runHeadless } from '../src/sim/headless';
import { autoResolve, checkChoices, evaluateOptions, findChoicePoint, resolveChoice } from '../src/sim/scenario/choices';
import { validateMap, validateScenario } from '../src/sim/scenario/validate';
import { pickByBias } from '../src/sim/policy';
import type { PolicyName, ScenarioDef } from '../src/sim/types';
import { hakoniwa, loadHakoniwaDef } from './helpers/map';
import { loadScenario } from './helpers/scenario';

const IDS = ['s01_cold_front', 's02_fog_descent', 's03_thunder_ridge'];

describe('検証（docs/09 §13、P5 の受け入れ）', () => {
  it('3 シナリオと箱庭岳マップにエラーがない', () => {
    const map = loadHakoniwaDef();
    expect(validateMap(map).filter((i) => i.level === 'error')).toEqual([]);
    for (const id of IDS) expect(validateScenario(loadScenario(id), map).filter((i) => i.level === 'error'), id).toEqual([]);
  });

  it('わざと壊した JSON で期待どおりのエラーパスが出る', () => {
    const dir = resolve(import.meta.dirname, 'fixtures', 'broken');
    const expected: Record<string, string> = {
      'undefined_node.json': 'choices[1].options[1].actions[0].node',
      'bad_timeref.json': 'startAt',
      'unknown_var.json': 'choices[0].trigger.var',
      'route_gap.json': 'plan.route[1]',
      'undefined_choice.json': 'lessons[0].when.chose.cp',
      'no_recommended.json': 'choices[2].options',
      'no_leader.json': 'party',
      'keyframe_order.json': 'weather.keyframes[3].at',
      'bad_placeholder.json': 'choices[0].situation',
    };
    expect(readdirSync(dir).sort()).toEqual(Object.keys(expected).sort());
    const map = loadHakoniwaDef();
    for (const [f, path] of Object.entries(expected)) {
      const s = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as ScenarioDef;
      const errs = validateScenario(s, map).filter((i) => i.level === 'error');
      expect(errs.map((e) => e.path), f).toEqual([path]);
    }
  });
});

describe('分岐点（docs/09 §5）', () => {
  it('s01: 出発時に cp_start が発火し、選ぶとアクションとフラグが適用される', () => {
    const { map } = hakoniwa();
    const sc = loadScenario('s01_cold_front');
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc, { mode: 'interactive' });
    stepWorld(w, ctx);
    expect(w.pendingChoice?.cpId).toBe('cp_start');
    const t = w.tMin;
    stepWorld(w, ctx); // 回答待ちの間は時間が進まない
    expect(w.tMin).toBe(t);
    resolveChoice(w, ctx, 'rule', 'user');
    expect(w.flags['turnaroundRule']).toBeDefined();
    expect(w.decisions).toEqual([{ cpId: 'cp_start', optionId: 'rule', tMin: t, by: 'user' }]);
    stepWorld(w, ctx);
    expect(w.tMin).toBeGreaterThan(t);
  });

  it('abortTrip で ABORTED になる', () => {
    const { map } = hakoniwa();
    const sc = loadScenario('s01_cold_front');
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc, { mode: 'interactive' });
    stepWorld(w, ctx);
    resolveChoice(w, ctx, 'abort', 'user');
    expect(w.ended?.kind).toBe('ABORTED');
  });

  it('自律バイアスは mods を足した重みに比例する（10,000 回で ±3%）', () => {
    const { map } = hakoniwa();
    const sc = loadScenario('s01_cold_front');
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    const cp = findChoicePoint(ctx, 'cp_start')!;
    const { available } = evaluateOptions(w, ctx, cp.cp, cp.key);
    // 村井 riskTolerance 0.6 > 0.5 → go は 1.0 + 0.6
    expect(available.map((o) => o.weight)).toEqual([1.6, 0.5, 0.1]);
    const n = 10_000;
    const count: Record<string, number> = {};
    for (let i = 0; i < n; i += 1) {
      const id = pickByBias(w, available).id;
      count[id] = (count[id] ?? 0) + 1;
    }
    expect(Math.abs(count['go']! / n - 1.6 / 2.2)).toBeLessThan(0.03);
    expect(Math.abs(count['rule']! / n - 0.5 / 2.2)).toBeLessThan(0.03);
  });

  it('available を満たさない選択肢は自動選択されない（電波のない所で救助要請しない）', () => {
    const { map } = hakoniwa();
    const sc = loadScenario('s01_cold_front');
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc, { policy: 'recommended' });
    const leader = w.climbers[0]!;
    // 電波のない谷（魚止ノ滝付近）に置く
    leader.x = -1200;
    leader.z = -575;
    const cp = findChoicePoint(ctx, 'cp_cold')!;
    const { available, unavailable } = evaluateOptions(w, ctx, cp.cp, cp.key);
    expect(unavailable).toEqual(['call']);
    w.pendingChoice = { cpId: 'cp_cold', firedAtMin: w.tMin, realDeadlineMs: null };
    expect(autoResolve(w, ctx, 'policy')).toBe('bivy');
    expect(available.map((o) => o.option.id)).toEqual(['bivy', 'push']);
  });

  it('priority の高い分岐点が先に発火する', () => {
    const { map } = hakoniwa();
    const base = loadScenario('s01_cold_front');
    const sc: ScenarioDef = {
      ...base,
      choices: [
        { ...base.choices[1]!, id: 'low', trigger: { after: 'D0 05:00' }, priority: 1 },
        { ...base.choices[1]!, id: 'high', trigger: { after: 'D0 05:00' }, priority: 50 },
      ],
    };
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc, { mode: 'interactive' });
    stepWorld(w, ctx);
    expect(w.pendingChoice?.cpId).toBe('high');
    expect(checkChoices(w, ctx)).toBe(false); // 回答待ちの間は発火しない
  });
});

describe('通し実行（P5 の受け入れ、docs/14 scenarios.test）', () => {
  const { map } = hakoniwa();
  for (const id of IDS) {
    for (const policy of ['recommended', 'bias', 'random', 'risky'] as PolicyName[]) {
      it(`${id} を ${policy} で結末まで例外なく走る`, () => {
        const r = runHeadless(map, loadScenario(id), { policy });
        expect(r.world.ended).not.toBeNull();
        expect(r.ending.kind).toBeTruthy();
      });
    }
  }

  it('推奨方針の s01 は無事に帰る（引き返す）', () => {
    const r = runHeadless(map, loadScenario('s01_cold_front'), { policy: 'recommended' });
    expect(r.ending.kind).toBe('SAFE_RETURN');
    expect(r.world.decisions.map((d) => d.cpId)).toContain('cp_eboshi');
  });

  it('同じシード・方針なら結果が同じ（決定論）', () => {
    const a = runHeadless(map, loadScenario('s02_fog_descent'), { policy: 'random', seed: 7 });
    const b = runHeadless(map, loadScenario('s02_fog_descent'), { policy: 'random', seed: 7 });
    expect(JSON.stringify(b.world)).toBe(JSON.stringify(a.world));
  });

  it('2 人のパーティは一緒に歩き、全員が下山して終わる', () => {
    const r = runHeadless(map, loadScenario('s02_fog_descent'), { policy: 'recommended' });
    const [a, b] = r.world.climbers;
    expect(a!.state).toBe('FINISHED');
    expect(b!.state).toBe('FINISHED');
    expect([a!.x, a!.z]).toEqual([b!.x, b!.z]);
  });
});
