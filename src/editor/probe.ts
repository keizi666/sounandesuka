/**
 * 試走を使った確認: 条件が初めて真になる時刻、分岐点が出た時点の World（文の展開プレビュー用）。推奨方針・シナリオのシードで 1 回走らせる。
 */
import { formatTimeRef } from '../sim/core/clock';
import { partyLeader } from '../sim/climber/party';
import { runHeadless } from '../sim/headless';
import { evalCondition } from '../sim/scenario/conditions';
import { scopeFor } from '../sim/scenario/choices';
import type { Condition, World } from '../sim/types';
import type { Ed } from './context';

export function firstTrueTime(ed: Ed, cond: Condition): string {
  const rt = ed.runtime();
  if (!rt) return '地形がありません';
  const hasChance = JSON.stringify(cond).includes('"chance"');
  let found: number | null = null;
  try {
    runHeadless(rt, ed.p.scenario, {
      policy: 'recommended',
      record: false,
      onTick(w, ctx) {
        if (found !== null) return;
        // chance は乱数を引くので、写しで評価する（試走の結果を変えない）
        const ww = hasChance ? (JSON.parse(JSON.stringify(w)) as World) : w;
        if (evalCondition(cond, scopeFor(ww, ctx, partyLeader(ww)), 'probe')) found = w.tMin;
      },
    });
  } catch (e) {
    return `試走できませんでした: ${String(e instanceof Error ? e.message : e)}`;
  }
  return found === null ? '推奨方針の試走では一度も真になりませんでした' : `推奨方針の試走で ${formatTimeRef(found)} に初めて真`;
}

/** 分岐点が出たときの World（出なければ null） */
export function worldAtChoice(ed: Ed, cpId: string): World | null {
  const rt = ed.runtime();
  if (!rt) return null;
  let snap: World | null = null;
  try {
    runHeadless(rt, ed.p.scenario, {
      policy: 'bias',
      record: false,
      onTick(w, _ctx, evs) {
        if (!snap && evs.some((e) => e.type === 'CHOICE_FIRED' && e.data?.['cp'] === cpId)) snap = JSON.parse(JSON.stringify(w)) as World;
      },
    });
  } catch {
    return null;
  }
  return snap;
}
