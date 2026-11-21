/**
 * 変数パスの解決（docs/09 §4.1）。条件 DSL・プレースホルダ・教訓の条件が使う。
 * 記録（rec.*）は World の外にあるので、呼び出し側が渡す。
 */
import { bacPct } from '../climber/physiology';
import { isIndoors, isMoving } from '../climber/situation';
import { nearestIndex } from '../terrain/sample';
import { ANIMAL_SPECIES, nearestAnimalM } from '../hazards/animals';
import { TUNING } from '../tuning';
import type { ClimberState, MapRuntime, ScenarioDef, World } from '../types';

export type VarValue = number | string | boolean;

/** 解決に使う文脈。leader はその分岐点・イベントを評価するグループのリーダー */
export interface VarScope {
  world: World;
  map: MapRuntime;
  scenario: ScenarioDef;
  leader: ClimberState;
  /** 記録の集計（教訓・結末の判定用。P7 の recorder が渡す） */
  rec?: Record<string, VarValue | null>;
}

/** 登山者の状態として読めるフィールド */
export const CLIMBER_FIELDS = [
  'coreC',
  'wetness',
  'glycogenKcal',
  'waterDeficitL',
  'fatigue',
  'anxiety',
  'J',
  'M',
  'state',
  'elevM',
  'injury',
  'rainwearOn',
  'awareLost',
  'knowsPosition',
  'conscious',
  'alive',
  'stage',
  'radio',
  'timeBehindMin',
  'phone.batteryPct',
  'phone.gpsApp',
  'phone.has',
  'headlamp.has',
  'headlamp.usable',
  'gear.clo',
  'gear.crampons',
  'gear.rainwear',
  'rescueCalled',
  'illness',
  'illnessActive',
  'stings',
  'bac',
  'waterL',
  'foodKcal',
  'nearestShelterM',
  'indoors',
  'moving',
  'name',
  'id',
] as const;

export const LOCAL_FIELDS = ['tempC', 'windMs', 'windDirDeg', 'precipMmH', 'precipType', 'visibilityM', 'windChillC', 'thunder', 'solarW', 'inCloud'] as const;
export const DEF_FIELDS = ['experience', 'fitness', 'navSkill', 'riskTolerance', 'age', 'weightKg', 'packKg', 'name', 'sex', 'role'] as const;
export const GLOBAL_FIELDS = ['tempC', 'windMs', 'windDirDeg', 'precipMmH', 'cloudCover', 'cloudBaseM', 'visibilityM', 'inCloudVisibilityM', 'thunder', 'pressureHpa', 'gust'] as const;
/** 集計（party.* と group.<id>.*）で使える数値フィールド */
export const AGG_FIELDS = ['coreC', 'wetness', 'glycogenKcal', 'waterDeficitL', 'fatigue', 'anxiety', 'J', 'M', 'elevM', 'timeBehindMin'] as const;
export const GROUP_COUNTS = ['count', 'incapacitatedCount', 'below35Count', 'unwellCount'] as const;
export const REC_FIELDS = [
  'deathCount',
  'minCoreC',
  'maxAnxiety',
  'fallCount',
  'rainwearDelayMin',
  'wasLost',
  'lostMinutes',
  'darkMinutesMoving',
  'rescueCalledAt',
  'finalState',
  'endingKind',
] as const;

