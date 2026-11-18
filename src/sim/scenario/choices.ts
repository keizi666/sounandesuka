/**
 * 分岐点（docs/09 §5）: 発火・選択肢の可否・自律バイアス・解決。
 * 汎用分岐点（generic.ts）は P6。group 指定の分岐点は P19（今はパーティ全体のリーダーで評価）。
 */
import { applyActions } from '../climber/actions';
import { groupLeader, groupMembers } from '../climber/party';
import { chooseByPolicy, type WeightedOption } from '../policy';
import type { ChoicePointDef, ClimberState, StaticContext, World } from '../types';
import { evalCondition } from './conditions';
import { cpOnce, cpPriority } from './load';
import type { VarScope } from './vars';

export function scopeFor(world: World, ctx: StaticContext, leader: ClimberState): VarScope {
  return { world, map: ctx.map, scenario: ctx.scenario, leader };
}

/** 分岐点の定義（シナリオのもの。P6 で汎用分岐点を加える） */
export function choicePoints(ctx: StaticContext): { cp: ChoicePointDef; key: string }[] {
  return ctx.scenario.choices.map((cp, i) => ({ cp, key: `choices[${i}]` }));
}

export function findChoicePoint(ctx: StaticContext, cpId: string): { cp: ChoicePointDef; key: string } | undefined {
  return choicePoints(ctx).find((x) => x.cp.id === cpId);
}

function groupIdOf(world: World, cp: ChoicePointDef): string | null {
  return cp.group ?? world.groups[0]?.id ?? null;
}

/** 選択肢ごとの可否と重み */
export function evaluateOptions(world: World, ctx: StaticContext, cp: ChoicePointDef, key: string): { available: WeightedOption[]; unavailable: string[] } {
  const leader = groupLeader(world, groupIdOf(world, cp));
  const scope = scopeFor(world, ctx, leader);
  const available: WeightedOption[] = [];
  const unavailable: string[] = [];
  cp.options.forEach((o, i) => {
    const k = `${key}.options[${i}]`;
    if (o.available && !evalCondition(o.available, scope, `${k}.available`)) {
      unavailable.push(o.id);
      return;
    }
    let w = o.bias.base;
    (o.bias.mods ?? []).forEach((m, j) => {
      if (evalCondition(m.when, scope, `${k}.bias.mods[${j}]`)) w += m.add;
    });
    available.push({ option: o, weight: Math.max(0, w) });
  });
  return { available, unavailable };
}

/**
 * 発火を判定する（docs/03 §4 の 7）。未発火（once）かつ trigger が真のもののうち priority 最大を 1 つ。
 * once: false は trigger が偽→真に変わったときだけ発火する。発火したら pendingChoice を立てて true を返す。
 */
export function checkChoices(world: World, ctx: StaticContext): boolean {
  if (world.pendingChoice) return false;
  let best: { cp: ChoicePointDef; key: string } | null = null;
  for (const item of choicePoints(ctx)) {
    const { cp, key } = item;
    const once = cpOnce(cp);
    if (once && world.firedChoices.includes(cp.id)) continue;
    const leader = groupLeader(world, groupIdOf(world, cp));
    if (!leader.body.alive) continue;
    const v = evalCondition(cp.trigger, scopeFor(world, ctx, leader), `${key}.trigger`);
    if (!once) {
      const prev = world.latches[key] ?? false;
      world.latches[key] = v;
      if (!v || prev) continue;
    } else if (!v) continue;
    if (!best || cpPriority(cp) > cpPriority(best.cp)) best = item;
  }
  if (!best) return false;
  world.pendingChoice = { cpId: best.cp.id, firedAtMin: world.tMin, realDeadlineMs: null };
  if (!world.firedChoices.includes(best.cp.id)) world.firedChoices.push(best.cp.id);
  ctx.events.push({ tMin: world.tMin, type: 'CHOICE_FIRED', important: true, data: { cp: best.cp.id } });
  return true;
}

/** 指定の分岐点をすぐ発火する（スクリプト効果 triggerChoice）。回答待ちがあれば何もしない */
export function fireChoiceById(world: World, ctx: StaticContext, cpId: string): boolean {
  if (world.pendingChoice || !findChoicePoint(ctx, cpId)) return false;
  world.pendingChoice = { cpId, firedAtMin: world.tMin, realDeadlineMs: null };
  if (!world.firedChoices.includes(cpId)) world.firedChoices.push(cpId);
  ctx.events.push({ tMin: world.tMin, type: 'CHOICE_FIRED', important: true, data: { cp: cpId } });
  return true;
}

/** 選択を確定してアクションを適用する */
export function resolveChoice(world: World, ctx: StaticContext, optionId: string, by: 'user' | 'bias' | 'policy'): void {
  const pending = world.pendingChoice;
  if (!pending) throw new Error('回答待ちの分岐点がありません');
  const found = findChoicePoint(ctx, pending.cpId);
  if (!found) throw new Error(`分岐点 ${pending.cpId} が見つかりません`);
  const opt = found.cp.options.find((o) => o.id === optionId);
  if (!opt) throw new Error(`分岐点 ${pending.cpId} に選択肢 ${optionId} がありません`);
  world.pendingChoice = null;
  world.decisions.push({ cpId: pending.cpId, optionId, tMin: world.tMin, by });
  const gid = groupIdOf(world, found.cp);
  const leader = groupLeader(world, gid);
  for (const f of opt.flags ?? []) if (world.flags[f] === undefined) world.flags[f] = world.tMin;
  ctx.events.push({ tMin: world.tMin, type: 'CHOICE_RESOLVED', important: true, data: { cp: pending.cpId, option: optionId, by } });
  applyActions(world, ctx, opt.actions, groupMembers(world, gid), leader);
}

/** 自動で選ぶ（headless は ctx.policy、観察のみ・時間切れは bias） */
export function autoResolve(world: World, ctx: StaticContext, by: 'bias' | 'policy'): string {
  const pending = world.pendingChoice;
  if (!pending) throw new Error('回答待ちの分岐点がありません');
  const found = findChoicePoint(ctx, pending.cpId)!;
  const { available } = evaluateOptions(world, ctx, found.cp, found.key);
  const policy = by === 'policy' ? ctx.policy : 'bias';
  const opt = chooseByPolicy(world, policy, pending.cpId, available, ctx.scenario.historical?.recordedChoices);
  resolveChoice(world, ctx, opt.id, by);
  return opt.id;
}
