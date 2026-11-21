/**
 * 同じ場所を歩く仲間を一列に並べるときの順番（描画だけ。シミュレーションでは同じ位置を歩いている）。
 * ふだんはパーティの順。暗いときは、ヘッドランプのない人を、ランプを持つ人の間に入れる
 * （ユーザーの指定: s20 で「ランプの 2 人で森田さんをはさむ」を選んでも、森田さんが最後尾を歩いていた）。
 */
import type { ClimberState } from '../sim/types';

export function formationOrder(climbers: readonly ClimberState[], dark: boolean): ClimberState[] {
  if (!dark) return [...climbers];
  const out: ClimberState[] = [];
  const done = new Set<string>();
  for (const c of climbers) {
    if (done.has(c.id)) continue;
    const group = climbers.filter((o) => o.groupId === c.groupId && !done.has(o.id));
    const walking = group.filter((o) => o.body.alive);
    const lit = walking.filter((o) => o.inv.headlamp.on);
    const unlit = walking.filter((o) => !o.inv.headlamp.on);
    if (lit.length >= 2 && unlit.length > 0) {
      // 先頭のランプ → ランプのない人 → 残りのランプ（最後尾を照らす）
      const ordered = [lit[0]!, ...unlit, ...lit.slice(1), ...group.filter((o) => !o.body.alive)];
      out.push(...ordered);
    } else out.push(...group);
    for (const o of group) done.add(o.id);
  }
  return out;
}
