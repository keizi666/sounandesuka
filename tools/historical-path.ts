// npm run historical -- [<scenarioId>] [--search N] — 史実のシナリオで、記録どおりに選び続けたときの経過を、画面で遊ぶのと同じ進め方で回す。
// 記録の死者数（historical.recordedDeaths）と一致するかを見る。--search N なら、一致する乱数の種を N 個まで探す
// （見つかったら、シナリオの seed に入れる。画面では種が決まっているので、記録どおりに選べば毎回この結末になる）
import { parseArgs } from 'node:util';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { stepWorld } from '../src/sim/core/step';
import { deriveSeed } from '../src/sim/core/rng';
import { autoResolve, choiceLeader, evaluateOptions, findChoicePoint, resolveChoice } from '../src/sim/scenario/choices';
import type { MapRuntime, ScenarioDef, World } from '../src/sim/types';
import { loadEntryRuntime, loadIndex } from './lib/scenarios';

/** 記録どおりに選び続けて、結末まで進める（画面と同じ: 記録のある分岐点は自分で選び、ないものと見守っていないパーティの分岐点はその人らしく自動で） */
export function runRecordPath(map: MapRuntime, s: ScenarioDef, seed: number): World {
  const rec = s.historical?.recordedChoices ?? {};
  const w = createWorld(map, { ...s, seed });
  const ctx = createStaticContext(map, { ...s, seed }, { mode: 'interactive' });
  for (let i = 0; i < 40000 && !w.ended; i += 1) {
    const p = w.pendingChoice;
    if (p) {
      const found = findChoicePoint(ctx, p.cpId);
      const other = w.focusMembers ? !w.focusMembers.includes(choiceLeader(w, ctx).id) : false;
      const want = rec[p.cpId];
      const ok = found && want && evaluateOptions(w, ctx, found.cp, found.key).available.some((a) => a.option.id === want);
      if (!other && ok) resolveChoice(w, ctx, want!, 'user');
      else autoResolve(w, ctx, 'bias');
      ctx.events.length = 0;
      continue;
    }
    stepWorld(w, ctx);
    ctx.events.length = 0;
  }
  return w;
}

if (process.argv[1]?.endsWith('historical-path.ts')) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { search: { type: 'string' }, from: { type: 'string' } } });
  const ids = positionals.length > 0 ? positionals : loadIndex().filter((e) => e.id.match(/^s1[6-9]_/)).map((e) => e.id);
  for (const id of ids) {
    const e = loadIndex().find((x) => x.id === id)!;
    const r = loadEntryRuntime(e);
    if (!r?.scenario.historical) {
      console.log(`${id}: 史実のシナリオではないか、地形のバンドルがない`);
      continue;
    }
    const target = r.scenario.historical.recordedDeaths;
    const survivors = r.scenario.historical.recordedSurvivors ?? [];
    const run = (seed: number): { deaths: number; who: string; end: string; ok: boolean } => {
      const w = runRecordPath(r.map, r.scenario, seed);
      const dead = w.climbers.filter((c) => !c.body.alive);
      const ok = dead.length === target && survivors.every((id) => w.climbers.find((c) => c.id === id)?.body.alive === true);
      return { deaths: dead.length, who: dead.map((c) => c.def.name).join('・'), end: w.ended?.kind ?? '-', ok };
    };
    const now = run(r.scenario.seed);
    console.log(`${id}: 記録の死者 ${target ?? '?'} 人 / 今の種 ${r.scenario.seed}: ${now.deaths} 人（${now.who}） ${now.end}${now.ok ? '  ← 一致' : ''}`);
    if (now.ok) continue;
    const n = Number(values.search ?? 0);
    const from = Number(values.from ?? 1);
    for (let i = from; i < from + n && target !== undefined; i += 1) {
      const seed = deriveSeed(r.scenario.seed, i);
      const x = run(seed);
      if (x.ok) {
        console.log(`  種 ${seed}: ${x.deaths} 人（${x.who}） ${x.end}  ← 一致`);
        break;
      }
    }
  }
}
