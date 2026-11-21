/** 調整定数: 道迷い・転倒滑落・落雷・機器・救助・思考（docs/07 §3・§6、docs/08） */

/** docs/07 §3 ナビゲーション */
export const nav = {
  visCueM: 200,
  darkCueLamp: 0.45,
  darkCueNoLamp: 0.9,
  twilightCue: 0.2,
  snowCueDeepCm: 10,
  snowCueDeep: 0.85,
  snowCueCm: 3,
  snowCue: 0.35,
  /** 分岐での誤り p_k = ambiguity × (base + k × cue) × (1 − navK × navEff) × (markBase − markK × markers) */
  errCueBase: 0.3,
  errCueK: 0.7,
  errNavK: 0.85,
  errMarkBase: 1.5,
  errMarkK: 0.5,
  errStopCheckedF: 0.1,
  errGpsHabitF: 0.4,
  errMax: 0.95,
  /** 不安が 20 を超えると分岐の誤りが増え、100 で ×(1 + k)。焦っていると道標や向きの確認を飛ばす */
  errAnxietyK: 1.2,
  /** 別の正規の道に入ったとき、次のノードで道標を見て気づく確率 */
  signBase: 0.6,
  signMarkersK: 0.4,
  signVisCueK: 0.5,
  /** 別の正規の道が、予定のルートのこの数の地点以内の先に出るなら道迷いにしない（短い並行の道・林道との交差。高水三山で、60 m の並行の道で「迷った」になっていた） */
  rejoinAheadNodes: 3,
  /** 道の途中での踏み外し（10 m ごと）: drift / 10 × cue × (1 − k × navEff) × (1 + fatigue / 100) */
  driftNavK: 0.8,
  /** 踏み外しの全体倍率（バランス調整用） */
  driftScale: 0.45,
  /** 動揺・けが・低体温のときの踏み外しの倍率（不安 100 で ×(1+anxietyK)、けがは種類ごと、深部体温 35.5℃ 未満で 1℃ごとに +coldK） */
  driftAnxietyK: 0.5,
  driftInjury: { none: 1, bruise: 1.1, sprain: 1.5, legFracture: 2.2, headInjury: 2.5, severeTrauma: 3 } as Record<string, number>,
  driftColdK: 0.8,
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
  /** 電波を探すときに下ってよい高さ（m）。谷は電波が入りにくく、道を外れて谷へ下りると危ない（ユーザーの指摘） */
  seekSignalMaxDropM: 10,
  /** 今いる所より電波がこれだけ強くなければ、動かずにその場でかける */
  seekSignalMinGain: 0.03,
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
  /** けがで動けないまま、体力 100 が 0 になるまでの時間（時間。ユーザーの指定） */
  debilityFullH: 96,
  /** 這って動いているとき（足の骨折）の 10 m あたりの滑落の確率。その場の斜面の傾斜（度）で決める [傾斜, 確率]。急なほど、止まれずに滑り落ちる */
  crawlP10: [[10, 0.0005], [20, 0.004], [30, 0.03], [40, 0.1], [50, 0.25], [60, 0.45]] as [number, number][],
  /** 這っていて滑ったとき、この傾斜より急なら斜面を滑り落ちる（道の外へ） */
  crawlSlideDeg: 22,
  /**
   * 転倒率の地形クラスごとの倍率。docs/08 §1.2 の表のままでは登山道の上でも 1 人 1 日に約 0.6 回けがをするため、
   * 平常の登山道は大きく下げ、道外・崖はほぼそのまま残す（P7 の調整、DECISIONS）
   */
  classScale: { T1: 0.05, T2: 0.05, EXPOSED: 0.08, OFF: 0.3, OFF_STEEP: 0.5, STREAM: 0.6, CLIFF: 1.0 } as Record<string, number>,
  base100: { T1: 0.0015, T2: 0.004, EXPOSED: 0.01, OFF: 0.012, OFF_STEEP: 0.04, STREAM: 0.06, CLIFF: 0.35 } as Record<string, number>,
  offSteepDeg: 30,
  offCliffDeg: 45,
  /** 道の外で、斜面そのものの傾きをどれだけ見るか（横切って巻くとき。1 = 斜面の傾きそのまま） */
  traverseF: 0.9,
  wetF: 1.6,
  icyCramponsF: 1.3,
  icyF: 4.0,
  snowSlopeDeg: 20,
  snowCramponsF: 1.1,
  snowF: 2.5,
  darkLampF: 1.5,
  /** 夜に道外（沢・やぶ・急斜面）をヘッドランプで歩くとき */
  darkLampOffF: 3.0,
  darkF: 4.0,
  /** 自分の明かりはないが、すぐそばの仲間のヘッドランプで足元を照らしてもらって道を歩くとき */
  darkSharedLampF: 2.5,
  fatigueDiv: 80,
  /** 血中アルコール濃度 1% あたりの転倒の増え方。0.05% で 1.5 倍 */
  alcoholK: 10,
  /** けがをするほど転んだとき、ストラップのないスマホをなくす確率 */
  phoneLossP: 0.4,
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
    STREAM: [0.25, 0.25, 0.18, 0.15, 0.08, 0.05, 0.04],
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
  /**
   * 地面を伝わる電流・側撃（1 回の落雷で近くの何人もが倒れる。1967 年の西穂高では、濡れた斜面に並んだ列の多くが倒れた）。
   * 打たれた人からの距離 d が groundM（地面が濡れていれば groundWetM）以内の人に、k = 1 − d / 半径 として:
   * 心停止 groundDeathP × k²、気を失う（頭部外傷として扱う）groundKnockP × k、ほかは打撲 bystanderP × k。しゃがんでいれば postureF 倍
   */
  groundM: 12,
  groundWetM: 25,
  groundWetAbove: 0.5,
  groundDeathP: 0.25,
  groundKnockP: 0.55,
  /**
   * 群れ: 近く（groundM 以内）に n 人いると、雷はそのうちの誰か 1 か所に落ちる。一人ひとりの確率を n で割り、
   * 群れ全体の受け方は 1 + clusterK × (n − 1) 倍にする（人が多いほど少しだけ目立つ）。一人ずつ独立に落ちると、密集した列で回数が人数倍になる
   */
  clusterK: 0.15,
};

