/**
 * 調整用の数値定数（CLAUDE.md 鉄則 4）。
 * sim のコード中に魔法の数値を書かず、ここに集約する。各フェーズで項目を追加する。
 * プレーンな JSON 互換の値だけを入れる。出典の節を併記する。
 */
export const TUNING = {
  /** docs/05 §4 太陽 */
  sun: {
    /** シナリオが maxElevDeg を省略したときの南中高度（度）。spring は仕様にないため 60（DECISIONS） */
    maxElevDegBySeason: { spring: 60, summer: 75, autumn: 45, winter: 32 },
    /** 南中高度＋真夜中の伏角 = 180 − 2×緯度（北緯 36° で 108°） */
    noonPlusMidnightDepthDeg: 108,
    /** 夜の伏角の下限（度） */
    minNightDepthDeg: 10,
    /** 太陽高度がこれ未満で暗い（度）。0 未満〜これ以上が薄明 */
    darkBelowDeg: -6,
    /** 雲量 1 で暗さの判定に使う太陽高度を下げる量（度） */
    cloudDarkeningDeg: 3,
  },

  /** docs/06 §6 判断力・運動能力 */
  capacity: {
    j0Base: 0.4,
    j0PerExperience: 0.6,
    /** 深部体温 → J の係数（線形補間の表 [体温, 係数]、昇順） */
    coreJ: [
      [30, 0.08],
      [31, 0.18],
      [32, 0.3],
      [33, 0.45],
      [34, 0.65],
      [35, 0.85],
      [36, 1.0],
    ],
    coreM: [
      [30, 0],
      [31, 0.2],
      [32, 0.4],
      [33, 0.6],
      [34, 0.85],
      [35, 1.0],
    ],
    lowGlycogenJ: 0.8,
    fatigueJK: 0.3,
    anxietyHigh: 70,
    anxietyHighJ: 0.75,
    anxietyMid: 50,
    anxietyMidJ: 0.9,
    dehydMidL: 2.0,
    dehydMidJ: 0.9,
    dehydMidMet: 0.85,
    dehydHighL: 4.0,
    dehydHighJ: 0.7,
    dehydHighMet: 0.6,
    veryLowGlycogenKcal: 100,
    veryLowGlycogenM: 0.7,
    jMin: 0.05,
    injuryM: { none: 1.0, bruise: 0.9, sprain: 0.45, legFracture: 0.03, headInjury: 0.5, severeTrauma: 0 },
    headInjuryJ: 0.4,
    heatExhaustionC: 39.0,
    heatExhaustionJ: 0.85,
    heatExhaustionSpeed: 0.7,
    heatStrokeC: 40.5,
    heatStrokeM: 0.2,
  },

  /** docs/06 生理 */
  physiology: {
    /** 状態ごとの活動 MET（歩行中は movement の MET） */
    stateMet: {
      RESTING: 1.4,
      STAYING: 1.4,
      LOST_AWARE: 1.4,
      BIVOUAC: 1.1,
      WAITING_RESCUE: 1.1,
      INCAPACITATED: 1.1,
      SHELTERED: 1.2,
      UNCONSCIOUS: 0.9,
      DEAD: 0,
      FINISHED: 1.4,
      RESCUED: 1.2,
    } as Record<string, number>,
    offTrailMetF: 1.4,
    /** 体表面積 A = areaBase × (体重 / areaRefKg)^areaExp */
    areaBase: 1.8,
    areaRefKg: 65,
    areaExp: 0.6,
    wPerMetPerKg: 1.163,
    mechEfficiencyKeep: 0.85,
    skinCoreDiffC: 4.0,
    rainwearClo: 0.15,
    windPenRainwear: 0.02,
    windPenNone: 0.08,
    wetCloLoss: 0.5,
    hcBase: 3.0,
    hcPerSqrtV: 4.0,
    radiativeH: 4.5,
    cloToR: 0.155,
    noHatLossF: 1.06,
    /** 末梢血管収縮 vaso = 1 − k × ageV × clamp((37 − core) / span) */
    vasoK: 0.25,
    vasoSpanC: 1.5,
    ageRefYears: 40,
    ageVPerYear: 0.012,
    ageVMin: 0.4,
    ageSPerYear: 0.01,
    ageSMin: 0.5,
    evapMaxW: 220,
    evapBase: 30,
    evapPerV: 12,
    evapUnderRainwearF: 0.35,
    respFrac: 0.09,
    /** 震え */
    shiverStartC: 36.8,
    shiverPerC: 2.2,
    shiverMaxMet: 3.0,
    shiverFadeFromC: 32,
    shiverFadeSpanC: 2,
    shiverWalkingMet: 3,
    shiverWalkingF: 0.4,
    shiverLowFuelBase: 0.6,
    /** 発汗 */
    sweatStartC: 37.1,
    sweatMaxW: 450,
    sweatWetPerW: 1 / 1800,
    /** 運動そのものによる発汗（W / MET）。MET がこれを超えた分 */
    sweatExertFromMet: 5,
    sweatExertWPerMet: 6,
    /** 暑さによる発汗冷却の上限の低下: clamp((ref − 気温) / span, min, 1) */
    sweatHotRefC: 36,
    sweatHotSpanC: 12,
    sweatHotMinF: 0.3,
    /** 脱水による発汗の低下: max(min, 1 − k × 不足 L) */
    sweatDehydPerL: 0.1,
    sweatDehydMinF: 0.4,
    trapF: { none: 0.5, poncho: 0.6, basic: 0.8, goretex: 0.5 } as Record<string, number>,
    /** 深部体温 */
    specificHeatJ: 3470,
    kMass: 2.8,
    hotRelax: 0.02,
    poorRecoveryBelowC: 34,
    poorRecoveryF: 0.3,
    staffedRecoveryCPerH: 1.0,
    /** 地面への伝導 docs/06 §3.2 */
    groundAirFrac: 0.75,
    groundContactFrac: 0.25,
    groundCloF: 0.3,
    groundContactR: 0.02,
    groundInsulationR: 0.15,
    groundBelowAirC: 1,
    /** 環境（docs/06 §3.1） */
    bivyTempUpC: 3,
    bivyWindF: 0.08,
    bivyCondensePerH: 0.01,
    bivyClo: { none: 0, tarp: 0.3, sack: 0.6 } as Record<string, number>,
    leePrecipF: 0.8,
    emergencyTempUpC: 5,
    emergencyDryPerH: 0.15,
    staffedTempC: 18,
    staffedDryPerH: 0.6,
    staffedMealKcalPerMin: 6,
    /** 濡れ docs/06 §4 */
    kRainPerMm: 0.12,
    protectPoncho: 0.6,
    ponchoWindMs: 20,
    protectBasic: 0.8,
    protectGoretex: 0.95,
    basicDegradeAfterH: 3,
    basicDegradePerH: 0.1,
    basicDegradeMin: 0.5,
    precipTypeF: { none: 0, rain: 1.0, sleet: 0.8, snow: 0.25, hail: 0.6 } as Record<string, number>,
    wetSnowAboveC: -1,
    wetSnowF: 0.5,
    dryPerH: 0.15,
    dryWindK: 0.1,
    dryWarmAboveC: 5,
    dryColdF: 0.5,
    /** エネルギー docs/06 §5.1 */
    glycoFracHigh: 0.65,
    glycoFracLow: 0.45,
    glycoFracMetAbove: 5,
    absorbKcalPerMin: 6,
    absorbEff: 0.9,
    glycogenMax: 2000,
    /** 水分 docs/06 §5.2 */
    waterBaseLPerH: 0.15,
    waterPerMetLPerH: 0.07,
    waterHotAboveC: 20,
    waterHotF: 1.6,
    waterWarmAboveC: 10,
    waterWarmF: 1.2,
    waterDeficitMax: 6,
    /** 疲労 docs/06 §5.3 */
    fatigueMetFree: 3.5,
    fatigueGainK: 0.045,
    fatigueSteepGrade: 0.15,
    fatigueSteepGain: 0.03,
    fatigueRecoverRest: 0.35,
    fatigueRecoverBivouac: 0.25,
    fatigueRecoverColdBivouac: 0.1,
    fatigueColdBelowC: 35.5,
    fatigueRecoverHut: 0.6,
    /** 不安 docs/06 §5.4 */
    anxietyBase: 10,
    anxietyTauMin: 20,
    anxDark: 15,
    anxLowVis: 10,
    anxLowVisM: 100,
    anxWind: 10,
    anxWindMs: 15,
    anxPrecip: 10,
    anxPrecipMmH: 5,
    anxLost: 30,
    anxInjury: 20,
    anxCompanion: 15,
    anxBehind: 10,
    anxBehindMin: 60,
    anxShelter: -25,
    anxRescue: -20,
    /** 低体温症の段階と生死 docs/06 §7 */
    stageColdC: 36.0,
    stageMildC: 35.0,
    stageModerateC: 32.0,
    stageSevereC: 28.0,
    unconsciousBelowC: 28.0,
    deathCoreC: 24.0,
    heatDeathC: 42.0,
    arrestBelowC: 28.0,
    arrestBase: 0.02,
    arrestPerC: 0.06,
    arrestCheckMin: 10,
    heatStrokeUnconsciousP: 0.2,
    coreMin: 20,
    coreMax: 42,
  },

  /** docs/04 §3 地形生成 */
  terrain: {
    /** リッジノイズを効かせ始める幅（ridgedAbove ± この値で滑らかに） */
    ridgedBlendM: 50,
    /** 尾根ポリライン上でのリッジノイズの倍率 */
    ridgedOnPolylineFactor: 0.3,
    /** ポリラインから離れてリッジノイズが 1 倍に戻る距離 */
    ridgedPolylineFadeM: 150,
    /** 滝の段差の縦断方向の遷移幅（セル数）。小さいほど急崖 */
    knickStepCells: 0.25,
    /** 滝の下流で段差を元に戻し始める距離と戻し終える距離（m） */
    knickFadeStartM: 150,
    knickFadeEndM: 550,
    /** 横断方向で段差が始まる位置（radius に対する比） */
    knickLateralInner: 0.6,
    /** 熱侵食の除外半径（knickpoint radius に対する比） */
    erosionExcludeFactor: 1.5,
    /** 熱侵食で 1 回に移す量（超過分に対する比）。8 近傍で合計 1 以下になるようにする */
    erosionRate: 0.125,
    /** ノードのスナップ半径と警告の閾値（m） */
    nodeSnapRadiusM: 120,
    nodeSnapWarnM: 60,
    /** 森林限界のゆらぎのノイズの尺度（m） */
    forestLineNoiseScaleM: 400,
  },

  /** docs/04 §4 派生レイヤー */
  derive: {
    tpiRadiusM: 320,
    exposureTpiDivisor: 180,
    exposureMin: 0.4,
    exposureMax: 1.6,
    /** 沢とみなす集水面積（m²） */
    streamAreaM2: 90_000,
    /** 窪地埋めで平坦部に付ける勾配（m/セル） */
    fillEpsilonM: 1e-4,
    cliffSlopeDeg: 50,
    /** knickpoint の半径内で、段差の何割以上の落差を持つセルを崖とするか */
    knickCliffDropRatio: 0.5,
    rockSlopeDeg: 40,
    krummholzBandM: 200,
    krummholzMaxSlopeDeg: 35,
    skyViewRadiusM: 500,
    skyViewForestFactor: 0.6,
  },

  /** docs/04 §5 登山道 */
  trails: {
    /** ポリラインの再サンプル間隔（水平距離 m） */
    sampleStepM: 10,
    /** courseTimeMin のないエッジでダイクストラに使う速度（実距離 m/分） */
    fallbackSpeedMPerMin: 40,
  },

  /** docs/07 §1 移動、docs/06 §2 代謝 */
  movement: {
    toblerMaxKmh: 6,
    toblerK: 3.5,
    toblerOffset: 0.05,
    /** pace = base + exp × experience + fit × (fitness − 1) */
    paceBase: 0.75,
    paceExp: 0.15,
    paceFit: 0.1,
    classF: { T1: 1.0, T2: 0.85, T3: 0.6, chain: 0.45 },
    darkHeadlampF: 0.75,
    darkNoLampBase: 0.25,
    darkNoLampMoon: 0.2,
    lowVisM: 30,
    lowVisF: 0.8,
    snowDeepCm: 20,
    snowDeepF: 0.5,
    snowCm: 5,
    snowF: 0.75,
    icyNoCramponsF: 0.6,
    wetGround: 0.5,
    wetF: 0.9,
    fatigueSpeedK: 0.4,
    sprainDownF: 0.8,
    hurryF: 1.1,
    hurryAnxiety: 60,
    windSlowStartMs: 8,
    windSlowSpanMs: 14,
    windMinF: 0.25,
    /** 風による運動負荷: 1 + k × max(0, wind − start) */
    windMetStartMs: 5,
    windMetK: 0.03,
    /** ACSM 歩行式（VO2 ml/kg/min） */
    vo2Rest: 3.5,
    vo2PerSpeed: 0.1,
    vo2PerClimb: 1.8,
    descentGradeF: 0.33,
    steepDescentGrade: 0.25,
    steepDescentAddF: 0.5,
    loadK: 0.6,
    /** 最大 MET = base + k × fitness */
    maxMetBase: 8,
    maxMetPerFitness: 6,
    lowGlycogenKcal: 300,
    lowGlycogenMetF: 0.55,
    fatigueMetK: 0.3,
    /** 持続できる MET の上限 = この比 × usableMET */
    sustainableMetRatio: 0.75,
    metSearchIterations: 6,
    restMet: 1.4,
    /** 道外の基本速度（km/h）。速度係数は植生クラスで docs/04 §4 */
    offTrailKmh: 3.0,
    offTrailMinSlopeF: 0.15,
    vegSpeed: [0.5, 0.45, 0.2, 0.7, 0.45, 0.35, 0.05],
  },

  /** docs/05 気象 */
  weather: {
    /** キーフレームで省略されたときの既定値 */
    defaultInCloudVisibilityM: 60,
    defaultGustiness: 0.25,
    defaultPressureHpa: 1013,
    /** 時間ノイズ（周期の長い順に 2 オクターブ、振幅の比） */
    noisePeriodsMin: [7, 3],
    noiseOctaveAmps: [0.6, 0.4],
    gustK: 1.6,
    tempNoiseC: 0.4,
    precipNoiseK: 0.35,
    /** 雷雲セル直下（d < coreRatio × radiusM）の影響。境目は fadeFrom〜coreRatio で滑らかに 0 に */
    cellCoreRatio: 0.6,
    cellCoreFadeFrom: 0.45,
    cellGustMs: 6,
    cellCoolingC: 3,
    hailEnvMin: 0.6,
    /** 局地補正 docs/05 §2 */
    altWindPer1000m: 0.45,
    altWindMin: 0.5,
    altWindMax: 2.0,
    leeK: 0.6,
    /** 植生クラスごとの風速倍率（docs/04 §4 の表） */
    vegWindFactor: [0.45, 0.4, 0.8, 1.0, 1.0, 0.6, 1.0],
    /** 風下判定: 風上方向にこの距離まで見る（m）、この刻みで、この高さで 1 */
    shelterLookM: 100,
    shelterStepM: 25,
    shelterFullM: 30,
    oroK: 0.8,
    oroSlopeK: 3,
    inCloudPrecipF: 1.15,
    precipNoneBelowMmH: 0.05,
    snowBelowC: 0.5,
    sleetBelowC: 2.0,
    cloudCoverForFog: 0.6,
    cloudFogBandM: 100,
    visPrecipBaseM: 20000,
    visPrecipK: 1.5,
    visSnowBaseM: 8000,
    visSnowK: 4,
    windChillMaxC: 10,
    windChillMinKmh: 4.8,
    solarMaxW: 120,
    solarCloudK: 0.85,
    solarInCloudF: 0.2,
  },

  /** docs/05 §3 地面 */
  ground: {
    snowCmPerMm: 1.0,
    sleetSnowF: 0.3,
    meltAboveC: 0.5,
    meltCmPerHourPerC: 0.25,
    rainMeltCmPerMm: 0.1,
    wetTauMin: 10,
    dryTauMin: 90,
    dryTauColdMin: 240,
    dryColdBelowC: 3,
    icyWetMin: 0.5,
    icyFreezeBelowC: 0,
    icyThawAboveC: 1,
    icyThawMin: 60,
  },

  /** docs/04 §7 電波圏 */
  radio: {
    rxHeightM: 1.5,
    minSampleM: 32,
    /** 見通し判定のサンプル間隔 = max(minSampleM, sampleCells × cell) */
    sampleCells: 2,
    diffractionBase: 0.25,
    diffractionScaleM: 200,
    forestFactor: 0.8,
    callableMin: 0.3,
    messageOnlyMin: 0.15,
  },
};

export type Tuning = typeof TUNING;
