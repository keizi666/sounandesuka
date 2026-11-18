/**
 * セリフ（docs/07 §7）。声に出して言う言葉。行動は起こさず、表示とログのためだけにある。
 * 乱数は thoughts ストリームだけを使う（セリフを足しても結果は変わらない）。
 * 組み込みテンプレートは条件だけをここに持ち、文は i18n（speech）にある。SPEECH イベントの data に key と r を入れる。
 * 発話の変形 distort() と史実シナリオの区分 classify() は表示側（UI・ログ・振り返り）から呼ぶ純粋関数。
 */
import { nextFloat } from '../core/rng';
import { evalCondition } from '../scenario/conditions';
import { groupLeader } from './party';
import type { ClimberState, ScenarioDef, SpeakerRef, SpeechTone, StaticContext, World } from '../types';

/** 同じ人のセリフの最小間隔（ゲーム分） */
export const SPEECH_GAP_MIN = 3;
export const SPEECH_COOLDOWN_MIN = 60;
export const SPEECH_MAX_SPEAKERS = 3;
const LAST = 'speech:';

interface Builtin {
  key: string;
  priority: number;
  tone?: SpeechTone;
  /** 話し手になれるか。to を返すと話しかけ */
  speaker: (w: World, ctx: StaticContext, c: ClimberState) => boolean | ClimberState;
  reply?: (to: ClimberState) => string;
}

const ev = (w: World, type: string): boolean => w.recentEvents.some((e) => e.type === type);
const isLeader = (w: World, c: ClimberState): boolean => groupLeader(w, c.groupId) === c;
const mates = (w: World, c: ClimberState): ClimberState[] => w.climbers.filter((x) => x !== c && x.groupId === c.groupId && x.body.alive);

const BUILTIN: Builtin[] = [
  { key: 'gust_crouch', priority: 10, tone: 'shout', speaker: (w, _x, c) => isLeader(w, c) && c.local.windMs * w.weather.gust > 20 && mates(w, c).length > 0 },
  { key: 'rain_start', priority: 10, speaker: (w, _x, c) => ev(w, 'RAIN_START') && isLeader(w, c) },
  {
    key: 'ask_ok',
    priority: 10,
    speaker: (w, _x, c) => (c.J > 0.7 ? (mates(w, c).find((m) => m.body.conscious && (m.body.coreC < 35.5 || m.body.anxiety > 60)) ?? false) : false),
    reply: (to) => (to.body.coreC >= 35 ? 'reply_ok' : 'reply_bad'),
  },
  { key: 'headcount', priority: 10, tone: 'shout', speaker: (w, _x, c) => ev(w, 'STRAGGLER') && isLeader(w, c) },
  { key: 'call_help', priority: 10, tone: 'shout', speaker: (w, _x, c) => mates(w, c).some((m) => m.state === 'INCAPACITATED' && w.tMin - m.stateSinceMin < 30) },
  { key: 'phone_call', priority: 10, speaker: (w, _x, c) => w.recentEvents.some((e) => e.type === 'RESCUE_CALLED' && e.climberId === c.id) },
  { key: 'whistle', priority: 10, tone: 'sound', speaker: (w, _x, c) => c.def.gear.whistle && w.sun.isDark && c.state === 'WAITING_RESCUE' },
  {
    key: 'lost_doubt',
    priority: 10,
    speaker: (w, _x, c) => {
      if (isLeader(w, c)) return false;
      const l = groupLeader(w, c.groupId);
      return l.state === 'OFFROUTE_UNAWARE' && w.tMin - l.stateSinceMin >= 15 ? l : false;
    },
  },
];

/** 発話できるか（意識あり・深部体温 32℃以上） */
export function canSpeak(c: ClimberState): boolean {
  return c.body.alive && c.body.conscious && c.body.coreC >= 32;
}

/** 変形の段階: 0 通常、1 構音障害、2 混乱、3 話さない */
export function distortLevel(c: ClimberState): 0 | 1 | 2 | 3 {
  if (!canSpeak(c)) return 3;
  if (c.body.coreC < 34) return 2;
  if (c.body.coreC < 35) return 1;
  return 0;
}

function resolveRef(w: World, ref: SpeakerRef | undefined, self: ClimberState): ClimberState | null {
  if (!ref) return null;
  if (ref === 'leader') return groupLeader(w, self.groupId);
  if (ref === 'any') return self;
  if (ref.startsWith('role:')) return w.climbers.find((c) => c.def.role === ref.slice(5) && c.body.alive) ?? null;
  return w.climbers.find((c) => c.id === ref) ?? null;
}

function matches(w: World, ref: SpeakerRef, c: ClimberState): boolean {
  if (ref === 'any') return true;
  return resolveRef(w, ref, c) === c;
}

interface Cand {
  c: ClimberState;
  key: string;
  priority: number;
  tone: SpeechTone;
  to: ClimberState | null;
  lines?: string[];
  replyKey?: string;
  replyLines?: string[];
  replyWho?: ClimberState | null;
  documented?: boolean;
  source?: string;
}

