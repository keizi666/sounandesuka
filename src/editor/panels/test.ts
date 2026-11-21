/**
 * タブ 8 試走（docs/18 §6）: 1 回の試走（Worker、結末・時系列グラフ・軌跡・ログ・分岐点）、まとめて試す（Worker 2 本、結末の分布・
 * 最低体温・選択の割合・道迷い・死亡原因）、balanceTargets の入力と合否・提案、3D で遊ぶ、書き出し。
 */
import { JA } from '../../i18n/ja';
import { formatEvent } from '../../i18n/format';
import { formatTimeRef } from '../../sim/core/clock';
import type { HeadlessResult } from '../../sim/headless';
import { checkTargets, type McSummary } from '../../sim/mc';
import type { BalanceTarget, EndingKind, PolicyName } from '../../sim/types';
import { drawTimeline } from '../../ui/charts';
import { el } from '../../ui/dom';
import type { McRun, RunIn, RunOut } from '../../workers/editorRun.worker';
import type { Ed } from '../context';
import { button, fill, num, section, select } from '../forms/fields';
import { mergeRuns, suggestTarget } from '../mcMerge';
import { mapWithHeights } from '../store/project';
import { exportBundle, exportScenarioOnly, playIn3d } from './exportActions';
import type { Panel } from './types';

const POLICIES: [PolicyName, string][] = [['recommended', '推奨'], ['bias', 'その人らしく'], ['random', 'ランダム'], ['risky', '危険']];
const KIND_COLOR: Record<EndingKind, string> = { SAFE_RETURN: '#16a34a', SAFE_SHELTER: '#22c55e', ABORTED: '#65a30d', SELF_RESCUE: '#ca8a04', RESCUED: '#d97706', RESCUED_CRITICAL: '#ea580c', MISSING: '#6b7280', FATAL: '#374151' };

let policy: PolicyName = 'recommended';
let seed: number | null = null;
let mcN = 200;
let status = '';
let single: Extract<RunOut, { type: 'run' }> | null = null;
const mc: Partial<Record<PolicyName, McSummary>> = {};

function worker(ed: Ed): Worker | null {
  const rt = ed.runtime();
  if (!rt) return null;
  const w = new Worker(new URL('../../workers/editorRun.worker.ts', import.meta.url), { type: 'module' });
  w.postMessage({ type: 'init', map: mapWithHeights(ed.p), radio: rt.radio, scenario: ed.p.scenario } satisfies RunIn);
  return w;
}

function runOnce(ed: Ed): void {
  const w = worker(ed);
  if (!w) return;
  status = '試走しています…';
  ed.refresh();
  w.onmessage = (ev: MessageEvent<RunOut>) => {
    const m = ev.data;
    w.terminate();
    if (m.type === 'error') status = `試走できませんでした: ${m.message}`;
    else if (m.type === 'run') {
      single = m;
      status = `${(m.ms).toFixed(0)} ms`;
      ed.setLastRun({ record: m.record, events: m.events, ending: m.ending } as unknown as HeadlessResult);
    }
    ed.refresh();
  };
  w.postMessage({ type: 'run', policy, seed: seed ?? ed.p.scenario.seed } satisfies RunIn);
}

/** Worker 2 本で偶数番・奇数番に分けて回す */
function runMc(ed: Ed, pol: PolicyName): Promise<void> {
  return new Promise((resolve) => {
    const ws = [worker(ed), worker(ed)];
    if (!ws[0] || !ws[1]) return resolve();
    const runs: McRun[] = [];
    let done = 0;
    let ms = 0;
    const prog = [0, 0];
    ws.forEach((w, k) => {
      w!.onmessage = (ev: MessageEvent<RunOut>) => {
        const m = ev.data;
        if (m.type === 'mcProgress') {
          prog[k] = m.done;
          status = `${POLICIES.find((p) => p[0] === pol)?.[1]}: ${prog[0]! + prog[1]!} / ${mcN}`;
          const s = document.querySelector('.test-status');
          if (s) s.textContent = status;
          return;
        }
        w!.terminate();
        done += 1;
        if (m.type === 'mc') {
          runs.push(...m.runs);
          ms = Math.max(ms, m.ms);
        } else if (m.type === 'error') status = `試走できませんでした: ${m.message}`;
        if (done === 2) {
          if (runs.length > 0) {
            mc[pol] = mergeRuns(ed.p.scenario.id, pol, runs, ms);
            status = `${POLICIES.find((p) => p[0] === pol)?.[1]} ${runs.length} 回（${(ms / 1000).toFixed(1)} 秒）`;
          }
          ed.refresh();
          resolve();
        }
      };
      const indices = Array.from({ length: mcN }, (_, i) => i).filter((i) => i % 2 === k);
      w!.postMessage({ type: 'mc', policy: pol, indices, seedBase: ed.p.scenario.seed } satisfies RunIn);
    });
  });
}

