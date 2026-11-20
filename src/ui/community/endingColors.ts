/**
 * 結末の色（振り返りの What-if の帯 src/ui/debrief.ts の KIND_COLOR に合わせる）。
 * 暗い背景の上で見えるように、行方不明と死亡だけ明るめの灰色にしている。
 */
export const ENDING_COLOR: Record<string, string> = {
  SAFE_RETURN: '#16a34a', SAFE_SHELTER: '#22c55e', ABORTED: '#65a30d', SELF_RESCUE: '#ca8a04',
  RESCUED: '#d97706', RESCUED_CRITICAL: '#ea580c', MISSING: '#7c8594', FATAL: '#a3abb8',
};
