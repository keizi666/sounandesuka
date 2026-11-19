/**
 * シミュレーション画面（docs/11 §2〜3）。World・StaticContext・記録・描画・ループ・HUD・吹き出し・分岐点をつなぐ。
 * モード: 通常（分岐点で止まる）、判断時間制限（登山者は立ち止まって待ち、時間切れで傾向どおり）、観察のみ（傾向どおり自動）。
 */
import { createAmbientSound } from '../view/ambientSound';
import { createFigureIcons, ICON_LIFT_PX } from './figureIcons';
import { closeLogDetail, snapOf } from './logDetail';
import { Timeline, type TimelineSnap } from '../app/timeline';
import { createTimelineBar } from './timelineBar';
import { showTitleCard } from './titleCard';
import { createDock } from './dockWindows';
import { dlog, versionLabel } from '../app/version';
import type { AppContext } from '../app/App';
import type { LoadedScenario } from '../app/data';
import { Loop, SPEEDS, type Speed } from '../app/loop';
import { effectiveQuality } from '../app/settings';
import { addHistory, clearResume, newRunId, saveResume, type ResumeData } from '../app/storage';
import { JA } from '../i18n/ja';
import { fill, formatEvent, speechView, formatDateTime } from '../i18n/format';
import { DT_SEC } from '../sim/core/step';
import { createStaticContext, createWorld } from '../sim/core/world';
import { createRecorder, recordTick, type RecorderState } from '../sim/record/recorder';
import { autoResolve, choiceLeader, findChoicePoint, resolveChoice } from '../sim/scenario/choices';
import type { SimEvent, World } from '../sim/types';
import { SceneView, type CameraMode } from '../view/sceneView';
import { BubbleLayer } from './bubbles';
import { showChoice, type ChoiceUi } from './choiceModal';
import { el, toast } from './dom';
import { Hud } from './simHud';
import { openSettings } from './settingsDialog';
import { audio } from './audio';
import { anySoundOn, toggleSoundPanel } from './soundPanel';
import { autoMusic, eventSound } from './simAudio';

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
  const figIcons = createFigureIcons(world.climbers);
  const stage = el('div', { class: 'stage' }, [canvas, figIcons.el, attributionLine(loaded)]);
  const modalHost = el('div', { class: 'modal-host' });
  // 始まりは追従（登山者の周りが見える近さ）
  let cam: CameraMode = 'follow';
  dlog('シナリオ開始', { scenario: scenario.id, map: map.def.id, size: map.def.size, resolution: map.n, party: scenario.party.length, resume: !!resume, observe, timed, tMin: world.tMin, quality: effectiveQuality(st), settings: st });
  const view = new SceneView(canvas, map, scenario, { quality: effectiveQuality(st), figureScale: st.figureScale, vExag: st.vExag, clouds3d: st.clouds3d });
  // 環境音（雨・風・雷）。最初は止めておき、上のバーのボタンで出す（ブラウザの決まりで、操作のあとでないと鳴らせない）
  const sound = createAmbientSound();
  sound.setVolume(st.soundVolume);
  // 前回、音を出していたら続けて出す（ブラウザが許せば。許されなければボタンで出し直す）
  view.godView = st.godViewDefault;
  view.tiltShift = st.tiltShift;
  view.mode = cam;
  view.frameClose(world);
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
          sound.setVolume(app.settings.soundVolume);
          view.tiltShift = app.settings.tiltShift;
          view.godView = hud.god;
        }),
      // 音のパネル（音楽・効果音・環境音のオンオフと音量）
      sound: () =>
        toggleSoundPanel(app, hud.soundBtn, {
          ambient: true,
          onChange: () => {
            sound.setOn(app.settings.sound);
            sound.setVolume(app.settings.soundVolume);
            hud.setSound(anySoundOn(app.settings, true));
          },
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
    // 上のバーの下からを置ける範囲にする（バーが 2 段に折り返しても隠れない）
    { topInset: () => (hud.top.isConnected ? hud.top.getBoundingClientRect().bottom : 0) },
  );
  // ---- タイムライン（時間を戻す） ----
  const timeline = new Timeline(scenario.party.length > 6 ? 5 : 2);
  const tlBar = createTimelineBar({
    seek: (t) => seekTo(t),
    latest: () => seekTo(Infinity),
    formatTime: (t) => formatDateTime(scenario, t).split(' ')[1] ?? '',
  });
  const simMain = el('main', { class: 'sim' }, [stage, hud.top, dock.el, tlBar.el, modalHost, el('p', { class: 'keyhelp' }, `${JA.ui.keyHelp} ・ ${versionLabel()}`)]);
  // シミュレーション画面では、ブラウザの右クリックメニューを出さない（右ドラッグで視点を回すため。ユーザーの指定）
  simMain.addEventListener('contextmenu', (e) => {
    if (!(e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) e.preventDefault();
  });
  app.root.append(simMain);
  dock.relayout();

  // ---- 保存 ----
  let lastSave = performance.now();
  async function save(): Promise<void> {
    if (world.ended) return;
    lastSave = performance.now();
    const ok = await saveResume({ scenarioId: scenario.id, world: structuredClone(world), recorder: structuredClone(recorder), choiceSnapshots: snapshots, log: hud.allLines(), savedAt: new Date().toISOString(), runId, parentRunId, conditions: loaded.conditions, speed: loop.speed });
    if (!ok) toast(JA.ui.saveFailed);
  }

  // ---- 分岐点 ----
  let choiceUi: ChoiceUi | null = null;
  let shownCp: string | null = null;
  /** シナリオの music アクションで指定された曲（なければ自動） */
  let scriptMusic: string | undefined;
  function handleEvents(evs: readonly SimEvent[]): void {
    const fast = loop?.speed >= 15;
    for (const e of evs) {
      // 効果音・音楽（シナリオの指定と、出来事に合わせた組み込みの音）
      if (e.type === 'MUSIC') scriptMusic = typeof e.data?.['id'] === 'string' ? (e.data['id'] as string) : undefined;
      const se = eventSound(e);
      if (se) audio().play(se.id, se.volume);
      // 見守るパーティが変わったら、そのリーダーを選んで追う
      if (e.type === 'FOCUS') focusGroup(String(e.data?.['group'] ?? ''));
      if (e.type === 'CHOICE_FIRED') {
        const id = String(e.data?.['cp'] ?? '');
        snapshots[id] = { world: structuredClone(world), recorder: structuredClone(recorder) };
      }
      if (e.type === 'CHOICE_RESOLVED') {
        const cpId = String(e.data?.['cp'] ?? '');
        const label = optionLabel(loaded, cpId, String(e.data?.['option'] ?? ''));
        const by = e.data?.['by'];
        hud.log({ tMin: e.tMin, important: true, text: by === 'user' ? fill(JA.ui.chose, { label }) : otherChoiceBy ? fill(JA.ui.otherChose, { who: otherChoiceBy, label }) : fill(observe ? JA.ui.autoChose : JA.ui.timeUp, { label }) });
        otherChoiceBy = null;
        continue;
      }
      const v = (e.type === 'SPEECH' || e.type === 'THOUGHT') && e.climberId ? speechView(e, scenario) : null;
      if (v && e.climberId) bubbles.add(e.climberId, v, fast);
      const text = formatEvent(e, { scenario, nodeName });
      if (!text || (e.type === 'THOUGHT' && !hud.god)) continue;
      // そのときの状態（顔の下のメーターと詳細に使う）
      const cs = e.climberId ? world.climbers.find((x) => x.id === e.climberId) : undefined;
      const snap = cs ? snapOf(cs) : undefined;
      if (v) {
        // 吹き出しの中は文だけ。注記（記録・架空・ろれつ）は下に小さく
        const tag = v.log.replace(/^.*[」）]/, '');
        hud.log({ tMin: e.tMin, text, important: Boolean(e.important), climberId: e.climberId, kind: v.thought ? 'thought' : 'speech', bubble: v.thought ? v.display : v.display, tag, to: v.to ? (party.get(v.to)?.name ?? v.to) : undefined, shout: v.tone === 'shout', snap });
      } else hud.log({ tMin: e.tMin, text, important: Boolean(e.important), climberId: e.climberId, kind: e.climberId ? 'action' : 'system', snap });
    }
  }

  function focusGroup(groupId: string): void {
    const leader = world.groups.find((g) => g.id === groupId)?.leader;
    if (!leader) return;
    view.selected = leader;
    view.lookAt(leader);
    if (view.mode === 'eye') bubbles.eyeOf = leader;
  }

  /** 見守っていないパーティの分岐点を自動で決めたとき、そのリーダーの名前（ログの文に使う） */
  let otherChoiceBy: string | null = null;
  function onChoice(): void {
    const p = world.pendingChoice;
    if (!p || shownCp === p.cpId) return;
    // 見守るパーティが決まっていて、この分岐点がほかのパーティのものなら、プレイヤーに聞かずにその人たちらしく決める
    if (world.focusMembers && findChoicePoint(ctx, p.cpId)) {
      const lead = choiceLeader(world, ctx);
      if (!world.focusMembers.includes(lead.id)) {
        otherChoiceBy = lead.def.name;
        autoResolve(world, ctx, 'bias');
        flush();
        return;
      }
    }
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
  let wasFlash = false;
  let lastMusicAt = 0;
  // 描画が重い（平均 30fps 未満が 5 秒続く）ときは画質を下げる提案を 1 回だけ出す
  let slowSince = 0;
  let suggested = effectiveQuality(st) === 'low';
  loop = new Loop(world, ctx, {
    render: (w, prev, alpha, t) => {
      applySeek();
      view.gameSpeed = loop.paused || w.pendingChoice || w.ended ? 0 : SPEEDS[loop.speed] * DT_SEC;
      view.render(w, prev, alpha, t);
      // 音: 注目している登山者の場所の天気。カメラが遠いほど小さく
      {
        const fc = w.climbers.find((x) => x.id === view.selected) ?? w.climbers[0];
        const fd = view.focusDistance();
        const near = cam === 'eye' ? 1 : Math.max(0.12, Math.min(1, 1.25 - fd / 1.6));
        if (fc) sound.update(Math.min(0.1, (performance.now() - lastFrame) / 1000), { windMs: fc.local.windMs * w.weather.gust, precipMmH: fc.local.precipMmH, snow: fc.local.precipType === 'snow' || fc.local.precipType === 'sleet', near });
        const fl = view.flashing;
        if (fl && !wasFlash) sound.thunder(0.6 + (1 - Math.min(1, w.weather.thunder)) * 8);
        wasFlash = fl;
      }
      const now = performance.now();
      // 曲: シナリオの指定がなければ、昼・夜・遭難のさなかで選ぶ（2 秒ごと）
      if (now - lastMusicAt > 2000) {
        lastMusicAt = now;
        audio().music(w.ended ? null : scriptMusic ?? autoMusic(w, scenario));
      }
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
      // 頭の上に顔アイコン。吹き出しはアイコンの左上に出し（アイコンが吹き出しの右に来る）、アイコンより手前に重ねる
      figIcons.update(w, (id) => view.headScreen(id, r.width, r.height), { god: hud.god, time: formatDateTime(scenario, w.tMin).split(' ')[1] ?? '', hidden: cam === 'eye' });
      bubbles.align = cam === 'eye' ? 'center' : 'left';
      bubbles.update(dt, (id) => {
        const hs = view.headScreen(id, r.width, r.height);
        if (hs && cam !== 'eye') {
          hs.x -= 16;
          hs.y -= ICON_LIFT_PX + 12;
        }
        return hs;
      }, r.width);
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
  // 途中から再開したら、そのときの再生の速さに戻す（ユーザーの指定）
  else if (resume?.speed !== undefined && resume.speed !== 0) loop.speed = resume.speed;
  timeline.capture(world, recorder, true);
  if (st.sound) sound.setOn(true);
  hud.setSound(anySoundOn(st, true));

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
  // 再開したときは、保存してあったログを出し直す（保存にログがない古いデータでは、再開したことだけを出す）
  if (resume?.log && resume.log.length > 0) for (const line of resume.log) hud.log(line);
  else if (resume) hud.log({ tMin: world.tMin, text: JA.ui.resumedNoLog, important: true });
  else hud.log({ tMin: world.tMin, text: `${scenario.title}（${nodeName(scenario.plan.route[0]!)} を出発）`, important: true });
  // 途中から再開したとき、見守るパーティが変わっていれば、そのリーダーを選ぶ
  if (world.focusGroup) focusGroup(world.focusGroup);
  refresh(true);
  // 新しく始めたときは、題の札を出し、消えてから時間を進める（途中からの再開では出さない）
  let closeTitle: (() => void) | null = null;
  if (!resume) {
    loop.paused = true;
    closeTitle = showTitleCard(stage, scenario, world, ctx, () => {
      closeTitle = null;
      loop.paused = false;
      refresh(true);
    });
  }
  loop.start();
  // 開発時のデバッグ用（ブラウザのコンソールから参照）
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>)['__hk'] = { view, world, ctx, loop, recorder };
  // 再開時、回答待ちの分岐点があればすぐ出す
  if (world.pendingChoice) onChoice();

  return () => {
    // 画面を離れるとき（ブラウザの戻るなど）も続きを保存する（結末に着いていれば何もしない）
    void save();
    closeTitle?.();
    loop.dispose();
    choiceUi?.close();
    ro.disconnect();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
    bubbles.dispose();
    sound.dispose();
    figIcons.dispose();
    closeLogDetail();
    tlBar.dispose();
    dock.dispose();
    view.dispose();
  };
}
