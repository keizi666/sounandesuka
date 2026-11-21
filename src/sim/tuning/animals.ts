/** 調整定数: 野生動物（src/sim/hazards/animals.ts。シナリオの効果 animal で出る） */

interface SpeciesTuning {
  /** 既定のふるまい */
  behavior: 'graze' | 'watch' | 'wander' | 'cross' | 'flee';
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
}

export const animals = {
  species: {
    // ツキノワグマ: 多くは人に気づくと離れる。見つけた側の動揺は大きい
    bear: { behavior: 'watch', durationMin: 10, noticeM: 90, fleeM: 35, anxiety: 12, walkMs: 0.8, runMs: 3 },
    brownBear: { behavior: 'watch', durationMin: 10, noticeM: 120, fleeM: 50, anxiety: 18, walkMs: 0.9, runMs: 3 },
    // ニホンジカ: 群れで草を食み、近づくと跳ねて逃げる
    deer: { behavior: 'graze', durationMin: 20, noticeM: 90, fleeM: 30, anxiety: 0, walkMs: 0.7, runMs: 4 },
    // カモシカ: 立ち止まってじっとこちらを見ることが多い
    serow: { behavior: 'watch', durationMin: 15, noticeM: 70, fleeM: 15, anxiety: 0, walkMs: 0.5, runMs: 2.5 },
    boar: { behavior: 'wander', durationMin: 10, noticeM: 60, fleeM: 25, anxiety: 5, walkMs: 0.6, runMs: 3.5 },
    monkey: { behavior: 'wander', durationMin: 25, noticeM: 60, fleeM: 8, anxiety: 2, walkMs: 0.6, runMs: 2.5 },
  } as Record<string, SpeciesTuning>,
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
};
