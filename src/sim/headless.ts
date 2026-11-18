/**
 * ヘッドレス実行（npm run sim / sim:check / mc、What-if の Worker、テストが使う）。
 * 分岐点は ctx.policy で自動的に選ぶ。
 */
import { parseTimeRef } from './core/clock';
import { DT_SEC, stepWorld } from './core/step';
import { createStaticContext, createWorld } from './core/world';
import { resolveEnding, type EndingText } from './scenario/endings';
import { createRecorder, recordTick, recVars, type RecorderState } from './record/recorder';
import type { VarValue } from './scenario/vars';
import type { MapRuntime, PolicyName, RunRecord, ScenarioDef, SimEvent, StaticContext, World } from './types';
import type { Tuning } from './tuning';

export interface HeadlessOptions {
  seed?: number;
  policy?: PolicyName;
  /** すべてのイベントを集める（ログ表示用） */
  collectEvents?: boolean;
  tuning?: Tuning;
  /** RunRecord を作る（既定 true） */
  record?: boolean;
  /** 途中から続けるときの記録 */
  recorder?: RecorderState;
  /** 毎ティックの後に呼ぶ（記録など） */
  onTick?: (world: World, ctx: StaticContext, events: readonly SimEvent[]) => void;
}

export interface HeadlessResult {
  world: World;
  ending: EndingText;
  events: SimEvent[];
  ticks: number;
  record: RunRecord | null;
  /** 教訓の条件などに使う rec.* の値 */
  rec: Record<string, VarValue | null> | null;
}

export function runHeadless(map: MapRuntime, scenario: ScenarioDef, opts: HeadlessOptions = {}): HeadlessResult {
  const world = createWorld(map, scenario, opts.seed ?? scenario.seed);
  const ctx = createStaticContext(map, scenario, { mode: 'headless', policy: opts.policy ?? 'recommended', tuning: opts.tuning });
  return continueHeadless(world, ctx, opts);
}

/** 途中の World から結末まで進める（What-if・やり直し） */
export function continueHeadless(world: World, ctx: StaticContext, opts: HeadlessOptions = {}): HeadlessResult {
  const limit = parseTimeRef(ctx.scenario.timeLimit);
  const maxTicks = Math.ceil(((limit - world.tMin) * 60) / DT_SEC) + 10;
  const all: SimEvent[] = [];
  const rs = opts.record === false ? null : (opts.recorder ?? createRecorder(world));
  let n = 0;
  while (!world.ended && n < maxTicks) {
    stepWorld(world, ctx);
    n += 1;
    if (rs) recordTick(rs, world, ctx, ctx.events, DT_SEC / 60);
    opts.onTick?.(world, ctx, ctx.events);
    if (opts.collectEvents) all.push(...ctx.events);
    ctx.events.length = 0;
  }
  if (!world.ended) throw new Error(`制限時刻を過ぎても結末に達しませんでした（tMin=${world.tMin}）`);
  const rec = rs ? recVars(rs, world) : null;
  return { world, ending: resolveEnding(world, ctx, rec ?? undefined)!, events: all, ticks: n, record: rs?.record ?? null, rec };
}
