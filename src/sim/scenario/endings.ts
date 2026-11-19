/**
 * 結末の判定（docs/02 §5、docs/09 §9）。全員が終端状態になるか制限時刻で終わり、最も悪い結末を採る。
 */
import { parseTimeRef } from '../core/clock';
import { partyLeader } from '../climber/party';
import type { ClimberState, DeathCause, EndingKind, StaticContext, World } from '../types';
import { evalCondition } from './conditions';
import { scopeFor } from './choices';
import { expandText } from './text';
import { resolveVar, type VarValue } from './vars';

/** 悪い順（大きいほど悪い） */
export const ENDING_SEVERITY: Record<EndingKind, number> = {
  ABORTED: -1,
  SAFE_RETURN: 0,
  SAFE_SHELTER: 1,
  SELF_RESCUE: 2,
  RESCUED: 3,
  RESCUED_CRITICAL: 4,
  MISSING: 5,
  FATAL: 6,
};

const TERMINAL = new Set(['FINISHED', 'RESCUED', 'DEAD']);

/** 一人ひとりの結末 */
export function climberOutcome(c: ClimberState, ctx: StaticContext): EndingKind {
  const b = c.body;
  if (!b.alive || c.state === 'DEAD') return 'FATAL';
  if (c.state === 'RESCUED') {
    return b.coreC < ctx.tuning.endings.rescuedCriticalCoreC || b.injury === 'severeTrauma' ? 'RESCUED_CRITICAL' : 'RESCUED';
  }
  if (c.state === 'FINISHED') {
    if (c.memo.bivouacked) return 'SELF_RESCUE';
    if (c.memo.sheltered) return 'SAFE_SHELTER';
    return 'SAFE_RETURN';
  }
  // 制限時刻に山中にいる
  if (c.state === 'SHELTERED' && b.shelterNodeId) return 'SAFE_SHELTER';
  // 小屋泊・ビバークの後、元気に下山している途中なら「翌朝以降に安全に下山」と同じ扱い
  // 打撲は元気なうちに数える
  const healthy = b.coreC >= 35 && (b.injury === 'none' || b.injury === 'bruise') && !c.perception.awareLost && c.pos.mode !== 'free';
  if (healthy && (c.state === 'WALKING' || c.state === 'RESTING')) {
    if (c.memo.bivouacked) return 'SELF_RESCUE';
    if (c.memo.sheltered) return 'SAFE_SHELTER';
  }
  return 'MISSING';
}

export function worstOutcome(climbers: readonly ClimberState[], ctx: StaticContext): EndingKind {
  let worst: EndingKind = 'SAFE_RETURN';
  for (const c of climbers) {
    const k = climberOutcome(c, ctx);
    if (ENDING_SEVERITY[k] > ENDING_SEVERITY[worst]) worst = k;
  }
  return worst;
}

/** 終了を判定し、終わっていれば world.ended を立てる（docs/03 §4 の 11） */
export function checkEnding(world: World, ctx: StaticContext): boolean {
  if (world.ended) return true;
  const allTerminal = world.climbers.every((c) => TERMINAL.has(c.state));
  const timeUp = world.tMin >= parseTimeRef(ctx.scenario.timeLimit);
  if (!allTerminal && !timeUp) return false;
  const kind = worstOutcome(world.climbers, ctx);
  world.ended = { kind, atMin: world.tMin };
  ctx.events.push({ tMin: world.tMin, type: 'ENDED', important: true, data: { kind, timeUp } });
  return true;
}

export interface EndingText {
  kind: EndingKind;
  title: string | null;
  text: string | null;
  perClimber: { id: string; state: ClimberState['state']; cause: DeathCause | null; outcome: EndingKind }[];
}

/**
 * シナリオの endings を上から評価し、kind が一致して when が真の最初の定義の文を使う。
 * なければ title / text は null（UI が i18n の既定文を出す）。
 */
export function resolveEnding(world: World, ctx: StaticContext, rec?: Record<string, VarValue | null>): EndingText | null {
  if (!world.ended) return null;
  const kind = world.ended.kind;
  const scope = { ...scopeFor(world, ctx, partyLeader(world)), rec };
  let title: string | null = null;
  let text: string | null = null;
  ctx.scenario.endings.some((e, i) => {
    if (e.kind !== kind) return false;
    if (e.when && !evalCondition(e.when, scope, `endings[${i}].when`)) return false;
    // 文の {leader.name} などを展開する（分岐点・ログと同じ書き方ができる）
    title = expandText(e.title, (p) => resolveVar(p, scope));
    text = expandText(e.text, (p) => resolveVar(p, scope));
    return true;
  });
  return {
    kind,
    title,
    text,
    perClimber: world.climbers.map((c) => ({ id: c.id, state: c.state, cause: c.body.deathCause, outcome: kind === 'ABORTED' ? 'ABORTED' : climberOutcome(c, ctx) })),
  };
}
