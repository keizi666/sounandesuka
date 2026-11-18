/**
 * 調整用の数値定数（CLAUDE.md 鉄則 4）。
 * sim のコード中に魔法の数値を書かず、ここに集約する。各フェーズで項目を追加する。
 * プレーンな JSON 互換の値だけを入れる。
 */
export const TUNING = {} as const;

export type Tuning = typeof TUNING;
