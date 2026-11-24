/**
 * 結末の判定（docs/02 §5、docs/09 §9）。全員が終端状態になるか制限時刻で終わり、最も悪い結末を採る。
 */
import { parseTimeRef } from '../core/clock';
import { partyLeader } from '../climber/party';
import type { ClimberState, DeathCause, EndingKind, StaticContext, World } from '../types';
import type { Tuning } from '../tuning';
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

/**
 * 小屋の中にいても「無事」とはいえない人（重い高山病・急病の発作中・意識がない）。救助隊はこの人も収容し、
 * 全員が小屋にいても結末にしない（s26 の指摘: 高地脳浮腫の人が小屋にいると無事として終わっていた）
 */
export function seriouslyIll(c: ClimberState, t: Tuning): boolean {
  const b = c.body;
  return b.alive && ((b.ams ?? 0) >= t.altitude.amsModerate || b.illness?.active === true || !b.conscious);
}

/** 一人ひとりの結末 */
export function climberOutcome(c: ClimberState, ctx: StaticContext): EndingKind {
  const b = c.body;
  if (!b.alive || c.state === 'DEAD') return 'FATAL';
  if (c.state === 'RESCUED') {
    // 重い状態での救助: 重度の低体温症・重い外傷・高地脳浮腫・意識がない
    const critical = b.coreC < ctx.tuning.endings.rescuedCriticalCoreC || b.injury === 'severeTrauma' || (b.ams ?? 0) >= ctx.tuning.altitude.amsHace || !b.conscious;
    return critical ? 'RESCUED_CRITICAL' : 'RESCUED';
  }
  if (c.state === 'FINISHED') {
    if (c.memo.bivouacked) return 'SELF_RESCUE';
    if (c.memo.sheltered) return 'SAFE_SHELTER';
    return 'SAFE_RETURN';
  }
  // 制限時刻に山中にいる
  if (c.state === 'SHELTERED' && b.shelterNodeId && !seriouslyIll(c, ctx.tuning)) return 'SAFE_SHELTER';
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
/** 遭難が起きたか（道迷い・ビバーク・救助待ち・動けない・死亡の状態に入った、重いけが・急病、救助の要請） */
function incidentHappened(world: World): boolean {
  if (world.latches['incident'] || world.rescue.calledAtMin !== null) return true;
  return world.climbers.some((c) => !c.body.alive || (c.body.injury !== 'none' && c.body.injury !== 'bruise') || c.body.illness?.active === true || c.memo.bivouacked || c.body.buried !== undefined);
}

/** 亡くなった人がまだ山にいて、救助隊が来る（来ている・届け出の予定がある）か */
function bodiesAwaitRecovery(world: World, ctx: StaticContext): boolean {
  const plan = ctx.scenario.plan;
  if (plan.recoverDead !== true) return false;
  if (!world.climbers.some((c) => c.state === 'DEAD' && c.offMap === undefined)) return false;
  const r = world.rescue;
  if (r.status === 'dispatched' || r.status === 'searching') return true;
  if (r.status === 'contacted') return false;
  return world.flags['reportedMissing'] !== undefined || (plan.reportIfNotBackBy !== null && world.flags['familyNotified'] === undefined);
}

export function checkEnding(world: World, ctx: StaticContext): boolean {
  if (world.ended) return true;
  const allTerminal = world.climbers.every((c) => TERMINAL.has(c.state));
  const timeUp = world.tMin >= parseTimeRef(ctx.scenario.timeLimit);
  // 遭難が起きたあと、生き残った人が全員安全（下山・救助・小屋の中・地図の外）になったら、そこで結末にする（ユーザーの指定）。
  // 遭難の前の予定の小屋泊まりでは終わらない（翌朝のつづきがある）
  // 遭難がなくても、誰かが下山していて、ほかが全員小屋の中なら終わる（予定の小屋泊まりで全員が小屋の中のときは、翌朝につづく）
  const someoneDown = world.climbers.some((c) => c.state === 'FINISHED');
  const allSafe = (incidentHappened(world) || someoneDown) && world.climbers.every((c) => TERMINAL.has(c.state) || c.offMap !== undefined || (c.state === 'SHELTERED' && c.body.shelterNodeId !== null && !seriouslyIll(c, ctx.tuning)));
  if (!allTerminal && !timeUp && !allSafe) return false;
  // 遺体の収容までシミュレートするシナリオ（plan.recoverDead）: 救助隊が来る見込みがあれば、収容されるまで続ける（制限時刻で打ち切る）
  if (!timeUp && bodiesAwaitRecovery(world, ctx)) return false;
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