function climberField(c: ClimberState, field: string, scope: VarScope): VarValue | undefined {
  const b = c.body;
  switch (field) {
    case 'coreC':
    case 'wetness':
    case 'glycogenKcal':
    case 'waterDeficitL':
    case 'fatigue':
    case 'anxiety':
    case 'injury':
    case 'rainwearOn':
    case 'conscious':
    case 'alive':
    case 'stage':
      return b[field];
    case 'J':
      return c.J;
    case 'M':
      return c.M;
    case 'state':
      return c.state;
    case 'elevM':
      return c.elevM;
    case 'awareLost':
      return c.perception.awareLost;
    case 'knowsPosition':
      return c.perception.knowsPosition;
    case 'timeBehindMin':
      return c.perception.timeBehindMin;
    case 'radio':
      return scope.map.radio[nearestIndex(scope.map, c.x, c.z)] ?? 0;
    case 'phone.batteryPct':
      return c.inv.phone.batteryPct;
    case 'phone.gpsApp':
      return c.inv.phone.gpsApp && c.inv.phone.has;
    case 'phone.has':
      return c.inv.phone.has;
    case 'headlamp.usable':
      return c.inv.headlamp.has && c.inv.headlamp.batteryH > 0;
    case 'rescueCalled':
      return scope.world.rescue.calledAtMin !== null && (scope.world.rescue.via === 'phone' || scope.world.rescue.via === 'satellite');
    case 'headlamp.has':
      return c.inv.headlamp.has;
    // 持って出た装備（始まりの条件で装備を変えたときに、文を出し分ける。gear.clo は着ている服と予備の服の保温力の和）
    case 'gear.clo':
      return c.def.gear.cloWorn + c.def.gear.cloPack;
    case 'gear.crampons':
      return c.def.gear.crampons;
    case 'gear.rainwear':
      return c.def.gear.rainwear;
    case 'illness':
      return c.body.illness?.kind ?? 'none';
    case 'illnessActive':
      return c.body.illness?.active ?? false;
    case 'stings':
      return c.body.stings ?? 0;
    case 'waterL':
      return c.inv.waterL;
    case 'foodKcal':
      return c.inv.foodKcal;
    case 'bac':
      return bacPct(c);
    case 'nearestShelterM': {
      let best = Infinity;
      for (const nd of Object.values(scope.map.nodes)) {
        const open = scope.scenario.nodeOverrides?.[nd.id]?.open ?? nd.shelter?.open ?? false;
        if (!nd.shelter || !open) continue;
        best = Math.min(best, Math.sqrt((nd.x - c.x) * (nd.x - c.x) + (nd.z - c.z) * (nd.z - c.z)));
      }
      return best;
    }
    case 'indoors':
      return isIndoors(scope.map, c);
    case 'moving':
      return isMoving(c);
    case 'name':
      return c.def.name;
    case 'id':
      return c.id;
    default:
      return undefined;
  }
}

function climberPath(c: ClimberState, rest: string[], scope: VarScope): VarValue | undefined {
  const [head, ...tail] = rest;
  if (head === 'local') {
    const f = tail.join('.');
    return (LOCAL_FIELDS as readonly string[]).includes(f) ? (c.local as unknown as Record<string, VarValue>)[f] : undefined;
  }
  if (head === 'def') {
    const f = tail.join('.');
    return (DEF_FIELDS as readonly string[]).includes(f) ? (c.def as unknown as Record<string, VarValue>)[f] : undefined;
  }
  return climberField(c, rest.join('.'), scope);
}

/** グループ（またはパーティ全体）の登山者 */
export function membersOf(world: World, groupId: string | null): ClimberState[] {
  return groupId === null ? world.climbers : world.climbers.filter((c) => c.groupId === groupId);
}

const SERIOUS_INJURY = new Set(['legFracture', 'headInjury', 'severeTrauma']);

function aggregate(cs: ClimberState[], rest: string[], scope: VarScope): VarValue | undefined {
  const [head, field] = rest;
  if (head === 'count') return cs.filter((c) => c.body.alive).length;
  if (head === 'incapacitatedCount') return cs.filter((c) => c.body.alive && (c.M <= 0 || !c.body.conscious)).length;
  if (head === 'below35Count') return cs.filter((c) => c.body.alive && c.body.coreC < 35).length;
  // 急病の発作中・重いけが・動けない人の数（沢を下るなどの判断に使う）
  if (head === 'unwellCount') return cs.filter((c) => c.body.alive && (c.body.illness?.active === true || SERIOUS_INJURY.has(c.body.injury) || c.M <= 0 || !c.body.conscious)).length;
  if ((head === 'min' || head === 'max') && field && (AGG_FIELDS as readonly string[]).includes(field)) {
    const vals = cs.filter((c) => c.body.alive).map((c) => climberField(c, field, scope) as number);
    if (vals.length === 0) return 0;
    return head === 'min' ? Math.min(...vals) : Math.max(...vals);
  }
  return undefined;
}

const splitCache = new Map<string, string[]>();

