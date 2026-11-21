/**
 * 「いつ」をやさしい言葉で選ぶ欄（物語のタブ）。条件 DSL（docs/09 §4）のうち、よく使う形だけを選択肢にする。
 * 選択肢にない形（組み合わせた条件など）は「そのほか」として言葉の要約を出し、くわしい設定（条件ビルダー）で直してもらう。
 * 「起きる確率」は { all: [もとの条件, { chance }] } の形で持つ。
 */
import type { Condition, MapDef, ScenarioDef, SimEventType } from '../../sim/types';
import { el } from '../../ui/dom';
import { EVENT_LABELS, summarize } from './ConditionBuilder';

export interface WhenCtx {
  scenario: ScenarioDef;
  map: MapDef;
}

type X = Record<string, unknown>;
type Up = (c: Condition) => void;

interface Preset {
  id: string;
  label: string;
  test(c: Condition): boolean;
  make(ctx: WhenCtx): Condition;
  /** 追加の入力欄（地点・時刻・数値） */
  fields?(c: Condition, ctx: WhenCtx, up: Up): (HTMLElement | string)[];
}

const isVar = (c: Condition, path: string, op: string): boolean => 'var' in c && c.var === path && c.op === op;

function numField(value: number, set: (v: number) => void, unit: string, step = 1): (HTMLElement | string)[] {
  const i = el('input', { type: 'number', value, step, style: 'width:5em' });
  i.addEventListener('change', () => i.value !== '' && set(Number(i.value)));
  return [i, unit];
}

function varPreset(id: string, label: string, path: string, op: '<' | '>', def: number, unit: string, step = 1): Preset {
  return {
    id,
    label,
    test: (c) => isVar(c, path, op),
    make: () => ({ var: path, op, value: def }),
    fields: (c, _ctx, up) => numField(Number((c as X)['value']), (v) => up({ var: path, op, value: v }), unit, step),
  };
}

function eventPreset(ev: SimEventType): Preset {
  return { id: `ev:${ev}`, label: `${EVENT_LABELS[ev] ?? ev}とき`, test: (c) => 'event' in c && c.event === ev, make: () => ({ event: ev }) };
}

/** 地点の選ぶ欄: 計画ルートの地点を先に、名前のある地点だけ（名前のない分岐は ID） */
export function nodeSelect(ctx: WhenCtx, value: string, set: (id: string) => void): HTMLSelectElement {
  const route = ctx.scenario.plan.route;
  const name = (id: string): string => ctx.map.nodes.find((n) => n.id === id)?.name || id;
  const onRoute = [...new Set(route)].filter((id) => ctx.map.nodes.some((n) => n.id === id && n.name));
  const others = ctx.map.nodes.filter((n) => n.name && !onRoute.includes(n.id)).map((n) => n.id);
  const opt = (id: string): HTMLElement => el('option', { value: id, selected: id === value }, name(id));
  const known = onRoute.includes(value) || others.includes(value);
  const s = el('select', {}, [
    known ? null : el('option', { value, selected: true }, name(value) || '（地点を選ぶ）'),
    onRoute.length ? el('optgroup', { label: '計画ルートの地点' }, onRoute.map(opt)) : null,
    others.length ? el('optgroup', { label: 'そのほかの地点' }, others.map(opt)) : null,
  ].filter((x) => x !== null));
  s.addEventListener('change', () => set(s.value));
  return s;
}

/** 時刻（"D0 13:30"）を「何日目」と時計で入れる */
export function timeFields(value: string, set: (v: string) => void): (HTMLElement | string)[] {
  const m = /^D(\d+) (\d{1,2}):(\d{2})$/.exec(value) ?? ['', '0', '12', '00'];
  let day = Number(m[1]);
  let hhmm = `${String(m[2]).padStart(2, '0')}:${m[3]}`;
  const d = el('select', {}, [0, 1, 2, 3].map((k) => el('option', { value: k, selected: k === day }, `${k + 1} 日目`)));
  const t = el('input', { type: 'time', value: hhmm });
  const commit = (): void => set(`D${day} ${hhmm}`);
  d.addEventListener('change', () => {
    day = Number(d.value);
    commit();
  });
  t.addEventListener('change', () => {
    if (!t.value) return;
    hhmm = t.value;
    commit();
  });
  return [d, t];
}

const firstNode = (ctx: WhenCtx): string => {
  const r = ctx.scenario.plan.route;
  return r[Math.floor(r.length / 2)] ?? ctx.map.nodes[0]?.id ?? '';
};

