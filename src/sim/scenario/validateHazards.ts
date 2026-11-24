// 渡渉点（scenario.fords）の検査: ID の重なり・水位の数の並び（ふだん < 危ない < 流される）・時定数
import type { ScenarioDef } from '../types';

export function checkFords(s: ScenarioDef): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  const ids = new Set<string>();
  (s.fords ?? []).forEach((f, i) => {
    const p = `fords[${i}]`;
    if (ids.has(f.id)) out.push({ path: `${p}.id`, message: `渡渉点 ID "${f.id}" が重複しています` });
    ids.add(f.id);
    if (!(f.baseCm >= 0 && f.wadeCm > f.baseCm && f.sweepCm > f.wadeCm)) out.push({ path: p, message: 'baseCm < wadeCm < sweepCm にしてください' });
    if (!(f.gainCmPerMmH >= 0)) out.push({ path: `${p}.gainCmPerMmH`, message: 'gainCmPerMmH は 0 以上' });
    if (!(f.riseMin > 0 && f.fallMin > 0)) out.push({ path: p, message: 'riseMin・fallMin は 0 より大きい' });
  });
  return out;
}
