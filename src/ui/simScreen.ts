/**
 * シミュレーション画面（docs/11 §2〜3）。World・StaticContext・記録・描画・ループ・HUD・吹き出し・分岐点をつなぐ。
 * モード: 通常（分岐点で止まる）、判断時間制限（登山者は立ち止まって待ち、時間切れで傾向どおり）、観察のみ（傾向どおり自動）。
 */
import { createFloatWindow } from './floatWindow';
import { dlog, versionLabel } from '../app/version';
import type { AppContext } from '../app/App';
import type { LoadedScenario } from '../app/data';
import { Loop, type Speed } from '../app/loop';
import { effectiveQuality } from '../app/settings';
import { addHistory, clearResume, newRunId, saveResume, type ResumeData } from '../app/storage';
import { JA } from '../i18n/ja';
import { fill, formatEvent, speechView } from '../i18n/format';
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
        loop.paused = false;
        refresh();
      },
      togglePause: () => {
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
          view.godView = hud.god;
        }),
      quit: () => {
        if (!confirm(JA.ui.quitConfirm)) return;
        void save().then(() => app.go({ name: 'title' }));
      },
    },
    { god: view.godView, observe, timed },
  );
  // 3D 画面を全面に敷き、状況とログは動かせるウィンドウとして重ねる（狭い画面では最小化して始める）
  const narrow = window.innerWidth < 900;
  const sideWin = createFloatWindow(hud.side, { id: 'status', title: JA.ui.statusWindow, right: 12, top: 60, width: 320, height: Math.round(window.innerHeight * 0.62), minimized: narrow });
  const logWin = createFloatWindow(hud.logEl, { id: 'log', title: JA.ui.log, left: 12, bottom: 34, width: Math.min(560, Math.round(window.innerWidth * 0.5)), height: 180, minimized: narrow });
  app.root.append(el('main', { class: 'sim' }, [stage, hud.top, sideWin.el, logWin.el, modalHost, el('p', { class: 'keyhelp' }, `${JA.ui.keyHelp} ・ ${versionLabel()}`)]));

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
      if ((e.type === 'SPEECH' || e.type === 'THOUGHT') && e.climberId) {
        const v = speechView(e, scenario);
        if (v) bubbles.add(e.climberId, v, fast);
      }
      const text = formatEvent(e, { scenario, nodeName });
      if (text && (e.type !== 'THOUGHT' || hud.god)) hud.log({ tMin: e.tMin, text, important: Boolean(e.important), climberId: e.climberId });
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

  let uiTick = 0;
  function refresh(force = false): void {
    hud.setState(world, loop.paused, loop.speed, cam);
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
      loop.paused = !loop.paused;
      e.preventDefault();
    } else if (/^[1-4]$/.test(e.key)) {
      loop.speed = speeds[Number(e.key) - 1]!;
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
    sideWin.dispose();
    logWin.dispose();
    view.dispose();
  };
}
