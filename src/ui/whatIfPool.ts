/**
 * What-if を Worker で並べて計算する（docs/12 §3）。結果の画面の「選択の振り返り」と振り返りのパネルが同じ結果を使う。
 * 1 回の結果（SimResult）ごとに Worker の組と、計算した（している）結果を覚え、同じ選択肢を 2 度計算しない。
 */
import type { LoadedScenario } from '../app/data';
import type { WhatIfResult } from '../sim/record/whatif';
import type { World } from '../sim/types';
import type { WhatIfIn, WhatIfOut } from '../workers/whatif.worker';
import type { SimResult } from './simScreen';

/** 1 つの選択肢を走らせる回数 */
export const WHATIF_N = 20;

interface Task {
  cpId: string;
  optionId: string;
  snapshot: World;
  resolve: (r: WhatIfResult) => void;
  reject: (e: Error) => void;
}

interface Pool {
  results: Map<string, Promise<WhatIfResult>>;
  queue: Task[];
  idle: Worker[];
  all: Worker[];
  disposed: boolean;
}

const pools = new WeakMap<SimResult, Pool>();

/** 並べる Worker の数（コアの数 − 1、2〜4） */
function poolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(2, Math.min(4, cores - 1));
}

function poolOf(loaded: LoadedScenario, result: SimResult): Pool {
  let p = pools.get(result);
  if (p && !p.disposed) return p;
  p = { results: new Map(), queue: [], idle: [], all: [], disposed: false };
  pools.set(result, p);
  const pool = p;
  for (let i = 0; i < poolSize(); i += 1) {
    const w = new Worker(new URL('../workers/whatif.worker.ts', import.meta.url), { type: 'module' });
    w.postMessage({ type: 'init', map: loaded.map.def, radio: loaded.map.radio, scenario: loaded.scenario } satisfies WhatIfIn);
    pool.all.push(w);
    pool.idle.push(w);
  }
  return pool;
}

/** 空いている Worker に、待っている仕事を渡す */
function pump(pool: Pool): void {
  while (!pool.disposed && pool.idle.length > 0 && pool.queue.length > 0) {
    const w = pool.idle.pop()!;
    const task = pool.queue.shift()!;
    let got: WhatIfResult | null = null;
    w.onmessage = (ev: MessageEvent<WhatIfOut>) => {
      const m = ev.data;
      if (m.type === 'result') got = m.result;
      else {
        if (m.type === 'done' && got) task.resolve(got);
        else task.reject(new Error(m.type === 'error' ? m.message : 'what-if の結果がありません'));
        pool.idle.push(w);
        pump(pool);
      }
    };
    w.postMessage({ type: 'run', jobs: [{ cpId: task.cpId, optionId: task.optionId, snapshot: task.snapshot }], n: WHATIF_N, followPolicy: 'bias' } satisfies WhatIfIn);
  }
}

/** 分岐点の場面（snapshot）から、その選択肢を WHATIF_N 回走らせた結果。計算済み・計算中なら、それを返す */
export function whatIfFor(loaded: LoadedScenario, result: SimResult, cpId: string, optionId: string, snapshot: World): Promise<WhatIfResult> {
  const pool = poolOf(loaded, result);
  const key = `${cpId}|${snapshot.tMin}|${optionId}`;
  const had = pool.results.get(key);
  if (had) return had;
  const p = new Promise<WhatIfResult>((resolve, reject) => {
    pool.queue.push({ cpId, optionId, snapshot, resolve, reject });
  });
  pool.results.set(key, p);
  pump(pool);
  return p;
}

/** 画面を離れるときに Worker を止める（計算済みの結果も捨てる） */
export function disposeWhatIf(result: SimResult): void {
  const p = pools.get(result);
  if (!p) return;
  p.disposed = true;
  for (const w of p.all) w.terminate();
  for (const t of p.queue) t.reject(new Error('canceled'));
  p.queue.length = 0;
  pools.delete(result);
}
