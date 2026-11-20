/** 調整定数: 移動・生理・判断力（docs/06, docs/07 §1） */

/** docs/07 §1 移動、docs/06 §2 代謝 */
export const movement = {
  /** 足を骨折した人は歩けず、這って動く: 平らな所での速さ（km/h。1 時間に 70 m ほど）と、傾斜（度）で遅くなる割合（この傾斜で止まる手前まで落ちる） */
  crawlKmh: 0.07,
  crawlSlopeStopDeg: 50,
  crawlMinF: 0.25,
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
  /** 道の外の雪（ラッセル）: 5 cm 超で 0.7 倍、40 cm 超（膝より深い）で 0.35 倍 */
  offTrailSnowF: 0.7,
  offTrailDeepSnowCm: 40,
  offTrailDeepSnowF: 0.35,
  icyNoCramponsF: 0.6,
  wetGround: 0.5,
  wetF: 0.9,
  fatigueSpeedK: 0.4,
  /**
   * 消耗による歩く速さの係数（[値, 係数] の昇順の表）。M とは別に速さにだけ掛ける。
   * エネルギー切れ（シャリバテ）・脱水・冷えが重なると、足取りが目に見えて重くなる
   */
  // シャリバテ（300 kcal を切る）から遅くなる。ふつうに食べながら歩く長い一日では効かない
  exhaustGlycogenF: [
    [0, 0.75],
    [150, 0.85],
    [300, 1],
  ],
  exhaustDehydF: [
    [1.5, 1],
    [3, 0.9],
    [4.5, 0.75],
    [6, 0.6],
    [8, 0.45],
  ],
  // 冷え: 35℃（軽い低体温症の入り口）まではほぼふつうに歩ける。34℃ を切ると足がもつれて大きく遅れる（M の表と重ねて効く）
  exhaustCoreF: [
    [33, 0.6],
    [34, 0.8],
    [35, 0.9],
    [36, 1],
  ],
  sprainDownF: 0.8,
  hurryF: 1.1,
  hurryAnxiety: 60,
  // 風で遅くなる: 8 m/s から落ち、15 m/s で約 0.61、20 m/s で約 0.33、21 m/s 前後から 0.3 で下げ止まる
  // （0.25 で下げ止まる・14 m/s 幅だったときは、18.5 m/s 以上でほぼ進めず、史実の吹雪の行程が大きく遅れた）
  windSlowStartMs: 8,
  windSlowSpanMs: 18,
  windMinF: 0.3,
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
};

