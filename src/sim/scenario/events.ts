/**
 * スクリプトイベント（docs/09 §8）と、リーダーの局地気象・暗さの変化から出るイベント（RAIN_START など）。
 */
import { applyActions } from '../climber/actions';
import { groupMembers, partyLeader } from '../climber/party';
import { nearestIndex } from '../terrain/sample';
import type { ScriptEffect, StaticContext, World } from '../types';
import { evalCondition } from './conditions';
import { eventOnce } from './load';
import { fireChoiceById, scopeFor } from './choices';

function radioAtLeader(world: World, ctx: StaticContext): number {
  const l = partyLeader(world);
  return ctx.map.radio[nearestIndex(ctx.map, l.x, l.z)] ?? 0;
}

/** 電波が必要な効果（予報の更新）が届かない間は、イベントごと保留する */
function blockedBySignal(world: World, ctx: StaticContext, effects: readonly ScriptEffect[]): boolean {
  return effects.some((e) => e.type === 'forecastUpdate' && (e.requiresSignal ?? true)) && radioAtLeader(world, ctx) < ctx.tuning.radio.messageOnlyMin;
}

function applyEffect(world: World, ctx: StaticContext, ef: ScriptEffect, evId: string): void {
  const leader = partyLeader(world);
  const party = groupMembers(world, leader.groupId);
  switch (ef.type) {
    case 'log':
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', text: ef.text, important: ef.important ?? false, data: { event: evId } });
      return;
    case 'forecastUpdate':
      for (const c of world.climbers) c.perception.forecast = ef.entries.map((x) => ({ ...x }));
      ctx.events.push({ tMin: world.tMin, type: 'FORECAST_UPDATE', important: true, data: { event: evId } });
      return;
    case 'setFlag':
      if (world.flags[ef.flag] === undefined) world.flags[ef.flag] = world.tMin;
      return;
    case 'clearFlag':
      delete world.flags[ef.flag];
      return;
    case 'actions':
      applyActions(world, ctx, ef.actions, party, leader);
      return;
    case 'weatherOverride':
      world.weather.overrides.push({ ...ef.keyframe });
      return;
    case 'pin':
      ctx.events.push({ tMin: world.tMin, type: 'PIN', text: ef.label, data: { x: ef.x, z: ef.z } });
      return;
    case 'triggerChoice':
      fireChoiceById(world, ctx, ef.cp);
      return;
    case 'say':
      applyActions(world, ctx, [{ type: 'say', who: ef.who === 'any' || ef.who.startsWith('role:') ? 'leader' : ef.who, text: ef.text, to: ef.to, tone: ef.tone, documented: ef.documented, source: ef.source }], party, leader);
      return;
    case 'injure':
    case 'rockfall':
    case 'soak':
      // 負傷・落石・浸水は P6 / P19
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', data: { unimplementedEffect: ef.type, event: evId } });
      return;
  }
}

/** スクリプトイベントを評価する（docs/03 §4 の 6） */
export function runEvents(world: World, ctx: StaticContext): void {
  const leader = partyLeader(world);
  const scope = scopeFor(world, ctx, leader);
  ctx.scenario.events.forEach((ev, i) => {
    const key = `events[${i}]`;
    const once = eventOnce(ev);
    if (once && world.firedEvents.includes(ev.id)) return;
    const v = evalCondition(ev.trigger, scope, `${key}.trigger`);
    if (!once) {
      const prev = world.latches[key] ?? false;
      world.latches[key] = v;
      if (!v || prev) return;
    } else if (!v) return;
    if (blockedBySignal(world, ctx, ev.effects)) return;
    if (!world.firedEvents.includes(ev.id)) world.firedEvents.push(ev.id);
    for (const ef of ev.effects) applyEffect(world, ctx, ef, ev.id);
  });
}

/** リーダーの局地気象（前のティックの値）と暗さの変化からイベントを出す */
export function weatherEvents(world: World, ctx: StaticContext): void {
  const bt = ctx.tuning.behavior;
  const m = world.weatherMemo;
  const leader = partyLeader(world);
  const l = leader.local;
  const raining = l.precipMmH >= bt.rainStartMmH;
  if (raining && !m.raining) {
    const gapOk = m.rainStoppedAtMin === null || world.tMin - m.rainStoppedAtMin >= bt.rainRestartGapMin;
    if (gapOk) ctx.events.push({ tMin: world.tMin, type: 'RAIN_START', climberId: leader.id, important: true, data: { precipMmH: l.precipMmH } });
  } else if (!raining && m.raining) {
    m.rainStoppedAtMin = world.tMin;
    ctx.events.push({ tMin: world.tMin, type: 'RAIN_STOP', climberId: leader.id });
  }
  m.raining = raining;
  if (l.precipType !== m.precipType && l.precipType !== 'none' && m.precipType !== 'none') {
    ctx.events.push({ tMin: world.tMin, type: 'PRECIP_TYPE', climberId: leader.id, important: true, data: { from: m.precipType, to: l.precipType } });
  }
  if (l.precipType !== 'none') m.precipType = l.precipType;
  const up = world.sun.elevDeg > 0;
  if (up !== m.sunUp) ctx.events.push({ tMin: world.tMin, type: up ? 'SUNRISE' : 'SUNSET', important: !up });
  m.sunUp = up;
  if (world.sun.isDark && !m.dark) ctx.events.push({ tMin: world.tMin, type: 'DARK', important: true });
  m.dark = world.sun.isDark;
}

/** 開始時点の値で覚え書きを初期化する（開始直後に余計なイベントを出さない） */
export function initWeatherMemo(world: World, ctx: StaticContext): void {
  const leader = partyLeader(world);
  world.weatherMemo = {
    raining: leader.local.precipMmH >= ctx.tuning.behavior.rainStartMmH,
    rainStoppedAtMin: null,
    precipType: leader.local.precipType,
    sunUp: world.sun.elevDeg > 0,
    dark: world.sun.isDark,
  };
}
