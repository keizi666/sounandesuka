/**
 * 1 ティックの処理（docs/03 §4）。順番は固定（変えると決定論テストが壊れる）。
 *  1 時刻 / 2 太陽 / 3 全体気象 / 4 地面 / 5 気象・暗さの変化イベント / 6 スクリプトイベント / 7 分岐点
 *  8 登山者（a 局地気象 b 認知 c 自律行動 d 移動 e 危険 f 生理 g 機器 h 判断力・生死）
 *  9 パーティ（8d に含む） / 10 救助 / 11 結末 / 12 記録（ループ側）
 * 条件の event・atNode は、直前のティックに出たイベント（world.recentEvents）で判定する。
 */
import { finishTask, autonomous, stepState } from '../climber/behavior';
import { updateCapacity } from '../climber/capacity';
import { drainDevices } from '../climber/devices';
import { stepHutNearby } from '../climber/hutNearby';
import { stepHelpRunners } from '../climber/carry';
import { awarenessCheck } from '../climber/navigation';
import { groupLeader, moveParty, type MoveOutcome } from '../climber/party';
import { applyActions } from '../climber/actions';
import { groupsMinute } from '../climber/groups';
import { maybeSpeak } from '../climber/speech';
import { maybeThink } from '../climber/thoughts';
import { lightningCheck } from '../hazards/lightning';
import { injuryTimers, slipCheck, stepDebility } from '../hazards/slip';
import { stepRescue } from '../rescue/rescue';
import { chance } from './rng';
import { updateTimeBehind, updateWeatherImpression } from '../climber/perception';
import { integrateBody, thermalEnvFor, updateAnxiety } from '../climber/physiology';
import { stepIllness } from '../climber/illness';
import { autoResolve, checkChoices } from '../scenario/choices';
import { checkEnding } from '../scenario/endings';
import { runEvents, weatherEvents } from '../scenario/events';
import type { ClimberState, StaticContext, World } from '../types';
import { updateGlobal } from '../weather/global';
import { updateGround } from '../weather/ground';
import { updateClimberLocal } from '../weather/local';
import { updateSun } from '../weather/sun';
import { scenarioStartMin } from './clock';

/** シミュレーションの固定刻み（ゲーム内秒） */
export const DT_SEC = 10;
/** 1 ゲーム分あたりのティック数 */
export const TICKS_PER_MIN = 60 / DT_SEC;

/** 1〜4: 時刻・太陽・全体気象・地面だけを進める。1 ゲーム分の区切りなら true */
export function stepEnvironment(world: World, ctx: StaticContext): boolean {
  // 1. 時刻（足し算の誤差をためないよう、開始時刻とティック数から求める）
  world.tick += 1;
  world.tMin = scenarioStartMin(ctx.scenario) + world.tick / TICKS_PER_MIN;
  const minuteTick = world.tick % TICKS_PER_MIN === 0;
  // 2〜4. 太陽・全体気象・地面
  updateSun(world, ctx);
  updateGlobal(world, ctx);
  if (minuteTick) updateGround(world, ctx);
  return minuteTick;
}

export function stepWorld(world: World, ctx: StaticContext): void {
  if (world.ended) return;
  if (world.pendingChoice && ctx.mode === 'interactive') return;
  const evStart = ctx.events.length;
  const minuteTick = stepEnvironment(world, ctx);
  // 5. 気象・暗さの変化（リーダーの前のティックの局地気象）
  weatherEvents(world, ctx);
  // 6〜7. スクリプトイベントと分岐点（回答待ちの間は評価しない）
  let hold = false;
  if (!world.pendingChoice) {
    runEvents(world, ctx);
    if (!world.ended && checkChoices(world, ctx)) {
      if (ctx.mode === 'interactive') return finish(world, ctx, evStart);
      // 判断時間制限モード: UI が答えるか時間切れになるまで立ち止まって待つ
      if (ctx.mode === 'timed') hold = true;
      else autoResolve(world, ctx, ctx.mode === 'headless' ? 'policy' : 'bias');
    }
  } else {
    hold = true; // 判断時間制限モード: 登山者は立ち止まって待つ
  }
  if (world.ended) return finish(world, ctx, evStart);
  // 8a〜c. 局地気象・認知・自律行動・状態の終了判定
  updateClimberLocal(world, ctx);
  for (const c of world.climbers) {
    if (!c.body.alive) continue;
    updateWeatherImpression(c);
    if (minuteTick) {
      updateTimeBehind(world, ctx, c);
      autonomous(world, ctx, c);
      // 気づき（道迷いの判断はグループのリーダー。loose のグループでは各自）
      const isLead = groupLeader(world, c.groupId) === c;
      if (c.state === 'OFFROUTE_UNAWARE' && (isLead || looseGroup(world, c.groupId))) awarenessCheck(world, ctx, c);
      // loose で先頭とはぐれて迷いに気づいた人は、来た道を戻る（分岐点はリーダーにしか出ない）
      if (!isLead && c.state === 'LOST_AWARE' && looseGroup(world, c.groupId)) applyActions(world, ctx, [{ type: 'backtrack' }], [c], c);
      maybeThink(world, ctx, c);
    }
    finishTask(world, ctx, c);
    stepState(world, ctx, c);
  }
  // グループ: loose の人数確認、リーダー交代の通知
  if (minuteTick) groupsMinute(world, ctx);
  // セリフ（thoughts ストリームのみ。結果に影響しない）
  if (minuteTick) maybeSpeak(world, ctx);
  // すぐそこに小屋があれば、歩ける人は小屋へ。小屋に仲間がいれば、小屋の人が動けない人を運び込む
  stepHutNearby(world, ctx);
  stepHelpRunners(world, ctx);
  // 8d・9. 移動（tight のグループは一緒に）
  const moves = moveParty(world, ctx, DT_SEC, hold);
  // 8e〜h. 危険・生理・機器・判断力
  for (const c of world.climbers) stepBody(world, ctx, c, moves[c.id]);
  // 10. 救助
  stepRescue(world, ctx, DT_SEC / 60);
  // 11. 結末
  checkEnding(world, ctx);
  finish(world, ctx, evStart);
}

