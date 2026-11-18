/** 調整定数: 時刻・太陽・気象・地面（docs/05） */

/** docs/05 §4 太陽 */
export const sun = {
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
};

/** docs/05 気象 */
export const weather = {
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
};

/** docs/05 §3 地面 */
export const ground = {
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
};
