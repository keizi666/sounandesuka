/**
 * マップとシナリオの検証（docs/09 §13、docs/16 §7）。npm run validate とエディターが使う。
 * エラーは path（"choices[2].options[1].actions[0].node" の形）と日本語の説明を返す。
 */
import { tryParseTimeRef } from '../core/clock';
import type { Action, Condition, MapDef, ScenarioDef, ScriptEffect } from '../types';
import { ANIMAL_SPECIES } from '../hazards/animals';
import { BGM_IDS, SE_IDS } from './soundCatalog';
import { placeholderPaths } from './text';
import { isKnownVarPath } from './vars';

export interface Issue {
  level: 'error' | 'warning';
  path: string;
  code: string;
  message: string;
}

const ENDING_KINDS = ['SAFE_RETURN', 'SAFE_SHELTER', 'ABORTED', 'SELF_RESCUE', 'RESCUED', 'RESCUED_CRITICAL', 'MISSING', 'FATAL'];
const GENERIC_KEYS = ['lostAware', 'darkness', 'hypothermia', 'injured', 'lightning', 'waterfall', 'straggler', 'rescueFailed'];
export const STATES = [
  'WALKING', 'RESTING', 'SHELTERED', 'BIVOUAC', 'OFFROUTE_UNAWARE', 'LOST_AWARE', 'BACKTRACKING', 'NAVIGATING_TO_TRAIL',
  'DESCENDING_DRAINAGE', 'SEEKING_SIGNAL', 'STAYING', 'WAITING_RESCUE', 'INCAPACITATED', 'UNCONSCIOUS', 'FINISHED', 'RESCUED', 'DEAD',
];
export const ACTION_TYPES = [
  'continueRoute', 'setRoute', 'turnBack', 'goToNode', 'stayInShelter', 'rest', 'eat', 'drink', 'drinkAlcohol', 'reportMissing', 'focus', 'leaveMap', 'sound', 'music', 'setPhone', 'addAnxiety', 'illness', 'medicate', 'sting', 'epipen', 'wearRainwear', 'addLayer', 'changeDry',
  'stopAndCheck', 'missJunction', 'checkPosition', 'bivouac', 'stayPut', 'backtrack', 'navigateToTrail', 'descendDrainage', 'seekSignal', 'callRescue',
  'waitRescue', 'setPace', 'lightningPosture', 'moveOffRidge', 'removeMetal', 'setFlag', 'clearFlag', 'narrate', 'abortTrip', 'splitParty',
  'setCohesion', 'soak', 'detach', 'goToMember', 'joinGroup', 'say', 'carryInjured', 'sendForHelp',
];

class Collector {
  issues: Issue[] = [];
  err(path: string, code: string, message: string): void {
    this.issues.push({ level: 'error', path, code, message });
  }
  warn(path: string, code: string, message: string): void {
    this.issues.push({ level: 'warning', path, code, message });
  }
}

// ---------------- マップ ----------------

