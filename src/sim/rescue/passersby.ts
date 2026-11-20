/**
 * 通りかかる登山者（ユーザーの指定）。登山道の上（か声・笛の届く所）で困っている人に気づけば、下山して正確な場所を通報してくれる。
 * - すべてのシナリオに共通: 偽の道を除く登山道を、昼のあいだ一定の割合で人が通る（道の区分で多い・少ない）。通るかどうかは毎回の乱数
 * - 土日祝が基準。平日は 8 分の 1。雨・荒天・冬は減り、夜は通らない
 * - シナリオに手で書いた通る人（passersby）があれば、それを使い、曜日の倍率だけ掛ける
 * - 史実のシナリオは変えない（記録どおりに選べば記録どおりの結果になるように）
 * 日付と曜日・祝日は整数の計算で求める（Date を使わない。決定論）
 */
import { clockMinOf, parseHHMM } from '../core/clock';
import { chance } from '../core/rng';
import { nearestIndex } from '../terrain/sample';
import type { ClimberState, EdgeId, MapRuntime, StaticContext, World } from '../types';

/** 道のうち沢床（地図の沢のセル）を通る割合（地図ごとに覚える）。半分を超える道は沢登りのルートとして、通る人を少なくする */
const streamShare = new WeakMap<MapRuntime, Map<EdgeId, number>>();
function streamFraction(map: MapRuntime, id: EdgeId): number {
  let m = streamShare.get(map);
  if (!m) {
    m = new Map();
    streamShare.set(map, m);
  }
  let f = m.get(id);
  if (f === undefined) {
    const ss = map.trails[id]?.samples ?? [];
    let n = 0;
    for (const s of ss) if (map.stream[nearestIndex(map, s.x, s.z)]) n++;
    f = ss.length > 0 ? n / ss.length : 0;
    m.set(id, f);
  }
  return f;
}

/** 1970-01-01 からの日数（Howard Hinnant の days_from_civil） */
function daysFromCivil(y0: number, m: number, d: number): number {
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z0: number): [number, number, number] {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

/** 曜日（0 = 日曜） */
function weekday(days: number): number {
  return (((days + 4) % 7) + 7) % 7;
}

/** その月の n 回目の月曜日 */
function nthMonday(y: number, m: number, n: number): number {
  const first = weekday(daysFromCivil(y, m, 1));
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
}

/** 国民の祝日（いまの法律の決まりで近似。春分・秋分は 1980〜2099 年の式） */
function isNamedHoliday(y: number, m: number, d: number): boolean {
  const k = y - 1980;
  const spring = Math.floor(20.8431 + 0.242194 * k - Math.floor(k / 4));
  const autumn = Math.floor(23.2488 + 0.242194 * k - Math.floor(k / 4));
  switch (m) {
    case 1:
      return d === 1 || d === nthMonday(y, 1, 2);
    case 2:
      return d === 11 || (y >= 2020 && d === 23);
    case 3:
      return d === spring;
    case 4:
      return d === 29;
    case 5:
      return d === 3 || d === 4 || d === 5;
    case 7:
      return d === nthMonday(y, 7, 3);
    case 8:
      return y >= 2016 && d === 11;
    case 9:
      return d === nthMonday(y, 9, 3) || d === autumn;
    case 10:
      return d === nthMonday(y, 10, 2);
    case 11:
      return d === 3 || d === 23;
    case 12:
      return y >= 1989 && y <= 2018 && d === 23;
    default:
      return false;
  }
}

function isHolidayDays(days: number): boolean {
  const [y, m, d] = civilFromDays(days);
  if (isNamedHoliday(y, m, d)) return true;
  // 振替休日: 日曜の祝日のあと、祝日でない最初の日
  for (let back = 1; back <= 3; back++) {
    const [py, pm, pd] = civilFromDays(days - back);
    if (!isNamedHoliday(py, pm, pd)) break;
    if (weekday(days - back) === 0) return true;
  }
  // 国民の休日: 祝日にはさまれた日
  const [ay, am, ad] = civilFromDays(days - 1);
  const [by, bm, bd] = civilFromDays(days + 1);
  return isNamedHoliday(ay, am, ad) && isNamedHoliday(by, bm, bd);
}

/** シナリオの日付から dayOffset 日目が、土日祝か */
export function isBusyDay(startDate: string, dayOffset: number): boolean {
  const y = Number(startDate.slice(0, 4));
  const m = Number(startDate.slice(5, 7));
  const d = Number(startDate.slice(8, 10));
  if (!(y > 0 && m > 0 && d > 0)) return true;
  const days = daysFromCivil(y, m, d) + dayOffset;
  const wd = weekday(days);
  return wd === 0 || wd === 6 || isHolidayDays(days);
}

/** 困っていて、通りかかった人に助けを頼む状態 */
const DISTRESS = new Set(['LOST_AWARE', 'STAYING', 'WAITING_RESCUE', 'BIVOUAC', 'INCAPACITATED', 'UNCONSCIOUS', 'SEEKING_SIGNAL']);
const TERMINAL = new Set(['FINISHED', 'RESCUED', 'DEAD']);

/** 道から気づける距離（見える・声・笛） */
function reachM(ctx: StaticContext, c: ClimberState, p?: { seeM?: number; voiceM?: number; whistleM?: number }): number {
  const pt = ctx.tuning.rescue.passerby;
  const see = p?.seeM ?? pt.seeM;
  if (!c.body.conscious) return see;
  return Math.max(see, c.def.gear.whistle ? (p?.whistleM ?? pt.whistleM) : (p?.voiceM ?? pt.voiceM));
}

/** いちばん近い道（edges を渡せばその中、なければ偽の道を除く全部）と距離 */
function nearestTrail(ctx: StaticContext, c: ClimberState, edges?: readonly EdgeId[]): { id: EdgeId; d: number } | null {
  let best: { id: EdgeId; d: number } | null = null;
  const ids = edges ?? Object.keys(ctx.map.trails);
  for (const id of ids) {
    const t = ctx.map.trails[id];
    if (!t || (!edges && t.def.kind === 'false')) continue;
    for (const s of t.samples) {
      const d2 = (s.x - c.x) * (s.x - c.x) + (s.z - c.z) * (s.z - c.z);
      if (!best || d2 < best.d) best = { id, d: d2 };
    }
  }
  return best ? { id: best.id, d: Math.sqrt(best.d) } : null;
}

/** 曜日・天気・季節で、通る人の数に掛ける倍率 */
function crowdF(world: World, ctx: StaticContext, c: ClimberState, withWeather: boolean): number {
  const pt = ctx.tuning.rescue.passerby;
  const day = Math.floor(world.tMin / 1440);
  let f = isBusyDay(ctx.scenario.startDate, day) ? 1 : pt.weekdayF;
  if (withWeather) {
    if (c.local.thunder >= pt.stormThunder || c.local.windMs * world.weather.gust >= pt.stormWindMs) f *= pt.stormF;
    else if (c.local.precipMmH >= pt.rainMmH) f *= pt.rainF;
    if (ctx.scenario.season === 'winter') f *= pt.winterF;
  }
  return f;
}

/** 気づいて通報してくれた */
function reported(world: World, ctx: StaticContext, c: ClimberState): void {
  const r = world.rescue;
  r.status = 'dispatched';
  r.via = 'passerby';
  r.calledAtMin = world.tMin;
  r.locationEstimate = { x: c.x, z: c.z, radiusM: ctx.tuning.rescue.preciseM };
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { passerby: true } });
  ctx.events.push({ tMin: world.tMin, type: 'RESCUE_CALLED', climberId: c.id, important: true, data: { via: 'passerby' } });
}

