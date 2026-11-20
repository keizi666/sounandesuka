/**
 * 結果の URL（結末まで進んだ場面の URL。結果の画面から SNS に共有したもの）を開いたとき、3D の画面を作らずに、
 * 同じ選択で結末まで進め直して、結果の画面だけを出す（ユーザーの指定）。
 * ログの行は、シミュレーション画面（simScreen の handleEvents）と同じ文で作る（吹き出し・音・カメラは扱わない）
 */
import type { LoadedScenario } from '../app/data';
import type { SharedState } from '../app/shareState';
import { newRunId } from '../app/storage';
import { fill, formatEvent, speechView } from '../i18n/format';
import { JA } from '../i18n/ja';
import { DT_SEC } from '../sim/core/step';
import { createStaticContext, createWorld } from '../sim/core/world';
import { createRecorder, recordTick } from '../sim/record/recorder';
import { choiceLeader } from '../sim/scenario/choices';
import { deciderOf } from './choiceModal';
import { snapOf } from './logDetail';
import { optionLabel, type SimResult } from './simCommon';
import type { LogLine } from './simHud';
import { replayTo } from './simReplay';

/** 結末まで進め直せたら結果を返す。結末に届かない（途中の場面の URL・合わない記録）ときは null */
export function replayResult(loaded: LoadedScenario, shared: SharedState): SimResult | null {
  const { scenario, map } = loaded;
  const world = createWorld(map, scenario, shared.seed ?? scenario.seed);
  const ctx = createStaticContext(map, scenario, { mode: shared.mode === 't' ? 'timed' : 'interactive' });
  const recorder = createRecorder(world);
  const snapshots: SimResult['choiceSnapshots'] = {};
  const party = new Map(scenario.party.map((p) => [p.id, p]));
  const nodeName = (id: string): string => map.nodes[id]?.name ?? id;
  const deciderByCp = new Map<string, string>();
  const log: LogLine[] = [{ tMin: world.tMin, text: `${scenario.title}（${nodeName(scenario.plan.route[0]!)} を出発）`, important: true }];
  const r = replayTo(world, ctx, shared, (evs, tick) => {
    recordTick(recorder, world, ctx, evs, tick ? DT_SEC / 60 : 0);
    for (const e of evs) {
      if (e.type === 'CHOICE_FIRED') {
        const id = String(e.data?.['cp'] ?? '');
        snapshots[id] = { world: structuredClone(world), recorder: structuredClone(recorder) };
        if (world.pendingChoice) deciderByCp.set(id, deciderOf(world, choiceLeader(world, ctx)).def.name);
      }
      if (e.type === 'CHOICE_RESOLVED') {
        const cpId = String(e.data?.['cp'] ?? '');
        const label = optionLabel(loaded, cpId, String(e.data?.['option'] ?? ''));
        const who = deciderByCp.get(cpId) ?? choiceLeader(world, ctx).def.name;
        const by = e.data?.['by'];
        log.push({ tMin: e.tMin, important: true, text: by === 'user' ? fill(JA.ui.chose, { who, label }) : fill(shared.mode === 'o' ? JA.ui.autoChose : JA.ui.timeUp, { who, label }) });
        continue;
      }
      let text = formatEvent(e, { scenario, nodeName });
      if (text && e.type === 'CHOICE_FIRED') {
        const who = deciderByCp.get(String(e.data?.['cp'] ?? ''));
        if (who) text = text.replace(/^◆\s*/, `◆ ${who}: `);
      }
      if (!text) continue;
      const cs = e.climberId ? world.climbers.find((x) => x.id === e.climberId) : undefined;
      const snap = cs ? snapOf(cs) : undefined;
      const v = (e.type === 'SPEECH' || e.type === 'THOUGHT') && e.climberId ? speechView(e, scenario) : null;
      if (v) {
        const tag = v.log.replace(/^.*[」）]/, '');
        log.push({ tMin: e.tMin, text, important: Boolean(e.important), climberId: e.climberId, kind: v.thought ? 'thought' : 'speech', bubble: v.display, tag, to: v.to ? (party.get(v.to)?.name ?? v.to) : undefined, shout: v.tone === 'shout', snap });
      } else {
        const group = e.type === 'DRINK' ? 'drink' : e.type === 'EAT' ? 'eat' : undefined;
        const amount = e.type === 'DRINK' ? `${Math.round(Number(e.data?.['liters'] ?? 0) * 1000)} mL` : e.type === 'EAT' ? `${Math.round(Number(e.data?.['kcal'] ?? 0))} kcal` : undefined;
        log.push({ tMin: e.tMin, text, important: Boolean(e.important), climberId: e.climberId, kind: e.climberId ? 'action' : 'system', snap, group, amount });
      }
    }
  });
  if (!r.complete || !world.ended) return null;
  return { world, recorder, choiceSnapshots: snapshots, runId: newRunId(), parentRunId: null, log, shared: true };
}
