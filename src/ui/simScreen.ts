/**
 * シミュレーション画面（docs/11 §2〜3）。World・StaticContext・記録・描画・ループ・HUD・吹き出し・分岐点をつなぐ。
 * モード: 通常（分岐点で止まる）、判断時間制限（登山者は立ち止まって待ち、時間切れで傾向どおり）、観察のみ（傾向どおり自動）。
 */
import { Timeline, type TimelineSnap } from '../app/timeline';
import { createTimelineBar } from './timelineBar';
import { createDock } from './dockWindows';
import { dlog, versionLabel } from '../app/version';
import type { AppContext } from '../app/App';
import type { LoadedScenario } from '../app/data';
import { Loop, type Speed } from '../app/loop';
import { effectiveQuality } from '../app/settings';
import { addHistory, clearResume, newRunId, saveResume, type ResumeData } from '../app/storage';
import { JA } from '../i18n/ja';
import { fill, formatEvent, speechView, formatDateTime } from '../i18n/format';
import { DT_SEC } from '../sim/core/step';
import { createStaticContext, createWorld } from '../sim/core/world';
import { createRecorder, recordTick, type RecorderState } from '../sim/record/recorder';
import { autoResolve, findChoicePoint, resolveChoice } from '../sim/scenario/choices';
import type { SimEvent, World } from '../sim/types';
import { SceneView, type CameraMode } from '../view/sceneView';
import { BubbleLayer } from './bubbles';
import { showChoice, type ChoiceUi } from './choiceModal';
import { el, toast } from './dom';
import { Hud } from './simHud';
import { openSettings } from './settingsDialog';

export interface SimResult {
  world: World;
  recorder: RecorderState;
  choiceSnapshots: Record<string, { world: World; recorder: RecorderState }>;
  runId: string;
  parentRunId: string | null;
}

const TIMED_SEC = 30;
const AUTOSAVE_MS = 30000;
const IMPORTANT_PAUSE = new Set(['DEATH', 'CARDIAC_ARREST', 'INJURY', 'LOST_AWARE', 'LIGHTNING_STRIKE', 'RESCUED', 'STAGE_CHANGE']);

