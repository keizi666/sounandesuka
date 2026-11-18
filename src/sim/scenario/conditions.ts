/**
 * 条件 DSL の評価（docs/09 §4）。eval は使わない。
 * event・atNode は「直前のティックに出たイベント」（world.recentEvents）で判定する（DECISIONS）。
 * chance は初めて評価されたときに events ストリームで 1 回だけ抽選し、key ごとに結果を固定する。
 */
import { parseTimeRef } from '../core/clock';
import { nextFloat } from '../core/rng';
import type { Condition } from '../types';
import { resolveVar, type VarScope, type VarValue } from './vars';

function compare(a: VarValue | undefined, op: string, b: VarValue): boolean {
  if (a === undefined) return false;
  switch (op) {
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    case '<':
      return typeof a === 'number' && typeof b === 'number' && a < b;
    case '<=':
      return typeof a === 'number' && typeof b === 'number' && a <= b;
    case '>':
      return typeof a === 'number' && typeof b === 'number' && a > b;
    case '>=':
      return typeof a === 'number' && typeof b === 'number' && a >= b;
    default:
      return false;
  }
}

/**
 * 条件を評価する。key は定義の位置（"choices[2].trigger" など）で、chance の結果の保存に使う。
 * all / any は左から評価し、結果が決まった時点で打ち切る（chance の抽選順を決定論的にするため）。
 */
export function evalCondition(cond: Condition, scope: VarScope, key: string): boolean {
  const w = scope.world;
  if ('all' in cond) {
    for (let i = 0; i < cond.all.length; i += 1) if (!evalCondition(cond.all[i]!, scope, `${key}.all[${i}]`)) return false;
    return true;
  }
  if ('any' in cond) {
    for (let i = 0; i < cond.any.length; i += 1) if (evalCondition(cond.any[i]!, scope, `${key}.any[${i}]`)) return true;
    return false;
  }
  if ('not' in cond) return !evalCondition(cond.not, scope, `${key}.not`);
  if ('var' in cond) return compare(resolveVar(cond.var, scope), cond.op, cond.value);
  if ('after' in cond) return w.tMin >= parseTimeRef(cond.after);
  if ('before' in cond) return w.tMin < parseTimeRef(cond.before);
  if ('atNode' in cond) {
    return w.recentEvents.some((e) => e.type === 'NODE_ARRIVE' && e.climberId === scope.leader.id && e.node === cond.atNode);
  }
  if ('beenAt' in cond) return w.visitedNodes[cond.beenAt] !== undefined;
  if ('onEdge' in cond) return scope.leader.pos.mode === 'edge' && scope.leader.pos.edgeId === cond.onEdge;
  if ('near' in cond) {
    const dx = scope.leader.x - cond.near.x;
    const dz = scope.leader.z - cond.near.z;
    return dx * dx + dz * dz <= cond.near.r * cond.near.r;
  }
  if ('state' in cond) return scope.leader.state === cond.state;
  if ('flag' in cond) return w.flags[cond.flag] !== undefined;
  if ('chose' in cond) return w.decisions.some((d) => d.cpId === cond.chose.cp && d.optionId === cond.chose.option);
  if ('event' in cond) return w.recentEvents.some((e) => e.type === cond.event);
  if ('chance' in cond) {
    let r = w.chanceResults[key];
    if (r === undefined) {
      r = nextFloat(w.rng.events) < cond.chance;
      w.chanceResults[key] = r;
    }
    return r;
  }
  if ('elapsedSince' in cond) {
    const at = w.flags[cond.elapsedSince.flag];
    return at !== undefined && w.tMin - at >= cond.elapsedSince.min;
  }
  return false;
}
