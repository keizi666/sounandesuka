/**
 * ログの行ができた瞬間の場面の写し（画像生成 AI 用のプロンプトの材料。ユーザーの指定）。
 * 世界は進んでいくので、行を作るときに、場所・時刻・天気・地形・人物・動物を小さなオブジェクトに写しておく。
 * 亡くなった人は描かない（静かに表す方針）。
 */
import { animalGoneMin, animalPos } from '../../sim/hazards/animals';
import { nearestIndex } from '../../sim/terrain/sample';
import { footSnowCm, groundAt } from '../../sim/weather/ground';
import type { ClimberState, StaticContext, World } from '../../sim/types';

export type Pose = 'walk' | 'stand' | 'rest' | 'huddle' | 'sit' | 'lie' | 'crawl' | 'phone' | 'shelter' | 'rescued';

export interface ScenePerson {
  age: number;
  sex: 'm' | 'f';
  color: string;
  pose: Pose;
  injury: string;
  rainwear: boolean;
  headlamp: boolean;
  coreC: number;
}

export interface SceneSnap {
  text: string;
  tMin: number;
  month: number;
  season: string;
  /** 地域の名前（実在の山）。架空の山なら null */
  region: string | null;
  nodeName: string | null;
  onTrail: boolean;
  elevM: number;
  veg: number;
  slopeDeg: number;
  snowCm: number;
  wet: boolean;
  sun: { elevDeg: number; isDark: boolean; twilight: boolean; moonIllum: number };
  wx: { tempC: number; windMs: number; precipMmH: number; precipType: string; visibilityM: number; thunder: number; inCloud: boolean };
  people: ScenePerson[];
  /** 描ききれなかった人数 */
  more: number;
  animals: { species: string; distM: number }[];
  heli: boolean;
}

/** いっしょに描く人の範囲（m） */
const NEAR_M = 150;
/** 描く人数の上限 */
const MAX_PEOPLE = 6;
/** 動物を描く範囲（m） */
const ANIMAL_M = 300;
/** 近くの地点とみなす距離（m） */
const NODE_M = 400;
const MOVING = new Set(['WALKING', 'OFFROUTE_UNAWARE', 'LOST_AWARE', 'BACKTRACKING', 'NAVIGATING_TO_TRAIL', 'DESCENDING_DRAINAGE', 'SEEKING_SIGNAL']);

function poseOf(c: ClimberState): Pose {
  const b = c.body;
  if (!b.conscious || c.state === 'UNCONSCIOUS') return 'lie';
  if (c.state === 'INCAPACITATED') return 'sit';
  if (c.state === 'SHELTERED' && b.shelterNodeId !== null) return 'shelter';
  if (c.state === 'RESCUED') return 'rescued';
  const crawler = b.illness?.active === true || b.injury === 'legFracture' || c.M < 0.25;
  if (c.speedMs > 0.002 && (MOVING.has(c.state) || c.pos.mode === 'free')) return crawler ? 'crawl' : 'walk';
  if (c.state === 'BIVOUAC' || c.state === 'WAITING_RESCUE' || c.state === 'STAYING') return b.coreC < 36.2 || c.local.windChillC < 2 ? 'huddle' : 'rest';
  if (c.state === 'RESTING') return 'rest';
  if (c.state === 'SEEKING_SIGNAL') return 'phone';
  return 'stand';
}

export function captureScene(world: World, ctx: StaticContext, text: string, focusId: string): SceneSnap | null {
  const focus = world.climbers.find((c) => c.id === focusId && c.body.alive) ?? world.climbers.find((c) => c.body.alive);
  if (!focus) return null;
  const map = ctx.map;
  const s = ctx.scenario;
  const i = nearestIndex(map, focus.x, focus.z);
  let nodeName: string | null = null;
  let nd2 = NODE_M * NODE_M;
  for (const n of Object.values(map.nodes)) {
    const d = (n.x - focus.x) ** 2 + (n.z - focus.z) ** 2;
    if (d < nd2 && n.name) (nd2 = d), (nodeName = n.name);
  }
  const near = world.climbers.filter((c) => c.body.alive && !c.offMap && (c.x - focus.x) ** 2 + (c.z - focus.z) ** 2 <= NEAR_M * NEAR_M);
  near.sort((a, b) => Number(b === focus) - Number(a === focus));
  const people: ScenePerson[] = near.slice(0, MAX_PEOPLE).map((c) => ({
    age: c.def.age,
    sex: c.def.sex,
    color: c.def.color,
    pose: poseOf(c),
    injury: c.body.injury,
    rainwear: c.body.rainwearOn,
    headlamp: c.inv.headlamp.on,
    coreC: c.body.coreC,
  }));
  const animals: SceneSnap['animals'] = [];
  for (const a of world.animals ?? []) {
    if (world.tMin < a.fromMin || world.tMin > animalGoneMin(a, ctx.tuning.animals)) continue;
    const [ax, az] = animalPos(a, world.tMin, ctx.tuning.animals);
    const d = Math.sqrt((ax - focus.x) ** 2 + (az - focus.z) ** 2);
    if (d <= ANIMAL_M) animals.push({ species: a.species, distM: Math.round(d / 10) * 10 });
  }
  const l = focus.local;
  const date = new Date(`${s.startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.floor(world.tMin / 1440));
  return {
    // 分岐の行の印（◆・観察:）は除く
    text: text.replace(/^◆\s*/, '').replace(/^観察:\s*/, '').trim(),
    tMin: world.tMin,
    month: date.getUTCMonth() + 1,
    season: s.season,
    region: s.region?.real ? s.region.name : null,
    nodeName,
    onTrail: focus.pos.mode !== 'free',
    elevM: Math.round(focus.elevM / 10) * 10,
    veg: map.veg[i] ?? 0,
    slopeDeg: map.slopeDeg[i] ?? 0,
    snowCm: footSnowCm(world, ctx, focus),
    wet: groundAt(world.ground, focus.elevM).wet > 0.5,
    sun: { elevDeg: world.sun.elevDeg, isDark: world.sun.isDark, twilight: world.sun.twilight, moonIllum: world.sun.moonIllum },
    wx: { tempC: l.tempC, windMs: l.windMs, precipMmH: l.precipMmH, precipType: l.precipType, visibilityM: l.visibilityM, thunder: l.thunder, inCloud: l.inCloud },
    people,
    more: Math.max(0, near.length - MAX_PEOPLE),
    animals,
    heli: world.rescue.heli.state === 'flying' || world.rescue.heli.state === 'searching',
  };
}