/** docs/06 §6 判断力・運動能力 */
export const capacity = {
  /** 体調（始まりの条件）ごとの判断力 J と運動能力 M の倍率。寝不足は判断が鈍り、風邪は力が出ない */
  healthJ: { good: 1, sleepy: 0.85, tired: 0.93, cold: 0.9 } as Record<string, number>,
  healthM: { good: 1, sleepy: 0.96, tired: 0.92, cold: 0.85 } as Record<string, number>,
  j0Base: 0.4,
  j0PerExperience: 0.6,
  /** 深部体温 → J の係数（線形補間の表 [体温, 係数]、昇順） */
  // 34℃ を切ると、判断も動きも急に落ちる（足がもつれ、まともに歩けない。33℃ 台は重度で命に関わる）
  coreJ: [
    [30, 0.05],
    [31, 0.12],
    [32, 0.2],
    [33, 0.3],
    [34, 0.5],
    [35, 0.8],
    [36, 1.0],
  ],
  coreM: [
    [30, 0],
    [31, 0.08],
    [32, 0.15],
    [33, 0.3],
    [34, 0.6],
    [35, 0.9],
    [36, 1.0],
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
  /** 血中アルコール濃度 1%（=10 g/L）あたりの判断力の低下。0.05% で約 15% 下がる */
  alcoholJK: 3,
  injuryM: { none: 1.0, bruise: 0.9, sprain: 0.45, legFracture: 0.03, headInjury: 0.5, severeTrauma: 0 },
  headInjuryJ: 0.4,
  heatExhaustionC: 39.0,
  heatExhaustionJ: 0.85,
  heatExhaustionSpeed: 0.7,
  heatStrokeC: 40.5,
  heatStrokeM: 0.2,
};

/** docs/06 生理 */
export const physiology = {
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
  /** 服を通して汗が蒸発する量（W）。歩く・風で増え、雨具の下・雲や雨の中では減る。これを超えた分だけ服が濡れる */
  sweatEvapW: 150,
  sweatEvapWindK: 0.05,
  /** 寒いと汗の湿気は服の中で結露して外へ抜けない: clamp((気温 + off) / span, min, 1)。5℃ 以下で 0、20℃ で 1 */
  sweatEvapColdOffC: -5,
  sweatEvapColdSpanC: 15,
  sweatEvapColdMinF: 0,
  /** 汗だけで濡れるのはここまで（肌着が汗で湿る程度。それ以上は垂れて落ちる。雨に打たれたのとは違う） */
  sweatWetMax: 0.5,
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
  /** 浸水（docs/06 §4.1）: 濡れの増分、追加の熱損失（W）、水中にいる時間（分） */
  soak: {
    feet: { wetAdd: 0.15, lossW: 150, waterMin: 2 },
    knees: { wetAdd: 0.25, lossW: 300, waterMin: 2 },
    waist: { wetAdd: 0.5, lossW: 700, waterMin: 2 },
    full: { wetAdd: 1, lossW: 1200, waterMin: 2 },
  } as Record<string, { wetAdd: number; lossW: number; waterMin: number }>,
  soakRefSpanC: 27,
  soakMinWaterC: 2,
  soakColdExtremitiesMin: 60,
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
  /** テント（docs/06 §9 C12: 風 ×0.1、気温 +3℃）。同じ場所の仲間 tentCapacity 人まで入れる */
  tentTempUpC: 3,
  tentWindF: 0.1,
  tentCapacity: 6,
  tentDistM: 30,
  /** エマージェンシーシート（横になっているとき） */
  rescueSheetClo: 0.3,
  rescueSheetWindF: 0.5,
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
  /** 営業小屋で飲む量（L/時） */
  staffedDrinkLPerH: 0.6,
  /** 営業小屋で水筒を満たす速さ（L/時。持ってきた量まで） */
  staffedFillLPerH: 2,
  /** 営業小屋で行動食を買い足す速さ（kcal/時。持ってきた量まで） */
  staffedFoodKcalPerH: 1200,
  /** アルコールが抜ける速さ（g/時。体重 60〜70 kg の目安） */
  alcoholElimGPerH: 7,
  /** 体内のアルコールが体に行き渡る割合（Widmark の r） */
  alcoholWidmarkR: { m: 0.68, f: 0.55 } as Record<string, number>,
  /**
   * アルコールの体への影響（血中濃度 % あたり）: 寒さで皮膚の血管が縮むのを抑える（0.05% で半分。上限 0.8）、
   * 皮膚の血流が増えて熱が逃げる（0.05% で +10%）、震えが弱まる（0.05% で 20% 減。上限 50%）
   */
  alcoholVasoK: 10,
  alcoholVasoMax: 0.8,
  alcoholHeatLossK: 2,
  alcoholShiverK: 4,
  alcoholShiverMax: 0.5,
  /** 利尿: 分解したアルコール 1 g あたりの余分な尿（L） */
  alcoholDiuresisLPerG: 0.01,
  /** ツエルト・タープで止まっているときに雨水をためる量（L/時、雨 1 mm/h あたり）と上限 */
  /** 沢の水: のどの渇き（水分不足）がこれを超えていれば飲む。飲む速さと水筒を満たす速さ（L/h）。これより寒いと凍っていて飲めない（℃） */
  streamDrinkFromL: 0.2,
  streamDrinkLPerH: 1.5,
  streamFillLPerH: 3,
  streamFrozenBelowC: -3,
  rainCollectLPerHPerMm: 0.08,
  rainCollectMaxLPerH: 0.4,
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
  /** 雲・霧の中（湿度ほぼ 100%）での乾きやすさ */
  inCloudDryF: 0.2,
  /** エネルギー docs/06 §5.1 */
  glycoFracHigh: 0.65,
  glycoFracLow: 0.45,
  glycoFracMetAbove: 5,
  absorbKcalPerMin: 6,
  absorbEff: 0.9,
  glycogenMax: 2000,
  /** 水分 docs/06 §5.2 */
  // 山本正嘉の式「脱水量(mL) ≒ 5 × 体重(kg) × 行動時間(h)」（ふつうの気象条件での登山）に合わせる。
  // 安静時の損失（不感蒸泄＋最低限の尿）から、運動の強さに比例して増え、登山のふつうの強さ（waterRefMet）で 5 mL/kg/h になる。
  // 運動で増える分は気温で増減する（暑いと汗が増え、寒いと減る）。寒いと尿が増える（寒冷利尿）
  /** 安静時の損失（mL/kg/h）。不感蒸泄 約 0.55 と、最低限の尿 約 0.35（1 日に 65 kg で約 1.4 L） */
  waterRestMlPerKgH: 0.9,
  /** 寒冷利尿: 気温がこれより低いと、安静時の損失にこれを足す（mL/kg/h） */
  waterColdBelowC: 5,
  waterColdDiuresisMlPerKgH: 0.4,
  /** 登山のふつうの強さでの損失（mL/kg/h。山本式の 5） */
  waterHikeMlPerKgH: 5,
  /** 山本式の「ふつうの登山」に当たる運動の強さ（MET。登りと下りをならした値） */
  waterRefMet: 5,
  /** 運動で増える分の、気温による係数（[気温 ℃, 係数] の昇順。山本式は春秋のふつうの気象 = 15℃ 前後で 1） */
  waterTempF: [
    [0, 0.75],
    [10, 0.9],
    [15, 1],
    [22, 1.25],
    [28, 1.55],
    [33, 1.8],
  ],
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
  /** 低体温症の段階（山での目安。ユーザーの指定で、33℃台は重度として扱う）: 35〜34℃ 軽度、34〜33.5℃ 中等度、33.5℃ 未満 重度 */
  stageMildC: 35.0,
  stageModerateC: 34.0,
  stageSevereC: 33.5,
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
};

/** 急病（src/sim/climber/illness.ts）。心停止の率は「毎時」。発症からの時間で減る（減り方の時定数 decayH）＋下限 */
export const illness = {
  defaultWeights: { angina: 0.3, mi: 0.2, dissection: 0.05, arrhythmia: 0.15, benign: 0.3 } as Record<string, number>,
  onsetAnxiety: 30,
  anginaEaseMin: 15,
  anginaEaseMedsMin: 5,
  benignEaseMin: 20,
  arrhythmiaEaseMin: 30,
  /** 不整脈が、休む時間を満たしたあと 10 分ごとに治まる確率 */
  arrhythmiaEaseP: 0.5,
  /** 治まったあと、この勾配より急な登りを歩くとぶり返す（毎時の率） */
  relapseGrade: 0.05,
  relapsePerH: 0.6,
  /** 心筋梗塞: 安静で 48 時間のうちに約 40% が亡くなる程度（治療なし） */
  arrestPerH: { angina: 0.003, mi: 0.061, dissection: 0.08, arrhythmia: 0.01, benign: 0, anaphylaxis: 0.12 } as Record<string, number>,
  arrestDecayH: { angina: 3, mi: 6, dissection: 12, arrhythmia: 2, benign: 1, anaphylaxis: 1.0 } as Record<string, number>,
  arrestFloorPerH: { angina: 0.0005, mi: 0.003, dissection: 0.005, arrhythmia: 0.001, benign: 0, anaphylaxis: 0.002 } as Record<string, number>,
  /** 症状が治まっているとき・歩いているとき・薬を飲んだときの倍率 */
  easedArrestF: 0.3,
  walkingArrestF: 3,
  medsArrestF: 0.8,
  /** ハチ: 刺された人がアナフィラキシーを起こす確率（以前刺されたことがある人は高い）、症状が出るまで（分）、治まっていくまで（時間） */
  anaphylaxisP: 0.03,
  anaphylaxisSensitizedP: 0.3,
  anaphylaxisDelayMin: [5, 15] as [number, number],
  anaphylaxisResolveH: 4,
  stingAnxiety: 20,
  /** エピペンが効いている時間（分）と、その間の心停止の率の倍率 */
  epiDurationMin: 25,
  epiArrestF: 0.08,
};
