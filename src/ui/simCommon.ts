/**
 * シミュレーション画面と、結末・振り返り・みんなの遭難記録で共通に使うもの（simScreen.ts から分けた）。
 */
import type { LoadedScenario } from '../app/data';
import { JA } from '../i18n/ja';
import type { Difficulty } from '../app/settings';
import type { RecorderState } from '../sim/record/recorder';
import type { World } from '../sim/types';
import { el } from './dom';
import type { LogLine } from './simHud';

export interface SimResult {
  world: World;
  recorder: RecorderState;
  choiceSnapshots: Record<string, { world: World; recorder: RecorderState }>;
  runId: string;
  parentRunId: string | null;
  /** 画面のログ（結果の画面で見られるように。ユーザーの指定） */
  log?: LogLine[];
  /** 共有された結果の URL から作り直した結果（自分の回ではないので、みんなの遭難記録には載せない） */
  shared?: boolean;
  /** 遊んだ難しさ（結果の画面に出す。共有された結果の URL からは分からない） */
  difficulty?: Difficulty;
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
  // 汎用の分岐点は、シナリオの上書き（genericOverrides）の選択肢を先に見る（ないと ID のまま出ていた）
  const opts = cpId.startsWith('generic:') ? s.genericOverrides?.[cpId.slice(8) as keyof NonNullable<typeof s.genericOverrides>]?.options : s.choices.find((c) => c.id === cpId)?.options;
  const o = opts?.find((x) => x.id === optionId);
  if (o?.label) return o.label;
  return JA.generic[cpId.slice(8)]?.options[optionId] ?? optionId;
}