/** 山の中で起きること（分岐・できごと・セリフ）の「いつ」 */
export const LIVE_PRESETS: Preset[] = [
  { id: 'atNode', label: '地点に着いたとき', test: (c) => 'atNode' in c, make: (ctx) => ({ atNode: firstNode(ctx) }), fields: (c, ctx, up) => [nodeSelect(ctx, String((c as X)['atNode']), (id) => up({ atNode: id }))] },
  { id: 'after', label: '時刻になったら', test: (c) => 'after' in c, make: (ctx) => ({ after: ctx.scenario.startAt }), fields: (c, _ctx, up) => timeFields(String((c as X)['after']), (v) => up({ after: v })) },
  eventPreset('RAIN_START'),
  eventPreset('SUNSET'),
  eventPreset('DARK'),
  eventPreset('LOST_AWARE'),
  eventPreset('FALL'),
  eventPreset('INJURY'),
  eventPreset('SHELTER_ENTER'),
  eventPreset('BIVOUAC_START'),
  varPreset('behind', '予定より遅れたら', 'leader.timeBehindMin', '>', 60, '分より遅れたら'),
  varPreset('tired', '疲れてきたら', 'party.max.fatigue', '>', 60, 'より疲れたら（0〜100）'),
  varPreset('cold', '体が冷えてきたら', 'party.min.coreC', '<', 35.5, '℃ より体温が下がったら', 0.1),
  varPreset('wind', '風が強くなったら', 'leader.local.windMs', '>', 12, 'm/s より強くなったら'),
  varPreset('animal', '動物が近くにいたら', 'animal.any', '<', 100, 'm より近くにいたら'),
];

/** 終わってから振り返ること（結末・教訓）の「どんなとき」 */
export const RECORD_PRESETS: Preset[] = [
  varPreset('rainwear', '雨具を着るのが遅れた', 'rec.rainwearDelayMin', '>', 20, '分より遅れた'),
  { id: 'lost', label: '道に迷った', test: (c) => 'var' in c && c.var === 'rec.wasLost', make: () => ({ var: 'rec.wasLost', op: '==', value: true }) },
  varPreset('coldRec', '体が冷えた', 'rec.minCoreC', '<', 35, '℃ より体温が下がった', 0.1),
  varPreset('fall', '転んだ・滑落した', 'rec.fallCount', '>', 0, '回より多く転んだ'),
  varPreset('dark', '暗い中を歩いた', 'rec.darkMinutesMoving', '>', 30, '分より長く歩いた'),
  varPreset('death', '亡くなった人がいる', 'rec.deathCount', '>', 0, '人より多い'),
  {
    id: 'chose',
    label: '分かれ道でこれを選んだ',
    test: (c) => 'chose' in c,
    make: (ctx) => ({ chose: { cp: ctx.scenario.choices[0]?.id ?? '', option: ctx.scenario.choices[0]?.options[0]?.id ?? '' } }),
    fields: (c, ctx, up) => {
      const ch = (c as { chose: { cp: string; option: string } }).chose;
      const cps = ctx.scenario.choices;
      const cp = cps.find((p) => p.id === ch.cp);
      const a = el('select', {}, cps.map((p) => el('option', { value: p.id, selected: p.id === ch.cp }, p.title || p.id)));
      a.addEventListener('change', () => up({ chose: { cp: a.value, option: cps.find((p) => p.id === a.value)?.options[0]?.id ?? '' } }));
      const b = el('select', {}, (cp?.options ?? []).map((o) => el('option', { value: o.id, selected: o.id === ch.option }, o.label || o.id)));
      b.addEventListener('change', () => up({ chose: { cp: ch.cp, option: b.value } }));
      return [a, 'で', b];
    },
  },
];

interface Parts {
  /** 選ぶ欄で表せる、もとの条件（なければ全体が「そのほか」） */
  base: Condition;
  preset: Preset | undefined;
  /** 「すべて満たす」で一緒に付いている、ほかの条件（そのまま残す） */
  rest: Condition[];
  chance: number | null;
}

