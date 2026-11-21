/**
 * エディター本体（docs/15 §2）: 上部バー（保存状態・Undo/Redo・検証・試走・3D で遊ぶ・書き出し）、左の縦タブ、
 * 中央の 2D 地図（3D プレビューに切替）、右のインスペクタ、下部パネル。変更から 2 秒後に IndexedDB へ自動保存。
 */
import type { HeadlessResult } from '../sim/headless';
import { validateScenario, type Issue } from '../sim/scenario/validate';
import { buildHeights, buildMapRuntime } from '../sim/terrain/map';
import type { EditorProject, MapRuntime } from '../sim/types';
import { el, toast } from '../ui/dom';
import { nextPaint, showLoading } from '../ui/loading';
import type { Ed, SelKind, TabId } from './context';
import { createLayers, overlayLegend, type LayerState, type OverlayKind } from './map/layers';
import { TileMapView } from './map/TileMapView';
import { PANELS } from './panels';
import { openPreview3d, type Preview3d } from './preview3d';
import { putProject } from './store/idb';
import { hasTerrain, mapWithHeights } from './store/project';
import { validateEditor } from './validateMap';
import { showIssuesDialog } from './issuesDialog';
import { wizardBar } from './wizard';
import { exportBundle, playIn3d } from './panels/exportActions';

const UNDO_MAX = 50;
const AUTOSAVE_MS = 2000;

interface Snapshot {
  label: string;
  json: string;
}

export class EditorApp implements Ed {
  readonly root: HTMLElement;
  readonly view: TileMapView;
  readonly inspector: HTMLElement;
  readonly bottom: HTMLElement;
  lastRun: HeadlessResult | null = null;
  cursorMin = 0;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private rt: MapRuntime | null = null;
  private rtVersion = 0;
  private builtVersion = -1;
  private heightCache: { key: string; heights: Float32Array } | null = null;
  private saveTimer = 0;
  private status: HTMLElement;
  private issueBtn: HTMLButtonElement;
  private tabs = new Map<TabId, HTMLButtonElement>();
  private layerState: LayerState = { overlay: 'none', paint: null, showSteep: false };
  private preview: Preview3d | null = null;
  private center: HTMLElement;
  private cachedIssues: Issue[] | null = null;
  private actionBtns: HTMLButtonElement[] = [];
  private wizardEl: HTMLElement | null = null;

