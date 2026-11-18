/**
 * 予報の下書き（docs/17 §7）: 朝・昼・夕方・夜の代表値から文を作る。作者が後で（わざと楽観的にするなど）書き換える前提。
 */
import { parseTimeRef } from '../../sim/core/clock';
import type { ForecastEntry, ScenarioDef } from '../../sim/types';
import { interpolateKeyframes } from '../../sim/weather/global';

const SLOTS: [string, number, number][] = [
  ['朝', 6 * 60, 9 * 60],
  ['昼', 11 * 60, 14 * 60],
  ['夕方', 16 * 60, 18 * 60],
  ['夜', 20 * 60, 24 * 60],
];

export function draftForecast(s: ScenarioDef): ForecastEntry[] {
  const kfs = s.weather.keyframes.map((kf) => ({ t: parseTimeRef(kf.at), kf }));
  const out: ForecastEntry[] = [];
  let windy = false;
  let thunder = false;
  for (const [label, a, b] of SLOTS) {
    let precip = 0;
    let cover = 0;
    let n = 0;
    for (let t = a; t <= b; t += 30) {
      const w = interpolateKeyframes(kfs, t);
      precip += w.precipMmH;
      cover += w.cloudCover;
      windy ||= w.windMs > 10;
      thunder ||= w.thunder > 0.1;
      n += 1;
    }
    precip /= n;
    cover /= n;
    const text = precip > 1 ? '雨' : precip > 0.2 ? '所により雨' : cover > 0.7 ? 'くもり' : cover > 0.4 ? '晴れ時々くもり' : '晴れ';
    out.push({ label, text, icon: precip > 0.2 ? 'rain' : cover > 0.7 ? 'cloudy' : 'sunny' });
  }
  if (thunder) out.push({ label: '注意', text: '所により雷雨' });
  if (windy) out.push({ label: '注意報', text: '強風注意報' });
  return out;
}
