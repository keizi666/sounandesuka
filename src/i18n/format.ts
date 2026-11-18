/**
 * イベント・時刻の日本語表示（UI とツールが使う。sim は i18n に依存しない）。
 */
import { clockMinOf, dateAt, formatClock, formatTimeRef } from '../sim/core/clock';
import type { TextLabels } from '../sim/scenario/text';
import type { ScenarioDef, SimEvent } from '../sim/types';
import { JA } from './ja';

export const TEXT_LABELS: TextLabels = {
  precipType: JA.labels.precipType,
  state: JA.labels.state,
  injury: JA.labels.injury,
  stage: JA.labels.stage,
  bool: JA.labels.bool,
};

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (w, k: string) => (vars[k] !== undefined ? String(vars[k]) : w));
}

/** 「10月17日 13:42」 */
export function formatDateTime(scenario: ScenarioDef, tMin: number): string {
  const d = dateAt(scenario.startDate, tMin);
  return `${d.month}月${d.day}日 ${formatClock(clockMinOf(tMin))}`;
}

export { formatClock, formatTimeRef };

export interface FormatCtx {
  scenario: ScenarioDef;
  nodeName: (id: string) => string;
}

/** イベントのログ文。出さないもの（STATE の一部など）は null */
export function formatEvent(e: SimEvent, f: FormatCtx): string | null {
  const L = JA.log;
  const who = e.climberId ? (f.scenario.party.find((p) => p.id === e.climberId)?.name ?? e.climberId) : '';
  const d = e.data ?? {};
  const s = (k: string): string => String(d[k] ?? '');
  switch (e.type) {
    case 'NODE_ARRIVE':
      return fill(L.nodeArrive, { name: f.nodeName(s('node')) });
    case 'FINISHED':
      return fill(L.finished, { who, node: d['node'] ? f.nodeName(s('node')) : '' });
    case 'STATE': {
      const to = s('to');
      if (['WALKING', 'RESTING', 'FINISHED', 'DEAD', 'SHELTERED'].includes(to)) return null;
      return fill(L.stateTo, { who, state: JA.labels.state[to] ?? to });
    }
    case 'RAIN_START':
      return fill(L.rainStart, { mm: Number(d['precipMmH'] ?? 0).toFixed(1) });
    case 'RAIN_STOP':
      return L.rainStop;
    case 'PRECIP_TYPE':
      return fill(L.precipType, { from: JA.labels.precipType[s('from')] ?? s('from'), to: JA.labels.precipType[s('to')] ?? s('to') });
    case 'SUNRISE':
      return L.sunrise;
    case 'SUNSET':
      return L.sunset;
    case 'DARK':
      return L.dark;
    case 'STAGE_CHANGE':
      return fill(L.stage, { who, stage: JA.labels.stage[s('to')] ?? s('to'), core: Number(d['coreC'] ?? 0).toFixed(1) });
    case 'DEATH':
      return fill(L.death, { who });
    case 'CARDIAC_ARREST':
      return fill(L.arrest, { who });
    case 'CHOICE_FIRED': {
      const cp = f.scenario.choices.find((c) => c.id === s('cp'));
      return fill(L.choiceFired, { title: cp?.title ?? s('cp') });
    }
    case 'CHOICE_RESOLVED': {
      const cp = f.scenario.choices.find((c) => c.id === s('cp'));
      const opt = cp?.options.find((o) => o.id === s('option'));
      return fill(L.choiceResolved, { label: opt?.label ?? s('option'), by: JA.labels.by[s('by')] ?? s('by') });
    }
    case 'GEAR':
      if (d['rainwearOn'] === true) return fill(L.gearRainwear, { who });
      if (d['rainwearOn'] === false) return fill(L.gearUnwear, { who });
      if (d['changeDry']) return fill(L.gearChangeDry, { who });
      return fill(L.gearLayer, { who });
    case 'EAT':
      return fill(L.eat, { who, kcal: s('kcal') });
    case 'DRINK':
      return fill(L.drink, { who });
    case 'LAMP':
      return fill(L.lampOn, { who });
    case 'LAMP_DEAD':
      return fill(L.lampDead, { who });
    case 'PHONE_DEAD':
      return fill(L.phoneDead, { who });
    case 'SHELTER_ENTER':
      return fill(L.shelterEnter, { who, node: f.nodeName(s('node')) });
    case 'SHELTER_LEAVE':
      return fill(L.shelterLeave, { who });
    case 'BIVOUAC_START':
      return fill(L.bivouac, { who });
    case 'RESCUE_CALLED':
      return fill(L.rescueCalled, { who, via: JA.labels.via[s('via')] ?? s('via') });
    case 'RESCUE_CALL_FAILED':
      return fill(L.rescueFailed, { who });
    case 'HELI_DISPATCH':
      return L.heliDispatch;
    case 'GROUND_DISPATCH':
      return L.groundDispatch;
    case 'RESCUED':
      return fill(L.rescued, { who });
    case 'FORECAST_UPDATE':
      return L.forecast;
    case 'OFFROUTE':
      return fill(L.offroute, { who });
    case 'LOST_AWARE':
      return fill(L.lostAware, { who });
    case 'BACK_ON_ROUTE':
      return fill(L.backOnRoute, { who });
    case 'FALL':
      return fill(L.fall, { who, injury: JA.labels.injury[s('injury')] ?? s('injury') });
    case 'LIGHTNING_STRIKE':
      return fill(L.lightningStrike, { who });
    case 'LIGHTNING_NEAR':
      return L.lightningNear;
    case 'SOAK':
      return fill(L.soak, { who });
    case 'LEADER_CHANGED':
      return fill(L.leaderChanged, { who });
    case 'PARTY_SPLIT':
      return L.partySplit;
    case 'STRAGGLER':
      return L.straggler;
    case 'GUST_FALL':
      return fill(L.gustFall, { who });
    case 'SPEECH':
      return `${who}「${e.text ?? ''}」`;
    case 'THOUGHT':
      return `${who}（${e.text ?? ''}）`;
    case 'SCRIPT_LOG':
      if (e.text) return e.text;
      if (d['unimplementedAction'] || d['unimplementedEffect']) return fill(L.unimplemented, { what: s('unimplementedAction') || s('unimplementedEffect') });
      return null;
    case 'PIN':
      return null;
    case 'ENDED':
      return fill(L.ended, { kind: JA.endings[s('kind')]?.title ?? s('kind') });
    default:
      return null;
  }
}