export function validateMap(def: MapDef): Issue[] {
  const v = new Collector();
  if (!def.id) v.err('id', 'required', 'id がありません');
  if (!(def.size > 0)) v.err('size', 'range', 'size は正の数');
  if (![257, 385, 513].includes(def.resolution)) v.warn('resolution', 'resolution', `resolution ${def.resolution} は 257 / 385 / 513 のどれでもありません`);
  const nodeIds = new Set<string>();
  const half = def.size / 2;
  def.nodes.forEach((n, i) => {
    if (nodeIds.has(n.id)) v.err(`nodes[${i}].id`, 'duplicate', `ノード ID "${n.id}" が重複しています`);
    nodeIds.add(n.id);
    if (!def.skeleton && (Math.abs(n.x) > half || Math.abs(n.z) > half)) v.err(`nodes[${i}]`, 'outOfArea', `ノード "${n.id}" が箱庭の外にあります`);
  });
  const edgeIds = new Set<string>();
  def.edges.forEach((e, i) => {
    const p = `edges[${i}]`;
    if (edgeIds.has(e.id)) v.err(`${p}.id`, 'duplicate', `エッジ ID "${e.id}" が重複しています`);
    edgeIds.add(e.id);
    if (!nodeIds.has(e.from)) v.err(`${p}.from`, 'undefinedNode', `未定義のノード "${e.from}"`);
    if (e.kind === 'trail') {
      if (!e.to) v.err(`${p}.to`, 'required', '正規の道（trail）には to が必要です');
      else if (!nodeIds.has(e.to)) v.err(`${p}.to`, 'undefinedNode', `未定義のノード "${e.to}"`);
    }
    if (!def.skeleton && e.waypoints.length < 2) v.err(`${p}.waypoints`, 'tooFew', 'waypoints は 2 点以上');
    if (!(e.sinuosity >= 1)) v.warn(`${p}.sinuosity`, 'range', 'sinuosity は 1 以上');
  });
  def.nodes.forEach((n, i) =>
    (n.confusers ?? []).forEach((c, j) => {
      if (!edgeIds.has(c.edge)) v.err(`nodes[${i}].confusers[${j}].edge`, 'undefinedEdge', `未定義のエッジ "${c.edge}"`);
      c.whenIntending.forEach((w, k) => {
        if (!edgeIds.has(w)) v.err(`nodes[${i}].confusers[${j}].whenIntending[${k}]`, 'undefinedEdge', `未定義のエッジ "${w}"`);
      });
    }),
  );
  def.hazards.forEach((h, i) => {
    if ((h.type === 'chain' || h.type === 'rockfallZone') && !edgeIds.has(h.onEdge)) {
      v.err(`hazards[${i}].onEdge`, 'undefinedEdge', `未定義のエッジ "${h.onEdge}"`);
    }
  });
  if (!def.nodes.some((n) => n.type === 'trailhead')) v.warn('nodes', 'noTrailhead', '下山口（trailhead）がありません');
  if (!def.nodes.some((n) => n.shelter)) v.warn('nodes', 'noShelter', '小屋が 1 つもありません');
  return v.issues;
}

// ---------------- シナリオ ----------------

interface Refs {
  nodes: Set<string>;
  edgesBetween: (a: string, b: string) => number;
  climbers: Set<string>;
  choices: Map<string, Set<string>>;
  groups: string[];
  scenario: ScenarioDef;
}

function checkTime(v: Collector, path: string, t: unknown): void {
  if (typeof t !== 'string' || tryParseTimeRef(t) === null) v.err(path, 'timeRef', `時刻の書式が不正です: ${JSON.stringify(t)}（例 "D0 05:30"）`);
}

function checkVar(v: Collector, path: string, varPath: string, r: Refs): void {
  if (!isKnownVarPath(varPath, r.scenario, r.groups)) v.err(path, 'unknownVar', `未知の変数パス "${varPath}"`);
}

function checkCondition(v: Collector, path: string, c: Condition | undefined, r: Refs): void {
  if (c === undefined) return;
  if (typeof c !== 'object' || c === null) return v.err(path, 'condition', '条件がオブジェクトではありません');
  if ('all' in c) return c.all.forEach((x, i) => checkCondition(v, `${path}.all[${i}]`, x, r));
  if ('any' in c) return c.any.forEach((x, i) => checkCondition(v, `${path}.any[${i}]`, x, r));
  if ('not' in c) return checkCondition(v, `${path}.not`, c.not, r);
  if ('var' in c) {
    checkVar(v, `${path}.var`, c.var, r);
    if (!['<', '<=', '>', '>=', '==', '!='].includes(c.op)) v.err(`${path}.op`, 'op', `未知の比較 "${c.op}"`);
    return;
  }
  if ('after' in c) return checkTime(v, `${path}.after`, c.after);
  if ('before' in c) return checkTime(v, `${path}.before`, c.before);
  if ('atNode' in c) return void (r.nodes.has(c.atNode) || v.err(`${path}.atNode`, 'undefinedNode', `未定義のノード "${c.atNode}"`));
  if ('beenAt' in c) return void (r.nodes.has(c.beenAt) || v.err(`${path}.beenAt`, 'undefinedNode', `未定義のノード "${c.beenAt}"`));
  if ('state' in c) return void (STATES.includes(c.state) || v.err(`${path}.state`, 'state', `未知の状態 "${c.state}"`));
  if ('chose' in c) {
    const cp = c.chose.cp;
    if (cp.startsWith('generic:')) {
      if (!GENERIC_KEYS.includes(cp.slice(8))) v.err(`${path}.chose.cp`, 'undefinedChoice', `未定義の汎用分岐点 "${cp}"`);
      return;
    }
    const opts = r.choices.get(cp);
    if (!opts) v.err(`${path}.chose.cp`, 'undefinedChoice', `未定義の分岐点 "${cp}"`);
    else if (!opts.has(c.chose.option)) v.err(`${path}.chose.option`, 'undefinedOption', `分岐点 "${cp}" に選択肢 "${c.chose.option}" がありません`);
    return;
  }
  if ('chance' in c) {
    if (!(c.chance >= 0 && c.chance <= 1)) v.err(`${path}.chance`, 'range', 'chance は 0〜1');
    return;
  }
  if ('onEdge' in c || 'near' in c || 'flag' in c || 'event' in c || 'elapsedSince' in c) return;
  v.err(path, 'condition', `未知の条件 ${JSON.stringify(Object.keys(c))}`);
}

