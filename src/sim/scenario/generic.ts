/**
 * 汎用分岐点（docs/09 §7）。シナリオに書かれていない状況のための組み込みの分岐点。
 * 分岐点 ID は "generic:<key>"。表示の文（状況・選択肢のラベル）は i18n にあり、UI が ID から引く。
 * シナリオの genericOverrides で situation / knowledge / options / enabled: false を上書きできる。
 */
import { lightningExposure } from '../hazards/lightning';
import { TUNING } from '../tuning';
import type { ChoiceOptionDef, ChoicePointDef, ClimberState, GenericChoiceKey, StaticContext, World } from '../types';

const opt = (id: string, actions: ChoiceOptionDef['actions'], base: number, extra: Partial<ChoiceOptionDef> = {}): ChoiceOptionDef => {
  const { bias, ...rest } = extra;
  return { id, label: '', actions, bias: bias ?? { base }, ...rest };
};

const CALL_OK = { var: 'leader.radio', op: '>=', value: TUNING.radio.messageOnlyMin } as const;

/** 既定の選択肢（docs/09 §7 の表） */
export const GENERIC_DEFS: Record<GenericChoiceKey, { priority: number; options: ChoiceOptionDef[] }> = {
  lostAware: {
    priority: 5,
    options: [
      opt('backtrack', [{ type: 'backtrack' }], 0.6, { tags: ['recommended'] }),
      opt('gps', [{ type: 'checkPosition' }, { type: 'navigateToTrail' }], 0.6, {
        tags: ['recommended'],
        available: { all: [{ var: 'leader.phone.gpsApp', op: '==', value: true }, { var: 'leader.phone.batteryPct', op: '>', value: 0 }] },
        hideIfUnavailable: true,
      }),
      opt('descend', [{ type: 'descendDrainage' }], 0.5, {
        tags: ['risky'],
        bias: { base: 0.5, mods: [{ when: { var: 'leader.J', op: '<', value: 0.5 }, add: 0.6 }] },
      }),
      opt('call', [{ type: 'callRescue', via: 'auto' }, { type: 'waitRescue' }], 0.3, { available: CALL_OK, hideIfUnavailable: true }),
      opt('stay', [{ type: 'stayPut' }], 0.2),
    ],
  },
  darkness: {
    priority: 2,
    options: [
      opt('continue', [{ type: 'continueRoute' }], 1.0, {
        bias: { base: 1.0, mods: [{ when: { var: 'leader.def.riskTolerance', op: '>', value: 0.5 }, add: 0.4 }] },
      }),
      opt('bivouac', [{ type: 'bivouac', until: 'dawn', findLee: true }], 0.4, { tags: ['recommended'] }),
      opt('toShelter', [{ type: 'goToNode', node: '$nearestShelter', then: 'stay' }], 0.6, {
        available: { var: 'leader.nearestShelterM', op: '<=', value: 2000 },
        hideIfUnavailable: true,
      }),
    ],
  },
  hypothermia: {
    priority: 3,
    options: [
      opt('bivouac', [{ type: 'addLayer' }, { type: 'eat', kcal: 300 }, { type: 'bivouac', until: 'dawn', findLee: true }], 0.4, { tags: ['recommended'] }),
      opt('push_eat', [{ type: 'addLayer' }, { type: 'eat', kcal: 300 }, { type: 'continueRoute' }], 0.6),
      opt('keep_walking', [{ type: 'setPace', factor: 1.1 }, { type: 'continueRoute' }], 0.8, {
        tags: ['risky'],
        bias: { base: 0.8, mods: [{ when: { var: 'leader.J', op: '<', value: 0.5 }, add: 0.6 }] },
      }),
      opt('call', [{ type: 'callRescue', via: 'auto' }, { type: 'waitRescue' }], 0.3, { tags: ['recommended'], available: CALL_OK, hideIfUnavailable: true }),
    ],
  },
  injured: {
    priority: 5,
    options: [
      opt('slow_descend', [{ type: 'setPace', factor: 0.6 }, { type: 'continueRoute' }], 0.8),
      opt('bivouac', [{ type: 'bivouac', until: 'rescue', findLee: true }], 0.3),
      opt('call', [{ type: 'callRescue', via: 'auto' }, { type: 'waitRescue' }], 0.5, { tags: ['recommended'], available: CALL_OK }),
      opt('seek_signal', [{ type: 'seekSignal' }], 0.3),
    ],
  },
  lightning: {
    priority: 4,
    options: [
      opt('off_ridge', [{ type: 'moveOffRidge', minDropM: 80 }], 0.4, { tags: ['recommended'] }),
      opt('rush', [{ type: 'setPace', factor: 1.2 }, { type: 'continueRoute' }], 0.8, { tags: ['risky'] }),
      opt('crouch', [{ type: 'lightningPosture', minutes: 30 }], 0.5),
      opt('remove_metal', [{ type: 'removeMetal' }, { type: 'continueRoute' }], 0.4, { tags: ['risky'] }),
    ],
  },
  waterfall: {
    priority: 4,
    options: [
      opt('climb_back', [{ type: 'backtrack' }], 0.5, { tags: ['recommended'] }),
      opt('high_route', [{ type: 'descendDrainage' }], 0.6, { tags: ['risky'] }),
      opt('bivouac', [{ type: 'bivouac', until: 'dawn', findLee: true }], 0.3),
    ],
  },
  straggler: {
    priority: 4,
    options: [
      opt('wait', [{ type: 'rest', minutes: 20 }, { type: 'setCohesion', cohesion: 'tight' }], 0.5, { tags: ['recommended'] }),
      opt('go', [{ type: 'continueRoute' }], 0.8, { tags: ['risky'] }),
      opt('back', [{ type: 'goToMember', member: '$straggler' }], 0.3),
    ],
  },
  rescueFailed: {
    priority: 3,
    options: [
      opt('seek_signal', [{ type: 'seekSignal' }], 0.5, { tags: ['recommended'] }),
      opt('wait', [{ type: 'waitRescue' }], 0.5),
      opt('descend', [{ type: 'descendDrainage' }], 0.4, { tags: ['risky'] }),
    ],
  },
};

