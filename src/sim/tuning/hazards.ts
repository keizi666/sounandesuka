/** 調整定数: 道迷い・転倒滑落・落雷・機器・救助・思考（docs/07 §3・§6、docs/08） */

/** docs/07 §3 ナビゲーション */
export const nav = {
  visCueM: 200,
  darkCueLamp: 0.45,
  darkCueNoLamp: 0.9,
  twilightCue: 0.2,
  snowCueDeepCm: 10,
  snowCueDeep: 0.5,
  snowCueCm: 3,
  snowCue: 0.2,
  /** 分岐での誤り p_k = ambiguity × (base + k × cue) × (1 − navK × navEff) × (markBase − markK × markers) */
  errCueBase: 0.3,
  errCueK: 0.7,
  errNavK: 0.85,
  errMarkBase: 1.5,
  errMarkK: 0.5,
  errStopCheckedF: 0.1,
  errGpsHabitF: 0.4,
  errMax: 0.95,
  /** 別の正規の道に入ったとき、次のノードで道標を見て気づく確率 */
  signBase: 0.6,
  signMarkersK: 0.4,
  signVisCueK: 0.5,
  /** 道の途中での踏み外し（10 m ごと）: drift / 10 × cue × (1 − k × navEff) × (1 + fatigue / 100) */
  driftNavK: 0.8,
  /** 踏み外しの全体倍率（バランス調整用） */
  driftScale: 0.65,
  /** 気づき（毎分） */
  awareBase: 0.01,
  awareNavK: 0.04,
  awareBushP: 0.06,
  awareVanishedP: 0.15,
  awareVanishedMin: 10,
  awareAnxietyF: 1.2,
  awareAnxietyAbove: 60,
  /** 道外の 1 歩の効用（docs/07 §3.4） */
  uBelief: 1.0,
  uDescend: 0.8,
  descendBias: 0.6,
  uSlope: 1.2,
  uBush: 0.8,
  uCliffSeen: 10,
  uNoise: 0.3,
  /** 最近通った地点（軌跡の直近この点数）に戻る 1 歩の減点。くぼみで行ったり来たりしないように */
  uRevisit: 1.5,
  revisitPoints: 30,
  slopeEasyDeg: 35,
  slopeSteepSpanDeg: 10,
  cliffSeenMinVisM: 40,
  /** 沢下り（docs/07 §3.6） */
  drainDescend: 1.2,
  drainFlow: 0.6,
  waterfallStopJ: 0.5,
  /** 軌跡を戻る: 100 m ごとに見失う確率 (1 − navEff) × k × (base + cue) */
  trackLoseEveryM: 100,
  trackLoseK: 0.12,
  trackLoseBase: 0.3,
  trackPointM: 10,
  /** 位置確認（docs/07 §3.7） */
  gpsCheckMin: 3,
  gpsCheckBatteryPct: 2,
  mapCheckMin: 10,
  mapCheckVisM: 300,
  mapCheckBase: 0.3,
  mapCheckNavK: 0.6,
  mapCheckPoorP: 0.1,
  knowsPositionForgetM: 300,
  /** 電波を探す範囲 */
  seekSignalRadiusM: 600,
  /** 風下の避難地点の探索（docs/04 §8） */
  leeRadiusM: 150,
  leeLookM: 100,
  leeFullM: 30,
  leeWindW: 0.6,
  leeVegW: 0.3,
  leeMaxSlopeDeg: 25,
  leeAvoidM: 30,
  leeSlopePenaltyPerDeg: 0.01,
  /** 稜線を外れて下る（moveOffRidge）の探索半径 */
  offRidgeRadiusM: 300,
  /** 登山道に戻ったとみなす距離（m） */
  onTrailM: 15,
};