function checkWho(v: Collector, path: string, who: string | undefined, r: Refs): void {
  if (who === undefined || who === 'leader' || who === 'all' || who === 'any' || who.startsWith('role:')) return;
  if (!r.climbers.has(who)) v.err(path, 'undefinedClimber', `未定義の登山者 "${who}"`);
}

function checkTexts(v: Collector, path: string, text: string | undefined, r: Refs): void {
  if (!text) return;
  for (const p of placeholderPaths(text)) checkVar(v, path, p, r);
}

function checkActions(v: Collector, path: string, actions: readonly Action[] | undefined, r: Refs): void {
  (actions ?? []).forEach((a, i) => {
    const p = `${path}[${i}]`;
    if (!ACTION_TYPES.includes(a.type)) return v.err(`${p}.type`, 'actionType', `未知のアクション "${a.type}"`);
    checkWho(v, `${p}.who`, a.who, r);
    switch (a.type) {
      case 'goToNode':
        if (a.node !== '$nearestShelter' && !r.nodes.has(a.node)) v.err(`${p}.node`, 'undefinedNode', `未定義のノード "${a.node}"`);
        break;
      case 'setRoute':
        a.route.forEach((n, j) => r.nodes.has(n) || v.err(`${p}.route[${j}]`, 'undefinedNode', `未定義のノード "${n}"`));
        for (let j = 0; j + 1 < a.route.length; j += 1) {
          if (r.edgesBetween(a.route[j]!, a.route[j + 1]!) !== 1) v.err(`${p}.route[${j + 1}]`, 'routeGap', `${a.route[j]} と ${a.route[j + 1]} を結ぶ登山道が 1 本に決まりません`);
        }
        break;
      case 'stayInShelter':
      case 'bivouac':
        if (!['dawn', 'rescue', 'weatherClears'].includes(a.until)) checkTime(v, `${p}.until`, a.until);
        break;
      case 'say':
        checkWho(v, `${p}.to`, a.to, r);
        checkTexts(v, `${p}.text`, a.text, r);
        break;
      case 'splitParty':
        a.groups.forEach((g, j) => checkActions(v, `${p}.groups[${j}].actions`, g.actions, r));
        break;
      case 'detach':
        checkActions(v, `${p}.then`, a.then, r);
        break;
      case 'sound':
        if (!SE_IDS.includes(a.id)) v.err(`${p}.id`, 'unknownSound', `未知の効果音 "${a.id}"（${SE_IDS.join(', ')}）`);
        break;
      case 'music':
        if (a.id !== null && !BGM_IDS.includes(a.id)) v.err(`${p}.id`, 'unknownMusic', `未知の曲 "${a.id}"（${BGM_IDS.join(', ')}）`);
        break;
      case 'setPace':
        if (!(a.factor >= 0.6 && a.factor <= 1.2)) v.warn(`${p}.factor`, 'range', 'setPace の factor は 0.6〜1.2（範囲外は切り詰める）');
        break;
      default:
        break;
    }
  });
}

