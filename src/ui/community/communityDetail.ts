/**
 * 「みんなの遭難記録」の詳細（docs/20_community.md §1）。載せた人・結末・感想・分岐での選択と、
 * 振り返りと同じ部品で、地図の軌跡（zoomableMap + drawMap2d）・体温と天気（drawTimeline）・メンバーの推移（memberCharts）を出す。
 * 地形データを公開していないシナリオは、軌跡だけを描く（trackOnly）。
 */
import type { AppContext } from '../../app/App';
import { bundleExists, loadEntry, loadIndex, loadScenarioFile, type LoadedScenario } from '../../app/data';
import { JA } from '../../i18n/ja';
import { fill, formatClock } from '../../i18n/format';
import { communityApi } from '../../net/communityApi';
import type { RunDetail } from '../../net/communityTypes';
import { unpackRecord } from '../../net/recordPack';
import type { RunRecord, ScenarioDef, ScenarioIndexEntry } from '../../sim/types';
import { drawTimeline, timeAtX, type ChartMarks } from '../charts';
import { el, toast } from '../dom';
import { icon, type IconName } from '../icons';
import { drawMap2d } from '../map2d';
import { zoomableMap } from '../mapZoom';
import { memberCharts } from '../memberCharts';
import { attributionLine } from '../simScreen';
import { endingTone } from '../ending';
import { cIcon, dateText, errorText, hm, sexAgeText, userAvatar } from './common';
import { ENDING_COLOR } from './endingColors';
import { showUserRuns } from './communityScreen';
import { drawTrackOnly } from './trackOnly';

const MARK_EVENTS = ['FALL', 'DEATH', 'RESCUED', 'LOST_AWARE', 'LIGHTNING_STRIKE', 'CARDIAC_ARREST'];

function coreColor(c: number): string {
  if (c >= 36) return '#2563eb';
  if (c >= 35) return '#eab308';
  if (c >= 32) return '#f97316';
  return '#991b1b';
}

/** シナリオ本体（地形なし）。公開をやめたシナリオなら null */
async function scenarioOnly(e: ScenarioIndexEntry | undefined): Promise<ScenarioDef | null> {
  if (!e) return null;
  try {
    return await loadScenarioFile(e.bundle ? e.bundle.replace(/\.sounan\.json$/, '.json') : (e.file ?? `${e.id}.json`));
  } catch {
    return null;
  }
}

