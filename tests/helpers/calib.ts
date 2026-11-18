// 生理の較正（docs/06 §9）用: 地形も気象モデルも通さず、固定の熱環境で体だけを積分する
import { computeJ, computeM } from '../../src/sim/climber/capacity';
import { walkMet } from '../../src/sim/climber/movement';
import { integrateBody, type ThermalEnv } from '../../src/sim/climber/physiology';
import { createClimberState } from '../../src/sim/core/world';
import { TUNING, type Tuning } from '../../src/sim/tuning';
import type { BehaviorState, ClimberBody, ClimberDef, ClimberState, MapRuntime } from '../../src/sim/types';
import { standardClimber, testScenario } from './scenario';

export interface CalibConfig {
  hours: number;
  env: Partial<ThermalEnv>;
  def?: Partial<ClimberDef>;
  gear?: Partial<ClimberDef['gear']>;
  body?: Partial<ClimberBody>;
  state?: BehaviorState;
  /** 歩行（速さ m/s・勾配）。なければ metAct で静止 */
  walk?: { speedMs: number; grade: number };
  metAct?: number;
  /** 90 分ごとに 300 kcal 食べる（標準体の条件） */
  feed?: boolean;
  /** 区間ごとに条件を変える（時間順） */
  phases?: { untilH: number; walk?: { speedMs: number; grade: number }; metAct?: number; state?: BehaviorState }[];
  tuning?: Tuning;
}

export interface Sample {
  h: number;
  coreC: number;
  wetness: number;
  glycogenKcal: number;
  waterDeficitL: number;
  stage: ClimberBody['stage'];
}

const STUB_MAP = { nodes: { A: { id: 'A', name: 'A', type: 'junction', x: 0, z: 0, elevM: 0 } } } as unknown as MapRuntime;

export function calibClimber(cfg: CalibConfig): ClimberState {
  const base = standardClimber();
  const def: ClimberDef = { ...base, ...cfg.def, gear: { ...base.gear, ...cfg.gear } };
  const c = createClimberState(def, testScenario(['A', 'A']), STUB_MAP, 0, 'party');
  Object.assign(c.body, cfg.body);
  c.state = cfg.state ?? 'WALKING';
  return c;
}

export function runCalib(cfg: CalibConfig): { samples: Sample[]; climber: ClimberState } {
  const tuning = cfg.tuning ?? TUNING;
  const c = calibClimber(cfg);
  const dtMin = 1 / 6;
  const steps = Math.round((cfg.hours * 60) / dtMin);
  const samples: Sample[] = [];
  const envBase: ThermalEnv = {
    tairC: 15,
    windMs: 0,
    walkSpeedMs: 0,
    precipMmH: 0,
    precipType: 'none',
    solarW: 0,
    extraClo: 0,
    wetInputF: 1,
    condensePerH: 0,
    forcedDryPerH: 0,
    groundContact: false,
    groundTempC: 10,
    staffed: false,
    ...cfg.env,
  };
  for (let i = 0; i <= steps; i += 1) {
    const tMin = i * dtMin;
    if (i % 6 === 0) {
      samples.push({
        h: tMin / 60,
        coreC: c.body.coreC,
        wetness: c.body.wetness,
        glycogenKcal: c.body.glycogenKcal,
        waterDeficitL: c.body.waterDeficitL,
        stage: c.body.stage,
      });
    }
    if (i === steps) break;
    if (cfg.feed && i % (90 * 6) === 0 && i > 0) c.body.gutKcal += 300;
    const ph = cfg.phases?.find((p) => tMin / 60 < p.untilH);
    const walk = ph ? ph.walk : cfg.walk;
    const met0 = ph ? ph.metAct : cfg.metAct;
    if (ph?.state) c.state = ph.state;
    const env = { ...envBase, walkSpeedMs: walk ? walk.speedMs : 0 };
    const metAct = walk ? walkMet(walk.speedMs, walk.grade, c.def, env.windMs, tuning) : (met0 ?? 1.4);
    integrateBody(c, env, { metAct, grade: walk?.grade ?? 0, walking: walk !== undefined }, dtMin, tuning);
    c.body.conscious = c.body.coreC >= tuning.physiology.unconsciousBelowC;
    c.J = computeJ(c, tuning);
    c.M = computeM(c, tuning);
  }
  return { samples, climber: c };
}

/** 初めて threshold を下回った時刻（時間）。下回らなければ Infinity */
export function hoursUntilBelow(samples: readonly Sample[], threshold: number): number {
  const s = samples.find((x) => x.coreC < threshold);
  return s ? s.h : Infinity;
}

export function hoursUntilAbove(samples: readonly Sample[], threshold: number): number {
  const s = samples.find((x) => x.coreC >= threshold);
  return s ? s.h : Infinity;
}

/** 3 km/h（m/s） */
export const WALK_3KMH = 3 / 3.6;