/** パスを解決する。未知のパスは undefined（validate でエラーにする） */
export function resolveVar(path: string, scope: VarScope): VarValue | undefined {
  let parts = splitCache.get(path);
  if (!parts) {
    parts = path.split('.');
    splitCache.set(path, parts);
  }
  const [head, ...rest] = parts;
  const w = scope.world;
  switch (head) {
    case 't':
      return parts.length === 1 ? w.tMin : undefined;
    case 'clockMin':
      return parts.length === 1 ? ((w.tMin % 1440) + 1440) % 1440 : undefined;
    case 'sun':
      if (rest[0] === 'isDark') return w.sun.isDark;
      if (rest[0] === 'elevDeg') return w.sun.elevDeg;
      return undefined;
    case 'g': {
      const f = rest.join('.');
      return (GLOBAL_FIELDS as readonly string[]).includes(f) ? (w.weather as unknown as Record<string, VarValue>)[f] : undefined;
    }
    case 'leader':
      return climberPath(scope.leader, rest, scope);
    case 'c': {
      const c = w.climbers.find((x) => x.id === rest[0]);
      return c ? climberPath(c, rest.slice(1), scope) : undefined;
    }
    case 'party':
      return aggregate(w.climbers, rest, scope);
    case 'mates':
      // 分岐点のリーダーと同じグループ（自分を含む）
      return aggregate(membersOf(w, scope.leader.groupId), rest, scope);
    case 'group': {
      const gid = rest[0] ?? '';
      return aggregate(membersOf(w, gid), rest.slice(1), scope);
    }
    case 'flags':
      return rest.length === 1 ? w.flags[rest[0]!] !== undefined : undefined;
    case 'animal': {
      // animal.<種類|any>: リーダーから、いる動物までの最短距離（m。いなければ 99999）
      const sp = rest[0];
      if (rest.length !== 1 || (sp !== 'any' && !(ANIMAL_SPECIES as readonly string[]).includes(sp ?? ''))) return undefined;
      return nearestAnimalM(w, TUNING, scope.leader, sp as (typeof ANIMAL_SPECIES)[number] | 'any');
    }
    case 'rec': {
      const v = scope.rec?.[rest.join('.')];
      return v === null ? undefined : v;
    }
    default:
      return undefined;
  }
}

/** validate 用: パスが文法上正しく、参照先（登山者 ID）が存在するか */
export function isKnownVarPath(path: string, scenario: ScenarioDef, groupIds: readonly string[] = []): boolean {
  const parts = path.split('.');
  const [head, ...rest] = parts;
  const climberOk = (r: string[]): boolean => {
    if (r[0] === 'local') return (LOCAL_FIELDS as readonly string[]).includes(r.slice(1).join('.'));
    if (r[0] === 'def') return (DEF_FIELDS as readonly string[]).includes(r.slice(1).join('.'));
    return (CLIMBER_FIELDS as readonly string[]).includes(r.join('.'));
  };
  const aggOk = (r: string[]): boolean =>
    (r.length === 1 && (GROUP_COUNTS as readonly string[]).includes(r[0]!)) ||
    (r.length === 2 && (r[0] === 'min' || r[0] === 'max') && (AGG_FIELDS as readonly string[]).includes(r[1]!));
  switch (head) {
    case 't':
    case 'clockMin':
      return parts.length === 1;
    case 'sun':
      return rest.length === 1 && (rest[0] === 'isDark' || rest[0] === 'elevDeg');
    case 'g':
      return (GLOBAL_FIELDS as readonly string[]).includes(rest.join('.'));
    case 'leader':
      return climberOk(rest);
    case 'c':
      return scenario.party.some((p) => p.id === rest[0]) && climberOk(rest.slice(1));
    case 'party':
    case 'mates':
      return aggOk(rest);
    case 'group':
      return rest.length >= 2 && (groupIds.length === 0 || groupIds.includes(rest[0]!)) && aggOk(rest.slice(1));
    case 'flags':
      return rest.length === 1 && rest[0]!.length > 0;
    case 'animal':
      return rest.length === 1 && (rest[0] === 'any' || (ANIMAL_SPECIES as readonly string[]).includes(rest[0]!));
    case 'rec':
      return rest.length === 1 && (REC_FIELDS as readonly string[]).includes(rest[0]!);
    default:
      return false;
  }
}