/** 外部データ由来の内容には出典を出す（鉄則 9）。実在の山のシナリオでは注記も添える */
export function attributionLine(loaded: LoadedScenario): HTMLElement | null {
  const a = loaded.attribution;
  if (a.length === 0 && !loaded.scenario.region?.real) return null;
  return el('p', { class: 'attribution' }, [
    ...a.flatMap((x, i) => [i > 0 ? ' / ' : '', el('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.text)]),
    loaded.scenario.region?.real ? el('span', {}, ` ${JA.disclaimer.realMountainShort}`) : null,
  ]);
}

export function optionLabel(loaded: LoadedScenario, cpId: string, optionId: string): string {
  const s = loaded.scenario;
  const cp = cpId.startsWith('generic:') ? null : s.choices.find((c) => c.id === cpId);
  const o = cp?.options.find((x) => x.id === optionId);
  if (o?.label) return o.label;
  return JA.generic[cpId.slice(8)]?.options[optionId] ?? optionId;
}

export function showSimScreen(app: AppContext, loaded: LoadedScenario, resume?: ResumeData, observe = false): () => void {
  const { scenario, map } = loaded;
  const st = app.settings;
  const timed = !observe && st.timed;
  const world = resume ? resume.world : createWorld(map, scenario);
  const ctx = createStaticContext(map, scenario, { mode: timed ? 'timed' : 'interactive' });
  const recorder = resume?.recorder ?? createRecorder(world);
  const snapshots: SimResult['choiceSnapshots'] = resume?.choiceSnapshots ?? {};
  const runId = resume?.runId ?? newRunId();
  const parentRunId = resume?.parentRunId ?? null;

  // ---- 画面 ----
  const canvas = el('canvas', { class: 'scene', 'aria-label': scenario.title });
  const stage = el('div', { class: 'stage' }, [canvas, attributionLine(loaded)]);
  const modalHost = el('div', { class: 'modal-host' });
  let cam: CameraMode = st.autoCamera ? 'follow' : 'overview';
  dlog('シナリオ開始', { scenario: scenario.id, map: map.def.id, size: map.def.size, resolution: map.n, party: scenario.party.length, resume: !!resume, observe, timed, tMin: world.tMin, quality: effectiveQuality(st), settings: st });
  const view = new SceneView(canvas, map, scenario, { quality: effectiveQuality(st), figureScale: st.figureScale, vExag: st.vExag });
  view.godView = st.godViewDefault;
  view.tiltShift = st.tiltShift;
  view.mode = cam;
  const party = new Map(scenario.party.map((p) => [p.id, p]));
  const bubbles = new BubbleLayer(stage, scenario, (id) => ({ name: party.get(id)?.name ?? id, color: party.get(id)?.color ?? '#888' }));
  const applyBubbleSettings = (): void => {
    bubbles.speechOn = st.speechBubbles;
    bubbles.thoughtOn = st.thoughtBubbles;
    bubbles.fictionalOn = st.fictionalSpeech;
  };
  applyBubbleSettings();
  const nodeName = (id: string): string => map.nodes[id]?.name ?? id;

  let loop: Loop;
  const hud = new Hud(
    scenario,
    {
      setSpeed: (s) => {
        loop.speed = s;
        beforePlay();
        loop.paused = false;
        refresh();
      },
      togglePause: () => {
        if (loop.paused) beforePlay();
        loop.paused = !loop.paused;
        refresh();
      },
      setGod: (v) => {
        hud.god = v;
        view.godView = v;
        refresh(true);
      },
      setCamera: (m) => {
        cam = m;
        view.mode = m;
        bubbles.eyeOf = m === 'eye' ? (view.selected ?? world.climbers[0]?.id ?? null) : null;
        refresh();
      },
      setLayer: (n, on) => view.setLayer(n, on),
      setOverlay: (k) => view.overlay.set(k),
      select: (id) => {
        view.selected = id;
        view.lookAt(id);
        refresh(true);
      },
      settings: () =>
        openSettings(app, () => {
          applyBubbleSettings();
          view.tiltShift = app.settings.tiltShift;
          view.godView = hud.god;
        }),
      quit: () => {
        if (!confirm(JA.ui.quitConfirm)) return;
        void save().then(() => app.go({ name: 'title' }));
      },
    },
    { god: view.godView, observe, timed },
  );
  // 3D 画面を全面に敷き、ログ・登山者・気象は「合体できるタブ式のウィンドウ」として重ねる（狭い画面では最小化して始める）
  const narrow = window.innerWidth < 900;
  const sideW = Math.min(330, window.innerWidth - 16);
  const dock = createDock(
    [
      { id: 'climbers', title: JA.ui.climbers, icon: 'groups', content: hud.climbersPane },
      { id: 'weather', title: JA.ui.weatherTab, icon: 'partlyCloudyDay', content: hud.weatherPane },
      { id: 'log', title: JA.ui.log, icon: 'listAlt', content: hud.logEl },
    ],
    [
      { x: window.innerWidth - sideW - 12, y: 60, w: sideW, h: Math.round(window.innerHeight * 0.6), min: narrow, tabs: ['climbers', 'weather'], active: 'climbers' },
      { x: 12, y: Math.max(60, window.innerHeight - 460 - 96), w: Math.min(540, Math.round(window.innerWidth * 0.46)), h: Math.min(460, window.innerHeight - 160), min: narrow, tabs: ['log'], active: 'log' },
    ],
  );
  // ---- タイムライン（時間を戻す） ----
  const timeline = new Timeline(scenario.party.length > 6 ? 5 : 2);
  const tlBar = createTimelineBar({
    seek: (t) => seekTo(t),
    latest: () => seekTo(Infinity),
    formatTime: (t) => formatDateTime(scenario, t).split(' ')[1] ?? '',
  });
  app.root.append(el('main', { class: 'sim' }, [stage, hud.top, dock.el, tlBar.el, modalHost, el('p', { class: 'keyhelp' }, `${JA.ui.keyHelp} ・ ${versionLabel()}`)]));

  // ---- 保存 ----
  let lastSave = performance.now();
  async function save(): Promise<void> {
    if (world.ended) return;
    lastSave = performance.now();
    const ok = await saveResume({ scenarioId: scenario.id, world: structuredClone(world), recorder: structuredClone(recorder), choiceSnapshots: snapshots, savedAt: new Date().toISOString(), runId, parentRunId });
    if (!ok) toast(JA.ui.saveFailed);
  }

  // ---- 分岐点 ----
  let choiceUi: ChoiceUi | null = null;
  let shownCp: string | null = null;
  function handleEvents(evs: readonly SimEvent[]): void {
    const fast = loop?.speed >= 15;
    for (const e of evs) {
      if (e.type === 'CHOICE_FIRED') {
        const id = String(e.data?.['cp'] ?? '');
        snapshots[id] = { world: structuredClone(world), recorder: structuredClone(recorder) };
      }
      if (e.type === 'CHOICE_RESOLVED') {
        const cpId = String(e.data?.['cp'] ?? '');
        const label = optionLabel(loaded, cpId, String(e.data?.['option'] ?? ''));
        const by = e.data?.['by'];
        hud.log({ tMin: e.tMin, important: true, text: by === 'user' ? fill(JA.ui.chose, { label }) : fill(observe ? JA.ui.autoChose : JA.ui.timeUp, { label }) });
        continue;
      }
      const v = (e.type === 'SPEECH' || e.type === 'THOUGHT') && e.climberId ? speechView(e, scenario) : null;
      if (v && e.climberId) bubbles.add(e.climberId, v, fast);
      const text = formatEvent(e, { scenario, nodeName });
      if (!text || (e.type === 'THOUGHT' && !hud.god)) continue;
      if (v) {
        // 吹き出しの中は文だけ。注記（記録・架空・ろれつ）は下に小さく
        const tag = v.log.replace(/^.*[」）]/, '');
        hud.log({ tMin: e.tMin, text, important: Boolean(e.important), climberId: e.climberId, kind: v.thought ? 'thought' : 'speech', bubble: v.thought ? v.display : v.display, tag, to: v.to ? (party.get(v.to)?.name ?? v.to) : undefined, shout: v.tone === 'shout' });
      } else hud.log({ tMin: e.tMin, text, important: Boolean(e.important), climberId: e.climberId, kind: e.climberId ? 'action' : 'system' });
    }
  }

  function onChoice(): void {
    const p = world.pendingChoice;
    if (!p || shownCp === p.cpId) return;
    if (observe) {
      autoResolve(world, ctx, 'bias');
      flush();
      return;
    }
    if (!findChoicePoint(ctx, p.cpId)) return;
    shownCp = p.cpId;
    void save();
    choiceUi = showChoice(modalHost, world, ctx, {
      god: hud.god,
      timeoutSec: timed ? TIMED_SEC : null,
      onPick: (id) => {
        choiceUi = null;
        if (!world.pendingChoice) return;
        if (id) resolveChoice(world, ctx, id, 'user');
        else autoResolve(world, ctx, 'bias');
        shownCp = null;
        flush();
      },
    });
  }

  /** ループの外で出たイベント（選択の確定など）を記録・表示する */
  function flush(): void {
    const evs = ctx.events.splice(0);
    if (evs.length === 0) return;
    recordTick(recorder, world, ctx, evs, 0);
    handleEvents(evs);
  }

  let ended = false;
  function onEnded(): void {
    if (ended) return;
    ended = true;
    clearResume(scenario.id);
    const r = recorder.record;
    addHistory({
      runId,
      parentRunId,
      scenarioId: scenario.id,
      title: scenario.title,
      at: new Date().toISOString(),
      ending: world.ended!.kind,
      choices: r.decisions.filter((d) => d.by === 'user').map((d) => optionLabel(loaded, d.cpId, d.optionId)),
    });
    window.setTimeout(() => app.go({ name: 'ending', loaded, result: { world, recorder, choiceSnapshots: snapshots, runId, parentRunId } }), 1500);
  }

  // ---- ループ ----
  let lastFrame = performance.now();
  // 描画が重い（平均 30fps 未満が 5 秒続く）ときは画質を下げる提案を 1 回だけ出す
  let slowSince = 0;
  let suggested = effectiveQuality(st) === 'low';
  loop = new Loop(world, ctx, {
    render: (w, prev, alpha, t) => {
      applySeek();
      view.render(w, prev, alpha, t);
      const now = performance.now();
      if (!suggested && !document.hidden) {
        if (now - lastFrame > 1000 / 30 && now - lastFrame < 500) {
          slowSince ||= now;
          if (now - slowSince > 5000) {
            suggested = true;
            toast(JA.ui.slowHint, 6000);
          }
        } else slowSince = 0;
      }
      const dt = loop.paused || w.pendingChoice ? 0 : (now - lastFrame) / 1000;
      lastFrame = now;
      const r = canvas.getBoundingClientRect();
      bubbles.update(dt, (id) => view.headScreen(id, r.width, r.height), r.width);
    },
    onEvents: (evs) => {
      recordTick(recorder, world, ctx, evs, DT_SEC / 60);
      handleEvents(evs);
      timeline.capture(world, recorder);
    },
    onChoice,
    onEnded,
    onUi: () => refresh(),
    shouldPause: (e) => {
      if (st.autoPause === 'choice') return false;
      if (st.autoPause === 'important') return IMPORTANT_PAUSE.has(e.type);
      return Boolean(e.important) && e.type !== 'CHOICE_FIRED' && e.type !== 'CHOICE_RESOLVED';
    },
  });
  if (observe) loop.speed = 15;
  timeline.capture(world, recorder, true);

  /** 写しの中身で、いまの世界と記録を置き換える（同じオブジェクトのまま中身を入れ替える） */
  function replaceInPlace(target: object, src: object): void {
    for (const k of Object.keys(target)) delete (target as Record<string, unknown>)[k];
    Object.assign(target, src);
  }
  let seekQueued: number | null = null;
  /** タイムラインの時刻へ移る。その時刻以前でいちばん新しい写しを表示し、一時停止する */
  function seekTo(tMin: number): void {
    if (world.ended) return;
    // いまが最新なら、戻る前に最新の状態も写しておく（「最新へ」で戻れるように）
    if (world.tMin >= timeline.endMin - 1e-6) timeline.capture(world, recorder, true);
    seekQueued = tMin;
  }
  function applySeek(): void {
    if (seekQueued === null) return;
    const snap: TimelineSnap | null = timeline.at(seekQueued);
    seekQueued = null;
    if (!snap || Math.abs(snap.tMin - world.tMin) < 1e-6) return;
    choiceUi?.close();
    choiceUi = null;
    shownCp = null;
    replaceInPlace(world, structuredClone(snap.world));
    replaceInPlace(recorder, structuredClone(snap.recorder));
    ctx.events.length = 0;
    loop.reset(world);
    loop.paused = true;
    hud.setCutoff(world.tMin < timeline.endMin - 1e-6 ? world.tMin : null);
    refresh(true);
  }
  /** 再生に入る直前: 過去を表示していたなら、そこからやり直す（それより先の写し・ログ・分岐点の記録を捨てる） */
  function beforePlay(): void {
    if (world.tMin < timeline.endMin - 1e-6) {
      timeline.truncateAfter(world.tMin);
      for (const [id, sn] of Object.entries(snapshots)) if (sn.world.tMin > world.tMin + 1e-6) delete snapshots[id];
      hud.truncate(world.tMin);
      toast(JA.ui.timelineRewound, 3500);
    }
    // 分岐点の回答待ちで止まっている時刻へ戻った場合は、選択肢を出し直す
    if (world.pendingChoice) window.setTimeout(() => onChoice(), 0);
  }

  let uiTick = 0;
  function refresh(force = false): void {
    hud.setState(world, loop.paused, loop.speed, cam);
    tlBar.update(timeline.startMin, Math.max(timeline.endMin, world.tMin), world.tMin, hud.importantLines().map((l) => ({ tMin: l.tMin, text: l.text, choice: l.text.startsWith('◆') })));
    uiTick += 1;
    if (force || uiTick % 2 === 0) {
      hud.updatePanels(world, view.selected);
      view.setTrack(recorder.record.track);
      view.overlay.update(world, ctx);
    }
    if (!world.ended && performance.now() - lastSave > AUTOSAVE_MS) void save();
  }

  // ---- 入力 ----
  const onKey = (e: KeyboardEvent): void => {
    if (choiceUi || (e.target as HTMLElement).closest('input,select,textarea,dialog')) return;
    const speeds: Speed[] = [1, 4, 15, 60];
    if (e.key === ' ') {
      if (loop.paused) beforePlay();
      loop.paused = !loop.paused;
      e.preventDefault();
    } else if (/^[1-4]$/.test(e.key)) {
      loop.speed = speeds[Number(e.key) - 1]!;
      beforePlay();
      loop.paused = false;
    } else if (e.key === 'g' || e.key === 'G') {
      hud.god = !hud.god;
      view.godView = hud.god;
    } else if (e.key === 'c' || e.key === 'C') {
      const order: CameraMode[] = ['overview', 'follow', 'eye'];
      cam = order[(order.indexOf(cam) + 1) % 3]!;
      view.mode = cam;
      bubbles.eyeOf = cam === 'eye' ? (view.selected ?? world.climbers[0]?.id ?? null) : null;
    } else return;
    refresh(true);
  };
  document.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => {
    const r = stage.getBoundingClientRect();
    view.resize(r.width, r.height);
  });
  ro.observe(stage);
  const onHide = (): void => {
    if (document.hidden) void save();
  };
  document.addEventListener('visibilitychange', onHide);

  // 開始時の重要な状態をログに
  hud.log({ tMin: world.tMin, text: `${scenario.title}（${nodeName(scenario.plan.route[0]!)} を出発）`, important: true });
  refresh(true);
  loop.start();
  // 開発時のデバッグ用（ブラウザのコンソールから参照）
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>)['__hk'] = { view, world, ctx, loop, recorder };
  // 再開時、回答待ちの分岐点があればすぐ出す
  if (world.pendingChoice) onChoice();

  return () => {
    loop.dispose();
    choiceUi?.close();
    ro.disconnect();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
    bubbles.dispose();
    tlBar.dispose();
    dock.dispose();
    view.dispose();
  };
}
