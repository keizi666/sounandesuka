/**
 * 画面ルーター（単純な状態機械。docs/03 §2）。
 * タイトル → シナリオ選択 → ブリーフィング → シミュレーション ⇄ 分岐点 → 結末 → 振り返り。
 * 開発用: ?scenario=<id> で直接シミュレーション画面を開く（&observe=1 で観察のみ、&debug=1 でデバッグパネル）。
 */
import { scrollMemory } from './scrollMemory';
import { decodeState, setAddress, STATE_PARAM, type SharedState } from './shareState';
import { applyConditions } from '../sim/scenario/startConditions';
import { JA } from '../i18n/ja';
import { loadEditorProject, loadEntry, loadIndex } from './data';
import { loadSettings, onSettingsSaved, saveSettings, type Settings } from './settings';
import { audio } from '../ui/audio';
import { detectQuality } from './quality';
import { showBriefing } from '../ui/briefing';
import { showDebrief } from '../ui/debrief';
import { showEnding } from '../ui/ending';
import { showHistory } from '../ui/history';
import { showCommunity } from '../ui/community/communityScreen';
import { showCommunityRun } from '../ui/community/communityDetail';
import { showScenarioSelect } from '../ui/scenarioSelect';
import { preloadView, showSimScreen, type SimResult } from '../ui/simScreen';
import { checkWebGL2, el, toast } from '../ui/dom';
import { nextPaint, progressTo, showLoading } from '../ui/loading';
import type { LoadedScenario } from './data';
import type { ResumeData } from './storage';

export interface AppContext {
  root: HTMLElement;
  settings: Settings;
  go(screen: Screen): void;
}

export type Screen =
  | { name: 'title' }
  | { name: 'select' }
  | { name: 'history' }
  | { name: 'community' }
  | { name: 'communityRun'; id: number }
  | { name: 'briefing'; loaded: LoadedScenario }
  | { name: 'sim'; loaded: LoadedScenario; resume?: ResumeData; observe?: boolean; replay?: SharedState }
  | { name: 'ending'; loaded: LoadedScenario; result: SimResult }
  | { name: 'debrief'; loaded: LoadedScenario; result: SimResult };

let cleanup: (() => void) | null = null;