function checkEffects(v: Collector, path: string, effects: readonly ScriptEffect[], r: Refs): void {
  effects.forEach((e, i) => {
    const p = `${path}[${i}]`;
    switch (e.type) {
      case 'actions':
        checkActions(v, `${p}.actions`, e.actions, r);
        break;
      case 'triggerChoice':
        if (!r.choices.has(e.cp)) v.err(`${p}.cp`, 'undefinedChoice', `未定義の分岐点 "${e.cp}"`);
        break;
      case 'injure':
      case 'rockfall':
      case 'soak':
      case 'say':
        checkWho(v, `${p}.who`, e.who, r);
        break;
      case 'weatherOverride':
        checkTime(v, `${p}.keyframe.at`, e.keyframe.at);
        break;
      case 'log':
        checkTexts(v, `${p}.text`, e.text, r);
        break;
      case 'animal':
        if (!ANIMAL_SPECIES.includes(e.species)) v.err(`${p}.species`, 'unknownAnimal', `未知の動物 "${e.species}"（${ANIMAL_SPECIES.join(', ')}）`);
        if (e.at !== undefined && !r.nodes.has(e.at)) v.err(`${p}.at`, 'undefinedNode', `未定義のノード "${e.at}"`);
        if ((e.x === undefined) !== (e.z === undefined)) v.err(`${p}.x`, 'animalXZ', 'x と z は両方書く');
        if (e.behavior !== undefined && !ANIMAL_BEHAVIORS.includes(e.behavior)) v.err(`${p}.behavior`, 'unknownBehavior', `未知のふるまい "${e.behavior}"（${ANIMAL_BEHAVIORS.join(', ')}）`);
        if (e.count !== undefined && !(e.count >= 1 && e.count <= 6)) v.warn(`${p}.count`, 'range', 'count は 1〜6（範囲外は切り詰める）');
        if (e.durationMin !== undefined && !(e.durationMin >= 0)) v.err(`${p}.durationMin`, 'range', 'durationMin は 0 以上');
        if (e.aggression !== undefined && !(e.aggression >= 0)) v.err(`${p}.aggression`, 'range', 'aggression は 0 以上');
        if (e.attackInjury !== undefined && !(Array.isArray(e.attackInjury) && e.attackInjury.length === 6 && e.attackInjury.every((x) => x >= 0)))
          v.err(`${p}.attackInjury`, 'range', 'attackInjury は 0 以上の数 6 つ（打撲・ねんざ・脚の骨折・頭のけが・重い外傷・死亡の割合）');
        if (e.behavior === 'stalk' && e.species !== 'bear' && e.species !== 'brownBear') v.warn(`${p}.behavior`, 'stalkSpecies', 'stalk（付きまとう）は熊のためのふるまい');
        break;
      case 'animalLeave':
        if (e.species !== undefined && !ANIMAL_SPECIES.includes(e.species)) v.err(`${p}.species`, 'unknownAnimal', `未知の動物 "${e.species}"`);
        break;
      default:
        break;
    }
  });
}

const ANIMAL_BEHAVIORS = ['graze', 'watch', 'wander', 'cross', 'flee', 'stalk'];

