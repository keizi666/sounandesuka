/**
 * World の生成（docs/03 §3）。World はプレーンな JSON 互換オブジェクトだけで作る。
 * 気象・生理などの中身は後のフェーズで更新処理が入る。ここでは初期値をそろえる。
 */
import { initialGroups } from '../climber/groups';
import { TUNING, type Tuning } from '../tuning';
import { eraGear, scenarioYear } from '../scenario/era';
import type {
  ClimberDef,
  ClimberState,
  GlobalWeather,
  LocalWeather,
  MapRuntime,
  PolicyName,
  RunMode,
  ScenarioDef,
  StaticContext,
  World,
} from '../types';
import { createGround } from '../weather/ground';
import { updateGlobal } from '../weather/global';
import { initWeatherMemo } from '../scenario/events';
import { updateClimberLocal } from '../weather/local';
import { sunStateAt, updateSun } from '../weather/sun';
import { parseTimeRef } from './clock';
import { createRngStreams, nextU32 } from './rng';

/** パーティ全体を 1 つのグループとして扱うときの ID（groups の指定がない場合） */
export const DEFAULT_GROUP_ID = 'party';

export function initialLocalWeather(): LocalWeather {
  return {
    tempC: 15,
    windMs: 0,
    windDirDeg: 0,
    precipMmH: 0,
    precipType: 'none',
    visibilityM: 20000,
    windChillC: 15,
    thunder: 0,
    solarW: 0,
    inCloud: false,
  };
}

export function initialGlobalWeather(): GlobalWeather {
  return {
    tempC: 15,
    windMs: 0,
    windDirDeg: 0,
    precipMmH: 0,
    cloudCover: 0,
    cloudBaseM: 5000,
    visibilityM: 20000,
    inCloudVisibilityM: 60,
    thunder: 0,
    pressureHpa: 1013,
    gust: 1,
    noiseSeed: 0,
    cells: [],
    overrides: [],
  };
}

/** 登山者の初期状態。startNode は計画ルートの最初のノード */
export function createClimberState(
  def0: ClimberDef,
  scenario: ScenarioDef,
  map: MapRuntime,
  tMin: number,
  groupId: string | null,
): ClimberState {
  const route = [...scenario.plan.route];
  const startNode = route[0];
  if (startNode === undefined) throw new Error('plan.route が空です');
  const nd = map.nodes[startNode];
  if (!nd) throw new Error(`plan.route[0] のノード "${startNode}" がマップにありません`);
  // シナリオの年代にまだない電子機器は持たない（ユーザーの指定: 1970 年に携帯電話はない）
  const eg = eraGear(def0.gear, scenarioYear(scenario), TUNING);
  const def: ClimberDef = eg === def0.gear ? def0 : { ...def0, gear: eg };
  const ini = def.initial ?? {};
  const g = def.gear;
  return {
    id: def.id,
    def,
    groupId,
    state: 'WALKING',
    stateSinceMin: tMin,
    pos: { mode: 'node', nodeId: startNode },
    x: nd.x,
    z: nd.z,
    elevM: nd.elevM,
    headingRad: 0,
    speedMs: 0,
    trip: { activeMin: 0, distM: 0, upM: 0, downM: 0 },
    metAct: 0,
    body: {
      coreC: ini.coreC ?? 37.0,
      wetness: ini.wetness ?? 0,
      glycogenKcal: ini.glycogenKcal ?? 1500,
      gutKcal: 0,
      waterDeficitL: ini.waterDeficitL ?? 0,
      fatigue: ini.fatigue ?? 0,
      anxiety: 10,
      injury: 'none',
      injuryAtMin: null,
      conscious: true,
      alive: true,
      deathCause: null,
      cloWorn: ini.cloWorn ?? g.cloWorn,
      cloPack: g.cloPack,
      rainwearOn: ini.rainwearOn ?? false,
      rainExposureMin: 0,
      groundInsulation: false,
      coldExtremitiesUntilMin: null,
      inBivy: false,
      shelterNodeId: null,
      leeShelter: 0,
      stage: 'normal',
    },
    // J・M の本計算は P4（capacity.ts）。それまでは体調が万全の値
    J: TUNING.capacity.j0Base + TUNING.capacity.j0PerExperience * def.experience,
    M: 1,
    inv: {
      foodKcal: g.foodKcal,
      waterL: g.waterL,
      phone: { ...g.phone, dead: false, lastCheckMin: null },
      headlamp: { ...g.headlamp, on: false },
      // モバイルバッテリー: 省略はスマホを持つ人なら既定の容量（ユーザーの指定: 既定は 5000 mAh を持つ）
      powerBankPct: powerBankPctOf(g.powerBankMah ?? (g.phone.has ? TUNING.devices.powerBankDefaultMah : 0)),
      charging: false,
    },
    plan: {
      route,
      routeIndex: 1,
      goalNodes: [...scenario.plan.goalNodes],
      restUntilMin: null,
      bivouacUntil: null,
      paceFactor: 1,
      hurry: false,
      stopCheckedNode: null,
      missJunctionNode: null,
      postureUntilMin: null,
      busyUntilMin: null,
      busyWith: null,
      goTo: null,
    },
    perception: {
      routeBelief: null,
      awareLost: false,
      knowsPosition: true,
      knowsPositionAt: null,
      weatherImpression: 'fine',
      timeBehindMin: 0,
      forecast: scenario.briefing.forecast.map((f) => ({ ...f })),
    },
    nav: {
      lastKnownOnRoute: null,
      offrouteSinceMin: null,
      beliefDirRad: null,
      track: [],
      falseEdgeId: null,
      distAccumM: 0,
      path: [],
      trackCheckM: 0,
    },
    local: initialLocalWeather(),
    lastThoughtMin: null,
    thoughtHistory: {},
    memo: { lastEatMin: tMin, lastDrinkMin: tMin, lastPrecipMin: null, clearSinceMin: null, bivouacked: false, sheltered: false, traumaDeathAtMin: null, unconsciousUntilMin: null, atWaterfall: false, trailVanishedAtMin: null, nextThoughtMin: null, walkSinceRestMin: 0 },
  };
}

