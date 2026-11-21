/**
 * シミュレーション画面（docs/11 §2〜3）。World・StaticContext・記録・描画・ループ・HUD・吹き出し・分岐点をつなぐ。
 * モード: 通常（分岐点で止まる）、判断時間制限（登山者は立ち止まって待ち、時間切れで傾向どおり）、観察のみ（傾向どおり自動）。
 */
import { createAmbientSound } from '../view/ambientSound';
import { createFigureIcons, ICON_LIFT_PX } from './figureIcons';
import { closeLogDetail, snapOf } from './logDetail';
import { Timeline } from '../app/timeline';
import { createTimelineBar } from './timelineBar';
import { showTitleCard } from './titleCard';
import { createDock, isCompactScreen } from './dockWindows';
import { dlog, versionLabel } from '../app/version';
import type { AppContext } from '../app/App';
import type { LoadedScenario } from '../app/data';
import { Loop, SPEEDS } from '../app/loop';
import { effectiveQuality } from '../app/settings';
import { addHistory, clearResume, newRunId, saveResume, type ResumeData } from '../app/storage';
import { JA } from '../i18n/ja';
import { fill, formatEvent, speechView, formatDateTime } from '../i18n/format';
import { DT_SEC, stepWorld } from '../sim/core/step';
import { createStaticContext, createWorld } from '../sim/core/world';
import type { PlayMode, SharedState } from '../app/shareState';
import { replayTo } from './simReplay';
import { loadViewPre, saveViewPre, viewKeys, type ViewPre } from '../view/viewCache';
import { icon } from './icons';
import { createRecorder, recordTick, type RecorderState } from '../sim/record/recorder';
import { autoResolve, choiceLeader, findChoicePoint, resolveChoice } from '../sim/scenario/choices';
import { deciderOf } from './choiceModal';
import type { ClimberState, SimEvent, StaticContext, World } from '../sim/types';
import { SceneView, type CameraMode } from '../view/sceneView';
import { BubbleLayer } from './bubbles';
import { showChoice, type ChoiceUi } from './choiceModal';
import { el, toast } from './dom';
import { Hud } from './simHud';
import { openSettings } from './settingsDialog';
import { audio } from './audio';
import { anySoundOn, toggleSoundPanel } from './soundPanel';
import { eventSound } from './simAudio';
import { attributionLine, optionLabel, type SimResult } from './simCommon';
import { createUrlSync } from './simUrl';
import { createTimeTravel } from './simTimeTravel';
import { createKeyHandler } from './simKeys';
import { createFrameExtras } from './simFrame';
import { createSimCapture } from './simCapture';
import { openEndConfirm } from './endConfirm';
import { setPhoneEra } from './phoneWord';

/** 遊ぶたびの乱数の種（UI 層なので Math.random を使ってよい。sim の中では使わない） */
function freshSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
import { countPlay } from '../app/playStats';
import { resolveEnding } from '../sim/scenario/endings';
import { recVars } from '../sim/record/recorder';
import type { Difficulty } from '../app/settings';
import { groupLeader } from '../sim/climber/party';
import { isForest } from '../sim/terrain/derive';
import { nearestIndex } from '../sim/terrain/sample';
import { openSynopsis } from './synopsis';

export { attributionLine, optionLabel, type SimResult } from './simCommon';

const TIMED_SEC = 30;
const AUTOSAVE_MS = 30000;
/** ハードで、これより遠い所をぼかす（m。ユーザーの指定: 樹林帯の中は狭く、抜けたら広く） */
const HARD_VIEW_FOREST_M = 100;
const HARD_VIEW_OPEN_M = 300;
/** 見える範囲が変わりきるまでの目安（秒） */
const HARD_VIEW_EASE_SEC = 1.5;
/** ノーマルは、ハードの何倍の範囲までぼかさないか（ユーザーの指定） */
const NORMAL_VIEW_F = 2;
/** 現在地が分からないとき、はっきり見える範囲（ハード。m） */
const LOST_VIEW_M = 50;
/** ぼかさないとき（なめらかに変えるための大きな値。これより広ければぼかさない。m） */
const VIEW_NONE_M = 4000;
const VIEW_NONE_AT_M = 3000;
/** ノーマルで悪天候とみなす見通し（m）と降水（mm/h） */
const BAD_WEATHER_VIS_M = 300;
const BAD_WEATHER_PRECIP_MMH = 1;
/** 見える範囲の下限（m。人形のまわりは別にぼかさない） */
const HARD_VIEW_MIN_M = 25;
/** 夜の見える範囲（ヘッドランプあり・なし。m） */
const HARD_VIEW_NIGHT_LAMP_M = 40;
const HARD_VIEW_NIGHT_DARK_M = 15;

