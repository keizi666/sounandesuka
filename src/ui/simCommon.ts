/**
 * シミュレーション画面と、結末・振り返り・みんなの遭難記録で共通に使うもの（simScreen.ts から分けた）。
 */
import type { LoadedScenario } from '../app/data';
import { JA } from '../i18n/ja';
import type { RecorderState } from '../sim/record/recorder';
import type { World } from '../sim/types';
import { el } from './dom';

export interface SimResult {
  world: World;
  recorder: RecorderState;
  choiceSnapshots: Record<string, { world: World; recorder: RecorderState }>;
  runId: string;
  parentRunId: string | null;
}

/** 外部データ由来の内容には出典を出す（鉄則 9）。実在の山のシナリオでは注記も添える */
export function attributionLine(loaded: LoadedScenario): HTMLElement | null {
  const a = loaded.attribution;
  if (a.length === 0 && !loaded.scenario.region?.real) return null;
  return el('p', { class: 'attribution' }, [
    ...a.flatMap((x, i) => [i > 0 ? ' / ' : '', el('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.text)]),
    loaded.scenario.region?.real ? el('span', {}, ` ${JA.disclaimer.realMountainShort}`) : null,
  ]);
}

export function optionLabel(loaded: LoadedScenario, cpId: string, optionId: string): string {
  const s = loaded.scenario;
  const cp = cpId.startsWith('generic:') ? null : s.choices.find((c) => c.id === cpId);
  const o = cp?.options.find((x) => x.id === optionId);
  if (o?.label) return o.label;
  return JA.generic[cpId.slice(8)]?.options[optionId] ?? optionId;
}