function distBar(s: McSummary): HTMLElement {
  const kinds = (Object.keys(s.counts) as EndingKind[]).filter((k) => s.counts[k] > 0);
  return el('div', {}, [
    el('div', { class: 'bar-h' }, kinds.map((k) => el('span', { style: `width:${(s.counts[k] / s.n) * 100}%;background:${KIND_COLOR[k]}`, title: `${JA.endings[k]?.title}: ${s.counts[k]}` }))),
    el('small', {}, kinds.map((k) => `${JA.endings[k]?.title} ${Math.round((s.counts[k] / s.n) * 100)}%`).join('　')),
  ]);
}

function targetEditor(ed: Ed, pol: PolicyName): HTMLElement {
  const s = ed.p.scenario;
  const t: BalanceTarget = s.balanceTargets?.[pol] ?? {};
  const setT = (patch: BalanceTarget): void =>
    ed.change('目標', () => {
      const next = { ...t, ...patch };
      for (const k of Object.keys(next) as (keyof BalanceTarget)[]) if (next[k] === undefined || Number.isNaN(next[k] as number)) delete next[k];
      s.balanceTargets = { ...(s.balanceTargets ?? {}), [pol]: next };
    });
  const f = (label: string, key: 'goodMin' | 'goodMax' | 'fatalMin' | 'fatalMax' | 'badMax' | 'lostMin' | 'lostMax'): HTMLElement => {
    const i = el('input', { type: 'number', min: 0, max: 1, step: 0.01, value: t[key] ?? '', style: 'width:5em', title: label });
    i.addEventListener('change', () => setT({ [key]: i.value === '' ? undefined : Number(i.value) }));
    return el('label', { class: 'cond-row' }, [el('small', {}, label), i]);
  };
  const sum = mc[pol];
  const checks = sum ? checkTargets(sum, s.balanceTargets?.[pol]) : [];
  return el('div', { class: 'f-section' }, [
    el('strong', {}, POLICIES.find((p) => p[0] === pol)![1]),
    el('div', { class: 'cond-row' }, [f('good ≥', 'goodMin'), f('good ≤', 'goodMax'), f('fatal ≥', 'fatalMin'), f('fatal ≤', 'fatalMax'), f('bad ≤', 'badMax'), f('道迷い ≥', 'lostMin'), f('道迷い ≤', 'lostMax')]),
    sum
      ? el('div', {}, [
          distBar(sum),
          el('small', {}, `最低体温 p10/p50/p90: ${sum.minCore.p10.toFixed(1)} / ${sum.minCore.p50.toFixed(1)} / ${sum.minCore.p90.toFixed(1)}℃　道迷い ${Math.round(sum.lostRate * 100)}%　死亡原因 ${Object.entries(sum.deathCauses).map(([c, n]) => `${c} ${n}`).join(', ') || 'なし'}`),
          el('div', {}, Object.entries(sum.choices).map(([cp, m]) => el('small', { class: 'chip' }, `${cp}: ${Object.entries(m).map(([o, n]) => `${o} ${Math.round((n / sum.n) * 100)}%`).join(' / ')}`))),
          checks.length > 0 ? el('p', { class: checks.every((c) => c.ok) ? 'note' : 'error' }, `目標: ${checks.every((c) => c.ok) ? '合格' : '不合格'}　${checks.map((c) => `${c.ok ? '✔' : '✖'} ${c.key} ${(c.value * 100).toFixed(1)}%`).join('　')}`) : null,
          button('現在の分布から目標を提案', () => setT(suggestTarget(pol, sum))),
        ].filter((x): x is HTMLElement => x !== null))
      : el('small', { class: 'note' }, 'まだ試していません'),
    button(`${mcN} 回試す`, () => void runMc(ed, pol)),
  ]);
}

