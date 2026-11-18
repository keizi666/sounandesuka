/**
 * 振り返り（docs/12 §2〜4、FR-32〜34）: 時系列グラフ・2D 地図・分岐点ごとの What-if・教訓・やり直し。
 * What-if は Worker で順に計算し、結果が出た順に棒グラフを更新する。
 */
import type { AppContext } from '../app/App';
import type { LoadedScenario } from '../app/data';
import { newRunId } from '../app/storage';
import { JA } from '../i18n/ja';
import { fill, formatDateTime, TEXT_LABELS } from '../i18n/format';
import { parseTimeRef } from '../sim/core/clock';
import { createStaticContext } from '../sim/core/world';
import { selectLessons } from '../sim/record/lessons';
import { recVars } from '../sim/record/recorder';
import type { WhatIfResult } from '../sim/record/whatif';
import { evaluateOptions, findChoicePoint } from '../sim/scenario/choices';
import { ENDING_SEVERITY } from '../sim/scenario/endings';
import type { EndingKind } from '../sim/types';
import type { WhatIfIn, WhatIfJob, WhatIfOut } from '../workers/whatif.worker';
import { drawTimeline, timeAtX, type ChartMarks } from './charts';
import { el } from './dom';
import { drawMap2d } from './map2d';
import { optionLabel, type SimResult } from './simScreen';

const WHATIF_N = 30;
const KIND_COLOR: Record<EndingKind, string> = {
  SAFE_RETURN: '#16a34a', SAFE_SHELTER: '#22c55e', ABORTED: '#65a30d', SELF_RESCUE: '#ca8a04',
  RESCUED: '#d97706', RESCUED_CRITICAL: '#ea580c', MISSING: '#6b7280', FATAL: '#374151',
};

function coreColor(c: number): string {
  if (c >= 36) return '#2563eb';
  if (c >= 35) return '#eab308';
  if (c >= 32) return '#f97316';
  return '#991b1b';
}

function whatIfBar(r: WhatIfResult): HTMLElement {
  const kinds = (Object.keys(r.counts) as EndingKind[]).sort((a, b) => ENDING_SEVERITY[a] - ENDING_SEVERITY[b]);
  return el('div', { class: 'wbar', title: kinds.map((k) => `${JA.endings[k]?.title}: ${Math.round(((r.counts[k] ?? 0) / r.n) * 100)}%`).join(' / ') }, [
    el('div', { class: 'segs' }, kinds.map((k) => el('span', { style: `width:${((r.counts[k] ?? 0) / r.n) * 100}%;background:${KIND_COLOR[k]}` }))),
    el('small', {}, kinds.map((k) => `${JA.endings[k]?.title} ${Math.round(((r.counts[k] ?? 0) / r.n) * 100)}%`).join('　')),
  ]);
}