/** docs/08 §4 機器 */
export const devices = {
  phoneIdlePctH: 2,
  phoneTrackPctH: 6,
  phoneCallPct: 20 / 6,
  phonePocketWarmC: 15,
  phoneColdCliffPct: 20,
  satelliteSendPct: 5,
  /** モバイルバッテリー（ユーザーの指定）: 容量を「スマホの何 % 分」に直す。スマホの電池 4000 mAh・充電の効率 65% */
  powerBankDefaultMah: 5000,
  phoneBatteryMah: 4000,
  powerBankEff: 0.65,
  /** 充電の速さ（% / 分） */
  chargePctPerMin: 1,
  /** 充電を始める残り（%）。ふだんは少なくなってから、遭難のさなか（スマホが頼り）は早めに */
  chargeBelowPct: 25,
  chargeBelowDistressPct: 50,
  /** ここまで充電したらやめる（%） */
  chargeUntilPct: 90,
  /** この雨（mm/h）より強いと、外では濡れるので充電できない（小屋・テント・ツェルトの中ならできる） */
  chargeMaxRainMmH: 0.3,
};

/** 電子機器が登場した年（シナリオの年代に合わせて、まだない機器は持たない。ユーザーの指定） */
export const era = {
  /** 携帯電話が登山者に広まった年 */
  mobilePhoneFrom: 1995,
  /** スマホ（地図アプリ・軌跡の記録） */
  smartphoneFrom: 2009,
  /** モバイルバッテリー */
  powerBankFrom: 2013,
  /** ココヘリ（会員制の捜索サービス） */
  cocoheliFrom: 2016,
  /** スマホの衛星 SOS */
  satelliteSosFrom: 2022,
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
  heliMaxWindMs: 13,
  heliMaxThunder: 0.2,
  /** ヘリ: 目標の上の雲との間をこれだけあける（m）。まわり heliRidgeRadiusM の尾根が雲に入っていても飛ばない（有視界飛行。雲があれば飛ばない） */
  heliCloudClearM: 300,
  heliRidgeRadiusM: 1500,
  /** ヘリ: 空の大半が雲（この割合以上）で、雲の底が目標より heliOvercastAboveM 以内なら飛ばない */
  heliOvercastCover: 0.85,
  heliOvercastAboveM: 800,
  /** ヘリ: 雨・雪の強さの上限（mm/h）。視界が悪くなる */
  heliMaxPrecipMmH: 4,
  /** 地上隊: 夜は山に入らない（二次遭難を避ける）。日の出から、日の入りのこの分前まで動く */
  groundBeforeSunsetMin: 30,
  /** 地上隊: 悪天候で出ない・捜索を止める条件（目標の場所の天気） */
  groundMaxPrecipMmH: 10,
  groundMaxWindMs: 15,
  groundMaxThunder: 0.3,
  groundMinVisM: 30,
  /** 地上隊がいったん見合わせたら、少なくともこの分は様子を見る */
  groundHoldMinMin: 30,
  heliHoistMin: 15,
  heliFindPerH: 0.6,
  /**
   * 居場所の分からない人（通報した場所・計画の道から離れた人）をヘリが見つける率（ユーザーの指定）。
   * [探した日数, それまでに見つかる率]。1 日 = ヘリが実際に飛んで探した heliBlindDayMin 分（夜・悪天候では進まない）。最後の点より先は同じ傾きで伸ばし、heliBlindMaxP まで
   */
  heliBlindFindP: [[0, 0], [1, 0.1], [2, 0.2], [3, 0.3]] as [number, number][],
  heliBlindDayMin: 600,
  heliBlindMaxP: 0.6,
  /** 計画の道からこれより離れた人は「居場所が分からない」（通報した場所があるときは、その範囲 + movedAwayM の外） */
  /**
   * 道を歩く捜索で気づける距離（探している道から。これより外れた人は「居場所が分からない」として日数の率でしか見つからない。ユーザーの指定）。
   * 地上隊: 意識があれば声（笛があれば whistleExtraM）、意識がない・声を出せなければ目で見える所だけ。ヘリ: 開けた所と森の中
   */
  groundVoiceReachM: 40,
  groundSilentReachM: 10,
  heliOpenReachM: 40,
  heliForestReachM: 10,
  /** ココヘリを持つ人をヘリが見つける率（1 時間あたり。受信機で電波をとらえる。居場所が分からなくても同じ） */
  cocoheliFindPerH: 3,
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
  /** 通報した場所からこれ以上離れていたら、着いても見つからない（m）。救助隊は電話をかけ直すか、まわりを探す */
  movedAwayM: 150,
  /** かけ直して場所を確かめ直したあと、向かい直すまでの時間（分） */
  relocateMin: 30,
  /** 通報した場所から離れた人を探すときの見つけやすさ: 1 / (1 + (距離 / この長さ)²) */
  movedFindScaleM: 250,
  /** 地上隊が道から探す範囲の外でも、笛の音が届けば気づく距離（森の中） */
  whistleExtraM: 150,
  /** 沢を下っている・沢床にいる人の見つけやすさ（谷の底で上からも横からも見えにくい。ユーザーの指定で 0.5 → 0.3） */
  deepDrainageF: 0.3,
  /**
   * 通りかかる登山者（ユーザーの指定。src/sim/rescue/passersby.ts）。busyPerHour は土日祝に、登山道のある一点を 1 時間に通る組の数（道の区分ごと）。
   * 平日は weekdayF 倍（8 分の 1）。雨・荒天・冬は減り、夜と from〜to の外は通らない。気づく距離は見える・声・笛
   */
  passerby: {
    busyPerHour: { T1: 2, T2: 1, T3: 0.4 } as Record<string, number>,
    /** 沢床（地図の沢のセル）を通る割合がこれを超える道は沢登りのルートとし、土日祝でも 1 時間にこれだけ */
    streamShareMin: 0.4,
    streamPerHour: 0.15,
    weekdayF: 1 / 8,
    rainMmH: 2,
    rainF: 0.3,
    stormThunder: 0.3,
    stormWindMs: 15,
    stormF: 0.1,
    winterF: 0.3,
    from: '07:00',
    to: '16:30',
    noticeP: 0.9,
    seeM: 40,
    voiceM: 120,
    whistleM: 300,
    checkEveryTicks: 6,
    /** この距離より近くにいる人たちは同じ所にいるとして、通るかのサイコロを 1 回だけ振る（m） */
    sameSpotM: 300,
  },
  /** 居場所の分からない人を上空から探すとき、森の中にいる人の見つけやすさ */
  blindForestF: 0.6,
  /** 地上隊: 道から外れた人は、探している道からの距離でも見つけにくくなる（1 / (1 + 距離 / この長さ)） */
  groundOffTrailScaleM: 400,
  /** 救助隊と接触した登山者の近くにいる仲間も一緒に収容する距離 */
  contactRadiusM: 300,
};

/** docs/07 §6 思考 */
export const thoughts = {
  minGapMin: 15,
  maxGapMin: 30,
  noRepeatMin: 240,
  scenarioPriorityBonus: 10,
};
