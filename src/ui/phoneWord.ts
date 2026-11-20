/**
 * 電話の呼び方をシナリオの年代に合わせる（ユーザーの指定: スマホがまだない年代は「携帯電話」）。
 * スマホが広まった年（tuning.era.smartphoneFrom）より前のシナリオでは「携帯電話」、それ以降は「スマホ」。
 * シナリオを始めるときに setPhoneEra を呼ぶ（画面をまたいで、結果の画面でも同じ呼び方）
 */
import { JA } from '../i18n/ja';
import { scenarioYear } from '../sim/scenario/era';
import { TUNING } from '../sim/tuning';
import type { ScenarioDef } from '../sim/types';

let smartphone = true;

export function setPhoneEra(s: Pick<ScenarioDef, 'startDate'>): void {
  smartphone = scenarioYear(s) >= TUNING.era.smartphoneFrom;
}

/** 体の状態の欄などの見出し */
export function phoneLabel(charging = false): string {
  if (smartphone) return charging ? JA.ui.phoneCharging : JA.ui.phoneBattery;
  return charging ? JA.ui.featurePhoneCharging : JA.ui.featurePhone;
}

