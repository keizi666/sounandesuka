/** 調整定数: 地形・派生レイヤー・登山道・電波（docs/04） */

/** docs/04 §3 地形生成 */
export const terrain = {
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
};

/** docs/04 §4 派生レイヤー */
export const derive = {
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
};

/** docs/04 §5 登山道 */
export const trails = {
  /** ポリラインの再サンプル間隔（水平距離 m） */
  sampleStepM: 10,
  /** courseTimeMin のないエッジでダイクストラに使う速度（実距離 m/分） */
  fallbackSpeedMPerMin: 40,
};

/** docs/04 §7 電波圏 */
export const radio = {
  rxHeightM: 1.5,
  /** 足元のこの距離以内の地形は見通しの判定から外す（数歩動けばよけられる小さな高まり） */
  nearFieldIgnoreM: 50,
  minSampleM: 32,
  /** 見通し判定のサンプル間隔 = max(minSampleM, sampleCells × cell) */
  sampleCells: 2,
  diffractionBase: 0.25,
  diffractionScaleM: 200,
  forestFactor: 0.8,
  /** radio.paint の「強制あり」の最低値（docs/04 §4） */
  paintOnValue: 0.6,
  callableMin: 0.3,
  messageOnlyMin: 0.15,
  /** 衛星 SOS が送れる空の見通し（docs/08 §4.1） */
  satelliteSkyViewMin: 0.5,
};