/** 地図とグラフの部分 */
function charts(rec: RunRecord, s: ScenarioDef, entry: ScenarioIndexEntry | undefined): HTMLElement {
  const C = JA.community;
  const leaderId = rec.samples[0]?.climbers[0]?.id;
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
  const decisionMarks = rec.samples.length > 0 ? rec.decisions.map((d) => ({ ...at(d.tMin), label: d.cpId, shape: 'diamond' as const, color: '#c8a050' })) : [];

  // 地図: まず軌跡だけを描き、地形が読めたら描き直す
  const mapCanvas = el('canvas', { width: 1024, height: 1024, class: 'map2d', 'aria-label': C.mapTitle });
  drawTrackOnly(mapCanvas, rec.track, colors, decisionMarks);
  const mapNote = el('p', { class: 'cm-note' }, C.loading);
  const mapSec = el('section', { class: 'db-map cm-map' }, [mapCanvas, el('p', { class: 'legend' }, C.trackLegend), mapNote]);
  void (async () => {
    const ok = entry && (await bundleExists(entry));
    if (!entry || !ok) {
      mapNote.textContent = C.noMap;
      return;
    }
    try {
      const loaded: LoadedScenario = await loadEntry(entry);
      const layers = { route: loaded.scenario.plan.route, track: rec.track, trackColors: colors, showFalse: true, markers: decisionMarks };
      const box = zoomableMap(mapCanvas, (view) => drawMap2d(mapCanvas, loaded.map, { ...layers, view }));
      mapSec.replaceChildren(box, el('p', { class: 'legend' }, C.trackLegend), attributionLine(loaded) ?? '');
    } catch {
      mapNote.textContent = C.noMap;
    }
  })();

  // 体温と天気
  const marks: ChartMarks = {
    decisions: rec.decisions.map((d) => ({ tMin: d.tMin, label: d.label })),
    events: rec.events.filter((e) => MARK_EVENTS.includes(e.type)).map((e) => ({ tMin: e.tMin, label: e.type })),
    reference: [],
  };
  const chart = el('canvas', { width: 1400, height: 520, class: 'chart', 'aria-label': C.chartTitle });
  if (rec.samples.length > 0) {
    drawTimeline(chart, rec, s, marks);
    chart.addEventListener('mousemove', (e) => {
      const r = chart.getBoundingClientRect();
      drawTimeline(chart, rec, s, marks, timeAtX(chart, rec, ((e.clientX - r.left) / r.width) * chart.width));
    });
    chart.addEventListener('mouseleave', () => drawTimeline(chart, rec, s, marks));
  }
  return el('div', { class: 'cm-charts' }, [
    el('section', { class: 'bf-card' }, [el('h2', {}, [icon('map'), C.mapTitle]), mapSec]),
    el('section', { class: 'bf-card db-chart' }, [el('h2', {}, [icon('thermostat'), C.chartTitle]), chart, el('p', { class: 'legend' }, C.chartLegend)]),
    el('section', { class: 'bf-card mc-card' }, [
      el('h2', {}, [icon('groups'), C.members]),
      memberCharts(rec, s, { marks: [...rec.decisions.map((d) => ({ tMin: d.tMin, label: d.label, kind: 'decision' as const })), ...rec.events.filter((e) => MARK_EVENTS.includes(e.type)).map((e) => ({ tMin: e.tMin, label: e.type, kind: 'event' as const }))] }),
    ]),
  ]);
}