export function validateScenario(s: ScenarioDef, map: MapDef | null): Issue[] {
  const v = new Collector();
  if (s.version !== 1) v.err('version', 'version', 'version は 1');
  for (const k of ['startAt', 'timeLimit'] as const) checkTime(v, k, s[k]);
  checkTime(v, 'plan.plannedFinish', s.plan.plannedFinish);
  if (s.plan.reportIfNotBackBy !== null) checkTime(v, 'plan.reportIfNotBackBy', s.plan.reportIfNotBackBy);
  if (s.plan.wakeAt !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.plan.wakeAt)) v.err('plan.wakeAt', 'badTime', '起きる時刻は "05:00" の形');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.startDate)) v.err('startDate', 'date', `日付の書式が不正です: "${s.startDate}"`);
  if (map && s.mapId !== map.id) v.err('mapId', 'mapId', `mapId "${s.mapId}" とマップ "${map.id}" が一致しません`);

  const nodes = new Set((map?.nodes ?? []).map((n) => n.id));
  const trails = (map?.edges ?? []).filter((e) => e.kind === 'trail');
  const edgesBetween = (a: string, b: string): number => trails.filter((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a)).length;
  const groupIds = [
    ...(s.groups ?? []).map((g) => g.id),
    ...JSON.stringify(s).match(/"id":"[^"]+","members"/g)?.map((m) => m.slice(6, m.indexOf('"', 6))) ?? [],
  ];
  const r: Refs = {
    nodes,
    edgesBetween,
    climbers: new Set(s.party.map((p) => p.id)),
    choices: new Map(s.choices.map((c) => [c.id, new Set(c.options.map((o) => o.id))])),
    groups: groupIds,
    scenario: s,
  };

  // パーティ
  const leaders = s.party.filter((p) => p.leader).length;
  if (leaders !== 1) v.err('party', 'leader', `leader: true の登山者がちょうど 1 人必要です（${leaders} 人）`);
  if (s.party.length === 0 || s.party.length > 60) v.err('party', 'partySize', 'パーティは 1〜60 人');
  const seen = new Set<string>();
  s.party.forEach((p, i) => {
    if (seen.has(p.id)) v.err(`party[${i}].id`, 'duplicate', `登山者 ID "${p.id}" が重複しています`);
    seen.add(p.id);
    if (p.portrait !== undefined && !/^(child|young|mid|senior)_[mf]:[1-9][0-9]*$/.test(p.portrait)) v.warn(`party[${i}].portrait`, 'badPortrait', `顔アイコンの指定 "${p.portrait}" は「区分:番号」（例: mid_m:3）の形にしてください。自動で選んだ顔を使います`);
    const shoe = p.gear.footwear;
    if (shoe !== undefined && !['sneakers', 'trailRunners', 'hikingBoots', 'mountainBoots'].includes(shoe)) v.err(`party[${i}].gear.footwear`, 'badFootwear', `靴 "${String(shoe)}" は sneakers・trailRunners・hikingBoots・mountainBoots のどれか`);
  });

  // 計画
  if (map) {
    s.plan.route.forEach((n, i) => nodes.has(n) || v.err(`plan.route[${i}]`, 'undefinedNode', `未定義のノード "${n}"`));
    for (let i = 0; i + 1 < s.plan.route.length; i += 1) {
      const a = s.plan.route[i]!;
      const b = s.plan.route[i + 1]!;
      if (nodes.has(a) && nodes.has(b) && edgesBetween(a, b) !== 1) v.err(`plan.route[${i + 1}]`, 'routeGap', `${a} と ${b} を結ぶ登山道が 1 本に決まりません`);
    }
    s.plan.goalNodes.forEach((n, i) => nodes.has(n) || v.err(`plan.goalNodes[${i}]`, 'undefinedNode', `未定義のノード "${n}"`));
    Object.keys(s.nodeOverrides ?? {}).forEach((n) => nodes.has(n) || v.err(`nodeOverrides.${n}`, 'undefinedNode', `未定義のノード "${n}"`));
    const edgeIds = new Set((map.edges ?? []).map((e) => e.id));
    for (const [k, id] of Object.entries(s.music ?? {})) if (typeof id === 'string' && !BGM_IDS.includes(id)) v.err(`music.${k}`, 'unknownMusic', `未知の曲 "${id}"（${BGM_IDS.join(', ')}）`);
    (s.passersby ?? []).forEach((p, pi) => p.edges.forEach((e, i) => edgeIds.has(e) || v.err(`passersby[${pi}].edges[${i}]`, 'undefinedEdge', `未定義のエッジ "${e}"`)));
    (s.plan.searchLeads ?? []).forEach((l, li) => {
      const p = `plan.searchLeads[${li}]`;
      checkTime(v, `${p}.at`, l.at);
      if (l.when) checkCondition(v, `${p}.when`, l.when, r);
      l.route.forEach((n, i) => nodes.has(n) || v.err(`${p}.route[${i}]`, 'undefinedNode', `未定義のノード "${n}"`));
      for (let i = 0; i + 1 < l.route.length; i += 1) {
        const a = l.route[i]!;
        const b = l.route[i + 1]!;
        if (nodes.has(a) && nodes.has(b) && edgesBetween(a, b) !== 1) v.err(`${p}.route[${i + 1}]`, 'routeGap', `${a} と ${b} を結ぶ登山道が 1 本に決まりません`);
      }
    });
  }

  // 気象
  let prev = -Infinity;
  s.weather.keyframes.forEach((k, i) => {
    checkTime(v, `weather.keyframes[${i}].at`, k.at);
    const t = tryParseTimeRef(k.at) ?? prev;
    if (t < prev) v.err(`weather.keyframes[${i}].at`, 'order', 'キーフレームが時刻の昇順になっていません');
    prev = t;
  });
  if (s.weather.keyframes.length === 0) v.err('weather.keyframes', 'required', 'キーフレームが 1 つも必要です');
  (s.weather.thunderCells ?? []).forEach((c, i) => {
    for (const k of ['from', 'peakAt', 'to'] as const) checkTime(v, `weather.thunderCells[${i}].${k}`, c[k]);
  });

  // 分岐点
  const cpIds = new Set<string>();
  s.choices.forEach((cp, i) => {
    const p = `choices[${i}]`;
    if (cpIds.has(cp.id)) v.err(`${p}.id`, 'duplicate', `分岐点 ID "${cp.id}" が重複しています`);
    cpIds.add(cp.id);
    checkCondition(v, `${p}.trigger`, cp.trigger, r);
    checkTexts(v, `${p}.situation`, cp.situation, r);
    (cp.knowledge ?? []).forEach((t, j) => checkTexts(v, `${p}.knowledge[${j}]`, t, r));
    if (cp.options.length < 2 || cp.options.length > 4) v.err(`${p}.options`, 'optionCount', `選択肢は 2〜4 個（${cp.options.length} 個）`);
    if (!cp.options.some((o) => o.tags?.includes('recommended'))) v.err(`${p}.options`, 'noRecommended', 'recommended の選択肢が 1 つ以上必要です');
    const optIds = new Set<string>();
    cp.options.forEach((o, j) => {
      const q = `${p}.options[${j}]`;
      if (optIds.has(o.id)) v.err(`${q}.id`, 'duplicate', `選択肢 ID "${o.id}" が重複しています`);
      optIds.add(o.id);
      checkCondition(v, `${q}.available`, o.available, r);
      checkActions(v, `${q}.actions`, o.actions, r);
      checkTexts(v, `${q}.detail`, o.detail, r);
      (o.bias.mods ?? []).forEach((m, k) => checkCondition(v, `${q}.bias.mods[${k}].when`, m.when, r));
    });
  });
  Object.entries(s.genericOverrides ?? {}).forEach(([k, g]) => {
    if (!GENERIC_KEYS.includes(k)) v.err(`genericOverrides.${k}`, 'genericKey', `未知の汎用分岐点 "${k}"`);
    checkTexts(v, `genericOverrides.${k}.situation`, g?.situation, r);
    (g?.options ?? []).forEach((o, j) => checkActions(v, `genericOverrides.${k}.options[${j}].actions`, o.actions, r));
  });

  // イベント・思考・セリフ・結末・教訓
  s.events.forEach((e, i) => {
    checkCondition(v, `events[${i}].trigger`, e.trigger, r);
    checkEffects(v, `events[${i}].effects`, e.effects, r);
  });
  (s.thoughts ?? []).forEach((t, i) => {
    checkCondition(v, `thoughts[${i}].when`, t.when, r);
    if (t.who !== undefined && t.who !== 'any' && t.who !== 'leader' && !t.who.startsWith('role:') && !r.climbers.has(t.who)) v.err(`thoughts[${i}].who`, 'undefinedClimber', `未定義の登山者 "${t.who}"`);
  });
  (s.speech ?? []).forEach((t, i) => {
    checkCondition(v, `speech[${i}].when`, t.when, r);
    checkWho(v, `speech[${i}].who`, t.who, r);
    checkWho(v, `speech[${i}].to`, t.to, r);
    if (s.historical && t.lines.some((l) => /死|遺言/.test(l))) v.warn(`speech[${i}].lines`, 'sensitive', '史実シナリオのセリフに「死」「遺言」などの語があります');
  });
  s.endings.forEach((e, i) => {
    if (!ENDING_KINDS.includes(e.kind)) v.err(`endings[${i}].kind`, 'endingKind', `未知の結末 "${e.kind}"`);
    checkCondition(v, `endings[${i}].when`, e.when, r);
    checkTexts(v, `endings[${i}].text`, e.text, r);
  });
  s.lessons.forEach((l, i) => {
    if (l.when !== undefined) checkCondition(v, `lessons[${i}].when`, l.when, r);
    checkTexts(v, `lessons[${i}].text`, l.text, r);
  });
  if (s.region?.real && !s.sources?.length) v.warn('sources', 'sources', '実在の山のシナリオに sources（データの出どころ）がありません');
  return v.issues;
}

/** 「s01.json: choices[2].options[1].actions[0].node: 未定義のノード "HUT"」の形 */
export function formatIssue(file: string, i: Issue): string {
  return `${file}: ${i.path}: ${i.message}`;
}
