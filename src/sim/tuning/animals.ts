/** 調整定数: 野生動物（src/sim/hazards/animals.ts。シナリオの効果 animal で出る） */

interface SpeciesTuning {
  /** 既定のふるまい */
  behavior: 'graze' | 'watch' | 'wander' | 'cross' | 'flee' | 'stalk';
  /** 既定の、立ち去るまでの分 */
  durationMin: number;
  /** 昼に見つけられる距離（m。視程と暗さで縮む） */
  noticeM: number;
  /** 人がこの距離まで近づくと立ち去る（m） */
  fleeM: number;
  /** 見つけたときの不安の増え方（そのグループの全員） */
  anxiety: number;
  /** 歩く・立ち去る速さ（m/s） */
  walkMs: number;
  runMs: number;
  /**
   * 襲ってくる確率（人が fleeM まで近づいた 1 回の出会いごと。ゲームの値で、統計にもとづく値ではない）。
   * approach: 熊に気づいたうえで近づいた / surprise: 気づかないうちに近づいた（鉢合わせ。霧・夜・見通しの悪さ）
   */
  attackApproachP: number;
  attackSurpriseP: number;
  /** 襲われたときのけがの割合（bruise, sprain, legFracture, headInjury, severeTrauma, death の順） */
  attackInjury: number[];
}

const NO_ATTACK = { attackApproachP: 0, attackSurpriseP: 0, attackInjury: [] as number[] };

export const animals = {
  species: {
    // ツキノワグマ: 多くは人に気づくと離れる。見つけた側の動揺は大きい
    // 襲われると、引っかき傷・かみ傷（多くは頭や顔・腕）。ツキノワグマで命を落とすことはまれ
    bear: { behavior: 'watch', durationMin: 10, noticeM: 90, fleeM: 35, anxiety: 12, walkMs: 0.8, runMs: 3, attackApproachP: 0.04, attackSurpriseP: 0.2, attackInjury: [0.5, 0.1, 0.05, 0.3, 0.05, 0] },
    brownBear: { behavior: 'watch', durationMin: 10, noticeM: 120, fleeM: 50, anxiety: 18, walkMs: 0.9, runMs: 3, attackApproachP: 0.06, attackSurpriseP: 0.3, attackInjury: [0.25, 0.05, 0.1, 0.25, 0.25, 0.1] },
    // ニホンジカ: 群れで草を食み、近づくと跳ねて逃げる
    deer: { behavior: 'graze', durationMin: 20, noticeM: 90, fleeM: 30, anxiety: 0, walkMs: 0.7, runMs: 4, ...NO_ATTACK },
    // カモシカ: 立ち止まってじっとこちらを見ることが多い
    serow: { behavior: 'watch', durationMin: 15, noticeM: 70, fleeM: 15, anxiety: 0, walkMs: 0.5, runMs: 2.5, ...NO_ATTACK },
    boar: { behavior: 'wander', durationMin: 10, noticeM: 60, fleeM: 25, anxiety: 5, walkMs: 0.6, runMs: 3.5, ...NO_ATTACK },
    monkey: { behavior: 'wander', durationMin: 25, noticeM: 60, fleeM: 8, anxiety: 2, walkMs: 0.6, runMs: 2.5, ...NO_ATTACK },
  } as Record<string, SpeciesTuning>,
  /** 襲う確率: 襲われそうな人が止まっているときの倍率、グループの人数 n で ÷(1 + groupK × (n − 1)) */
  attackStillF: 0.3,
  attackGroupK: 0.2,
  /** 襲われたときの、そのグループの不安の増え方 */
  attackAnxiety: 25,
  /** 熊が人に向かってくる時間（分）。そのあと立ち去る */
  chargeMin: 0.15,
  /** 向かってきて止まる所（襲った人からの距離 m） */
  chargeStopM: 1.5,
  /** 暗いときに見つけられる距離の倍率 */
  darkNoticeF: 0.25,
  /** 立ち去り始めてから消えるまで（分） */
  leaveMoveMin: 1.5,
  /** cross: 横切る道筋の長さ（m） */
  crossM: 40,
  /** wander: うろつく輪の半径（m）と一周の分 */
  wanderR: 6,
  wanderPeriodMin: 6,
  /** 一度に出せる頭数の上限 */
  maxCount: 6,
  /** 立ち去るとき、この距離（m）以内の人から離れる向きへ */
  awayFromM: 300,
  /**
   * stalk（付きまとう熊）: 近づく速さ（歩く速さの倍率）、襲わなかったあとに止まっている分、
   * いちばん近い人がこの距離（m）より離れたらあきらめて立ち去る。ゲームの値
   */
  stalkSpeedF: 1.5,
  stalkRestMin: 20,
  stalkGiveUpM: 800,
};