function build(app: AppContext, r: RunDetail, root: HTMLElement): void {
  const C = JA.community;
  const tone = endingTone(r.ending);
  const fact = (ic: IconName, label: string, value: string): HTMLElement => el('div', { class: 'bf-fact' }, [icon(ic), el('span', {}, [el('small', {}, label), el('strong', {}, value)])]);
  const actions = el('div', { class: 'cm-actions' }, [
    r.mine
      ? el('button', { class: 'small danger', onclick: async () => {
          if (!confirm(C.removeConfirm)) return;
          try {
            await communityApi.remove(r.id);
            toast(C.removed);
            app.go({ name: 'community' });
          } catch (e) {
            toast(errorText(e), 5000);
          }
        } }, [cIcon('delete'), C.remove])
      : el('button', { class: 'small', onclick: async (ev: Event) => {
          if (!confirm(C.reportConfirm)) return;
          try {
            await communityApi.report(r.id);
            toast(C.reported);
            (ev.currentTarget as HTMLButtonElement | null)?.setAttribute('disabled', '');
          } catch (e) {
            toast(errorText(e), 5000);
          }
        } }, [cIcon('flag2'), C.report]),
  ]);
  root.closest('main')?.classList.add(`tone-${tone}`);
  const chartsBox = el('div', {}, el('p', { class: 'cm-msg' }, C.loading));
  const notes = el('div', { class: 'bf-notes' }, el('p', { class: 'note' }, JA.disclaimer.endingNote));
  root.replaceChildren(
    el('header', { class: 'en-hero cm-hero', style: `--end:${ENDING_COLOR[r.ending] ?? '#6b7280'}` }, [
      el('div', { class: 'en-in' }, [
        el('button', { class: 'cm-hero-user', type: 'button', onclick: () => showUserRuns(app, r.user.id, r.user.nickname) }, [
          userAvatar(r.user, 64),
          el('span', {}, [el('strong', {}, r.user.nickname), el('small', {}, [sexAgeText(r.user), sexAgeText(r.user) ? ' ・ ' : '', fill(C.postedAt, { date: dateText(r.createdAt) })])]),
          cIcon('chevronRight'),
        ]),
        el('p', { class: 'en-kicker' }, [JA.ui.endingTitle, el('span', {}, r.scenarioTitle), r.conditions ? el('span', { class: 'tag' }, C.conditionsTried) : null]),
        el('h1', {}, r.endingTitle || (JA.endings[r.ending]?.title ?? r.ending)),
        el('div', { class: 'bf-facts' }, [
          fact('timer', JA.ui.duration, hm(r.durationMin)),
          fact('route', JA.ui.distance, `${(r.distanceM / 1000).toFixed(1)} km`),
          fact('thermostat', JA.ui.minCore, `${r.minCoreC.toFixed(1)}℃`),
          fact('groups', C.party, `${r.partySize} 人`),
          r.deaths > 0 ? fact('warning', C.deaths, `${r.deaths} 人`) : null,
        ]),
      ]),
    ]),
    el('div', { class: `en-body tone-${tone}` }, [
      el('section', { class: 'bf-card cm-comment-card' }, [
        el('h2', {}, [cIcon('forum'), C.comment]),
        r.comment ? el('blockquote', { class: 'cm-comment' }, r.comment) : el('p', { class: 'cm-note' }, '—'),
        actions,
      ]),
      el('section', { class: 'bf-card' }, [
        el('h2', {}, [icon('route'), C.decisions]),
        r.decisions.length > 0
          ? el('ol', { class: 'en-decisions cm-decisions' }, r.decisions.map((d) => el('li', {}, [el('time', {}, formatClock(d.tMin)), el('span', { class: 'dia' }, '◆'), el('span', {}, [d.title ? el('small', {}, d.title) : null, el('strong', {}, d.label)]), d.auto ? el('small', {}, C.auto) : null])))
          : el('p', { class: 'cm-note' }, C.noDecisions),
      ]),
      chartsBox,
      notes,
    ]),
  );
  // 記録とシナリオを読んでから、地図とグラフ
  void (async () => {
    try {
      const [rec, idx] = await Promise.all([unpackRecord(r.record), loadIndex().catch(() => [] as ScenarioIndexEntry[])]);
      const entry = idx.find((e) => e.id === r.scenarioId);
      const s = await scenarioOnly(entry);
      if (!s) {
        chartsBox.replaceChildren(el('p', { class: 'cm-msg' }, C.noScenario));
        return;
      }
      chartsBox.replaceChildren(charts(rec, s, entry));
      if (s.region?.real) notes.append(el('p', { class: 'note' }, JA.disclaimer.realMountain));
      if (s.historical) notes.append(el('p', { class: 'note strong' }, s.historical.disclaimer));
    } catch {
      chartsBox.replaceChildren(el('p', { class: 'cm-msg' }, C.recordBroken));
    }
  })();
}

export function showCommunityRun(app: AppContext, id: number): () => void {
  const C = JA.community;
  let gone = false;
  const content = el('div', { class: 'cm-detail' }, el('p', { class: 'cm-msg' }, C.loading));
  const title = el('h1', {}, [cIcon('forum'), C.title]);
  app.root.append(
    el('main', { class: 'cm-screen ending2' }, [
      el('header', { class: 'cm-bar' }, [
        el('div', { class: 'cm-bar-in' }, [el('button', { class: 'cap', type: 'button', onclick: () => app.go({ name: 'community' }) }, [cIcon('arrowBack'), el('span', { class: 'cm-cap-t' }, C.title)]), title]),
      ]),
      content,
    ]),
  );
  void communityApi
    .run(id)
    .then(({ run }) => {
      if (gone) return;
      title.replaceChildren(cIcon('forum'), fill(C.detailTitle, { name: run.user.nickname }));
      build(app, run, content);
    })
    .catch((e: unknown) => {
      if (!gone) content.replaceChildren(el('p', { class: 'cm-msg' }, errorText(e)));
    });
  return () => {
    gone = true;
  };
}