/** docs/08 §1 転倒・滑落 */
export const slip = {
  /** 転倒率の全体倍率（docs/08 §1.2 の表のままでは 1 人 1 日に約 0.6 回けがをするため、P7 で合わせる） */
  rateScale: 0.2,
  base100: { T1: 0.0015, T2: 0.004, EXPOSED: 0.01, OFF: 0.012, OFF_STEEP: 0.04, CLIFF: 0.35 } as Record<string, number>,
  offSteepDeg: 30,
  offCliffDeg: 45,
  wetF: 1.6,
  icyCramponsF: 1.3,
  icyF: 4.0,
  snowSlopeDeg: 20,
  snowCramponsF: 1.1,
  snowF: 2.5,
  darkLampF: 1.5,
  darkF: 4.0,
  fatigueDiv: 80,
  hurryF: 1.3,
  polesF: 0.8,
  downF: 1.3,
  gustFromMs: 20,
  gustDivMs: 5,
  /** 結果の表 [何もなし, bruise, sprain, legFracture, headInjury, severeTrauma, 即死] */
  outcomes: {
    T1: [0.7, 0.24, 0.05, 0.01, 0, 0, 0],
    T2: [0.55, 0.3, 0.1, 0.04, 0.01, 0, 0],
    EXPOSED: [0.3, 0.25, 0.15, 0.12, 0.08, 0.05, 0.05],
    OFF: [0.55, 0.3, 0.1, 0.04, 0.01, 0, 0],
    OFF_STEEP: [0.3, 0.3, 0.15, 0.13, 0.06, 0.04, 0.02],
    CLIFF: [0.05, 0.1, 0.1, 0.25, 0.15, 0.15, 0.2],
  } as Record<string, number[]>,
  fallMinM: 10,
  fallMaxM: 40,
  traumaDeathP: 0.6,
  traumaDeathRescuedP: 0.3,
  traumaDeathMaxMin: 90,
  headUnconsciousP: 0.3,
  headUnconsciousMinMin: 30,
  headUnconsciousMaxMin: 180,
  anxiety: { bruise: 10, sprain: 20, legFracture: 35, headInjury: 35, severeTrauma: 35 } as Record<string, number>,
};

/** docs/08 §2 落雷 */
export const lightning = {
  perMinK: 0.004,
  summitRadiusM: 50,
  exposureSummit: 1.0,
  exposureRidge: 0.6,
  ridgeTpi: 60,
  exposureOpen: 0.2,
  exposureForest: 0.06,
  exposureHollow: 0.04,
  hollowTpi: -20,
  postureF: 0.5,
  deathP: 0.3,
  struckM: 0.5,
  bystanderM: 5,
  bystanderP: 0.3,
  struckUnconsciousMin: 30,
};

/** docs/08 §4 機器 */
export const devices = {
  phoneIdlePctH: 2,
  phoneTrackPctH: 6,
  phoneCallPct: 20 / 6,
  phonePocketWarmC: 15,
  phoneColdCliffPct: 20,
  satelliteSendPct: 5,
};

/** docs/08 §5 救助 */
export const rescue = {
  heliPrepMinMin: 45,
  heliPrepMaxMin: 90,
  heliRecheckMin: 60,
  heliAfterSunriseMin: 30,
  heliBeforeSunsetMin: 60,
  heliMinVisM: 1500,
  heliCloudMarginM: 100,
  heliMaxWindMs: 15,
  heliMaxThunder: 0.2,
  heliHoistMin: 15,
  heliFindPerH: 0.6,
  heliFindForestPerH: 0.25,
  signalF: 1.5,
  preciseM: 50,
  groundMobMinMin: 90,
  groundMobMaxMin: 180,
  groundNightAddMin: 60,
  groundTrailKmh: 2.5,
  groundOffKmh: 0.8,
  groundFindPerH: 0.35,
  groundNightFindF: 0.5,
  groundPathF: 1.5,
  groundVoiceF: 1.6,
  searchStartM: 300,
  searchGrowMPerH: 300,
  deepDrainageF: 0.5,
  /** 救助隊と接触した登山者の近くにいる仲間も一緒に収容する距離 */
  contactRadiusM: 300,
};

/** docs/07 §6 思考 */
export const thoughts = {
  minGapMin: 15,
  maxGapMin: 30,
  noRepeatMin: 120,
  scenarioPriorityBonus: 10,
};
