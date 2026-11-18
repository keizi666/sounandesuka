// npm run sim:check — 全シナリオを推奨方針で 1 回ずつヘッドレス実行し、例外なく結末に到達することを確かめる
import { JA } from '../src/i18n/ja';
import { formatTimeRef } from '../src/sim/core/clock';
import { runHeadless } from '../src/sim/headless';
import type { PolicyName } from '../src/sim/types';
import { loadIndex, loadScenarioById, mapRuntimeFor } from './lib/scenarios';

const policy = (process.argv[2] as PolicyName | undefined) ?? 'recommended';
let failed = 0;
for (const e of loadIndex()) {
  if (!e.file) continue; // バンドルは P13
  const t0 = performance.now();
  try {
    const s = loadScenarioById(e.id);
    const r = runHeadless(mapRuntimeFor(s.mapId), s, { policy });
    const k = r.ending.kind;
    console.log(`✔ ${e.id.padEnd(20)} ${k.padEnd(16)} ${JA.endings[k]?.title ?? ''}  ${formatTimeRef(r.world.ended!.atMin)}  ${(performance.now() - t0).toFixed(0)} ms`);
  } catch (err) {
    failed += 1;
    console.error(`✖ ${e.id}: ${(err as Error).stack ?? err}`);
  }
}
console.log(failed === 0 ? `sim:check: OK（policy=${policy}）` : `sim:check: ${failed} 件失敗`);
process.exit(failed === 0 ? 0 : 1);
