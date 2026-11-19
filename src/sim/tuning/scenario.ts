/** 調整定数: 行動・自律ミクロ行動・分岐点・結末（docs/07 §2・§4、docs/09、docs/02 §5） */

/** docs/07 §4 自律ミクロ行動、docs/09 §6 アクション */
export const behavior = {
  /** グループ（docs/07 §1.4、docs/09 §3.1） */
  /** weak の基準。docs/09 §3.1 の初版は 35.0 だったが、s04 では分割の時点で全員が 35℃ 未満になり下山組ができないため 34.0 にした（DECISIONS P19） */
  weakCoreBelowC: 34,
  weakMBelow: 0.5,
  headcountEveryMin: 30,
  headcountPBase: 0.5,
  stragglerDistM: 100,
  /** tight のグループで、この距離より離れた仲間は自分で歩いて合流する */
  regroupDistM: 30,
  /** この人数以上の tight のグループでは、歩行中の食事・水分・重ね着・疲労休憩をリーダーの休憩に合わせる */
  groupSyncMinSize: 4,
  /** 強い雨の中で着替えたときの冷え（℃） */
  changeDryChillC: 0.1,
  changeDryChillPrecipMmH: 1,
  /** 雨具を着る */
  rainwearPrecipMmH: 1,
  rainwearP: 0.25,
  rainwearUrgentP: 0.6,
  rainwearUrgentWetness: 0.5,
  rainwearMin: 4,
  /** 寒冷ストレス（core < 36）で細かい作業の時間 ×1.5、手袋なしで気温 < 5℃ なら ×2 */
  coldTaskF: 1.5,
  noGlovesTaskF: 2,
  noGlovesBelowC: 5,
  /** 防寒着を足す */
  layerCoreBelowC: 36.4,
  layerWindChillBelowC: 0,
  layerP: 0.3,
  layerMin: 3,
  /** 食べる */
  eatLowGlycogenKcal: 450,
  eatHabitP: 0.8,
  eatLowP: 0.5,
  eatForgetBelowJ: 0.3,
  eatForgetP: 0.05,
  eatMin: 3,
  eatKcal: 300,
  /** 飲む */
  drinkDeficitL: 0.5,
  drinkP: 0.3,
  drinkMin: 1,
  drinkL: 0.5,
  /** 決まった間隔で休む習慣（50 分歩いて 10 分。P2 のコースタイム検証と同じ前提） */
  habitRestEveryMin: 50,
  habitRestMin: 10,
  /** 疲れて休む */
  restFatigue: 75,
  restP: 0.5,
  restMin: 10,
  /** ヘッドランプ */
  lampP: 0.7,
  lampInPackMin: 3,
  /** 雨具を脱ぐ */
  unwearDryMin: 30,
  unwearCoreAboveC: 37.3,
  unwearP: 0.1,
  unwearMin: 3,
  /** アクション */
  stopAndCheckMin: 10,
  removeMetalMin: 5,
  changeDryWetnessF: 0.4,
  changeDryMin: 10,
  paceMin: 0.6,
  paceMax: 1.2,
  hurryAbove: 1.1,
  /** until: "weatherClears"（docs/09 §6） */
  clearThunderBelow: 0.1,
  clearPrecipBelowMmH: 1,
  clearWindBelowMs: 12,
  clearVisAboveM: 300,
  clearHoldMin: 30,
  /** until: "dawn" = 次の日の出 + この分 */
  dawnAfterSunriseMin: 30,
  /** RAIN_START: リーダー局地の降水がこれ以上になった瞬間。止んでこの分以上たってからの再開でも出す */
  rainStartMmH: 0.5,
  rainRestartGapMin: 30,
  /** 救助要請（P5 は通報まで。出動・収容は P6） */
  callMessageOnlySuccessP: 0.5,
  callMin: 10,
};

/** docs/09 §5 分岐点 */
export const choices = {
  /** 救助を頼んで（場所を伝えて）からは、動く選択肢の重みをこの倍率にする（動かないのが基本。動くと救助が遅れる） */
  movingAfterCallF: 0.25,
  defaultPriority: 10,
  defaultTimeoutSec: 30,
  /** 汎用分岐点 hypothermia の 1 回目と 2 回目（docs/09 §7） */
  genericHypothermiaC: 35.3,
  genericHypothermia2C: 34.0,
};

/** docs/02 §5 結末 */
export const endings = {
  /** 収容時にこれ未満なら RESCUED_CRITICAL */
  rescuedCriticalCoreC: 32,
};
