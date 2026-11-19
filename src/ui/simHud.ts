/**
 * シミュレーション画面の HUD（docs/11 §2）: 上部バー（時刻・速度・情報モード・カメラ・レイヤー・設定）、
 * 右の登山者パネル・気象パネル・予報、下のイベントログ。スマホ幅ではパネルを下のタブにまとめる。
 */
import { avatar } from './avatar';
import { icon } from './icons';
import { JA } from '../i18n/ja';
import { formatDateTime } from '../i18n/format';
import type { ClimberState, ScenarioDef, World } from '../sim/types';
import type { CameraMode } from '../view/sceneView';
import type { OverlayKind } from '../view/overlay';
import type { Speed } from '../app/loop';
import { el } from './dom';
import { climberCard, forecastPanel, weatherPanel } from './panels';

export interface HudHandlers {
  setSpeed(s: Speed): void;
  togglePause(): void;
  setGod(v: boolean): void;
  setCamera(m: CameraMode): void;
  setLayer(name: 'trail' | 'track' | 'cloud', on: boolean): void;
  setOverlay(k: OverlayKind): void;
  select(id: string): void;
  settings(): void;
  quit(): void;
}

export interface LogLine {
  tMin: number;
  /** 1 行の文（タイムラインの点の説明・検索用。表示はこれと下の項目から組み立てる） */
  text: string;
  important: boolean;
  climberId?: string;
  /** 表示の種類: セリフ（吹き出し）・心の声（点線の吹き出し）・行動（顔＋1 行）・全体の出来事（中央の帯） */
  kind?: 'speech' | 'thought' | 'action' | 'system';
  /** 吹き出しの中の文（セリフ・心の声） */
  bubble?: string;
  /** 吹き出しの下の注記（記録・架空・ろれつ など） */
  tag?: string;
  /** 話しかけた相手の名前 */
  to?: string;
  /** 叫び */
  shout?: boolean;
}

const SPEED_LIST: Speed[] = [1, 4, 15, 60];

export class Hud {
  readonly top: HTMLElement;
  /** 登山者のパネル */
  readonly climbersPane: HTMLElement;
  /** 気象のパネル（気象と予報） */
  readonly weatherPane: HTMLElement;
  readonly logEl: HTMLElement;
  private clock: HTMLElement;
  private speedBtns = new Map<Speed, HTMLButtonElement>();
  private pauseBtn: HTMLButtonElement;
  private godBtn: HTMLButtonElement;
  private camBtns = new Map<CameraMode, HTMLButtonElement>();
  private climbersEl: HTMLElement;
  private weatherEl: HTMLElement;
  private forecastEl: HTMLElement;
  private lines: LogLine[] = [];
  private sortByCore = false;
  /** 小さくしているカード（登山者の ID） */
  private collapsed = new Set<string>();
  private party = new Map<string, ScenarioDef['party'][number]>();
  god: boolean;