/** モバイルバッテリーの容量（mAh）を、スマホの何 % 分を充電できるかに直す */
export function powerBankPctOf(mAh: number, t: Tuning = TUNING): number {
  if (!(mAh > 0)) return 0;
  return Math.round(((mAh * t.devices.powerBankEff) / t.devices.phoneBatteryMah) * 100);
}

export function createWorld(map: MapRuntime, scenario: ScenarioDef, seed: number = scenario.seed): World {
  const tMin = parseTimeRef(scenario.startAt);
  const leader = scenario.party.find((p) => p.leader) ?? scenario.party[0];
  if (!leader) throw new Error('party が空です');
  const startNode = scenario.plan.route[0]!;
  const rng = createRngStreams(seed);
  const weather = initialGlobalWeather();
  // 時間ノイズのシードは weather ストリームから 1 回だけ引く
  weather.noiseSeed = nextU32(rng.weather);
  const ig = initialGroups(scenario, DEFAULT_GROUP_ID);
  const world: World = {
    version: 1,
    scenarioId: scenario.id,
    mapId: map.def.id,
    seed,
    tick: 0,
    tMin,
    rng,
    sun: sunStateAt(scenario, tMin, 0),
    weather,
    ground: createGround(scenario.snowpack),
    climbers: scenario.party.map((def) => createClimberState(def, scenario, map, tMin, ig.of[def.id] ?? DEFAULT_GROUP_ID)),
    flags: {},
    firedChoices: [],
    firedEvents: [],
    chanceResults: {},
    decisions: [],
    pendingChoice: null,
    rescue: {
      status: 'none',
      calledAtMin: null,
      via: null,
      locationEstimate: null,
      heli: { readyAtMin: null, nextCheckMin: null, state: 'idle' },
      ground: { readyAtMin: null, x: 0, z: 0, state: 'idle' },
      searchRadiusM: 0,
    },
    visitedNodes: { [startNode]: tMin },
    groups: ig.groups,
    ended: null,
    recentEvents: [],
    weatherMemo: { raining: false, rainStoppedAtMin: null, precipType: 'none', sunUp: false, dark: false },
    latches: {},
  };
  // 開始時点の気象・暗さ・局地気象をそろえる
  const ctx = createStaticContext(map, scenario);
  updateGlobal(world, ctx);
  updateSun(world, ctx);
  updateClimberLocal(world, ctx);
  initWeatherMemo(world, ctx);
  return world;
}

export function createStaticContext(
  map: MapRuntime,
  scenario: ScenarioDef,
  opts: { mode?: RunMode; policy?: PolicyName; tuning?: Tuning } = {},
): StaticContext {
  return {
    map,
    scenario,
    tuning: opts.tuning ?? TUNING,
    mode: opts.mode ?? 'headless',
    policy: opts.policy ?? 'recommended',
    events: [],
  };
}
