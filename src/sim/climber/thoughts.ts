/**
 * 思考の吹き出し（docs/07 §6）。乱数は thoughts ストリームだけを使い、シミュレーション結果に影響させない。
 * 組み込みのテンプレートは条件だけをここに持ち、文は i18n（THOUGHTS）にある。THOUGHT イベントの data に
 * key と r（0..1。UI が文を選ぶのに使う）を入れる。シナリオの thoughts は文もイベントに入れる。
 */
import { scenarioStartMin } from '../core/clock';
import { nextFloat, randRange } from '../core/rng';
import { evalCondition } from '../scenario/conditions';
import type { ClimberState, StaticContext, World } from '../types';
import { isIndoors } from './situation';

/** これより強い雨は「小降り」と考えない（mm/h） */
const RAIN_HEAVY_MMH = 2;
const MOVING = new Set(['WALKING', 'OFFROUTE_UNAWARE', 'LOST_AWARE', 'BACKTRACKING', 'NAVIGATING_TO_TRAIL', 'DESCENDING_DRAINAGE', 'SEEKING_SIGNAL']);

interface Builtin {
  key: string;
  priority: number;
  /** 計画や時間の考えは、グループのリーダー（計画を立てた人）だけ */
  leaderOnly?: boolean;
  when: (w: World, ctx: StaticContext, c: ClimberState) => boolean;
}

/** 同じグループに、急病の発作中・重いけが・動けない仲間がいるか */
function unwellMate(w: World, c: ClimberState): boolean {
  return w.climbers.some((o) => o !== c && o.groupId === c.groupId && o.body.alive && (o.body.illness?.active === true || o.body.injury === 'legFracture' || o.body.injury === 'headInjury' || o.body.injury === 'severeTrauma' || o.M <= 0.05));
}
/** その日の 0 時からの分 */
function clockOf(w: World): number {
  return ((w.tMin % 1440) + 1440) % 1440;
}