  constructor(
    private scenario: ScenarioDef,
    private h: HudHandlers,
    opts: { god: boolean; observe: boolean; timed: boolean },
  ) {
    this.god = opts.god;
    this.party = new Map(scenario.party.map((p) => [p.id, p]));
    this.clock = el('span', { class: 'clock', 'aria-live': 'off' });
    this.pauseBtn = el('button', { class: 'icon', title: `${JA.ui.pause} (Space)`, onclick: () => h.togglePause() }, icon('pause'));
    for (const s of SPEED_LIST) {
      const b = el('button', { class: 'speed', title: `×${s}`, onclick: () => h.setSpeed(s) }, `×${s}`);
      this.speedBtns.set(s, b);
    }
    this.godBtn = el('button', { class: 'toggle', title: 'G', onclick: () => h.setGod(!this.god) });
    const cams: [CameraMode, string][] = [['overview', JA.ui.camOverview], ['follow', JA.ui.camFollow], ['eye', JA.ui.camEye]];
    const camIcon = { overview: 'landscape', follow: 'myLocation', eye: 'directionsWalk' } as const;
    for (const [m, label] of cams) this.camBtns.set(m, el('button', { class: 'cam', onclick: () => h.setCamera(m) }, [icon(camIcon[m]), label]));
    const layerBox = (name: 'trail' | 'track' | 'cloud', label: string, on: boolean): HTMLElement => {
      const cb = el('input', { type: 'checkbox', checked: on, onchange: () => h.setLayer(name, cb.checked) });
      return el('label', {}, [cb, label]);
    };
    const ov = el('select', { 'aria-label': JA.ui.layers, onchange: () => h.setOverlay(ov.value as OverlayKind) }, [
      el('option', { value: 'none' }, '—'),
      el('option', { value: 'temp' }, JA.ui.layerTemp),
      el('option', { value: 'wind' }, JA.ui.layerWind),
      el('option', { value: 'radio' }, JA.ui.layerRadio),
      el('option', { value: 'hazard' }, JA.ui.layerHazard),
    ]);
    const layers = el('details', { class: 'layers' }, [
      el('summary', {}, [icon('layers'), JA.ui.layers]),
      el('div', { class: 'menu' }, [layerBox('trail', JA.ui.layerTrail, true), layerBox('track', JA.ui.layerTrack, true), layerBox('cloud', JA.ui.layerCloud, true), el('label', {}, [JA.ui.layerOverlay, ov])]),
    ]);
    const modeTag = opts.observe ? el('span', { class: 'tag' }, JA.settingsUi.observe) : opts.timed ? el('span', { class: 'tag' }, JA.settingsUi.timed) : null;
    this.top = el('header', { class: 'topbar' }, [
      el('button', { class: 'icon', title: JA.ui.quit, 'aria-label': JA.ui.quit, onclick: () => h.quit() }, icon('home')),
      el('strong', { class: 'title' }, scenario.title),
      el('span', { class: 'clockbox' }, [icon('schedule'), this.clock]),
      modeTag,
      el('div', { class: 'group speeds', role: 'group', 'aria-label': JA.ui.speed }, [this.pauseBtn, el('span', { class: 'grp-ic', title: JA.ui.speed }, icon('speed')), ...this.speedBtns.values()]),
      this.godBtn,
      el('div', { class: 'group cams', role: 'group', 'aria-label': JA.ui.camera }, [...this.camBtns.values()]),
      layers,
      el('button', { class: 'icon', title: JA.ui.settings, 'aria-label': JA.ui.settings, onclick: () => h.settings() }, icon('settings')),
    ]);
    this.climbersEl = el('div', { class: 'climbers' });
    this.weatherEl = el('div');
    this.forecastEl = el('div');
    const sortBtn = scenario.party.length > 6 ? el('button', { class: 'small', onclick: () => (this.sortByCore = !this.sortByCore) }, JA.ui.sortByCore) : null;
    this.climbersPane = el('div', { class: 'side' }, [sortBtn ? el('p', { class: 'tools' }, sortBtn) : null, this.climbersEl]);
    this.weatherPane = el('div', { class: 'side' }, [this.weatherEl, this.forecastEl]);
    // 人数が多いときは、小さいカード（名前・体力・スマホ）で始める
    if (scenario.party.length > 3) for (const p of scenario.party) this.collapsed.add(p.id);
    this.logEl = el('ol', { class: 'log', 'aria-label': JA.ui.log });
  }

  setState(world: World, paused: boolean, speed: Speed, cam: CameraMode): void {
    this.clock.textContent = formatDateTime(this.scenario, world.tMin);
    if (this.pauseBtn.dataset['p'] !== String(paused)) {
      this.pauseBtn.dataset['p'] = String(paused);
      this.pauseBtn.replaceChildren(icon(paused ? 'playArrow' : 'pause'));
    }
    this.pauseBtn.setAttribute('aria-label', paused ? JA.ui.play : JA.ui.pause);
    this.pauseBtn.title = `${paused ? JA.ui.play : JA.ui.pause} (Space)`;
    for (const [s, b] of this.speedBtns) b.classList.toggle('on', s === speed && !paused);
    for (const [m, b] of this.camBtns) b.classList.toggle('on', m === cam);
    if (this.godBtn.dataset['g'] !== String(this.god)) {
      this.godBtn.dataset['g'] = String(this.god);
      this.godBtn.replaceChildren(icon(this.god ? 'visibility' : 'hiking'), this.god ? JA.ui.godView : JA.ui.climberView);
    }
  }

  /** パネルの更新（4Hz） */
  updatePanels(world: World, selected: string | null): void {
    const sel = world.climbers.find((c) => c.id === selected) ?? world.climbers[0];
    const cards = (list: ClimberState[]): HTMLElement[] =>
      list.map((c) =>
        climberCard(c, this.god, c === sel, () => this.h.select(c.id), this.collapsed.has(c.id), () => {
          if (this.collapsed.has(c.id)) this.collapsed.delete(c.id);
          else this.collapsed.add(c.id);
          this.updatePanels(world, selected);
        }),
      );
    let list = world.climbers;
    if (this.sortByCore) list = [...list].sort((a, b) => a.body.coreC - b.body.coreC);
    if (world.climbers.length > 6) {
      // 大人数: グループごとの折りたたみ一覧（docs/11 §2.1）
      const open = new Set([...this.climbersEl.querySelectorAll('details[open]')].map((d) => (d as HTMLElement).dataset['g'] ?? ''));
      const groups = [...new Set(list.map((c) => c.groupId ?? ''))];
      this.climbersEl.replaceChildren(
        ...groups.map((g) => {
          const members = list.filter((c) => (c.groupId ?? '') === g);
          const worst = Math.min(...members.map((c) => c.body.coreC));
          const d = el('details', { 'data-g': g, open: open.size === 0 || open.has(g) }, [
            el('summary', {}, `${g === 'party' ? JA.ui.wholeParty : g}（${members.length}人・最低 ${worst.toFixed(1)}℃）`),
            ...cards(members),
          ]);
          return d;
        }),
      );
    } else {
      this.climbersEl.replaceChildren(...cards(list));
    }
    this.weatherEl.replaceChildren(weatherPanel(world, sel, this.god));
    // 予報のスパークラインは重いので 10 ゲーム分ごと
    if (!this.forecastEl.dataset['t'] || Math.abs(Number(this.forecastEl.dataset['t']) - world.tMin) >= 10 || this.forecastEl.dataset['g'] !== String(this.god)) {
      this.forecastEl.replaceChildren(forecastPanel(world, this.scenario, sel, this.god));
      this.forecastEl.dataset['t'] = String(world.tMin);
      this.forecastEl.dataset['g'] = String(this.god);
    }
  }