export const testPanel: Panel = {
  id: 'test',
  label: '試走',
  render(ed) {
    const s = ed.p.scenario;
    const nodeName = (id: string): string => ed.p.map.nodes.find((n) => n.id === id)?.name || id;
    fill(
      ed.inspector,
      el('h2', {}, '試走'),
      section('1 回の試走', [
        select('方針', policy, POLICIES, (v) => (policy = v)),
        num('シード', seed ?? s.seed, (v) => (seed = v)),
        button('試走する', () => runOnce(ed), 'primary'),
        el('p', { class: 'note test-status' }, status),
        single
          ? el('div', {}, [
              el('p', {}, [el('strong', {}, `結末: ${JA.endings[single.ending.kind]?.title ?? single.ending.kind}`), single.ending.title ? `（${single.ending.title}）` : '']),
              el('ul', {}, single.finalStates.map((c) => el('li', {}, `${s.party.find((p) => p.id === c.id)?.name ?? c.id}: ${JA.labels.state[c.state] ?? c.state}`))),
              el('table', { class: 'ed-table' }, [el('tr', {}, ['時刻', '分岐点', '選んだ選択肢'].map((x) => el('th', {}, x))), ...single.record.decisions.map((d) => el('tr', {}, [formatTimeRef(d.tMin), d.title || d.cpId, d.label || d.optionId].map((x) => el('td', {}, x))))]),
            ])
          : null,
      ]),
      section('まとめて試す（モンテカルロ）', [
        num('回数', mcN, (v) => (mcN = v), { min: 20, max: 2000, step: 20 }),
        button('目標のある方針をすべて試す', async () => {
          for (const [p] of POLICIES) if (s.balanceTargets?.[p] || p === 'recommended' || p === 'bias') await runMc(ed, p);
        }),
        ...POLICIES.map(([p]) => targetEditor(ed, p)),
      ]),
      section('チャレンジ・書き出す', [
        button('3D でチャレンジ（プレイヤーを新しいタブで開く）', () => void playIn3d(ed)),
        button('バンドルを書き出す（*.sounan.json）', () => void exportBundle(ed), 'primary'),
        !ed.p.map.geo ? button('シナリオだけ書き出す（既存マップを使う）', () => exportScenarioOnly(ed)) : null,
      ]),
    );
    // 下部: 時系列グラフとログ
    if (!single) return void ed.bottom.replaceChildren();
    const chart = el('canvas', { width: 900, height: 260, class: 'chart' });
    const rec = single.record;
    drawTimeline(chart, rec, s, { decisions: rec.decisions.map((d) => ({ tMin: d.tMin, label: d.cpId })), events: [], reference: [] });
    const log = el('ol', { class: 'log', style: 'max-height:200px' }, single.events.flatMap((e) => {
      const text = formatEvent(e, { scenario: s, nodeName });
      if (!text) return [];
      const li = el('li', { class: e.important ? 'imp' : '' }, [el('time', {}, formatTimeRef(e.tMin)), ' ', text]);
      li.addEventListener('click', () => {
        ed.cursorMin = e.tMin;
        const c = rec.samples.reduce((a, b) => (Math.abs(b.t - e.tMin) < Math.abs(a.t - e.tMin) ? b : a)).climbers[0];
        if (c) {
          const ll = ed.view.fromPx(ed.view.xzToPx(c.x, c.z).px, ed.view.xzToPx(c.x, c.z).py);
          ed.view.setView(ll.lat, ll.lon);
        }
        ed.view.redraw();
      });
      return [li];
    }));
    ed.bottom.replaceChildren(el('div', { style: 'display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:8px;padding:6px' }, [chart, log]));
  },
};
