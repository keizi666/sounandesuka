/**
 * 思考の吹き出し（docs/07 §6）。乱数は thoughts ストリームだけを使い、シミュレーション結果に影響させない。
 * 組み込みのテンプレートは条件だけをここに持ち、文は i18n（THOUGHTS）にある。THOUGHT イベントの data に
 * key と r（0..1。UI が文を選ぶのに使う）を入れる。シナリオの thoughts は文もイベントに入れる。
 */
import { scenarioStartMin } from '../core/clock';
import { nextFloat, randRange } from '../core/rng';
import { evalCondition } from '../scenario/conditions';
import type { ClimberState, StaticContext, World } from '../types';

interface Builtin {
  key: string;
  priority: number;
  when: (w: World, ctx: StaticContext, c: ClimberState) => boolean;
}

const BUILTIN: Builtin[] = [
  { key: 'fine_start', priority: 1, when: (w, ctx, c) => w.tMin < scenarioStartMin(ctx.scenario) + 60 && c.perception.weatherImpression === 'fine' },
  { key: 'behind', priority: 3, when: (_w, _c, c) => c.perception.timeBehindMin > 45 },
  { key: 'phone_low', priority: 4, when: (_w, _c, c) => c.inv.phone.has && !c.inv.phone.dead && c.inv.phone.batteryPct < 20 },
  { key: 'rain_delay', priority: 4, when: (_w, _c, c) => c.local.precipMmH >= 0.5 && !c.body.rainwearOn && c.def.gear.rainwear !== 'none' },
  { key: 'cold_hands', priority: 5, when: (_w, _c, c) => c.body.coreC < 35.8 },
  { key: 'sheltered', priority: 5, when: (_w, _c, c) => c.state === 'SHELTERED' },
  { key: 'unaware_offroute', priority: 6, when: (_w, _c, c) => c.state === 'OFFROUTE_UNAWARE' },
  { key: 'dark_no_lamp', priority: 6, when: (w, _c, c) => w.sun.isDark && !c.inv.headlamp.on },
  { key: 'rescue_wait', priority: 6, when: (_w, _c, c) => c.state === 'WAITING_RESCUE' },
  { key: 'mild_hypo', priority: 7, when: (_w, _c, c) => c.body.coreC < 35.0 },
  { key: 'aware_lost', priority: 8, when: (_w, _c, c) => c.state === 'LOST_AWARE' },
  { key: 'descend_bias', priority: 8, when: (_w, _c, c) => c.state === 'DESCENDING_DRAINAGE' },
  { key: 'thunder_near', priority: 8, when: (_w, _c, c) => c.local.thunder > 0.6 },
  { key: 'moderate_hypo', priority: 9, when: (_w, _c, c) => c.body.coreC < 33.0 },
];

/** 1 ゲーム分ごとに呼ぶ。出す時刻になっていれば 1 つ選んで THOUGHT イベントを出す */
export function maybeThink(world: World, ctx: StaticContext, c: ClimberState): void {
  const t = ctx.tuning.thoughts;
  const rng = world.rng.thoughts;
  if (!c.body.alive || !c.body.conscious) return;
  if (c.memo.nextThoughtMin === null) {
    c.memo.nextThoughtMin = world.tMin + randRange(rng, 0, t.maxGapMin);
    return;
  }
  if (world.tMin < c.memo.nextThoughtMin) return;
  c.memo.nextThoughtMin = world.tMin + randRange(rng, t.minGapMin, t.maxGapMin);
  // 同じグループの人が最近出した内容は出さない（全員が同じことを考えているように見えるのを避ける）
  const mates = world.climbers.filter((x) => x !== c && x.groupId !== null && x.groupId === c.groupId);
  const recent = (key: string): boolean => {
    const last = c.thoughtHistory[key];
    if (last !== undefined && world.tMin - last < t.noRepeatMin) return true;
    return mates.some((m) => {
      const lm = m.thoughtHistory[key];
      return lm !== undefined && world.tMin - lm < t.noRepeatMin;
    });
  };
  type Cand = { key: string; priority: number; lines?: string[] };
  const cands: Cand[] = [];
  for (const b of BUILTIN) if (!recent(b.key) && b.when(world, ctx, c)) cands.push({ key: b.key, priority: b.priority });
  (ctx.scenario.thoughts ?? []).forEach((th, i) => {
    if (recent(th.key)) return;
    const scope = { world, map: ctx.map, scenario: ctx.scenario, leader: c };
    // thoughts の chance は思考専用のキーで固定する（結果に影響する events ストリームは使わない）
    if (evalCondition(th.when, scope, `thoughts[${i}].when`)) cands.push({ key: th.key, priority: (th.priority ?? 0) + t.scenarioPriorityBonus, lines: th.lines });
  });
  if (cands.length === 0) return;
  const top = Math.max(...cands.map((x) => x.priority));
  const group = cands.filter((x) => x.priority === top);
  const pick = group[Math.floor(nextFloat(rng) * group.length)]!;
  c.thoughtHistory[pick.key] = world.tMin;
  c.lastThoughtMin = world.tMin;
  const r = nextFloat(rng);
  const text = pick.lines && pick.lines.length > 0 ? pick.lines[Math.floor(r * pick.lines.length)] : undefined;
  ctx.events.push({ tMin: world.tMin, type: 'THOUGHT', climberId: c.id, text, data: { key: pick.key, r } });
}