const KEYS = Object.keys(GENERIC_DEFS) as GenericChoiceKey[];

/** シナリオの上書きを反映した汎用分岐点 */
export function genericChoicePoints(ctx: StaticContext): { cp: ChoicePointDef; key: string; generic: GenericChoiceKey }[] {
  const out: { cp: ChoicePointDef; key: string; generic: GenericChoiceKey }[] = [];
  for (const k of KEYS) {
    const ov = ctx.scenario.genericOverrides?.[k];
    if (ov?.enabled === false) continue;
    const d = GENERIC_DEFS[k];
    out.push({
      key: `generic:${k}`,
      generic: k,
      cp: {
        id: `generic:${k}`,
        title: '',
        trigger: { all: [] },
        once: false,
        priority: d.priority,
        situation: ov?.situation ?? '',
        knowledge: ov?.knowledge,
        options: ov?.options ?? d.options,
      },
    });
  }
  return out;
}

const OUTDOOR_EXCLUDE = new Set(['SHELTERED', 'BIVOUAC', 'WAITING_RESCUE', 'FINISHED', 'RESCUED', 'DEAD', 'UNCONSCIOUS', 'INCAPACITATED']);

/** 立ち上がり（偽→真）を検出する */
function rising(world: World, latch: string, v: boolean): boolean {
  const prev = world.latches[latch] ?? false;
  if (prev !== v) world.latches[latch] = v;
  return v && !prev;
}

/** 汎用分岐点を今発火させるか（一度きり・立ち上がりの扱いもここで行う） */
const LATCH: Record<GenericChoiceKey, string> = Object.fromEntries(KEYS.map((k) => [k, `generic:${k}`])) as Record<GenericChoiceKey, string>;

/** suffix は最初のグループなら ''、それ以外は '@<グループ ID>'（ラッチをグループごとに分ける） */
export function genericTrigger(world: World, ctx: StaticContext, key: GenericChoiceKey, leader: ClimberState, suffix = ''): boolean {
  const L = LATCH[key] + suffix;
  const fired = key === 'darkness' || key === 'lightning' || key === 'hypothermia' ? (suffix === '' ? world.firedChoices.includes(L) : world.latches[`${L}:fired`] === true) : false;
  switch (key) {
    case 'lostAware':
      return rising(world, L, leader.state === 'LOST_AWARE');
    case 'darkness':
      // 暗くなった瞬間（DARK イベント）に歩いていたら。出発時から暗いときは出ない
      return world.recentEvents.some((e) => e.type === 'DARK') && leader.state === 'WALKING';
    case 'hypothermia': {
      if (OUTDOOR_EXCLUDE.has(leader.state) || leader.body.shelterNodeId) return false;
      if (!fired) return leader.body.coreC < ctx.tuning.choices.genericHypothermiaC;
      if (!world.latches[`${L}:2`] && leader.body.coreC < ctx.tuning.choices.genericHypothermia2C) {
        world.latches[`${L}:2`] = true;
        return true;
      }
      return false;
    }
    case 'injured':
      return rising(world, L, ['sprain', 'legFracture', 'headInjury', 'severeTrauma'].includes(leader.body.injury) && leader.body.conscious);
    case 'lightning':
      return !fired && leader.local.thunder > 0.5 && lightningExposure(world, ctx, leader) >= ctx.tuning.lightning.exposureRidge;
    case 'waterfall':
      // 滝の手前で止まった瞬間だけ（高巻きに出た後に何度も出さない）
      return rising(world, L, leader.memo.atWaterfall);
    case 'rescueFailed':
      return rising(world, L, world.recentEvents.some((e) => e.type === 'RESCUE_CALL_FAILED'));
    case 'straggler': {
      // loose のグループでリーダーが遅れに気づいたとき（groups.ts の人数確認）
      const k = `stragglerPending:${leader.groupId ?? ''}`;
      if (!world.latches[k]) return false;
      world.latches[k] = false;
      return true;
    }
  }
}