function looseGroup(world: World, gid: string | null): boolean {
  for (const g of world.groups) if (g.id === gid) return g.cohesion === 'loose';
  return false;
}

function finish(world: World, ctx: StaticContext, evStart: number): void {
  world.recentEvents = ctx.events.slice(evStart).map((e) => ({
    type: e.type,
    climberId: e.climberId ?? null,
    node: typeof e.data?.['node'] === 'string' ? (e.data['node'] as string) : null,
  }));
}

function dtMinOf(): number {
  return DT_SEC / 60;
}

function stepBody(world: World, ctx: StaticContext, c: ClimberState, move: MoveOutcome | undefined): void {
  // 死亡した人と、救助隊に収容された人（接触の時点で結果が確定する。docs/08 §5.2）、下山した人（里に戻った）は体の計算を進めない
  if (!c.body.alive || c.state === 'RESCUED' || c.state === 'FINISHED') {
    c.speedMs = 0;
    c.metAct = 0;
    return;
  }
  const t = ctx.tuning;
  const walking = move?.walking ?? false;
  if (!walking) {
    c.speedMs = 0;
    c.metAct = t.physiology.stateMet[c.state] ?? t.movement.restMet;
    // 止まって休んだ分、次の休みまでの時間が戻る（昼食や小屋で休んだら、出てすぐには休まない）
    c.memo.walkSinceRestMin = Math.max(0, c.memo.walkSinceRestMin - dtMinOf() * t.behavior.restRecoverF);
  } else {
    c.metAct = move!.met;
    if (c.state === 'WALKING') c.memo.walkSinceRestMin += dtMinOf();
  }
  // 歩いた記録（行動時間・距離・累計標高）
  const trip = (c.trip ??= { activeMin: 0, distM: 0, upM: 0, downM: 0 });
  // 行動時間は出発からの経過（歩いている間だけでなく、休む・待つ・ビバークの間も進む。ユーザーの指定）
  trip.activeMin += dtMinOf();
  if (move && move.movedM > 0) {
    trip.distM += move.movedM;
    const dh = move.grade * move.movedM;
    if (dh > 0) trip.upM += dh;
    else trip.downM -= dh;
  }
  // 暗くなってから小屋にいた（小屋で夜を過ごした）
  if (c.body.shelterNodeId && world.sun.isDark) c.memo.sheltered = true;
  const dtMin = DT_SEC / 60;
  // 8e. 危険（10 m ごとの転倒、落雷、負傷の経過）
  if (move && move.movedM > 0) {
    const checks = Math.floor(move.movedM / 10);
    const extra = chance(world.rng.hazard, (move.movedM - checks * 10) / 10) ? 1 : 0;
    for (let k = 0; k < checks + extra && c.body.alive; k += 1) slipCheck(world, ctx, c, move.grade);
  }
  lightningCheck(world, ctx, c, dtMin);
  injuryTimers(world, ctx, c);
  stepDebility(world, ctx, c, DT_SEC / 60, walking);
  if (!c.body.alive) return;
  // 8f. 生理
  const env = thermalEnvFor(world, ctx, c);
  integrateBody(c, env, { metAct: c.metAct, grade: move?.grade ?? 0, walking }, dtMin, t);
  // 初めて沢の水を飲んだ（のどが渇いていて、沢に手が届く）ときに、ログに 1 行
  if (env.streamWater && c.body.conscious && c.body.waterDeficitL > t.physiology.streamDrinkFromL && world.latches[`streamDrink:${c.id}`] !== true) {
    world.latches[`streamDrink:${c.id}`] = true;
    ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, data: { streamDrink: true } });
  }
  // 急病の経過（症状の治まり・ぶり返し、心停止）
  if (c.body.illness) {
    stepIllness(world, ctx, c, dtMin, walking, move?.grade ?? 0);
    if (!c.body.alive) return;
  }
  updateAnxiety(world, c, dtMin, t);
  // 8g. 機器
  drainDevices(world, ctx, c, dtMin);
  // 8h. 判断力・運動能力・段階・生死
  const checkTick = world.tick % (t.physiology.arrestCheckMin * TICKS_PER_MIN) === 0;
  updateCapacity(world, ctx, c, checkTick);
}
