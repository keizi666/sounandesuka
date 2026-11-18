/// <reference lib="webworker" />
/**
 * What-if の Worker（docs/12 §3）。マップを 1 回作り、分岐点 × 選択肢のジョブを順に処理して結果を返す。
 */
import { buildMapRuntime } from '../sim/terrain/map';
import { runWhatIf, type WhatIfResult } from '../sim/record/whatif';
import type { MapDef, MapRuntime, PolicyName, ScenarioDef, World } from '../sim/types';

export interface WhatIfJob {
  cpId: string;
  optionId: string;
  snapshot: World;
}

export type WhatIfIn = { type: 'init'; map: MapDef; radio: Float32Array; scenario: ScenarioDef } | { type: 'run'; jobs: WhatIfJob[]; n: number; followPolicy: PolicyName };
export type WhatIfOut = { type: 'result'; result: WhatIfResult } | { type: 'done' } | { type: 'error'; message: string };

let map: MapRuntime | null = null;
let scenario: ScenarioDef | null = null;

self.onmessage = (ev: MessageEvent<WhatIfIn>) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      map = buildMapRuntime(m.map, { radio: false }).map;
      map.radio = m.radio;
      scenario = m.scenario;
      return;
    }
    if (!map || !scenario) throw new Error('init されていません');
    for (const j of m.jobs) {
      const result = runWhatIf(map, scenario, j.snapshot, j.optionId, { n: m.n, followPolicy: m.followPolicy });
      (self as unknown as Worker).postMessage({ type: 'result', result: { ...result, cpId: j.cpId } } satisfies WhatIfOut);
    }
    (self as unknown as Worker).postMessage({ type: 'done' } satisfies WhatIfOut);
  } catch (e) {
    (self as unknown as Worker).postMessage({ type: 'error', message: String(e) } satisfies WhatIfOut);
  }
};
