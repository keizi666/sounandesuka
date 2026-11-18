/**
 * 認知（docs/07 §5）。P5 は予定との遅れ（timeBehindMin）と天気の受け止め方だけ。
 * 推定位置・道迷いの自覚は P6。
 */
import { plannedArrivals } from '../scenario/load';
import type { ClimberState, StaticContext, World } from '../types';

/**
 * 予定との遅れ: 元の計画ルートを進んでいる間、次の予定ノードの予定到着時刻を過ぎた分。
 * ルートを変えた後（引き返しなど）は最後の値を保つ。
 */
export function updateTimeBehind(world: World, ctx: StaticContext, c: ClimberState): void {
  const route = ctx.scenario.plan.route;
  const p = c.plan;
  const sameRoute = p.route.length === route.length && p.route.every((n, i) => n === route[i]);
  if (!sameRoute) return;
  const sched = plannedArrivals(ctx.map, ctx.scenario);
  const next = sched[Math.min(p.routeIndex, route.length - 1)];
  if (next === undefined) return;
  c.perception.timeBehindMin = Math.max(0, world.tMin - next);
}

/** 局地気象の受け止め方（fine / worsening / bad / severe） */
export function updateWeatherImpression(c: ClimberState): void {
  const l = c.local;
  let v: ClimberState['perception']['weatherImpression'] = 'fine';
  if (l.precipMmH > 0.5 || l.windMs > 10 || l.visibilityM < 1000) v = 'worsening';
  if (l.precipMmH > 3 || l.windMs > 15 || l.visibilityM < 200 || l.thunder > 0.3) v = 'bad';
  if (l.precipMmH > 8 || l.windMs > 20 || l.visibilityM < 50 || l.thunder > 0.6) v = 'severe';
  c.perception.weatherImpression = v;
}
