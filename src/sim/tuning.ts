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

  /** docs/06 §6 判断力・運動能力（P4 で本実装） */
  capacity: {
    j0Base: 0.4,
    j0PerExperience: 0.6,
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
