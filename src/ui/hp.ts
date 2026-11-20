/**
 * 総合の体力（HP。0〜100）。登山者カードを最小化したときに 1 本の棒で見せるための、表示用の目安。
 * シミュレーションの判定には使わない（生死は sim 側の深部体温・外傷で決まる）。生きている間は 1 以上、死亡で 0。
 *   - 深部体温: 36.5℃ 以上で満点。24℃（低体温症による死亡の境目）で 0
 *   - 高体温: 38.5℃ から下がり、42℃（熱中症による死亡の境目）で 0
 *   - けが: 上限を決める（重いほど低い）。意識がなければ上限 15
 *   - 消耗（エネルギー切れ・脱水・疲労）: 最大で 4 割ほど割り引く
 *   - けがで動けないあいだの衰弱（sim の debility）: (1 - 衰弱) 倍。96 時間で 0（ユーザーの指定）
 */
import type { ClimberBody, InjuryKind } from '../sim/types';

const INJURY_CAP: Record<InjuryKind, number> = { none: 1, bruise: 0.95, sprain: 0.85, legFracture: 0.55, headInjury: 0.45, severeTrauma: 0.2 };

/** 折れ線の補間。pts は [x, y] を x の小さい順に */
function ramp(x: number, pts: readonly (readonly [number, number])[]): number {
  if (x <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i += 1) {
    const [x1, y1] = pts[i]!;
    const [x0, y0] = pts[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1]![1];
}

export type HpInput = Pick<ClimberBody, 'coreC' | 'glycogenKcal' | 'waterDeficitL' | 'fatigue' | 'injury' | 'conscious' | 'alive' | 'debility'>;

export function hpOf(b: HpInput): number {
  if (!b.alive) return 0;
  const cold = ramp(b.coreC, [[24, 0], [28, 0.2], [32, 0.45], [35, 0.75], [36.5, 1]]);
  const heat = ramp(b.coreC, [[38.5, 1], [40, 0.55], [42, 0]]);
  const cap = Math.min(INJURY_CAP[b.injury] ?? 1, b.conscious ? 1 : 0.15);
  const energy = ramp(b.glycogenKcal, [[0, 0.8], [300, 0.92], [600, 1]]);
  const water = ramp(b.waterDeficitL, [[1, 1], [3, 0.92], [5, 0.8]]);
  const tired = ramp(b.fatigue, [[70, 1], [100, 0.88]]);
  const weak = 1 - Math.min(1, Math.max(0, b.debility ?? 0));
  return Math.max(1, Math.round(100 * Math.min(cold, heat, cap) * energy * water * tired * weak));
}

/** HP の段階（色と記号の区別に使う） */
export function hpLevel(hp: number): 'ok' | 'warn' | 'danger' | 'critical' {
  return hp > 70 ? 'ok' : hp > 45 ? 'warn' : hp > 20 ? 'danger' : 'critical';
}