export function stepPassersby(world: World, ctx: StaticContext, dtMin: number): void {
  if (world.sun.isDark) return;
  const r = world.rescue;
  if (r.status === 'dispatched' || r.status === 'contacted') return;
  const pt = ctx.tuning.rescue.passerby;
  const clock = clockMinOf(world.tMin);
  const day = Math.floor(world.tMin / 1440);
  const defs = ctx.scenario.passersby;
  const historical = ctx.scenario.historical !== undefined;
  // シナリオに手で書いた通る人（曜日の倍率だけ掛ける。史実はそのまま）
  if (defs && defs.length > 0) {
    for (const p of defs) {
      if (p.fromDay !== undefined && day < p.fromDay) continue;
      if (p.from && clock < parseHHMM(p.from)) continue;
      if (p.to && clock > parseHHMM(p.to)) continue;
      const any = world.climbers.find((c) => !TERMINAL.has(c.state));
      const f = historical || !any ? 1 : crowdF(world, ctx, any, false);
      if (!chance(world.rng.rescue, (p.perHour * f * dtMin) / 60)) continue;
      for (const c of world.climbers) {
        if (TERMINAL.has(c.state) || !DISTRESS.has(c.state)) continue;
        const near = nearestTrail(ctx, c, p.edges);
        if (!near || near.d > reachM(ctx, c, p)) continue;
        reported(world, ctx, c);
        return;
      }
    }
    return;
  }
  if (historical) return;
  // すべてのシナリオに共通: 登山道の上（声・笛の届く所）で困っている人のそばを、人が通るか（1 分ごとに判定）
  if (world.tick % pt.checkEveryTicks !== 0) return;
  if (clock < parseHHMM(pt.from) || clock > parseHHMM(pt.to)) return;
  const stepMin = dtMin * pt.checkEveryTicks;
  for (const c of world.climbers) {
    if (TERMINAL.has(c.state) || !DISTRESS.has(c.state)) continue;
    const near = nearestTrail(ctx, c);
    if (!near || near.d > reachM(ctx, c)) continue;
    const cls = ctx.map.trails[near.id]!.def.class;
    // 沢床を通る道（沢登りのルート）は、一般の登山道より人が少ない
    const base = streamFraction(ctx.map, near.id) > pt.streamShareMin ? pt.streamPerHour : (pt.busyPerHour[cls] ?? pt.busyPerHour['T2'] ?? 1);
    const perH = base * crowdF(world, ctx, c, true);
    if (!chance(world.rng.rescue, Math.min(1, (perH * stepMin) / 60) * pt.noticeP)) continue;
    reported(world, ctx, c);
    return;
  }
}