const BUILTIN: Builtin[] = [
  { key: 'fine_start', priority: 1, leaderOnly: true, when: (w, ctx, c) => w.tMin < scenarioStartMin(ctx.scenario) + 60 && c.perception.weatherImpression === 'fine' && c.state === 'WALKING' && c.body.injury === 'none' && !unwellMate(w, c) },
  // 予定の遅れを気にするのは、ふつうに歩いているときだけ（迷った・けが・急病のときは、それどころではない）
  // 出発した日のうちだけ。仲間に具合の悪い人がいれば、時間どころではない
  { key: 'behind', priority: 3, leaderOnly: true, when: (w, ctx, c) => c.perception.timeBehindMin > 45 && c.state === 'WALKING' && c.body.injury === 'none' && !(c.body.illness?.active ?? false) && !c.perception.awareLost && Math.floor(w.tMin / 1440) === Math.floor(scenarioStartMin(ctx.scenario) / 1440) && !unwellMate(w, c) },
  // 「寒さのせいか」は寒いときだけ（暖かいときは節約の考えだけ）
  { key: 'phone_low', priority: 4, when: (_w, _c, c) => c.inv.phone.has && !c.inv.phone.dead && c.inv.phone.batteryPct < 20 && c.local.tempC < 10 },
  { key: 'phone_low_warm', priority: 4, when: (_w, _c, c) => c.inv.phone.has && !c.inv.phone.dead && c.inv.phone.batteryPct < 20 && c.local.tempC >= 10 },
  // 雨具を後回しにするのは、歩いているときだけ（小屋の中・ビバーク・動けないときは出さない）
  { key: 'rain_delay', priority: 4, when: (_w, _c, c) => c.local.precipMmH >= 0.5 && c.local.precipMmH < RAIN_HEAVY_MMH && !c.body.rainwearOn && c.def.gear.rainwear !== 'none' && c.state === 'WALKING' },
  // 本降りでも着ないでいる（止まって着るのが面倒・どうせ濡れる、という先延ばし）
  { key: 'rain_delay_heavy', priority: 4, when: (_w, _c, c) => c.local.precipMmH >= RAIN_HEAVY_MMH && !c.body.rainwearOn && c.def.gear.rainwear !== 'none' && c.state === 'WALKING' },
  { key: 'cold_hands', priority: 5, when: (_w, _c, c) => c.body.coreC < 35.8 },
  // 水・食べ物の残りを気にして控える（ユーザーの指定）
  { key: 'water_ration', priority: 5, when: (_w, _c, c) => c.def.gear.waterL > 0 && c.inv.waterL > 0 && c.inv.waterL / c.def.gear.waterL < 0.5 },
  { key: 'water_out', priority: 6, when: (_w, _c, c) => c.def.gear.waterL > 0 && c.inv.waterL <= 0.01 && c.body.waterDeficitL > 0.8 },
  { key: 'food_ration', priority: 5, when: (_w, _c, c) => c.def.gear.foodKcal > 0 && c.inv.foodKcal > 0 && c.inv.foodKcal / c.def.gear.foodKcal < 0.5 },
  // 「今夜はここで」は夕方から（昼の雨宿り・休憩では出さない）
  { key: 'sheltered', priority: 5, when: (w, _c, c) => c.state === 'SHELTERED' && (w.sun.isDark || clockOf(w) >= 15 * 60) },
  { key: 'unaware_offroute', priority: 6, when: (_w, _c, c) => c.state === 'OFFROUTE_UNAWARE' },
  // 暗いのに明かりがない: 持っていない人と、持っているのに点けていない人で考えが違う
  // 足元の暗さを気にするのは、歩いているときだけ（休む・待つ・小屋の中では出さない）
  { key: 'dark_no_lamp', priority: 6, when: (w, _c, c) => w.sun.isDark && MOVING.has(c.state) && !c.inv.headlamp.has },
  { key: 'dark_lamp_off', priority: 6, when: (w, _c, c) => w.sun.isDark && MOVING.has(c.state) && c.inv.headlamp.has && !c.inv.headlamp.on && c.inv.headlamp.batteryH > 0 },
  // 「電話はつながった」は、電話・衛星で自分たちが通報したときだけ（家族の届け出・通りかかった人の通報ではない）
  { key: 'rescue_wait', priority: 6, when: (w, _c, c) => c.state === 'WAITING_RESCUE' && w.rescue.calledAtMin !== null && (w.rescue.via === 'phone' || w.rescue.via === 'satellite') },
  { key: 'wait_nocall', priority: 6, when: (w, _c, c) => c.state === 'WAITING_RESCUE' && !(w.rescue.calledAtMin !== null && (w.rescue.via === 'phone' || w.rescue.via === 'satellite')) },
  { key: 'mild_hypo', priority: 7, when: (_w, _c, c) => c.body.coreC < 35.0 },
  { key: 'aware_lost', priority: 8, when: (_w, _c, c) => c.state === 'LOST_AWARE' },
  { key: 'descend_bias', priority: 8, when: (_w, _c, c) => c.state === 'DESCENDING_DRAINAGE' },
  { key: 'thunder_near', priority: 8, when: (_w, ctx, c) => c.local.thunder > 0.6 && c.state !== 'INCAPACITATED' && !isIndoors(ctx.map, c) },
  // 34℃ を切ると重い（低体温症の段階に合わせる）
  { key: 'moderate_hypo', priority: 9, when: (_w, _c, c) => c.body.coreC < 34.0 },
];

/** 1 ゲーム分ごとに呼ぶ。出す時刻になっていれば 1 つ選んで THOUGHT イベントを出す */
export function maybeThink(world: World, ctx: StaticContext, c: ClimberState): void {
  const t = ctx.tuning.thoughts;
  const rng = world.rng.thoughts;
  if (!c.body.alive || !c.body.conscious) return;
  // 下山した人・救助された人は、山の考えをしない
  if (c.state === 'FINISHED' || c.state === 'RESCUED') return;
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
  const isLeader = world.groups.find((g) => g.id === c.groupId)?.leader === c.id || world.groups.length === 0;
  for (const b of BUILTIN) if (!recent(b.key) && (!b.leaderOnly || isLeader) && b.when(world, ctx, c)) cands.push({ key: b.key, priority: b.priority });
  (ctx.scenario.thoughts ?? []).forEach((th, i) => {
    if (recent(th.key)) return;
    // 誰の考えか（ほかの人には浮かばない）
    if (th.who !== undefined && th.who !== 'any') {
      if (th.who === 'leader') {
        if (world.groups.find((g) => g.id === c.groupId)?.leader !== c.id) return;
      } else if (th.who.startsWith('role:')) {
        if (c.def.role !== th.who.slice(5)) return;
      } else if (th.who !== c.id) return;
    }
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