  constructor(
    host: HTMLElement,
    public p: EditorProject,
    private onClose: () => void,
  ) {
    this.status = el('span', { class: 'ed-status' }, '保存済み');
    this.issueBtn = el('button', { class: 'ed-issues', onclick: () => this.showIssues() });
    const undo = el('button', { title: '元に戻す（Ctrl+Z）', onclick: () => this.undo() }, '↶');
    const redo = el('button', { title: 'やり直す（Ctrl+Y）', onclick: () => this.redo() }, '↷');
    const test = el('button', { onclick: () => this.goTab('test') }, '試走');
    const play = el('button', { onclick: () => void playIn3d(this) }, '3D で遊ぶ');
    const exp = el('button', { class: 'primary', onclick: () => void exportBundle(this) }, '書き出し');
    this.actionBtns = [test, play, exp];
    const name = el('input', { class: 'ed-name', value: p.name });
    name.addEventListener('change', () => this.change('名前', () => (this.p.name = name.value)));
    const top = el('header', { class: 'ed-top' }, [
      el('button', { title: 'プロジェクト一覧', onclick: () => void this.save().then(onClose) }, '≡'),
      name,
      this.status,
      undo,
      redo,
      this.issueBtn,
      el('span', { class: 'spacer' }),
      el('button', { onclick: () => this.toggle3d() }, '2D / 3D'),
      test,
      play,
      exp,
    ]);
    const side = el('nav', { class: 'ed-tabs' }, PANELS.map((pn, i) => {
      const b = el('button', { onclick: () => this.goTab(pn.id), title: pn.label }, [el('b', {}, pn.id === 'json' ? '{ }' : pn.id === 'ai' ? 'AI' : String(i + 1)), el('small', {}, pn.id === 'ai' ? 'プロンプト' : pn.label)]);
      this.tabs.set(pn.id, b);
      return b;
    }));
    this.center = el('div', { class: 'ed-center' });
    this.view = new TileMapView(this.center);
    this.inspector = el('aside', { class: 'ed-inspector' });
    this.bottom = el('section', { class: 'ed-bottom' });
    this.root = el('div', { class: 'editor' }, [top, side, el('div', { class: 'ed-main' }, [this.center, this.bottom]), this.inspector]);
    host.replaceChildren(this.root);
    const geo = p.map.geo;
    if (geo) {
      this.view.lat0 = geo.centerLat;
      this.view.lon0 = geo.centerLon;
      const mv = p.editorState.mapView;
      this.view.setView(mv.lat || geo.centerLat, mv.lon || geo.centerLon, mv.zoom || 13);
    } else {
      // 架空の山: タイルを使わず、仮の原点で表示する
      this.view.offline = true;
      this.view.lat0 = 36;
      this.view.lon0 = 138;
      this.view.setView(36, 138, 13);
      setTimeout(() => this.view.fitArea(p.map.size), 0);
    }
    this.view.onView = () => {
      this.p.editorState.mapView = { lat: this.view.lat, lon: this.view.lon, zoom: this.view.zoom };
    };
    this.view.layers = createLayers(this, this.layerState);
    document.addEventListener('keydown', this.onKey);
    this.goTab(p.editorState.tab);
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKey);
    this.preview?.dispose();
  }

  private paletteEl: HTMLElement | null = null;
  private paletteKeys = new Map<string, () => void>();
  setToolPalette(p: HTMLElement | null, keys: Map<string, () => void> = new Map()): void {
    this.paletteEl?.remove();
    this.paletteEl = p;
    this.paletteKeys = keys;
    if (p) this.center.append(p);
  }

  private onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement).closest('input,textarea,select')) return;
    // 道具のショートカット（修飾キーなしの 1 文字）
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      const f = this.paletteKeys.get(e.key.toLowerCase());
      if (f) {
        f();
        e.preventDefault();
        return;
      }
    }
    const pn = PANELS.find((x) => x.id === this.p.editorState.tab);
    if (pn?.key?.(this, e)) {
      e.preventDefault();
      return;
    }
    if (e.ctrlKey && e.key === 'z') {
      this.undo();
      e.preventDefault();
    } else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
      this.redo();
      e.preventDefault();
    }
  };

  // ---- 実行時データ ----
  runtime(): MapRuntime | null {
    if (this.builtVersion === this.rtVersion) return this.rt;
    this.builtVersion = this.rtVersion;
    if (!hasTerrain(this.p)) {
      this.rt = null;
      return null;
    }
    try {
      const def = mapWithHeights(this.p);
      // 手続き地形の高さは地形の定義が変わらない限り使い回す
      let heights: Float32Array | undefined;
      if (def.terrain.type !== 'heightmap') {
        const key = JSON.stringify(def.terrain) + def.resolution + def.size;
        if (this.heightCache?.key !== key) this.heightCache = { key, heights: buildHeights(def).heights };
        heights = this.heightCache.heights;
      }
      const old = this.rt;
      this.rt = buildMapRuntime(def, { radio: false, heights }).map;
      if (old && old.n === this.rt.n && JSON.stringify(old.def.radio) === JSON.stringify(def.radio) && old.radio.some((v) => v > 0)) this.rt.radio = old.radio;
      else this.computeRadio(def, this.rtVersion);
    } catch (e) {
      this.rt = null;
      this.toast(`マップを作れませんでした: ${String(e)}`, 6000);
    }
    return this.rt;
  }

  private computeRadio(def: ReturnType<typeof mapWithHeights>, version: number): void {
    const w = new Worker(new URL('../workers/coverage.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<{ radio: Float32Array }>) => {
      w.terminate();
      if (this.rtVersion === version && this.rt) {
        this.rt.radio = ev.data.radio;
        this.refresh();
      }
    };
    w.postMessage({ def });
  }

  // ---- 変更・Undo ----
  private snapshot(label: string): Snapshot {
    const { map, scenario, editorState } = this.p;
    return { label, json: JSON.stringify({ map, scenario, draft: editorState.draftEdgeIds, probes: editorState.probePoints }) };
  }

  private restore(s: Snapshot): void {
    const d = JSON.parse(s.json) as { map: EditorProject['map']; scenario: EditorProject['scenario']; draft: string[]; probes: EditorProject['editorState']['probePoints'] };
    this.p.map = d.map;
    this.p.scenario = d.scenario;
    this.p.editorState.draftEdgeIds = d.draft;
    this.p.editorState.probePoints = d.probes;
    this.rtVersion += 1;
    this.dirty();
    this.refresh();
  }

  change(label: string, mutate: () => void, mapChanged = false): void {
    this.undoStack.push(this.snapshot(label));
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack = [];
    mutate();
    if (mapChanged) this.rtVersion += 1;
    this.dirty();
    this.refresh();
  }

  checkpoint(label: string): void {
    this.undoStack.push(this.snapshot(label));
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack = [];
  }

  touched(mapChanged: boolean): void {
    if (mapChanged) this.rtVersion += 1;
    this.dirty();
    this.refresh();
  }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot(s.label));
    this.restore(s);
    this.toast(`元に戻しました: ${s.label}`);
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot(s.label));
    this.restore(s);
  }

  /** 地形（高さ）の差し替えなど、Undo の対象外の変更 */
  mapReplaced(): void {
    this.rtVersion += 1;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty();
    this.refresh();
  }

  private dirty(): void {
    this.cachedIssues = null;
    this.status.textContent = '未保存';
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), AUTOSAVE_MS);
  }

  async save(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.p.updatedAt = new Date().toISOString();
    try {
      await putProject(this.p);
      this.status.textContent = '保存済み';
    } catch (e) {
      this.status.textContent = '保存できませんでした';
      this.toast(String(e), 6000);
    }
  }

  // ---- 表示 ----
  refresh(): void {
    this.cachedIssues = null;
    const iss = this.issues();
    const nErr = iss.filter((i) => i.level === 'error').length;
    const nWarn = iss.length - nErr;
    this.issueBtn.textContent = `検証: ⚠${nWarn} ✖${nErr}`;
    this.issueBtn.classList.toggle('has-error', nErr > 0);
    for (const b of this.actionBtns) b.disabled = nErr > 0;
    const pn = PANELS.find((x) => x.id === this.p.editorState.tab)!;
    // 道具パレットは、パネルが描くときに置き直す（道具のないタブでは消える）
    this.setToolPalette(null);
    pn.render(this);
    // はじめての流れ（次にやること）
    this.wizardEl?.remove();
    this.wizardEl = wizardBar(this);
    if (this.wizardEl) this.center.append(this.wizardEl);
    this.view.tool = pn.tool?.(this) ?? null;
    this.view.setCursor(this.view.tool?.cursor ?? 'grab');
    this.view.redraw();
  }

  issues(): Issue[] {
    if (this.cachedIssues) return this.cachedIssues;
    let list: Issue[] = [];
    try {
      list = validateScenario(this.p.scenario, this.p.map);
    } catch (e) {
      list = [{ level: 'error', path: 'scenario', code: 'exception', message: String(e) }];
    }
    this.cachedIssues = [...validateEditor(this.p, this.builtVersion === this.rtVersion ? this.rt : null), ...list];
    return this.cachedIssues;
  }

  private showIssues(): void {
    showIssuesDialog(this);
  }

  select(kind: SelKind, id: string | null): void {
    this.p.editorState.selection = { kind, id };
    this.refresh();
  }

  goTab(t: TabId): void {
    // もとの「地点」のタブは「登山道と地点」に統合した（ユーザーの指定）。保存したプロジェクトや検証の「そのタブへ」から来ても登山道と地点へ
    if (t === 'points') t = 'trails';
    this.p.editorState.tab = t;
    for (const [k, b] of this.tabs) b.classList.toggle('on', k === t);
    this.bottom.replaceChildren();
    this.inspector.replaceChildren();
    this.refresh();
  }

  setLastRun(r: HeadlessResult | null): void {
    this.lastRun = r;
    this.view.redraw();
  }

  setOverlay(kind: OverlayKind, paint: 'veg' | 'radio' | null = null): void {
    this.layerState.overlay = kind;
    this.layerState.paint = paint;
    this.view.redraw();
    this.renderLegend();
  }

  /** 重ね表示の凡例（地図の左下）。重ね表示がなければ消す */
  private legendEl: HTMLElement | null = null;
  private renderLegend(): void {
    const lg = overlayLegend(this.layerState.overlay, this.layerState.paint !== null);
    if (!lg) {
      this.legendEl?.remove();
      this.legendEl = null;
      return;
    }
    const box = el('div', { class: 'map-legend', 'aria-label': `凡例: ${lg.title}` }, [
      el('strong', {}, lg.title),
      ...lg.items.map(([c, label]) => el('div', { class: 'lg-row' }, [el('span', { class: 'lg-sw', style: `background:${c}` }), label])),
      lg.gradient ? el('div', { class: 'lg-grad', style: `background:linear-gradient(to right, ${lg.gradient[0]}, ${lg.gradient[1]})` }) : null,
      lg.gradient ? el('div', { class: 'lg-note' }, lg.gradient[2]) : null,
      lg.note ? el('div', { class: 'lg-note' }, lg.note) : null,
    ].filter((x): x is HTMLElement => x !== null));
    if (this.legendEl) this.legendEl.replaceWith(box);
    else this.view.root.append(box);
    this.legendEl = box;
  }

  setShowSteep(on: boolean): void {
    this.layerState.showSteep = on;
    this.view.redraw();
  }

  /** 3D を作っている最中（ボタンの連打で二重に作らない） */
  private building3d = false;

  toggle3d(on?: boolean): void {
    if (this.building3d) return;
    const want = on ?? !this.preview;
    this.preview?.dispose();
    this.preview = null;
    if (!want) return;
    const m = this.runtime();
    if (!m) {
      this.toast('まだ地形がありません');
      return;
    }
    // 3D の箱庭（地形・森・建物）を作るあいだはメインスレッドが止まるので、先に読み込み中の表示を出して描かせる
    this.building3d = true;
    const ld = showLoading('3D の箱庭を作っています');
    ld.step(`地形・森・建物を作っています…（${this.p.map.urban ? `建物 ${this.p.map.urban.buildings.length.toLocaleString('ja-JP')} 棟、` : ''}数秒かかることがあります）`, null);
    void nextPaint()
      .then(() => {
        this.preview = openPreview3d(this.center, m, this.p.scenario, 'mid', this.p.map.geo ? 1.3 : 1);
        ld.step('描いています…', 0.95);
        return nextPaint();
      })
      .catch((e: unknown) => this.toast(`3D を作れませんでした: ${String(e)}`, 6000))
      .finally(() => {
        this.building3d = false;
        ld.done();
      });
  }

  toast(msg: string, ms = 3000): void {
    toast(msg, ms);
  }
}