export function startApp(root: HTMLElement): void {
  document.title = JA.app.title;
  if (!checkWebGL2()) {
    root.replaceChildren(el('div', { class: 'fatal' }, [el('h1', {}, JA.app.title), el('p', {}, JA.ui.noWebgl)]));
    return;
  }
  const settings = loadSettings();
  if (settings.detectedQuality === null) {
    settings.detectedQuality = detectQuality();
    saveSettings(settings);
  }
  document.documentElement.dataset['textSize'] = settings.textSize;
  const prefs = (s: Settings): void => audio().setPrefs({ se: s.se, seVolume: s.seVolume, music: s.music, musicVolume: s.musicVolume, track: s.musicTrack });
  prefs(settings);
  onSettingsSaved(prefs);
  const app: AppContext = {
    root,
    settings,
    go(screen) {
      navigate(screen, false);
    },
  };
  /**
   * 画面を切り替える。ブラウザの履歴は「トップ → いまの画面」の 2 段だけにし、戻るボタンでいつもトップへ戻る（ユーザーの指定）。
   * fromPop: ブラウザの戻る・進むから来たとき（履歴は動かさない）
   */
  let onTop = false;
  // スクロールの位置は自前で扱う（画面を切り替えたら上から。一覧に戻ったら、離れたときの位置へ）
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const navigate = (screen: Screen, fromPop: boolean): void => {
    const top = screen.name === 'title' || screen.name === 'select';
    if (onTop) scrollMemory.listY = window.scrollY;
    if (!fromPop) {
      if (top) history.replaceState({ hk: 'top' }, '');
      else if (onTop) history.pushState({ hk: screen.name }, '');
      else history.replaceState({ hk: screen.name }, '');
    }
    // 場面の URL（?scenario=…&st=…）は、シミュレーションと結末・振り返りの間だけ残す。一覧や説明の画面に移ったら消す
    if (screen.name !== 'sim' && screen.name !== 'ending' && screen.name !== 'debrief' && location.search !== '') setAddress(null);
    onTop = top;
    {
      cleanup?.();
      cleanup = null;
      root.replaceChildren();
      root.className = `screen-${screen.name}`;
      switch (screen.name) {
        case 'title':
        case 'select':
          cleanup = showScenarioSelect(app);
          break;
        case 'history':
          cleanup = showHistory(app);
          break;
        case 'community':
          cleanup = showCommunity(app);
          break;
        case 'communityRun':
          cleanup = showCommunityRun(app, screen.id);
          break;
        case 'briefing':
          cleanup = showBriefing(app, screen.loaded);
          break;
        case 'sim': {
          // 3D の山と森を作る間は画面が止まるので、先に読み込み中の表示を出してから作る
          const ld = showLoading(JA.ui.loadingTitle);
          ld.step(JA.ui.loadingScene, null);
          let gone = false;
          cleanup = () => {
            gone = true;
            ld.done();
          };
          void nextPaint().then(async () => {
            if (gone) return;
            // 前に作った 3D のデータ（キャッシュ）を読んでから作る
            const pre = await preloadView(app, screen.loaded).catch(() => undefined);
            if (gone) return;
            try {
              const c = showSimScreen(app, screen.loaded, screen.resume, screen.observe, screen.replay, pre);
              cleanup = c;
            } finally {
              void nextPaint().then(() => ld.done());
            }
          });
          break;
        }
        case 'ending':
          cleanup = showEnding(app, screen.loaded, screen.result);
          break;
        case 'debrief':
          cleanup = showDebrief(app, screen.loaded, screen.result);
          break;
      }
    }
    // シナリオの詳細などを開いたら、いちばん上から見せる（一覧で下へスクロールした位置を引き継がない。ユーザーの指定）。
    // 一覧は、カードを並べ終えてから覚えた位置へ戻す（scenarioSelect）
    window.scrollTo(0, 0);
  };
  // ブラウザの戻る（・進む）: どの画面からでもトップへ
  window.addEventListener('popstate', () => {
    if (onTop) {
      history.replaceState({ hk: 'top' }, '');
      return;
    }
    navigate({ name: 'select' }, true);
    history.replaceState({ hk: 'top' }, '');
  });
  const params = new URLSearchParams(location.search);
  const bundleRef = params.get('bundle');
  if (bundleRef?.startsWith('editor:')) {
    root.replaceChildren(el('p', { class: 'loading' }, JA.ui.loading));
    void loadEditorProject(bundleRef.slice(7))
      .then((loaded) => app.go({ name: 'briefing', loaded }))
      .catch((e: unknown) => root.replaceChildren(el('div', { class: 'fatal' }, [el('h1', {}, JA.app.title), el('p', { class: 'error' }, String(e)), el('a', { href: location.pathname }, JA.ui.toTitle)])));
    return;
  }
  const direct = params.get('scenario');
  if (direct) {
    root.replaceChildren(el('p', { class: 'loading' }, JA.ui.loading));
    void loadIndex()
      .then((idx) => {
        const e = idx.find((x) => x.id === direct) ?? { id: direct, file: `${direct}.json`, title: direct, theme: 'mixed' as const, difficulty: 1 as const, season: 'autumn' as const, estMinutes: 0 };
        return loadEntry(e, progressTo(showLoading(JA.ui.loadingTitle), { data: JA.ui.loadingData, terrain: JA.ui.loadingTerrain }));
      })
      .then(async (loaded0) => {
        const listed = (await loadIndex()).some((x) => x.id === direct);
        const loaded: LoadedScenario = { ...loaded0, listed };
        // 場面の URL（リロード・共有）: 同じ条件・同じ選択で進め直して、その場面から始める
        const stText = params.get(STATE_PARAM);
        const shared = stText ? await decodeState(stText) : null;
        if (stText && !shared) toast(JA.ui.sharedBroken, 5000);
        if (shared) {
          const l = shared.cond ? { ...loaded, scenario: applyConditions(loaded.scenario, shared.cond), conditions: shared.cond } : loaded;
          app.go({ name: 'sim', loaded: l, replay: shared });
        } else app.go({ name: 'sim', loaded, observe: params.get('observe') === '1' });
      })
      .catch((e: unknown) => root.replaceChildren(el('div', { class: 'fatal' }, [el('h1', {}, JA.app.title), el('p', { class: 'error' }, String(e)), el('a', { href: location.pathname }, JA.ui.toTitle)])));
    return;
  }
  app.go({ name: 'title' });
}