export function showDebrief(app: AppContext, loaded: LoadedScenario, result: SimResult): () => void {
  const { scenario: s, map } = loaded;
  const w = result.world;
  const rec = result.recorder.record;
  const ctx = createStaticContext(map, s);
  const lessons = selectLessons(w, ctx, recVars(result.recorder, w), TEXT_LABELS);
  const leaderId = rec.samples[0]?.climbers[0]?.id;

  // ---- グラフ ----
  const marks: ChartMarks = {
    decisions: rec.decisions.map((d) => ({ tMin: d.tMin, label: optionLabel(loaded, d.cpId, d.optionId) })),
    events: rec.events.filter((e) => ['FALL', 'DEATH', 'RESCUED', 'LOST_AWARE', 'LIGHTNING_STRIKE', 'CARDIAC_ARREST'].includes(e.type)).map((e) => ({ tMin: e.tMin, label: e.type })),
    reference: (s.historical?.reference ?? []).map((r) => ({ tMin: parseTimeRef(r.at), label: r.label })),
  };
  const chart = el('canvas', { width: 720, height: 300, class: 'chart', 'aria-label': '時系列グラフ' });
  drawTimeline(chart, rec, s, marks);
  chart.addEventListener('mousemove', (e) => {
    const r = chart.getBoundingClientRect();
    drawTimeline(chart, rec, s, marks, timeAtX(chart, rec, ((e.clientX - r.left) / r.width) * chart.width));
  });
  chart.addEventListener('mouseleave', () => drawTimeline(chart, rec, s, marks));

  // ---- 地図 ----
  const mapCanvas = el('canvas', { width: 512, height: 512, class: 'map2d', 'aria-label': '2D 地図' });
  const colors: string[] = [];
  for (let i = 0; i < rec.track.length; i += 1) {
    const sm = rec.samples[Math.min(rec.samples.length - 1, Math.floor((i / Math.max(1, rec.track.length)) * rec.samples.length))];
    colors.push(coreColor(sm?.climbers.find((c) => c.id === leaderId)?.coreC ?? 37));
  }
  const at = (t: number): { x: number; z: number } => {
    const sm = rec.samples.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a), rec.samples[0]!);
    const c = sm.climbers[0]!;
    return { x: c.x, z: c.z };
  };
  drawMap2d(mapCanvas, map, {
    route: s.plan.route,
    track: rec.track,
    trackColors: colors,
    showFalse: true,
    markers: [
      ...rec.decisions.map((d) => ({ ...at(d.tMin), label: d.cpId, shape: 'diamond' as const, color: '#c8a050' })),
      ...(s.historical?.reference ?? []).filter((r) => r.node && map.nodes[r.node]).map((r) => ({ x: map.nodes[r.node!]!.x, z: map.nodes[r.node!]!.z, label: r.label, shape: 'triangle' as const, color: '#2563eb' })),
    ],
  });

  // ---- 分岐点と What-if ----
  const jobs: WhatIfJob[] = [];
  const slots = new Map<string, HTMLElement>();
  const decisionsEl = rec.decisions.map((d) => {
    const snap = result.choiceSnapshots[d.cpId];
    const found = findChoicePoint(ctx, d.cpId);
    const title = d.cpId.startsWith('generic:') ? (JA.generic[d.cpId.slice(8)]?.title ?? d.cpId) : (found?.cp.title ?? d.title);
    const rows: HTMLElement[] = [];
    if (snap && found) {
      const { available } = evaluateOptions(snap.world, { ...ctx }, found.cp, found.key);
      for (const a of available) {
        const slot = el('div', { class: 'wslot' }, JA.ui.computing);
        slots.set(`${d.cpId}|${a.option.id}`, slot);
        jobs.push({ cpId: d.cpId, optionId: a.option.id, snapshot: snap.world });
        rows.push(el('div', { class: `wrow${a.option.id === d.optionId ? ' chosen' : ''}` }, [el('span', { class: 'opt' }, `${optionLabel(loaded, d.cpId, a.option.id)}${a.option.id === d.optionId ? `（${JA.ui.yourChoice}）` : ''}`), slot]));
      }
    }
    const recorded = s.historical?.recordedChoices[d.cpId];
    return el('section', { class: 'decision' }, [
      el('h3', {}, `◆ ${formatDateTime(s, d.tMin)} ${title}`),
      el('p', {}, `${JA.ui.yourChoice}: ${optionLabel(loaded, d.cpId, d.optionId)}${d.by !== 'user' ? '（自動）' : ''}`),
      recorded ? el('p', { class: 'note' }, `${JA.ui.actualRecord}: ${optionLabel(loaded, d.cpId, recorded)}`) : null,
      rows.length > 0 ? el('div', { class: 'whatif' }, [el('h4', {}, `${JA.ui.whatIf}（各 ${WHATIF_N} 回）`), ...rows]) : null,
      snap
        ? el('button', {
            onclick: () => {
              const keep: SimResult['choiceSnapshots'] = {};
              for (const [k, v] of Object.entries(result.choiceSnapshots)) if (v.world.tMin < snap.world.tMin) keep[k] = v;
              app.go({
                name: 'sim',
                loaded,
                resume: { scenarioId: s.id, world: structuredClone(snap.world), recorder: structuredClone(snap.recorder), choiceSnapshots: keep, savedAt: new Date().toISOString(), runId: newRunId(), parentRunId: result.runId },
              });
            },
          }, JA.ui.restart)
        : null,
    ]);
  });
  const progress = el('progress', { max: Math.max(1, jobs.length), value: 0 });
  let worker: Worker | null = null;
  if (jobs.length > 0) {
    worker = new Worker(new URL('../workers/whatif.worker.ts', import.meta.url), { type: 'module' });
    let done = 0;
    const t0 = performance.now();
    worker.onmessage = (ev: MessageEvent<WhatIfOut>) => {
      const m = ev.data;
      if (m.type === 'result') {
        done += 1;
        progress.value = done;
        slots.get(`${m.result.cpId}|${m.result.optionId}`)?.replaceChildren(whatIfBar(m.result));
      } else if (m.type === 'done') {
        progress.replaceWith(el('small', {}, `What-if: ${jobs.length} 件（${((performance.now() - t0) / 1000).toFixed(1)} 秒）`));
      } else {
        progress.replaceWith(el('small', { class: 'error' }, m.message));
      }
    };
    worker.postMessage({ type: 'init', map: map.def, radio: map.radio, scenario: s } satisfies WhatIfIn);
    worker.postMessage({ type: 'run', jobs, n: WHATIF_N, followPolicy: 'bias' } satisfies WhatIfIn);
  }

  // ---- 史実: 記録との比較 ----
  const refTable = s.historical
    ? el('section', {}, [
        el('h2', {}, JA.ui.actualRecord),
        el('table', { class: 'ref' }, [
          el('tr', {}, ['時刻', '実際の記録'].map((x) => el('th', {}, x))),
          ...s.historical.reference.map((r) => el('tr', {}, [el('td', {}, formatDateTime(s, parseTimeRef(r.at))), el('td', {}, r.label)])),
        ]),
        el('p', { class: 'note strong' }, s.historical.disclaimer),
      ])
    : null;

  const download = (): void => {
    const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${s.id}-record.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  app.root.append(
    el('main', { class: 'debrief' }, [
      el('header', {}, [
        el('button', { onclick: () => app.go({ name: 'ending', loaded, result }) }, JA.ui.back),
        el('h1', {}, `${JA.ui.debrief}: ${s.title} ─ ${JA.endings[w.ended?.kind ?? 'MISSING']?.title ?? ''}`),
      ]),
      el('div', { class: 'cols' }, [el('section', {}, [chart, el('p', { class: 'legend' }, '◆ 分岐点 ● 出来事 ▲ 実際の記録 ／ 上: 体温（35℃ 点線）／ 下: 気温（橙）・体感（橙点線）・風（紫）・降水（青）')]), el('section', {}, [mapCanvas])]),
      el('section', { class: 'decisions' }, [el('h2', {}, `${JA.ui.decisions}`), progress, ...decisionsEl]),
      refTable,
      el('section', { class: 'lessons' }, [el('h2', {}, JA.ui.lessons), ...lessons.map((l) => el('article', {}, [el('h3', {}, `■ ${l.title}`), el('p', {}, l.text)]))]),
      el('p', { class: 'note' }, JA.disclaimer.endingNote),
      el('div', { class: 'actions' }, [
        el('button', { onclick: download }, '記録を保存（JSON）'),
        el('button', { onclick: () => app.go({ name: 'briefing', loaded }) }, JA.ui.again),
        el('button', { onclick: () => app.go({ name: 'select' }) }, JA.ui.toSelect),
      ]),
      el('p', { class: 'note' }, fill('{n} 回の試算は傾向どおりに進めた場合の結果です。', { n: WHATIF_N })),
    ]),
  );
  return () => worker?.terminate();
}
