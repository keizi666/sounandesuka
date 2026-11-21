/**
 * 登山者のテンプレート: 人数・性別・年代・経験を選ぶと、名前・顔アイコン・体力・装備をランダムに決めたパーティを作る。
 * エディター専用（sim ではないので Math.random を使ってよい。テストでは rnd を差し替える）。
 */
import type { PortraitGroup } from '../../ui/avatar';
import type { ClimberDef, GearDef, ScenarioDef } from '../../sim/types';
import { defaultClimber, pickColor } from '../store/project';

type Season = ScenarioDef['season'];

export const GEAR_PRESETS: Record<string, (g: GearDef) => GearDef> = {
  日帰り軽装: (g) => ({ ...g, rainwear: 'poncho', cloWorn: 0.7, cloPack: 0.2, gloves: 'none', hat: false, bivy: 'none', headlamp: { has: false, batteryH: 0, inPack: true, spareBatteryH: 0 }, foodKcal: 600, waterL: 1, map: false, compass: false, whistle: false, rescueSheet: false }),
  日帰り標準: (g) => ({ ...g, rainwear: 'basic', cloWorn: 0.9, cloPack: 0.6, gloves: 'thin', hat: true, bivy: 'none', headlamp: { has: true, batteryH: 6, inPack: true, spareBatteryH: 0 }, foodKcal: 1200, waterL: 1.5, map: true }),
  日帰り万全: (g) => ({ ...g, rainwear: 'goretex', cloWorn: 0.9, cloPack: 1.0, gloves: 'waterproof', hat: true, bivy: 'sack', headlamp: { has: true, batteryH: 8, inPack: false, spareBatteryH: 8 }, phone: { ...g.phone, gpsApp: true, trackRecording: true }, foodKcal: 1800, waterL: 2, map: true, compass: true, whistle: true, rescueSheet: true }),
  小屋泊: (g) => ({ ...g, rainwear: 'goretex', cloWorn: 1.0, cloPack: 1.2, gloves: 'waterproof', hat: true, bivy: 'tarp', headlamp: { has: true, batteryH: 10, inPack: false, spareBatteryH: 6 }, foodKcal: 2500, waterL: 2, map: true, compass: true, whistle: true }),
  冬山: (g) => ({ ...g, rainwear: 'goretex', cloWorn: 1.6, cloPack: 1.5, gloves: 'waterproof', hat: true, bivy: 'sack', headlamp: { has: true, batteryH: 10, inPack: false, spareBatteryH: 10 }, foodKcal: 2500, waterL: 1.5, stove: true, crampons: true, helmet: true, map: true, compass: true, whistle: true, rescueSheet: true }),
};

export type SexMix = 'm' | 'f' | 'mix';
export type AgeMix = '20s' | '30s40s' | '50s60s' | '70s' | 'mix' | 'family';
export type LevelMix = 'beginner' | 'standard' | 'veteran' | 'mix';

export const SEX_OPTIONS: [SexMix, string][] = [['mix', '男女混在'], ['m', '男性だけ'], ['f', '女性だけ']];
export const AGE_OPTIONS: [AgeMix, string][] = [['mix', '年代混在'], ['20s', '20 代'], ['30s40s', '30〜40 代'], ['50s60s', '50〜60 代'], ['70s', '70 代'], ['family', '親子（子供を含む）']];
export const LEVEL_OPTIONS: [LevelMix, string][] = [['mix', '経験混在'], ['beginner', '初心者'], ['standard', 'ふつう'], ['veteran', 'ベテラン']];

export interface PartyOpts {
  count: number;
  sex: SexMix;
  age: AgeMix;
  level: LevelMix;
  season: Season;
}

const SURNAMES = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '清水', '山崎', '森', '池田', '橋本', '阿部', '石川', '山下', '中島', '石井', '小川', '前田', '岡田', '長谷川', '藤田', '後藤', '近藤', '村上', '遠藤', '青木', '坂本', '斉藤', '福田', '太田', '西村', '藤井', '岡本', '藤原', '中野', '三浦', '原田', '松田', '竹内', '小野', '田村', '中山', '和田', '石田', '上田', '森田', '原', '柴田', '酒井', '工藤', '横山', '宮崎', '宮本', '内田', '高木', '安藤', '谷口', '大野', '丸山', '今井', '河野', '藤本', '村田', '武田', '上野', '杉山', '増田', '平野', '大塚', '千葉', '久保', '松井', '小島', '岩崎', '桜井', '野口', '松尾', '野村', '木下', '菊地', '佐野', '大西', '杉本', '新井', '浜田', '菅原', '市川', '水野'];
const KID_NAMES: Record<'m' | 'f', string[]> = {
  m: ['陽太', '蓮', '湊', '悠真', '大翔', '樹', '颯太', '律', '朝陽', '蒼'],
  f: ['陽葵', '凛', '結菜', '紬', '芽依', '葵', '咲良', '澪', '心春', '杏'],
};

