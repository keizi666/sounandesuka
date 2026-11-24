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
  /** ビバーク・救助待ちをしようとしたとき、これより近くに開いている小屋があれば、歩ける人は小屋へ入る（m） */
  hutNearM: 500,
  /**
   * 見通しが悪いと、すぐそこの小屋も見つけられない（s17 立山: 吹雪と夕闇で内蔵助山荘への下り口が分からなかった）。
   * 小屋へ向かう距離は min(hutNearM, max(hutSeeMinM, その場の見通し × hutSeeVisF))。s18 の頂上宿舎（160 m）は吹雪でも向かえる
   */
  hutSeeMinM: 200,
  hutSeeVisF: 2,
  /** 小屋に仲間が入っていて、これより近くで動けない人がいれば、小屋の人が運び込む（m・分） */
  hutHelpM: 600,
  hutHelpDelayMin: 30,
  /** すぐそこの小屋へ向かう人が、計算上は進めなくても這って進める速さ（m/s） */
  hutCrawlMs: 0.15,
  /** 歩いていても、この分でこの m も進んでいなければ止まっているとみなす（小屋がすぐそこなら、歩ける人は列を離れて小屋へ） */
  hutStallMin: 30,
  hutStallM: 30,
  /** この人数以上の列で歩けない人が出たら、付き添いを残して残りは先へ（大人数のパーティ。少人数は肩を貸すなど全員で動く） */
  leaveBehindMinSize: 6,
  /** 歩けない仲間を支えて（背負って）運ぶときの列の速さの倍率（ユーザーの指定: 両側から支えて進む） */
  carryPaceF: 0.35,
  /** 救助を呼びに行く人の速さの倍率（急ぐ） */
  helpRunPaceF: 1.1,
  /** 呼びに行った人が知らせる、けが人を残した場所の確かさ（m） */
  helpReportRadiusM: 150,
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
  /**
   * 食べる（ユーザーの指定: 決まった間隔で機械的に食べず、お腹が減ってから食べる）。
   * 空腹 = グリコーゲン＋胃に残っている食べ物（吸収される分）が eatHungryKcal を切ったとき（出発時 1,500 kcal から、ふつうの登りで 2 時間ほど）。
   * 食べる習慣のない人（habits.eatEveryMin が null）は空腹でも後回しにし、エネルギーが尽きかける（eatLowGlycogenKcal）まで食べない
   */
  eatHungryKcal: 1200,
  /**
   * 空腹で食べるときは満ちるまで: 1 回の量 = eatFullKcal −（グリコーゲン＋胃の中）を eatKcal〜eatMaxKcal に収める（エネルギーが尽きかけたときは eatKcal）。
   * ユーザーの指定: 一度に食べすぎない。1 回 200 kcal まで
   */
  eatFullKcal: 1600,
  eatMaxKcal: 200,
  /** ユーザーの指定: 行動食の残りが持ってきた量のこの割合を切ったら節約し、空腹は我慢する（エネルギーが尽きかける eatLowGlycogenKcal まで食べない） */
  eatEndureBelowF: 0.5,
  /** 続けて食べるときの間隔（分。空腹でも、エネルギーが尽きかけていても）。200 kcal を食べてすぐまた食べると、一度に食べすぎるのと同じになる */
  eatGapMin: 30,
  eatLowGlycogenKcal: 450,
  /** 力が入らない（シャリバテ）と感じるグリコーゲン（kcal）。考え・画面の表示だけに使う */
  bonkFeelKcal: 300,
  eatHabitP: 0.8,
  eatLowP: 0.5,
  eatForgetBelowJ: 0.3,
  eatForgetP: 0.05,
  eatMin: 3,
  eatKcal: 200,
  /**
   * 飲む: 喉の渇き（ユーザーの指定）。感じる不足 = 体の水分不足 × 寒さ（寒いと渇きを感じにくい）× 暑さ（汗で口が渇く）× 年齢。
   * 感じる不足が thirstStartL を超えると渇きを感じ、渇きの強さ t（0〜1）= (感じる不足 − start) / span。
   * ユーザーの指定: 30 分ごとに機械的に飲まず、体の水分がある程度減って喉が渇いてから飲む。
   * 渇いたら渇きが癒えるまで飲む: 1 回に飲む量 = 体の水分不足 − drinkQuenchL（不足をそこまで戻す）を drinkSipL〜drinkMaxL に収める。
   * 飲めば渇きは消えるので、次に飲むのはまた渇いたとき（ふつうの登りで 1 時間ほどあと）。
   * 渇いたまま次に飲むまでの間隔は、渇きが強いほど短い（drinkGapMaxMin → drinkGapMinMin）。休憩中は短め
   */
  thirstStartL: 0.5,
  thirstSpanL: 1.0,
  thirstColdF: [
    [-5, 0.6],
    [5, 0.75],
    [15, 1],
  ],
  thirstHeatF: [
    [20, 1],
    [30, 1.3],
  ],
  thirstOlderAge: 60,
  thirstOlderF: 0.85,
  drinkP: 0.3,
  drinkMin: 1,
  /** ユーザーの指定: 一度に飲みすぎない。1 回 150 mL まで */
  drinkSipL: 0.1,
  drinkMaxL: 0.15,
  /** ユーザーの指定: 水筒の残りが持ってきた量のこの割合以下になったら、体の水分不足が体重の drinkEndureBodyF（2%）になるまでは我慢する */
  drinkEndureBelowF: 0.5,
  drinkEndureBodyF: 0.02,
  drinkQuenchL: 0.15,
  drinkGapMaxMin: 25,
  drinkGapMinMin: 8,
  drinkRestGapF: 0.6,
  /**
   * 残りを気にして控える（ユーザーの指定）: 残りが持ってきた量のこの割合を切ると、1 回の量にこの倍率を掛ける（[残りの割合, 倍率] の昇順）。
   * 道に迷った・救助を待つ・ビバークのとき（いつ補えるか分からない）は、さらに rationUnsureF を掛ける
   */
  rationWaterF: [
    [0.1, 0.4],
    [0.25, 0.55],
    [0.5, 0.8],
    [0.6, 1],
  ],
  rationFoodF: [
    [0.1, 0.35],
    [0.25, 0.5],
    [0.5, 0.75],
    [0.6, 1],
  ],
  rationUnsureF: 0.75,
  /** 二日酔いの吐き気が残る時間（出発から。時間）と、そのあいだに食べられる量の倍率 */
  hangoverNauseaH: 6,
  hangoverEatF: 0.4,
  /** 決まった間隔で休む習慣（50 分歩いて 10 分。P2 のコースタイム検証と同じ前提） */
  habitRestEveryMin: 50,
  habitRestMin: 10,
  /** 止まっている 1 分で、休みなしで歩いた時間をこれだけ減らす（昼食や小屋で休んだら、出てすぐには休まない） */
  restRecoverF: 5,
  /** 休む時間になっても、行く先のこの距離（m）の中に小屋があれば、小屋まで歩いてそこで休む */
  hutAheadM: 700,
  /** 小屋に着いたとき、休む時間までこれ以内（分）なら、小屋で休んでいく */
  hutEarlyMin: 20,
  /** 疲れて休む */
  restFatigue: 75,
  /** これより疲れていたら、小屋が近くてもその場で休む */
  restFatigueNow: 90,
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
  /** ビバーク・小屋などで止まっている人が寝る時刻（その日の何分。ユーザーの指定: 22 時から朝まで寝て、飲み食いしない） */
  sleepFromClockMin: 22 * 60,
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
  /**
   * 結果の画面の「選択の振り返り」（ユーザーの指定: どれが良かった・悪かった・意味がなかったか）。
   * 分岐点の場面から選択肢ごとに乱数を変えて走らせ（What-if）、結末の悪さの平均で比べる。
   * 悪さ: 結末ごとの重み（0 が最良、1 が最悪）
   */
  verdictWeight: { ABORTED: 0, SAFE_RETURN: 0, SAFE_SHELTER: 0.05, SELF_RESCUE: 0.3, RESCUED: 0.4, RESCUED_CRITICAL: 0.7, MISSING: 0.9, FATAL: 1 },
  /** いちばん良い選択肢といちばん悪い選択肢の差がこれ未満なら「どれを選んでも、ほとんど変わらない」 */
  verdictSameSpread: 0.06,
  /** 差を「はっきりした差」とみなす z（試算の回数が少ないので、揺れの幅を見る） */
  verdictZ: 1.5,
  /** いちばん良い選択肢との差がこれ未満なら「良い判断」、これ以上で、はっきりした差なら「悪い判断」。間は「まずまず」 */
  verdictGoodMargin: 0.05,
  /** どれを選んでも変わらないとき、いちばん良い選択肢の悪さがこれ以上なら「手遅れ」（ユーザーの指定。救助や行方不明・死亡がほとんど） */
  verdictLateMean: 0.4,
  verdictBadMargin: 0.15,
};

/** docs/02 §5 結末 */
export const endings = {
  /** 収容時にこれ未満なら RESCUED_CRITICAL */
  /** これより体温が低いまま収容されたら、重い状態での救助（重度の低体温症） */
  rescuedCriticalCoreC: 33.5,
};