  /** 保存用: いまのログ（新しいほうから最大 400 行） */
  allLines(): LogLine[] {
    return this.lines.slice(-400);
  }

  /** タイムライン用: 重要な出来事の一覧 */
  importantLines(): readonly LogLine[] {
    return this.lines.filter((l) => l.important);
  }

  private cutoff: number | null = null;
  /** この時刻より後のログを隠す（過去を表示している間）。null で全部表示 */
  setCutoff(tMin: number | null): void {
    this.cutoff = tMin;
    for (const li of this.logEl.children) (li as HTMLElement).hidden = tMin !== null && Number((li as HTMLElement).dataset['t']) > tMin + 1e-6;
    const sc = this.logEl.parentElement ?? this.logEl;
    sc.scrollTop = sc.scrollHeight;
  }

  /** この時刻より後のログを消す（戻した先からやり直すとき） */
  truncate(tMin: number): void {
    this.lines = this.lines.filter((l) => l.tMin <= tMin + 1e-6);
    for (const li of [...this.logEl.children]) if (Number((li as HTMLElement).dataset['t']) > tMin + 1e-6) li.remove();
    this.lastSpeaker = null;
    this.setCutoff(null);
  }

  /** 直前の行の話し手（同じ人が続くときは顔と名前を省く。LINE のトーク画面と同じ） */
  private lastSpeaker: string | null = null;

  log(line: LogLine): void {
    this.lines.push(line);
    const time = formatDateTime(this.scenario, line.tMin).split(' ')[1] ?? '';
    const who = line.climberId ? this.party.get(line.climberId) : undefined;
    const kind = line.kind ?? (who ? 'action' : 'system');
    let li: HTMLElement;
    if (kind === 'system' || !who) {
      // 全体の出来事: 中央の帯
      this.lastSpeaker = null;
      li = el('li', { class: `sys${line.important ? ' imp' : ''}`, 'data-t': line.tMin }, el('span', { class: 'pill' }, [el('time', {}, time), line.text]));
    } else {
      const cont = this.lastSpeaker === who.id;
      this.lastSpeaker = who.id;
      const face = cont ? el('span', { class: 'face-gap' }) : avatar(who, 52);
      const name = cont ? null : el('div', { class: 'name' }, [el('span', { style: `color:${who.color}` }, who.name), line.to ? el('span', { class: 'to' }, ` → ${line.to}`) : null]);
      let body: HTMLElement;
      if (kind === 'speech' || kind === 'thought') {
        body = el('div', { class: 'msg' }, [
          el('div', { class: `bubble ${kind}${line.shout ? ' shout' : ''}${cont ? ' cont' : ''}` }, line.bubble ?? line.text),
          el('div', { class: 'meta' }, [line.tag ? el('span', { class: 'tag' }, line.tag) : null, el('time', {}, time)]),
        ]);
      } else {
        // 行動: 顔の横に 1 行（名前は文の中にあるので、見出しは出さない）
        body = el('div', { class: 'msg' }, [el('div', { class: `act${line.important ? ' imp' : ''}` }, [line.text, el('time', {}, time)])]);
      }
      li = el('li', { class: `who ${kind}${cont ? ' cont' : ''}`, 'data-t': line.tMin }, [face, el('div', { class: 'col' }, [kind === 'action' ? null : name, body])]);
      li.addEventListener('click', () => this.h.select(who.id));
    }
    if (this.cutoff !== null && line.tMin > this.cutoff + 1e-6) li.hidden = true;
    this.logEl.append(li);
    while (this.logEl.childElementCount > 300) this.logEl.firstElementChild?.remove();
    // ログはウィンドウの本体（親）がスクロールする
    const sc = this.logEl.parentElement ?? this.logEl;
    sc.scrollTop = sc.scrollHeight;
  }
}