/**
 * ハードの見える範囲（ユーザーの指定: 登山者の視点の状態で変える）。
 * 樹林帯の中は 100 m、抜けたら 300 m。霧の見通しより先は見えない。強い雨・雪で狭くなり、夜はヘッドランプの届くあたりまで
 */
function hardViewRangeM(map: StaticContext['map'], c: ClimberState, dark: boolean): number {
  let r = isForest(map.veg[nearestIndex(map, c.x, c.z)] ?? 0) ? HARD_VIEW_FOREST_M : HARD_VIEW_OPEN_M;
  const l = c.local;
  r = Math.min(r, l.visibilityM);
  if (l.precipMmH > 8) r *= 0.5;
  else if (l.precipMmH > 3) r *= 0.7;
  else if (l.precipMmH > 1) r *= 0.85;
  if (dark) r = Math.min(r, c.inv.headlamp.on ? HARD_VIEW_NIGHT_LAMP_M : HARD_VIEW_NIGHT_DARK_M);
  return Math.max(HARD_VIEW_MIN_M, r);
}
const TERMINAL_STATES = new Set(['FINISHED', 'RESCUED', 'DEAD']);
const IMPORTANT_PAUSE = new Set(['DEATH', 'CARDIAC_ARREST', 'INJURY', 'LOST_AWARE', 'LIGHTNING_STRIKE', 'RESCUED', 'STAGE_CHANGE']);

/** 画面を開く前に、前に作った 3D のデータ（キャッシュ）を読む（ユーザーの指定: 同じ条件なら作り直さない） */
export async function preloadView(app: AppContext, loaded: LoadedScenario): Promise<ViewPre> {
  const st = app.settings;
  return loadViewPre(viewKeys(loaded.map, loaded.scenario.season, effectiveQuality(st), st.vExag));
}

