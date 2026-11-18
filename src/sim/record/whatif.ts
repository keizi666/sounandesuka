/**
 * What-if（docs/12 §3）: 分岐点のスナップショットから、選択肢ごとに乱数を引き直して結末まで n 回走らせる。
 * Worker（src/workers/whatif.worker.ts）とテストが使う純粋な処理。
 */
import { createRngStreams, deriveSeed1, nextU32 } from '../core/rng';
import { createStaticContext } from '../core/world';
import { continueHeadless } from '../headless';
import { resolveChoice } from '../scenario/choices';
import type { EndingKind, MapRuntime, PolicyName, ScenarioDef, World } from '../types';

export interface WhatIfResult {
  cpId: string;
  optionId: string;
  n: number;
  counts: Partial<Record<EndingKind, number>>;
  /** 最低体温のヒストグラム（26〜37℃、1℃刻み） */
  minCoreHistogram: number[];
  deaths: number;
}

/** 全ストリームと時間ノイズのシードを引き直す */
export function reseed(world: World, seed: number): void {
  world.rng = createRngStreams(seed);
  world.weather.noiseSeed = nextU32(world.rng.weather);
}

export function runWhatIf(
  map: MapRuntime,
  scenario: ScenarioDef,
  snapshot: World,
  optionId: string,
  opts: { n?: number; followPolicy?: PolicyName; seedBase?: number } = {},
): WhatIfResult {
  const n = opts.n ?? 30;
  const cpId = snapshot.pendingChoice?.cpId ?? '';
  const counts: Partial<Record<EndingKind, number>> = {};
  const hist = new Array<number>(12).fill(0);
  let deaths = 0;
  for (let i = 0; i < n; i += 1) {
    const w = JSON.parse(JSON.stringify(snapshot)) as World;
    reseed(w, deriveSeed1(opts.seedBase ?? snapshot.seed, i + 1));
    const ctx = createStaticContext(map, scenario, { mode: 'headless', policy: opts.followPolicy ?? 'bias' });
    resolveChoice(w, ctx, optionId, 'user');
    ctx.events.length = 0;
    const r = continueHeadless(w, ctx, { record: false });
    counts[r.ending.kind] = (counts[r.ending.kind] ?? 0) + 1;
    const minCore = Math.min(...r.world.climbers.map((c) => c.body.coreC));
    hist[Math.max(0, Math.min(11, Math.floor(minCore - 26)))]! += 1;
    deaths += r.world.climbers.filter((c) => !c.body.alive).length;
  }
  return { cpId, optionId, n, counts, minCoreHistogram: hist, deaths };
}
