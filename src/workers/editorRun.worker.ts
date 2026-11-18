/// <reference lib="webworker" />
/**
 * エディターの試走用 Worker（docs/18 §6）。1 回の試走（記録とログつき）と、まとめて試す（モンテカルロの 1 回ごとの結果を返す）。
 * まとめて試すときは本体が 2 本の Worker に偶数番・奇数番を振り分け、結果を合わせる（順に回したときと同じ集計になる）。
 */
import { deriveSeed } from '../sim/core/rng';
import { runHeadless } from '../sim/headless';
import { buildMapRuntime } from '../sim/terrain/map';
import type { EndingKind, MapDef, MapRuntime, PolicyName, RunRecord, ScenarioDef, SimEvent } from '../sim/types';

export type RunIn =
  | { type: 'init'; map: MapDef; radio: Float32Array; scenario: ScenarioDef }
  | { type: 'run'; policy: PolicyName; seed: number }
  | { type: 'mc'; policy: PolicyName; indices: number[]; seedBase: number };

export interface McRun {
  i: number;
  kind: EndingKind;
  minCoreC: number;
  wasLost: boolean;
  deaths: number;
  causes: string[];
  decisions: { cpId: string; optionId: string }[];
}

export type RunOut =
  | { type: 'run'; ending: { kind: EndingKind; title: string | null; text: string | null }; record: RunRecord; events: SimEvent[]; ms: number; finalStates: { id: string; state: string }[] }
  | { type: 'mcProgress'; done: number }
  | { type: 'mc'; runs: McRun[]; ms: number }
  | { type: 'error'; message: string };

let map: MapRuntime | null = null;
let scenario: ScenarioDef | null = null;
const post = (m: RunOut): void => (self as unknown as Worker).postMessage(m);

self.onmessage = (ev: MessageEvent<RunIn>) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      map = buildMapRuntime(m.map, { radio: false }).map;
      map.radio = m.radio;
      scenario = m.scenario;
      return;
    }
    if (!map || !scenario) throw new Error('init されていません');
    const t0 = performance.now();
    if (m.type === 'run') {
      const r = runHeadless(map, scenario, { policy: m.policy, seed: m.seed, collectEvents: true });
      post({ type: 'run', ending: { kind: r.ending.kind, title: r.ending.title, text: r.ending.text }, record: r.record!, events: r.events, ms: performance.now() - t0, finalStates: r.world.climbers.map((c) => ({ id: c.id, state: c.state })) });
      return;
    }
    const runs: McRun[] = [];
    m.indices.forEach((i, k) => {
      const r = runHeadless(map!, scenario!, { policy: m.policy, seed: deriveSeed(m.seedBase, i) });
      const dead = r.world.climbers.filter((c) => !c.body.alive);
      runs.push({ i, kind: r.ending.kind, minCoreC: r.record!.stats.minCoreC, wasLost: r.record!.stats.wasLost, deaths: dead.length, causes: dead.map((c) => c.body.deathCause ?? 'unknown'), decisions: r.world.decisions.map((d) => ({ cpId: d.cpId, optionId: d.optionId })) });
      if (k % 5 === 4) post({ type: 'mcProgress', done: k + 1 });
    });
    post({ type: 'mc', runs, ms: performance.now() - t0 });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