/** 1 ゲーム分ごとに呼ぶ。条件に合うセリフを集め、優先度順に最大 3 人まで SPEECH イベントを出す */
export function maybeSpeak(world: World, ctx: StaticContext): void {
  const rng = world.rng.thoughts;
  const cands: Cand[] = [];
  const recent = (c: ClimberState, key: string, cool: number): boolean => {
    const t = c.thoughtHistory[LAST + key];
    return t !== undefined && world.tMin - t < cool;
  };
  for (const c of world.climbers) {
    if (distortLevel(c) === 3) continue;
    const last = c.thoughtHistory[LAST];
    if (last !== undefined && world.tMin - last < SPEECH_GAP_MIN) continue;
    for (const b of BUILTIN) {
      if (recent(c, b.key, SPEECH_COOLDOWN_MIN)) continue;
      const r = b.speaker(world, ctx, c);
      if (!r) continue;
      const to = r === true ? null : r;
      cands.push({ c, key: b.key, priority: b.priority, tone: b.tone ?? 'normal', to, replyKey: to && b.reply ? b.reply(to) : undefined, replyWho: to });
    }
    (ctx.scenario.speech ?? []).forEach((s, i) => {
      if (!matches(world, s.who, c)) return;
      if (s.once && c.thoughtHistory[LAST + s.key] !== undefined) return;
      if (recent(c, s.key, s.cooldownMin ?? SPEECH_COOLDOWN_MIN)) return;
      const scope = { world, map: ctx.map, scenario: ctx.scenario, leader: c };
      if (!evalCondition(s.when, scope, `speech[${i}].when`)) return;
      const to = resolveRef(world, s.to, c);
      cands.push({
        c,
        key: s.key,
        priority: s.priority ?? 20,
        tone: s.tone ?? 'normal',
        to: to === c ? null : to,
        lines: s.lines,
        replyLines: s.replies?.lines,
        replyWho: s.replies ? resolveRef(world, s.replies.who, c) : null,
        documented: s.documented,
        source: s.source,
      });
    });
  }
  if (cands.length === 0) return;
  cands.sort((a, b) => b.priority - a.priority);
  const spoke = new Set<ClimberState>();
  for (const k of cands) {
    if (spoke.size >= SPEECH_MAX_SPEAKERS) break;
    if (spoke.has(k.c)) continue;
    const r = nextFloat(rng);
    // 混乱した発語は確率 0.5 で話さない
    if (distortLevel(k.c) === 2 && r < 0.5) continue;
    spoke.add(k.c);
    k.c.thoughtHistory[LAST] = world.tMin;
    k.c.thoughtHistory[LAST + k.key] = world.tMin;
    const text = k.lines && k.lines.length > 0 ? k.lines[Math.floor(r * k.lines.length)] : undefined;
    ctx.events.push({
      tMin: world.tMin,
      type: 'SPEECH',
      climberId: k.c.id,
      text,
      data: { key: k.key, r, to: k.to?.id ?? null, tone: k.tone, distortLevel: distortLevel(k.c), documented: k.documented ?? false, source: k.source ?? null },
    });
    const rw = k.replyWho;
    if (rw && rw !== k.c && distortLevel(rw) < 3 && (k.replyKey || k.replyLines)) {
      const r2 = nextFloat(rng);
      const text2 = k.replyLines && k.replyLines.length > 0 ? k.replyLines[Math.floor(r2 * k.replyLines.length)] : undefined;
      ctx.events.push({
        tMin: world.tMin,
        type: 'SPEECH',
        climberId: rw.id,
        text: text2,
        data: { key: k.replyKey ?? `${k.key}:reply`, r: r2, to: k.c.id, tone: 'normal', distortLevel: distortLevel(rw), delaySec: 3 + Math.floor(r2 * 17), documented: false, source: null },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 表示用（純粋関数）

/** 構音障害・混乱・息切れの表示変形。level 2 は呼び出し側が confused 群の文を渡す */
export function distort(text: string, level: number, breathless = false, r = 0.5): string {
  let s = text;
  if (level >= 1) {
    const cut = s.search(/[、。！？!?]/);
    if (cut > 0) s = s.slice(0, cut);
    const chars = [...s];
    const out: string[] = [];
    chars.forEach((ch, i) => {
      out.push(ch);
      if (i < chars.length - 1 && (i + Math.floor(r * 3)) % 3 === 2) out.push(i % 2 === 0 ? '…' : 'っ');
    });
    s = `${out.join('')}……`;
  }
  if (breathless) {
    const cut = s.search(/[、。]/);
    s = `はぁ、${cut > 0 ? s.slice(0, cut) : s}`;
  }
  return s;
}

export type SpeechClass = 'plain' | 'documented' | 'fictional';

/**
 * 史実シナリオでのセリフの区分（docs/07 §7.5）。架空のシナリオは全体が架空なので plain。
 * documented: true かつ source があるものだけが記録。変形した文は架空。
 */
export function classify(line: { documented?: boolean; source?: string | null; distortLevel?: number }, scenario: ScenarioDef): SpeechClass {
  if (!scenario.historical) return 'plain';
  if (line.documented && line.source && !(line.distortLevel && line.distortLevel > 0)) return 'documented';
  return 'fictional';
}