type Rnd = () => number;
const between = (rnd: Rnd, a: number, b: number): number => a + (b - a) * rnd();
const int = (rnd: Rnd, a: number, b: number): number => Math.floor(between(rnd, a, b + 1));
const r2 = (v: number): number => Math.round(v * 100) / 100;
function pick<T>(rnd: Rnd, xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)]!;
}
function shuffle<T>(rnd: Rnd, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}

const AGE_RANGE: Record<Exclude<AgeMix, 'mix' | 'family'>, [number, number]> = { '20s': [20, 29], '30s40s': [30, 49], '50s60s': [50, 69], '70s': [70, 78] };

/** 混在のときは偏らないよう、候補を順に回す（シャッフルした並びを繰り返す） */
function spread<T>(rnd: Rnd, xs: readonly T[], n: number): T[] {
  const order = shuffle(rnd, [...xs]);
  return Array.from({ length: n }, (_, i) => order[i % order.length]!);
}

interface Member {
  sex: 'm' | 'f';
  age: number;
  level: Exclude<LevelMix, 'mix'>;
  child: boolean;
  role?: string;
}

function members(o: PartyOpts, rnd: Rnd): Member[] {
  const n = Math.max(1, Math.min(12, Math.round(o.count)));
  const sexes = o.sex === 'mix' ? (n === 1 ? [pick(rnd, ['m', 'f'] as const)] : spread(rnd, ['m', 'f'] as const, n)) : Array<'m' | 'f'>(n).fill(o.sex);
  const levels = o.level === 'mix' ? spread(rnd, ['beginner', 'standard', 'veteran'] as const, n) : Array<Exclude<LevelMix, 'mix'>>(n).fill(o.level);
  if (o.age === 'family') {
    // 大人 1〜2 人と子供。3 人以上なら大人 2 人（性別が混在なら父と母）
    const adults = n >= 3 ? 2 : 1;
    return Array.from({ length: n }, (_, i): Member => {
      if (i < adults) {
        const sex = o.sex === 'mix' && adults === 2 ? (i === 0 ? 'm' : 'f') : sexes[i]!;
        return { sex, age: int(rnd, 35, 49), level: levels[i] === 'beginner' ? 'standard' : levels[i]!, child: false, role: sex === 'm' ? '父' : '母' };
      }
      return { sex: sexes[i]!, age: int(rnd, 8, 15), level: 'beginner', child: true, role: '子供' };
    });
  }
  const bands = o.age === 'mix' ? spread(rnd, ['20s', '30s40s', '50s60s', '70s'] as const, n) : Array<Exclude<AgeMix, 'mix' | 'family'>>(n).fill(o.age);
  return Array.from({ length: n }, (_, i): Member => {
    const [a, b] = AGE_RANGE[bands[i]!];
    return { sex: sexes[i]!, age: int(rnd, a, b), level: levels[i]!, child: false };
  });
}

function gearPreset(level: Member['level'], season: Season): string {
  if (season === 'winter') return level === 'beginner' ? '日帰り標準' : '冬山';
  return level === 'beginner' ? '日帰り軽装' : level === 'standard' ? '日帰り標準' : '日帰り万全';
}

/** 顔アイコンを区分ごとに重ならないよう選ぶ（画像の一覧がなければ自動のまま） */
function portraitPicker(counts: Partial<Record<PortraitGroup, number>> | null, rnd: Rnd): (g: PortraitGroup) => string | undefined {
  const used = new Map<PortraitGroup, number[]>();
  return (g) => {
    const n = counts?.[g] ?? 0;
    if (n <= 0) return undefined;
    let left = used.get(g);
    if (!left || left.length === 0) left = shuffle(rnd, Array.from({ length: n }, (_, k) => k + 1));
    const k = left.pop()!;
    used.set(g, left);
    return `${g}:${k}`;
  };
}