/** 条件を「もとの条件・ほかの条件・確率」に分ける。{ all: [もと, ほか…, { chance }] } の形を読む */
function split(c: Condition, presets: Preset[]): Parts {
  const find = (x: Condition): Preset | undefined => presets.find((p) => p.test(x));
  if ('all' in c) {
    const ch = c.all.find((y) => 'chance' in y) as { chance: number } | undefined;
    const others = c.all.filter((y) => !('chance' in y));
    const bi = others.findIndex((y) => find(y));
    if (bi >= 0) return { base: others[bi]!, preset: find(others[bi]!), rest: others.filter((_, i) => i !== bi), chance: ch?.chance ?? null };
  }
  return { base: c, preset: find(c), rest: [], chance: null };
}

function join(base: Condition, rest: Condition[], chance: number | null): Condition {
  const parts = [base, ...rest, ...(chance === null ? [] : [{ chance }])];
  return parts.length === 1 ? base : { all: parts };
}

/** 「いつ」を 1 行の言葉にする（カードに出す） */
export function plainWhen(c: Condition | undefined, ctx: WhenCtx, presets: Preset[] = LIVE_PRESETS): string {
  if (!c) return 'いつも';
  const { base, preset: p, rest, chance } = split(c, presets);
  let text = summarize(base, ctx.scenario, ctx.map);
  if (p?.id === 'atNode') text = `${ctx.map.nodes.find((n) => n.id === (base as X)['atNode'])?.name || String((base as X)['atNode'])}に着いたとき`;
  else if (p?.id === 'after') text = `${clockLabel(String((base as X)['after']))}になったら`;
  else if (p?.id.startsWith('ev:')) text = p.label;
  return `${text}${rest.length ? '（条件つき）' : ''}${chance === null ? '' : `（${Math.round(chance * 100)}% の確率で）`}`;
}

/** "D1 06:30" → "2 日目 06:30" */
export function clockLabel(ref: string): string {
  const m = /^D(\d+) (\d{1,2}:\d{2})$/.exec(ref);
  return m ? `${Number(m[1]) === 0 ? '' : `${Number(m[1]) + 1} 日目 `}${m[2]}` : ref;
}

export interface WhenOpts {
  presets?: Preset[];
  /** 条件なし（いつも）を選べる。選ぶと commit(undefined) */
  optional?: string;
  /** 「起きる確率」の欄を出す */
  chance?: boolean;
}

export function whenPicker(c: Condition | undefined, ctx: WhenCtx, commit: (c: Condition | undefined) => void, o: WhenOpts = {}): HTMLElement {
  const presets = o.presets ?? LIVE_PRESETS;
  const parts = c ? split(c, presets) : null;
  const cur = parts?.preset;
  const rest = parts?.rest ?? [];
  const chance = parts?.chance ?? null;
  const sel = el('select', { class: 'when-kind' }, [
    o.optional ? el('option', { value: '__none', selected: !parts }, o.optional) : null,
    ...presets.map((p) => el('option', { value: p.id, selected: p === cur }, p.label)),
    parts && !cur ? el('option', { value: '__custom', selected: true }, 'そのほか（くわしい条件）') : null,
  ].filter((x) => x !== null));
  sel.addEventListener('change', () => {
    if (sel.value === '__none') return commit(undefined);
    const p = presets.find((x) => x.id === sel.value);
    if (p) commit(join(p.make(ctx), rest, chance));
  });
  const kids: (HTMLElement | string)[] = [sel];
  if (parts && cur?.fields) kids.push(...cur.fields(parts.base, ctx, (n) => commit(join(n, rest, chance))));
  const box = el('div', { class: 'when-picker' }, [el('div', { class: 'cond-row' }, kids)]);
  if (parts && !cur) box.append(el('p', { class: 'note' }, `いまの条件: ${summarize(parts.base, ctx.scenario, ctx.map)}。下の「くわしい設定」で変えられます。上の欄で選び直すと、この条件は置き換わります。`));
  if (rest.length) box.append(el('p', { class: 'note' }, `さらに、次の条件もそろったとき: ${rest.map((r) => summarize(r, ctx.scenario, ctx.map)).join('、')}（「くわしい設定」で変えられます）`));
  if (o.chance && parts) {
    const pct = el('input', { type: 'number', min: 1, max: 100, step: 5, value: Math.round((chance ?? 1) * 100), style: 'width:4.5em' });
    pct.addEventListener('change', () => {
      const v = Math.max(1, Math.min(100, Number(pct.value) || 100));
      commit(join(parts.base, rest, v >= 100 ? null : v / 100));
    });
    box.append(el('div', { class: 'cond-row' }, ['起きる確率', pct, '%（100 なら必ず起きる）']));
  }
  return box;
}
