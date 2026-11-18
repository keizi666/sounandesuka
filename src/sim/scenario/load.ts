/**
 * シナリオの読み込み（docs/03: JSON → 内部表現）。
 * 定義は ScenarioDef のまま使い、既定値の補完と、何度も使う派生値のキャッシュだけをここで行う。
 */
import { parseTimeRef } from '../core/clock';
import { resolveRoute, legCourseTimeMin } from '../terrain/trails';
import type { ChoicePointDef, MapRuntime, ScenarioDef, ScriptEventDef } from '../types';
import { TUNING } from '../tuning';

/** 分岐点の既定値（once: true、priority: 10、timeoutSec: 30） */
export function cpOnce(cp: ChoicePointDef): boolean {
  return cp.once ?? true;
}
export function cpPriority(cp: ChoicePointDef): number {
  return cp.priority ?? TUNING.choices.defaultPriority;
}
export function cpTimeoutSec(cp: ChoicePointDef): number {
  return cp.timeoutSec ?? TUNING.choices.defaultTimeoutSec;
}
export function eventOnce(ev: ScriptEventDef): boolean {
  return ev.once ?? true;
}

/** JSON を ScenarioDef として受け取る（形の検証は validate.ts） */
export function loadScenario(json: unknown): ScenarioDef {
  if (typeof json !== 'object' || json === null) throw new Error('シナリオ JSON がオブジェクトではありません');
  return json as ScenarioDef;
}

const scheduleCache = new WeakMap<ScenarioDef, Record<number, number>>();

/**
 * 計画ルートの各ノードの予定到着時刻（tMin）。コースタイムの比で、出発から plannedFinish までを割り振る。
 * 登山者の「予定との遅れ」（timeBehindMin）に使う。
 */
export function plannedArrivals(map: MapRuntime, scenario: ScenarioDef): Record<number, number> {
  let s = scheduleCache.get(scenario);
  if (!s) {
    s = {};
    const start = parseTimeRef(scenario.startAt);
    const finish = parseTimeRef(scenario.plan.plannedFinish);
    const legs = resolveRoute(map, scenario.plan.route);
    const times = legs.map((l) => legCourseTimeMin(map, l));
    const total = times.reduce((a, b) => a + b, 0);
    let acc = 0;
    s[0] = start;
    times.forEach((t, i) => {
      acc += t;
      s![i + 1] = start + (total > 0 ? ((finish - start) * acc) / total : 0);
    });
    scheduleCache.set(scenario, s);
  }
  return s;
}