/** 条件に合うパーティを作る。ID は idPrefix + 番号（既定 c1, c2, …）。いちばん経験のある大人がリーダー */
export function generateParty(o: PartyOpts, counts: Partial<Record<PortraitGroup, number>> | null, rnd: Rnd = Math.random, opts: { firstIndex?: number; usedNames?: string[]; usedColors?: string[] } = {}): ClimberDef[] {
  const ms = members(o, rnd);
  const face = portraitPicker(counts, rnd);
  const names = shuffle(rnd, SURNAMES.filter((s) => !(opts.usedNames ?? []).includes(s)));
  const family = names.pop() ?? '山田';
  const kidNames = { m: shuffle(rnd, [...KID_NAMES.m]), f: shuffle(rnd, [...KID_NAMES.f]) };
  const colors = [...(opts.usedColors ?? [])];
  const first = opts.firstIndex ?? 1;
  const out = ms.map((m, i): ClimberDef => {
    const color = pickColor(colors);
    colors.push(color);
    const name = o.age === 'family' ? (m.child ? (kidNames[m.sex].pop() ?? '子供') : `${family}（${m.role}）`) : (names.pop() ?? `登山者${i + 1}`);
    const c = defaultClimber(`c${first + i}`, name, color, false);
    c.age = m.age;
    c.sex = m.sex;
    if (m.role) c.role = m.role;
    const group = `${m.age < 16 ? 'child' : m.age < 40 ? 'young' : m.age < 65 ? 'mid' : 'senior'}_${m.sex}` as PortraitGroup;
    c.portrait = face(group);
    if (m.child) c.weightKg = Math.round(between(rnd, 22, 30) + (m.age - 8) * 3.5);
    else c.weightKg = Math.round(m.sex === 'm' ? between(rnd, 58, 78) : between(rnd, 46, 60));
    const fit = m.child ? [0.9, 1.05] : m.age < 30 ? [1.05, 1.2] : m.age < 50 ? [0.95, 1.12] : m.age < 65 ? [0.85, 1.02] : [0.72, 0.88];
    c.fitness = r2(between(rnd, fit[0]!, fit[1]!));
    const lv = { beginner: { exp: [0.08, 0.28], nav: [0.1, 0.35], delay: [0.4, 0.7] }, standard: { exp: [0.4, 0.62], nav: [0.4, 0.62], delay: [0.2, 0.4] }, veteran: { exp: [0.7, 0.92], nav: [0.65, 0.9], delay: [0.05, 0.2] } }[m.level];
    c.experience = r2(between(rnd, lv.exp[0]!, lv.exp[1]!));
    c.navSkill = r2(between(rnd, lv.nav[0]!, lv.nav[1]!));
    c.riskTolerance = r2(between(rnd, m.child ? 0.3 : 0.2, m.child ? 0.5 : 0.7));
    c.habits = { ...c.habits, delaysRainwear: r2(between(rnd, lv.delay[0]!, lv.delay[1]!)), eatEveryMin: Math.round(between(rnd, 90, 150) / 15) * 15, drinkEveryMin: Math.round(between(rnd, 40, 75) / 5) * 5 };
    c.gear = GEAR_PRESETS[gearPreset(m.level, o.season)]!(c.gear);
    if (o.season === 'winter' && m.level === 'beginner') c.gear = { ...c.gear, cloWorn: 1.2, cloPack: 0.6 };
    c.packKg = m.child ? 3 : Math.round(between(rnd, o.season === 'winter' ? 9 : 5, o.season === 'winter' ? 13 : 9));
    if (m.child) c.gear = { ...c.gear, phone: { ...c.gear.phone, has: false }, map: false, compass: false };
    return c;
  });
  // リーダー: 大人の中でいちばん経験のある人
  const adults = out.filter((c) => c.age >= 18);
  const leader = (adults.length ? adults : out).reduce((a, b) => (b.experience > a.experience ? b : a));
  if (out.length > 1 || first === 1) leader.leader = true;
  return out;
}

/** シナリオの中（パーティ以外）で、残らない登山者 ID を参照している所があるか */
export function danglingClimberRefs(s: ScenarioDef, keepIds: readonly string[]): string[] {
  const rest = JSON.stringify({ ...s, party: [] });
  return s.party.map((c) => c.id).filter((id) => !keepIds.includes(id) && rest.includes(`"${id}"`));
}
