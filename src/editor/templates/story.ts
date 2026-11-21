/**
 * 物語のテンプレート（物語のタブの「足す」）: 分かれ道・できごと・会話・結末と教訓の部品と、部品をまとめた「物語の型」。
 * 部品は、計画ルートの地点・小屋・開始時刻に合わせて作る。足したあとは物語のタブで自由に直せる。
 * 中身は storyParts.ts（分かれ道・できごと）と storyParts2.ts（会話・結末・教訓）。
 */
import { formatTimeRef, tryParseTimeRef } from '../../sim/core/clock';
import type { ChoicePointDef, EditorProject, EndingDef, GenericChoiceKey, GenericOverride, LessonDef, MapDef, ScenarioDef, ScriptEventDef, SpeechDef, ThoughtDef } from '../../sim/types';

export interface StoryAdd {
  choices?: ChoicePointDef[];
  events?: ScriptEventDef[];
  speech?: SpeechDef[];
  thoughts?: ThoughtDef[];
  endings?: EndingDef[];
  lessons?: LessonDef[];
  generic?: Partial<Record<GenericChoiceKey, GenericOverride>>;
}

export type StoryCat = 'kit' | 'choice' | 'event' | 'talk' | 'ending';
export const CAT_LABELS: Record<StoryCat, [string, string]> = {
  kit: ['物語の型', 'いくつかの部品をまとめて入れます。はじめの一歩に'],
  choice: ['分かれ道', '登山者が判断を迫られる場面。選んだ行動で、その先が変わります'],
  event: ['できごと', '時刻や場所で、自動で起きること'],
  talk: ['会話・心の声', '登山者が話すこと・考えること（行動は変えません）'],
  ending: ['結末・教訓', '終わったときに出す文と、振り返りの教訓'],
};

export interface TplCtx {
  s: ScenarioDef;
  map: MapDef;
  /** 起きる地点（ボードの地点の「＋」から開いたらその地点。なければルートの中ほど） */
  node: string;
  nodeName: string;
  /** ルート上（なければ地図の中）の小屋。なければ node */
  hut: string;
  hutName: string;
  /** 開始から h 時間後の時刻（"D0 10:00"） */
  timeAt(h: number): string;
}

export interface StoryTemplate {
  id: string;
  cat: StoryCat;
  icon: string;
  name: string;
  desc: string;
  /** 地点で起きる（ボードの地点の「＋」に出す） */
  atNode?: boolean;
  make(c: TplCtx): StoryAdd;
}

export type StorySel = { kind: 'choice' | 'event' | 'speech' | 'thought' | 'ending' | 'lesson' | 'generic'; idx: number };

export function tplCtx(p: EditorProject, node?: string): TplCtx {
  const s = p.scenario;
  const map = p.map;
  const route = s.plan.route;
  const named = route.filter((id) => map.nodes.find((n) => n.id === id)?.name);
  const at = node ?? named[Math.floor(named.length / 2)] ?? route[Math.floor(route.length / 2)] ?? map.nodes[0]?.id ?? '';
  const name = (id: string): string => map.nodes.find((n) => n.id === id)?.name || id;
  const hut = map.nodes.find((n) => n.shelter && route.includes(n.id))?.id ?? map.nodes.find((n) => n.shelter)?.id ?? at;
  const start = tryParseTimeRef(s.startAt) ?? 360;
  return { s, map, node: at, nodeName: name(at), hut, hutName: name(hut), timeAt: (h) => formatTimeRef(start + Math.round(h * 60)) };
}

const uniq = (base: string, used: Set<string>): string => {
  let id = base;
  for (let k = 2; used.has(id); k += 1) id = `${base}${k}`;
  used.add(id);
  return id;
};

/** 部品をシナリオに足す。ID が重なるものは番号を付け、部品の中の参照（「この分かれ道でこれを選んだ」）も合わせる。足した最初の項目を返す */
export function applyStory(s: ScenarioDef, add0: StoryAdd): StorySel | null {
  const ren = new Map<string, string>();
  const plan = (ids: string[], list: { id?: string; key?: string }[] | undefined): void => {
    const used = new Set(ids);
    for (const x of list ?? []) {
      const old = (x.id ?? x.key)!;
      const id = uniq(old, used);
      if (id !== old) ren.set(old, id);
    }
  };
  plan(s.choices.map((c) => c.id), add0.choices);
  plan(s.events.map((e) => e.id), add0.events);
  plan((s.speech ?? []).map((x) => x.key), add0.speech);
  plan((s.thoughts ?? []).map((x) => x.key), add0.thoughts);
  plan(s.lessons.map((l) => l.id), add0.lessons);
  let json = JSON.stringify(add0);
  for (const [a, b] of ren) json = json.split(`"${a}"`).join(`"${b}"`);
  const add = JSON.parse(json) as StoryAdd;
  let first: StorySel | null = null;
  const mark = (kind: StorySel['kind'], idx: number): void => {
    first ??= { kind, idx };
  };
  for (const c of add.choices ?? []) mark('choice', s.choices.push(c) - 1);
  for (const e of add.events ?? []) mark('event', s.events.push(e) - 1);
  for (const x of add.speech ?? []) mark('speech', (s.speech ??= []).push(x) - 1);
  for (const x of add.thoughts ?? []) mark('thought', (s.thoughts ??= []).push(x) - 1);
  for (const e of add.endings ?? []) {
    // 同じ種類の条件なしの結末がもうあれば足さない（上にあるものが先に使われるので、足しても出ない）
    if (s.endings.some((x) => x.kind === e.kind && !x.when)) continue;
    mark('ending', s.endings.push(e) - 1);
  }
  for (const l of add.lessons ?? []) mark('lesson', s.lessons.push(l) - 1);
  if (add.generic) {
    s.genericOverrides = { ...(s.genericOverrides ?? {}) };
    for (const [k, v] of Object.entries(add.generic) as [GenericChoiceKey, GenericOverride][]) s.genericOverrides[k] = { ...(s.genericOverrides[k] ?? {}), ...v };
    mark('generic', 0);
  }
  return first;
}

/** いくつかの部品を 1 つにまとめる（物語の型） */
export function mergeAdds(list: StoryAdd[]): StoryAdd {
  const out: StoryAdd = {};
  for (const a of list) {
    for (const k of ['choices', 'events', 'speech', 'thoughts', 'endings', 'lessons'] as const) {
      if (a[k]) (out[k] as unknown[] | undefined) = [...((out[k] as unknown[] | undefined) ?? []), ...(a[k] as unknown[])];
    }
    if (a.generic) out.generic = { ...(out.generic ?? {}), ...a.generic };
  }
  return out;
}
