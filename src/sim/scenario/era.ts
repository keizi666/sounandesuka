/**
 * 電子機器の有無を、シナリオの年代に合わせる（ユーザーの指定: 1970 年に携帯電話はない）。
 * シナリオの日付（startDate の年）で、その年にまだない機器は持たないことにする。純粋な関数（DOM なし）。
 * 境目の年は tuning.era（携帯電話・スマホの地図アプリ・モバイルバッテリー・ココヘリ・衛星 SOS）
 */
import type { GearDef, ScenarioDef } from '../types';
import type { Tuning } from '../tuning';

export function scenarioYear(s: Pick<ScenarioDef, 'startDate'>): number {
  const y = Number(s.startDate.slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : 9999;
}

/** その年にある機器だけを残した装備（変えなければ同じオブジェクトを返す） */
export function eraGear(g: GearDef, year: number, t: Tuning): GearDef {
  const e = t.era;
  const mobile = year >= e.mobilePhoneFrom;
  const smart = year >= e.smartphoneFrom;
  const phone = {
    ...g.phone,
    has: g.phone.has && mobile,
    gpsApp: g.phone.gpsApp && smart,
    trackRecording: g.phone.trackRecording && smart,
    satelliteSos: g.phone.satelliteSos && year >= e.satelliteSosFrom,
  };
  const bank = year >= e.powerBankFrom ? g.powerBankMah : 0;
  const coco = g.cocoheli === true && year >= e.cocoheliFrom;
  const same = phone.has === g.phone.has && phone.gpsApp === g.phone.gpsApp && phone.trackRecording === g.phone.trackRecording && phone.satelliteSos === g.phone.satelliteSos && bank === g.powerBankMah && coco === (g.cocoheli === true);
  if (same) return g;
  return { ...g, phone, powerBankMah: bank, cocoheli: coco };
}

/** モバイルバッテリーを持てる年代か（始まりの条件の欄を出すか） */
export function powerBankAvailable(s: Pick<ScenarioDef, 'startDate'>, t: Tuning): boolean {
  return scenarioYear(s) >= t.era.powerBankFrom;
}