export function showSimScreen(app: AppContext, loaded: LoadedScenario, resume?: ResumeData, observe = false, replay?: SharedState, pre?: ViewPre): () => void {
  const { scenario, map } = loaded;
  const st = app.settings;
  // URL の場面から作り直すときは、その URL の遊び方で進める（同じ場面にするため）
  if (replay) observe = replay.mode === 'o';
  const timed = replay ? replay.mode === 't' : !observe && st.timed;
  const playMode: PlayMode = observe ? 'o' : timed ? 't' : 'i';
  // 乱数の種: 遊ぶたびに違う種（ユーザーの指定: 確率の絡むことは毎回違う結果に）。場面の URL・記録から始めるときはその回の種、
  // 途中からの再開は保存した世界の種のまま。史実のシナリオだけは、記録どおりに選べば記録どおりになるよう、シナリオの種（DECISIONS.md）
  // 種のない場面の URL（この変更の前に作ったもの）は、シナリオの種で作り直す
  setPhoneEra(scenario);
  const seed = replay ? (replay.seed ?? scenario.seed) : scenario.historical ? scenario.seed : freshSeed();
  const world = resume ? resume.world : createWorld(map, scenario, seed);
  const ctx = createStaticContext(map, scenario, { mode: timed ? 'timed' : 'interactive' });
  const recorder = resume?.recorder ?? createRecorder(world);
  const snapshots: SimResult['choiceSnapshots'] = resume?.choiceSnapshots ?? {};
  const runId = resume?.runId ?? newRunId();
  const parentRunId = resume?.parentRunId ?? null;

  // ---- 画面 ----
  const canvas = el('canvas', { class: 'scene', 'aria-label': scenario.title });
  // スクリーンショット・録画（描いた直後に afterRender で合成する）
  const simCap = createSimCapture({ canvas, loaded, world: () => world, settings: app.settings, onChange: () => hud.setRecording(simCap.elapsed()), situation: () => situationLines(),
    // カードは、見守っている人のまわりを切り抜いて拡大する（画面の画素で。ユーザーの指定）
    focus: () => {
      const hs = view.headScreen(watched(world).id, canvas.width, canvas.height);
      return hs && hs.front ? { x: hs.x, y: hs.y } : null;
    },
  });
  const figIcons = createFigureIcons(world.climbers);
  // 一時停止中は、画面の中央に角丸のパネルで ▶ を出し、押すと再開する（ユーザーの指定）
  const pauseOverlay = el('button', { class: 'pause-overlay', type: 'button', title: `${JA.ui.resumeShort} (Space)`, 'aria-label': JA.ui.resumeShort, hidden: true }, [icon('playArrow'), el('span', {}, JA.ui.resumeShort)]);
  pauseOverlay.addEventListener('click', () => {
    tt.beforePlay();
    loop.paused = false;
    refresh();
  });
  /** 題の札を出している間（▶ のパネルを出さない） */
  let titleShowing = false;
  const stage = el('div', { class: 'stage' }, [canvas, figIcons.el, attributionLine(loaded), pauseOverlay]);
  const modalHost = el('div', { class: 'modal-host' });
  // 始まりは追従（登山者の周りが見える近さ）
  let cam: CameraMode = 'follow';
  dlog('シナリオ開始', { scenario: scenario.id, map: map.def.id, size: map.def.size, resolution: map.n, party: scenario.party.length, resume: !!resume, observe, timed, tMin: world.tMin, quality: effectiveQuality(st), settings: st });
  const tView = performance.now();
  const view = new SceneView(canvas, map, scenario, { quality: effectiveQuality(st), figureScale: st.figureScale, vExag: st.vExag, clouds3d: st.clouds3d, pre });
  dlog('3D の準備', { ms: Math.round(performance.now() - tView), cache: { masks: !!pre?.masks, terrain: !!pre?.terrain, trees: !!pre?.trees } });
  // 新しく作ったものは、次のためにキャッシュに入れる（画面が出てから、裏で）
  window.setTimeout(() => saveViewPre(viewKeys(map, scenario.season, effectiveQuality(st), st.vExag), view.made), 1500);
  // 環境音（雨・風・雷）。最初は止めておき、上のバーのボタンで出す（ブラウザの決まりで、操作のあとでないと鳴らせない）
  const sound = createAmbientSound();
  sound.setVolume(st.soundVolume);
  // 前回、音を出していたら続けて出す（ブラウザが許せば。許されなければボタンで出し直す）
  // 難しさ（出発の前に選ぶ。途中から再開したときは、そのときの難しさ。ユーザーの指定）
  const difficulty: Difficulty = resume?.difficulty ?? st.difficulty ?? 'normal';
  view.godView = difficulty !== 'hard';
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
        tt.beforePlay();
        loop.paused = false;
        refresh();
      },
      togglePause: () => {
        if (loop.paused) tt.beforePlay();
        loop.paused = !loop.paused;
        refresh();
      },
      setCamera: (m) => {
        cam = m;
        view.mode = m;
        bubbles.eyeOf = m === 'eye' ? (view.selected ?? world.climbers[0]?.id ?? null) : null;
        refresh();
      },
      setLayer: (n, on) => view.setLayer(n, on),
      setOverlay: (k) => view.overlay.set(k),
      jumpToChoice: (t) => tt.jumpToChoice(t),
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
      share: () => void url.share(),
      snap: () => simCap.snap(),
      record: () => simCap.toggleRecord(),
      quit: () => {
        if (!confirm(JA.ui.quitConfirm)) return;
        void save().then(() => app.go({ name: 'title' }));
      },
    },
    { god: view.godView, observe, timed, difficulty },
  );
  // ---- タイムライン（時間を戻す） ----
  const timeline = new Timeline(scenario.party.length > 6 ? 5 : 2);
  const tlBar = createTimelineBar({
    seek: (t) => tt.seekTo(t),
    latest: () => tt.seekTo(Infinity),
    seekChoice: (t) => tt.jumpToChoice(t),
    formatTime: (t) => formatDateTime(scenario, t).split(' ')[1] ?? '',
  });
  // 3D 画面を全面に敷き、ログ・登山者・気象は「合体できるタブ式のウィンドウ」として重ねる（狭い画面では最小化して始める）
  const narrow = window.innerWidth < 900;
  const sideW = Math.min(330, window.innerWidth - 16);
  /** ウィンドウの入れ物の場所（広い画面でタイムラインをこの後ろに戻す） */
  const dockHost = el('div', { class: 'dock-anchor', hidden: true });
  const dock = createDock(
    [
      { id: 'climbers', title: JA.ui.climbers, icon: 'groups', content: hud.climbersPane },
      { id: 'weather', title: JA.ui.weatherTab, icon: 'partlyCloudyDay', content: hud.weatherPane },
      { id: 'log', title: JA.ui.log, icon: 'listAlt', content: hud.logPane },
      // 狭い画面（スマホ）では、タイムラインもタブにして 1 つのウィンドウにまとめる（ユーザーの指定）
      { id: 'timeline', title: JA.ui.timeline, icon: 'history', content: tlBar.el, compactOnly: true },
    ],
    [
      { x: window.innerWidth - sideW - 12, y: 60, w: sideW, h: Math.round(window.innerHeight * 0.6), min: narrow, tabs: ['climbers', 'weather'], active: 'climbers' },
      { x: 12, y: Math.max(60, window.innerHeight - 460 - 96), w: Math.min(540, Math.round(window.innerWidth * 0.46)), h: Math.min(460, window.innerHeight - 160), min: narrow, tabs: ['log'], active: 'log' },
    ],
    // 上のバーの下からを置ける範囲にする（バーが 2 段に折り返しても隠れない）
    {
      topInset: () => (hud.top.isConnected ? hud.top.getBoundingClientRect().bottom : 0),
      // 狭い画面では、下のウィンドウをタイムラインのバーの上に置く
      bottomInset: () => (tlBar.el.isConnected ? window.innerHeight - tlBar.el.getBoundingClientRect().top + 6 : 96),
      // 広い画面では、タイムラインを画面の下のバーに戻す
      onCompactChange: (c) => {
        if (!c && tlBar.el.previousElementSibling !== dockHost) dockHost.after(tlBar.el);
      },
    },
  );
  const simMain = el('main', { class: 'sim' }, [stage, hud.top, dock.el, dockHost, ...(isCompactScreen() ? [] : [tlBar.el]), modalHost, el('p', { class: 'keyhelp' }, `${JA.ui.keyHelp} ・ ${versionLabel()}`)]);
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
    const ok = await saveResume({ scenarioId: scenario.id, world: structuredClone(world), recorder: structuredClone(recorder), choiceSnapshots: snapshots, log: hud.allLines(), savedAt: new Date().toISOString(), runId, parentRunId, conditions: loaded.conditions, speed: loop.speed, difficulty });
    if (!ok) toast(JA.ui.saveFailed);
  }

  // ---- URL の状況（リロード・共有で同じ場面から始められる。ユーザーの指定） ----
  /** URL の場面から進め直している間（音・吹き出しを出さない） */
  let replaying = false;
  const url = createUrlSync({ world, loaded, mode: playMode, skip: () => replaying, alive: () => simMain.isConnected, card: () => simCap.card() });
  /** いまの状況（場面リンクのカードに書く）: ログの大きな出来事と選んだことの、新しい 2 つ（分岐点が出た行・セリフは除く） */
  function situationLines(): string[] {
    return hud
      .importantLines()
      .filter((l) => l.jumpTo === undefined && l.kind !== 'speech' && l.kind !== 'thought')
      .slice(-2)
      .map((l) => l.text.replace(/^◆\s*/, ''));
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
      const se = replaying ? null : eventSound(e);
      if (se) audio().play(se.id, se.volume);
      // 見守るパーティが変わったら、そのリーダーを選んで追う
      if (e.type === 'FOCUS') focusGroup(String(e.data?.['group'] ?? ''));
      if (e.type === 'CHOICE_FIRED') {
        const id = String(e.data?.['cp'] ?? '');
        snapshots[id] = { world: structuredClone(world), recorder: structuredClone(recorder) };
        // 誰の判断か（ログの行に名前を出す。ユーザーの指定）
        if (world.pendingChoice) deciderByCp.set(id, deciderOf(world, choiceLeader(world, ctx)).def.name);
      }
      if (e.type === 'CHOICE_RESOLVED') {
        const cpId = String(e.data?.['cp'] ?? '');
        const label = optionLabel(loaded, cpId, String(e.data?.['option'] ?? ''));
        const by = e.data?.['by'];
        const who = deciderByCp.get(cpId) ?? choiceLeader(world, ctx).def.name;
        hud.log({ tMin: e.tMin, important: true, text: by === 'user' ? fill(JA.ui.chose, { who, label }) : otherChoiceBy ? fill(JA.ui.otherChose, { who, label }) : fill(observe ? JA.ui.autoChose : JA.ui.timeUp, { who, label }) });
        otherChoiceBy = null;
        continue;
      }
      const v = (e.type === 'SPEECH' || e.type === 'THOUGHT') && e.climberId ? speechView(e, scenario) : null;
      if (v && e.climberId && !replaying) bubbles.add(e.climberId, v, fast);
      let text = formatEvent(e, { scenario, nodeName });
      if (text && e.type === 'CHOICE_FIRED') {
        const who = deciderByCp.get(String(e.data?.['cp'] ?? ''));
        if (who) text = text.replace(/^◆\s*/, `◆ ${who}: `);
      }
      if (!text || (e.type === 'THOUGHT' && !hud.god)) continue;
      // そのときの状態（顔の下のメーターと詳細に使う）
      const cs = e.climberId ? world.climbers.find((x) => x.id === e.climberId) : undefined;
      const snap = cs ? snapOf(cs) : undefined;
      if (v) {
        // 吹き出しの中は文だけ。注記（記録・架空・ろれつ）は下に小さく
        const tag = v.log.replace(/^.*[」）]/, '');
        hud.log({ tMin: e.tMin, text, important: Boolean(e.important), climberId: e.climberId, kind: v.thought ? 'thought' : 'speech', bubble: v.thought ? v.display : v.display, tag, to: v.to ? (party.get(v.to)?.name ?? v.to) : undefined, shout: v.tone === 'shout', snap });
      } else {
        // 飲食の行は、3 人以上続いたら 1 行にまとめる（hud.log）
        const group = e.type === 'DRINK' ? 'drink' : e.type === 'EAT' ? 'eat' : undefined;
        const amount = e.type === 'DRINK' ? `${Math.round(Number(e.data?.['liters'] ?? 0) * 1000)} mL` : e.type === 'EAT' ? `${Math.round(Number(e.data?.['kcal'] ?? 0))} kcal` : undefined;
        hud.log({ tMin: e.tMin, text, important: Boolean(e.important), climberId: e.climberId, kind: e.climberId ? 'action' : 'system', snap, jumpTo: e.type === 'CHOICE_FIRED' ? e.tMin : undefined, group, amount });
      }
    }
  }

  function focusGroup(groupId: string): void {
    const leader = world.groups.find((g) => g.id === groupId)?.leader;
    if (!leader) return;
    view.selected = leader;
    view.lookAt(leader);
    if (view.mode === 'eye') bubbles.eyeOf = leader;
  }

  /** 分岐点ごとの、決める人の名前（出たときに覚え、選んだ行にも使う） */
  const deciderByCp = new Map<string, string>();
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
      recommend: difficulty === 'easy',
      timeoutSec: timed ? TIMED_SEC : null,
      onPick: (id) => {
        choiceUi = null;
        if (!world.pendingChoice) return;
        tt.truncateIfPast();
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
  let closeEndConfirm: (() => void) | null = null;
  function onEnded(): void {
    if (ended) return;
    ended = true;
    // 録画中なら止めて、動画を自動で保存する（ユーザーの指定）
    simCap.finishOnEnd();
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
      endingTitle: resolveEnding(world, ctx, recVars(recorder, world))?.title ?? undefined,
      deaths: world.climbers.filter((c) => !c.body.alive).length,
      partySize: world.climbers.length,
      durationMin: Math.round(world.tMin - (r.samples[0]?.t ?? world.tMin)),
      conditions: !!loaded.conditions,
    });
    countPlay(scenario.id);
    // 結末を確かめてから結果の画面へ（ユーザーの指定: いきなり飛ばない）。少し待って最後の場面を見せてから出す
    const end = resolveEnding(world, ctx, recVars(recorder, world));
    window.setTimeout(() => {
      if (!simMain.isConnected) return;
      closeEndConfirm = openEndConfirm({
        kind: world.ended!.kind,
        title: end?.title ?? JA.endings[world.ended!.kind]?.title ?? world.ended!.kind,
        text: end?.text ?? JA.endings[world.ended!.kind]?.text ?? '',
        time: formatDateTime(scenario, world.tMin),
        onGo: () => app.go({ name: 'ending', loaded, result: { world, recorder, choiceSnapshots: snapshots, runId, parentRunId, log: hud.allLines(), difficulty } }),
        // これまでの選択（分岐点の写しがあるもの）。選ぶとその場面に戻って選び直せる（ユーザーの指定）
        choices: world.decisions
          .filter((dc) => Object.values(snapshots).some((sn) => sn.world.pendingChoice && Math.abs(sn.world.tMin - dc.tMin) < 0.05))
          .map((dc) => ({
            time: formatDateTime(scenario, dc.tMin).split(' ')[1] ?? '',
            label: optionLabel(loaded, dc.cpId, dc.optionId),
            onPick: () => {
              closeEndConfirm = null;
              ended = false;
              tt.jumpToChoice(dc.tMin);
            },
          })),
      });
    }, 1200);
  }

  // ---- 難しさ: 体調が分かる人・見えている範囲のぼかし（ユーザーの指定） ----
  /** 自分たち（見守っているパーティのリーダー） */
  const ownLeader = (w: World): ClimberState => groupLeader(w, w.focusGroup ?? w.groups[0]?.id ?? null);
  // ハードでは、体調が分かるのはリーダーだけ
  /** まだ山にいる人（下山した・救助された・地図の外へ出た・亡くなった人は除く） */
  const onStage = (c: ClimberState): boolean => c.body.alive && !TERMINAL_STATES.has(c.state) && !c.offMap;
  /**
   * いま見守っている人: 選んでいる人。その人が退場した（下山・救助・地図の外）なら、見守るパーティのリーダー、
   * それもいなければ山にいるほかの人（ユーザーの指摘: s06 で下山した由美さんのまわりだけはっきり見えていた）
   */
  function watched(w: World): ClimberState {
    const sel = w.climbers.find((c) => c.id === view.selected);
    if (sel && onStage(sel)) return sel;
    const lead = ownLeader(w);
    if (onStage(lead)) return lead;
    return w.climbers.find(onStage) ?? sel ?? lead;
  }
  // ハードでは、体調が分かるのは見守っているグループのリーダーだけ
  if (difficulty === 'hard') hud.knows = (id) => groupLeader(world, watched(world).groupId).id === id;
  /** 選んでいた人が退場したら、山にいる人へ選び直す（カメラもそちらを追う）。1 回だけ */
  let autoSwitched: string | null = null;
  function switchFromExited(w: World): void {
    const sel = w.climbers.find((c) => c.id === view.selected);
    if (!sel || sel.state === 'DEAD' || onStage(sel) || autoSwitched === sel.id) return;
    const next = watched(w);
    if (next.id === sel.id) return;
    autoSwitched = sel.id;
    view.selected = next.id;
    view.lookAt(next.id);
  }
  /** 現在地が分からなくなってぼかしているか（ログに出したか） */
  let lostShown = false;
  /** 見える範囲（樹林帯の出入り・天気で、なめらかに変える） */
  let hardViewM: number | null = null;
  let hardViewAt = performance.now();
  function updateAreaBlur(w: World): void {
    if (difficulty === 'easy') {
      view.setAreaBlur(null);
      return;
    }
    // 中心は、いま追っている（選んでいる）人。パーティが分かれたとき、見守っているパーティのリーダーではなく、
    // 画面で追っている人のまわりと人形をぼかさない（ユーザーの指摘: s06 で一人で迷った健一さんまで全部ぼけた）
    const l = watched(w);
    // 道に迷ったと気づき、現在地が分からない（地図・GPS で確かめたら解く）
    const lost = l.body.alive && l.perception.awareLost && !l.perception.knowsPosition && !TERMINAL_STATES.has(l.state);
    const keepIds = w.climbers.filter((c) => c.id === l.id || (c.groupId !== null && c.groupId === l.groupId && c.body.alive)).map((c) => c.id);
    // 見える範囲: ハードはいつも（樹林帯・霧・雨や雪・夜）。ノーマルは悪天候（霧・雨や雪）のときだけ、ハードの 2 倍（ユーザーの指定）
    let target = VIEW_NONE_M;
    if (difficulty === 'hard') target = hardViewRangeM(ctx.map, l, w.sun.isDark);
    else if (l.local.visibilityM < BAD_WEATHER_VIS_M || l.local.precipMmH > BAD_WEATHER_PRECIP_MMH) target = hardViewRangeM(ctx.map, l, false) * NORMAL_VIEW_F;
    const now = performance.now();
    const a = Math.min(1, (now - hardViewAt) / 1000 / HARD_VIEW_EASE_SEC);
    hardViewAt = now;
    hardViewM = hardViewM === null ? target : hardViewM + (target - hardViewM) * a;
    const farM = hardViewM >= VIEW_NONE_AT_M ? null : hardViewM;
    const lostM = difficulty === 'hard' ? LOST_VIEW_M : LOST_VIEW_M * NORMAL_VIEW_F;
    view.setAreaBlur({ x: l.x, z: l.z, lost, lostM, farM, keepIds });
    if (lost !== lostShown && !replaying) {
      lostShown = lost;
      hud.log({ tMin: w.tMin, text: fill(lost ? JA.difficulty.lostBlurOn : JA.difficulty.lostBlurOff, { who: l.def.name, m: lostM }), important: true });
    }
  }

  // ---- ループ ----
  let lastFrame = performance.now();
  const frame = createFrameExtras({ view, sound, scenario, cam: () => cam, scriptMusic: () => scriptMusic, lowQuality: effectiveQuality(st) === 'low' });
  loop = new Loop(world, ctx, {
    render: (w, prev, alpha, t) => {
      tt.applySeek();
      view.gameSpeed = loop.paused || w.pendingChoice || w.ended ? 0 : SPEEDS[loop.speed] * DT_SEC;
      view.render(w, prev, alpha, t);
      simCap.afterRender();
      // タイムラインも 3D と同じく、前の刻みからの補間した時刻で滑らかに流す
      tlBar.setNow(prev ? w.tMin - (1 - alpha) * (DT_SEC / 60) : w.tMin);
      const now = performance.now();
      frame.update(w, now, now - lastFrame);
      const dt = loop.paused || w.pendingChoice ? 0 : (now - lastFrame) / 1000;
      lastFrame = now;
      const r = canvas.getBoundingClientRect();
      // 頭の上に顔アイコン。吹き出しはアイコンの左上に出し（アイコンが吹き出しの右に来る）、アイコンより手前に重ねる
      figIcons.update(w, (id) => view.headScreen(id, r.width, r.height), { god: hud.god, time: formatDateTime(scenario, w.tMin).split(' ')[1] ?? '', hidden: cam === 'eye', knows: hud.knows });
      // 退場した人の視点は残さない（難しさによらず）
      switchFromExited(w);
      updateAreaBlur(w);
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
    onUi: () => {
      refresh();
      skipHutNight();
    },
    shouldPause: (e) => {
      if (st.autoPause === 'choice') return false;
      if (st.autoPause === 'important') return IMPORTANT_PAUSE.has(e.type);
      return Boolean(e.important) && e.type !== 'CHOICE_FIRED' && e.type !== 'CHOICE_RESOLVED';
    },
  });
  // 山小屋に泊まることになったら、夜を飛ばして翌日 03:00 まで進める（ユーザーの指定）。1 晩に 1 回。
  // 分岐点が出た・結末になった・誰かが小屋を出たら、そこで止める
  const skippedNights = new Set<number>();
  function skipHutNight(): void {
    if (loop.paused || world.pendingChoice || world.ended || !world.sun.isDark) return;
    const active = world.climbers.filter((c) => c.body.alive && c.state !== 'FINISHED' && c.state !== 'RESCUED' && !c.offMap);
    if (active.length === 0 || !active.every((c) => c.state === 'SHELTERED' && c.body.shelterNodeId !== null)) return;
    const day = Math.floor((world.tMin - 180) / 1440);
    if (skippedNights.has(day)) return;
    skippedNights.add(day);
    const target = (day + 1) * 1440 + 180;
    if (target <= world.tMin) return;
    replaying = true;
    const startMin = world.tMin;
    for (let n = 0; n < 30 * 360 && world.tMin < target && !world.ended && !world.pendingChoice; n += 1) {
      stepWorld(world, ctx);
      const evs = ctx.events.splice(0);
      recordTick(recorder, world, ctx, evs, DT_SEC / 60);
      handleEvents(evs);
      timeline.capture(world, recorder);
      if (active.some((c) => c.state !== 'SHELTERED')) break;
    }
    replaying = false;
    timeline.capture(world, recorder, true);
    loop.reset(world);
    if (world.tMin > startMin) hud.log({ tMin: world.tMin, text: JA.ui.hutNightSkipped, important: true });
    if (world.pendingChoice) onChoice();
    if (world.ended) onEnded();
    refresh(true);
  }
  if (observe) loop.speed = 15;
  // 途中から再開したら、そのときの再生の速さに戻す（ユーザーの指定）
  else if (resume?.speed !== undefined && resume.speed !== 0) loop.speed = resume.speed;
  timeline.capture(world, recorder, true);
  if (st.sound) sound.setOn(true);
  hud.setSound(anySoundOn(st, true));


  const tt = createTimeTravel({
    world,
    recorder,
    ctx,
    loop: () => loop,
    timeline,
    snapshots,
    hud,
    closeChoice: () => {
      choiceUi?.close();
      choiceUi = null;
      shownCp = null;
    },
    refresh: (f) => refresh(f),
    onChoice: () => onChoice(),
  });

  let uiTick = 0;
  function refresh(force = false): void {
    hud.setState(world, loop.paused, loop.speed, cam);
    hud.setRecording(simCap.elapsed());
    pauseOverlay.hidden = !(loop.paused && !world.pendingChoice && !world.ended && !titleShowing && !choiceUi);
    tlBar.update(timeline.startMin, Math.max(timeline.endMin, world.tMin), world.tMin, hud.importantLines().map((l) => ({ tMin: l.tMin, text: l.text, choice: l.text.startsWith('◆') })));
    uiTick += 1;
    if (force || uiTick % 2 === 0) {
      hud.updatePanels(world, view.selected);
      view.setTrack(recorder.record.track);
      view.overlay.update(world, ctx);
    }
    if (!world.ended && performance.now() - lastSave > AUTOSAVE_MS) void save();
    url.write();
  }

  // ---- 入力 ----
  const onKey = createKeyHandler({
    blocked: () => choiceUi !== null,
    loop: () => loop,
    beforePlay: () => tt.beforePlay(),
    cycleCamera: () => {
      const order: CameraMode[] = ['overview', 'follow', 'eye'];
      cam = order[(order.indexOf(cam) + 1) % 3]!;
      view.mode = cam;
      bubbles.eyeOf = cam === 'eye' ? (view.selected ?? world.climbers[0]?.id ?? null) : null;
    },
    refresh: () => refresh(true),
  });
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
  /** これまでのあらすじの窓（途中の場面から始めたとき） */
  let closeSynopsis: (() => void) | null = null;
  if (replay) {
    replaying = true;
    const r = replayTo(world, ctx, replay, (evs, tick) => {
      recordTick(recorder, world, ctx, evs, tick ? DT_SEC / 60 : 0);
      handleEvents(evs);
      if (tick) timeline.capture(world, recorder);
    });
    replaying = false;
    timeline.capture(world, recorder, true);
    loop.reset(world);
    // 途中の場面から始めたので、ここまでのあらすじを出す（ユーザーの指定）。出来事が何もなければ出さない
    if (world.tMin > (recorder.record.samples[0]?.t ?? world.tMin) + 1) {
      closeSynopsis = openSynopsis({
        scenario,
        lines: hud.allLines(),
        climbers: world.climbers,
        time: (t) => formatDateTime(scenario, t),
        nowMin: world.tMin,
        onClose: () => {
          closeSynopsis = null;
        },
      });
    }
    // みんなの遭難記録の「この分岐から」（replay.cp がある）と、場面の URL とで知らせを変える
    const fromRecord = replay.cp !== undefined;
    const partial = fromRecord ? JA.ui.recordPartial : JA.ui.sharedPartial;
    hud.log({ tMin: world.tMin, text: r.complete ? (fromRecord ? JA.ui.recordOpened : JA.ui.sharedOpened) : partial, important: true });
    toast(r.complete ? (fromRecord ? JA.ui.recordOpenedToast : JA.ui.sharedOpenedToast) : partial, 5000);
  }
  // 途中から再開したとき、見守るパーティが変わっていれば、そのリーダーを選ぶ
  if (world.focusGroup) focusGroup(world.focusGroup);
  refresh(true);
  // 新しく始めたときは、題の札を出し、消えてから時間を進める（途中からの再開では出さない）
  let closeTitle: (() => void) | null = null;
  if (replay) loop.paused = true;
  else if (!resume) {
    loop.paused = true;
    titleShowing = true;
    closeTitle = showTitleCard(stage, scenario, world, ctx, () => {
      closeTitle = null;
      titleShowing = false;
      loop.paused = false;
      refresh(true);
    });
  }
  loop.start();
  // 開発時のデバッグ用（ブラウザのコンソールから参照）
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>)['__hk'] = { view, world, ctx, loop, recorder };
  // 再開時、回答待ちの分岐点があればすぐ出す
  if (world.pendingChoice) onChoice();
  // URL の場面が結末のあとなら、結末の画面へ
  if (replay && world.ended) onEnded();
  url.write(true);

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
    closeEndConfirm?.();
    closeSynopsis?.();
    simCap.dispose();
    closeLogDetail();
    tlBar.dispose();
    dock.dispose();
    view.dispose();
  };
}
