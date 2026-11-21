/**
 * シミュレーション画面の HUD（docs/11 §2）: 上部バー（時刻・速度・情報モード・カメラ・レイヤー・設定）、
 * 右の登山者パネル・気象パネル・予報、下のイベントログ。スマホ幅ではパネルを下のタブにまとめる。
 */
import { closeLogDetail, openLogDetail, snapGauges, type LogSnap } from './logDetail';
import { avatar } from './avatar';
import { icon } from './icons';
import { JA } from '../i18n/ja';
import { fill, formatDateTime } from '../i18n/format';
import type { ClimberState, ScenarioDef, World } from '../sim/types';
import type { CameraMode } from '../view/sceneView';
import type { OverlayKind } from '../view/overlay';
import type { Speed } from '../app/loop';
import { el } from './dom';
import { climberCard, forecastPanel, weatherPanel } from './panels';
import type { Difficulty } from '../app/settings';

export interface HudHandlers {
  /** 環境音の入／切 */
  sound(): void;
  setSpeed(s: Speed): void;
  togglePause(): void;
  setCamera(m: CameraMode): void;
  setLayer(name: 'trail' | 'track' | 'cloud', on: boolean): void;
  setOverlay(k: OverlayKind): void;
  select(id: string): void;
  settings(): void;
  /** いまの場面の URL をコピーする（共有） */
  share?(): void;
  /** スクリーンショット・録画（ユーザーの指定） */
  snap?(): void;
  record?(): void;
  quit(): void;
  /** 分岐点の場面へ戻る（ログの「この場面へ」） */
  jumpToChoice?(tMin: number): void;
}

/**
 * 登山者の一覧のグループの見出し（ユーザーの指摘: gsolo・solo_kD などの英語の ID が出ていた）。
 * パーティ全体は「パーティ」、ほかはリーダーを先にしたメンバーの名前（多ければ「ほか n 人」）
 */
function groupLabel(world: World, g: string, members: readonly ClimberState[]): string {
  if (g === 'party' || g === '') return JA.ui.wholeParty;
  const leaderId = world.groups.find((x) => x.id === g)?.leader;
  const names = [...members].sort((a, b) => Number(b.id === leaderId) - Number(a.id === leaderId)).map((c) => c.def.name);
  return names.length <= 3 ? names.join('・') : fill(JA.ui.groupMore, { names: names.slice(0, 2).join('・'), n: names.length - 2 });
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
  /** そのときの登山者の状態（顔の下のメーターと、詳細のポップアップに使う） */
  snap?: LogSnap;
  /** 分岐点の行: この時刻の場面へ戻れる */
  jumpTo?: number;
  /** 飲食の行（3 人以上続いたら 1 行にまとめる。ユーザーの指定）と、その量の文 */
  group?: 'drink' | 'eat';
  amount?: string;
}

/** まとめる飲食の行が続いているとみなす時間（分） */
const GROUP_GAP_MIN = 15;
/** この人数からまとめる */
const GROUP_MIN = 3;

const SPEED_LIST: Speed[] = [1, 4, 15, 60];
/** 上のバーをたたんでいるか（狭い画面） */
const TOPBAR_FOLD_KEY = 'hks.v1.topbarFolded';

export class Hud {
  readonly top: HTMLElement;
  /** 登山者のパネル */
  readonly climbersPane: HTMLElement;
  /** 気象のパネル（気象と予報） */
  readonly weatherPane: HTMLElement;
  readonly logEl: HTMLElement;
  /** ログのパネルの中身（流れるログと、下の帯） */
  readonly logPane: HTMLElement;
  /** ログの下の帯: 行動時間・移動距離・累計標高 */
  private tripEl: HTMLElement;
  private clock: HTMLElement;
  /** 再生の速さ（ドロップダウン。ユーザーの指定） */
  private speedSel: HTMLSelectElement;
  private pauseBtn: HTMLButtonElement;
  private godBtn: HTMLElement;
  /** 追従 ⇄ 俯瞰を切り替える 1 つのボタン（ユーザーの指定。一人称は C キー） */
  private povBtn: HTMLButtonElement;
  private cam: CameraMode = 'follow';
  private climbersEl: HTMLElement;
  private weatherEl: HTMLElement;
  private forecastEl: HTMLElement;
  private lines: LogLine[] = [];
  private sortByCore = false;
  readonly soundBtn: HTMLButtonElement;
  readonly recBtn: HTMLButtonElement;
  /** 小さくしているカード（登山者の ID） */
  private collapsed = new Set<string>();
  private party = new Map<string, ScenarioDef['party'][number]>();
  god: boolean;
  /** 体調が分かる人か（ハードではリーダーだけ。ユーザーの指定） */
  knows: (id: string) => boolean = () => true;

  constructor(
    private scenario: ScenarioDef,
    private h: HudHandlers,
    opts: { god: boolean; observe: boolean; timed: boolean; difficulty: Difficulty },
  ) {
    this.god = opts.god;
    this.soundBtn = el('button', { class: 'icon', title: JA.ui.soundOn, 'aria-label': JA.ui.soundOn, onclick: () => h.sound() }, icon('volumeOff'));
    this.recBtn = el('button', { class: 'icon rec-btn', title: JA.capture.record, 'aria-label': JA.capture.record, onclick: () => h.record?.() }, icon('videocam'));
    this.party = new Map(scenario.party.map((p) => [p.id, p]));
    this.clock = el('span', { class: 'clock', 'aria-live': 'off' });
    this.pauseBtn = el('button', { class: 'icon', title: `${JA.ui.pause} (Space)`, onclick: () => h.togglePause() }, icon('pause'));
    this.speedSel = el('select', { class: 'speed-sel', title: `${JA.ui.speed}（1〜4）`, 'aria-label': JA.ui.speed }, SPEED_LIST.map((s) => el('option', { value: String(s) }, `×${s}`))) as HTMLSelectElement;
    this.speedSel.addEventListener('change', () => h.setSpeed(Number(this.speedSel.value) as Speed));
    // 神の視点のボタンは廃止し、出発の前に選んだ難しさを札で出す（ユーザーの指定）
    this.godBtn = el('span', { class: `df-tag df-${opts.difficulty}`, title: JA.difficulty.note[opts.difficulty] }, [icon('visibility'), JA.difficulty.label[opts.difficulty]]);
    // カメラ: 「追従」と、俯瞰 ⇄ FPV（一人称）の切り替えボタン（ユーザーの指定）。押すたびに俯瞰と FPV が替わる
    this.povBtn = el('button', { class: 'cam pov', title: `${JA.ui.camFollow} / ${JA.ui.camOverview}（C キーで一人称も）`, onclick: () => h.setCamera(this.cam === 'follow' ? 'overview' : 'follow') });
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
    // 狭い画面では、上のバーをたためる（ホーム・時刻・再生だけを残す。ユーザーの指定）
    const foldBtn = el('button', { class: 'icon tb-fold', type: 'button' });
    const paintFold = (): void => {
      const folded = this.top.classList.contains('folded');
      foldBtn.replaceChildren(icon(folded ? 'keyboardArrowDown' : 'keyboardArrowUp'));
      foldBtn.title = folded ? JA.ui.topbarExpand : JA.ui.topbarFold;
      foldBtn.setAttribute('aria-label', foldBtn.title);
      foldBtn.setAttribute('aria-expanded', String(!folded));
    };
    foldBtn.addEventListener('click', () => {
      const folded = this.top.classList.toggle('folded');
      try {
        localStorage.setItem(TOPBAR_FOLD_KEY, folded ? '1' : '0');
      } catch {
        // 覚えられなくても続ける
      }
      paintFold();
      // 上のバーの高さが変わったので、パネルを並べ直す
      window.dispatchEvent(new Event('resize'));
    });
    this.top = el('header', { class: 'topbar' }, [
      el('button', { class: 'icon', title: JA.ui.quit, 'aria-label': JA.ui.quit, onclick: () => h.quit() }, icon('home')),
      el('strong', { class: 'title' }, scenario.title),
      // 難しさはタイトルのすぐ右（ユーザーの指定）
      this.godBtn,
      el('span', { class: 'clockbox' }, [icon('schedule'), this.clock]),
      modeTag,
      el('div', { class: 'group speeds', role: 'group', 'aria-label': JA.ui.speed }, [this.pauseBtn, el('span', { class: 'grp-ic', title: JA.ui.speed }, icon('speed')), this.speedSel]),
      el('div', { class: 'group cams', role: 'group', 'aria-label': JA.ui.camera }, [this.povBtn]),
      layers,
      this.soundBtn,
      h.snap ? el('button', { class: 'icon', title: JA.capture.snap, 'aria-label': JA.capture.snap, onclick: () => h.snap?.() }, icon('photoCamera')) : null,
      h.record ? this.recBtn : null,
      h.share ? el('button', { class: 'icon', title: JA.ui.share, 'aria-label': JA.ui.share, onclick: () => h.share?.() }, icon('link')) : null,
      el('button', { class: 'icon', title: JA.ui.settings, 'aria-label': JA.ui.settings, onclick: () => h.settings() }, icon('settings')),
      foldBtn,
    ]);
    try {
      if (localStorage.getItem(TOPBAR_FOLD_KEY) === '1') this.top.classList.add('folded');
    } catch {
      // 読めなくても続ける
    }
    paintFold();
    this.climbersEl = el('div', { class: 'climbers' });
    this.weatherEl = el('div');
    this.forecastEl = el('div');
    const sortBtn = scenario.party.length > 6 ? el('button', { class: 'small', onclick: () => (this.sortByCore = !this.sortByCore) }, JA.ui.sortByCore) : null;
    this.climbersPane = el('div', { class: 'side' }, [sortBtn ? el('p', { class: 'tools' }, sortBtn) : null, this.climbersEl]);
    this.weatherPane = el('div', { class: 'side' }, [this.weatherEl, this.forecastEl]);
    // 人数が多いときは、小さいカード（名前・体力・スマホ）で始める
    if (scenario.party.length > 3) for (const p of scenario.party) this.collapsed.add(p.id);
    this.logEl = el('ol', { class: 'log', 'aria-label': JA.ui.log });
    this.tripEl = el('div', { class: 'trip-banner', 'aria-live': 'off' });
    // ログを過去へスクロールしたら、新しい行が来ても下へ送らない。下に「最新を表示」を出す（ユーザーの指定）
    this.logScroll = el('div', { class: 'logscroll' }, this.logEl);
    this.latestBtn = el('button', { class: 'log-latest', type: 'button', hidden: true, onclick: () => this.followLog(true) }, [icon('keyboardArrowDown'), JA.ui.logLatest]);
    this.logScroll.addEventListener('scroll', () => {
      const sc = this.logScroll;
      this.stickLog = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 24;
      if (this.stickLog) this.latestBtn.hidden = true;
    });
    this.logPane = el('div', { class: 'logpane' }, [this.logScroll, this.latestBtn, this.tripEl]);
  }

  private readonly logScroll: HTMLElement;
  private readonly latestBtn: HTMLButtonElement;
  /** ログをいちばん下に合わせ続けるか（過去へスクロールしたら false） */
  private stickLog = true;

  /** 新しい行のあと: 下に合わせているときだけ下へ送る。過去を見ているあいだは位置を保ち、「最新を表示」を出す。force で下へ */
  private followLog(force = false): void {
    const sc = this.logScroll;
    if (force) this.stickLog = true;
    if (this.stickLog) {
      sc.scrollTop = sc.scrollHeight;
      this.latestBtn.hidden = true;
    } else this.latestBtn.hidden = false;
  }

  /** ログの下の帯（行動時間・移動距離・累計標高）。選んでいる人の分 */
  private updateTrip(c: ClimberState): void {
    const t = c.trip ?? { activeMin: 0, distM: 0, upM: 0, downM: 0 };
    const h = Math.floor(t.activeMin / 60);
    const m = Math.floor(t.activeMin - h * 60);
    const elevM = Math.round(c.elevM);
    const key = `${c.id}|${h}:${m}|${Math.round(t.distM / 100)}|${Math.round(t.upM)}|${Math.round(t.downM)}|${elevM}`;
    if (this.tripEl.dataset['k'] === key) return;
    this.tripEl.dataset['k'] = key;
    const item = (ic: Parameters<typeof icon>[0], label: string, value: string, cls = ''): HTMLElement =>
      el('div', { class: `tb-item ${cls}`, title: label }, [icon(ic), el('small', {}, label), el('strong', {}, value)]);
    this.tripEl.replaceChildren(
      el('div', { class: 'tb-who', style: `--c:${c.def.color}` }, [avatar(c.def, 26), el('span', {}, c.def.name)]),
      // 現在地の標高（ユーザーの指定）
      item('landscape', JA.ui.elevNow, `${elevM.toLocaleString('ja-JP')} m`, 'tb-elevnow'),
      item('timer', JA.ui.duration, `${h}:${String(m).padStart(2, '0')}`),
      item('route', JA.ui.distance, `${(t.distM / 1000).toFixed(1)} km`),
      el('div', { class: 'tb-item tb-elev', title: JA.ui.tripElev }, [
        el('small', {}, JA.ui.tripElev),
        el('strong', { class: 'up' }, [icon('trendingUp'), `+${Math.round(t.upM)} m`]),
        el('strong', { class: 'down' }, [icon('trendingDown'), `−${Math.round(t.downM)} m`]),
      ]),
    );
  }

  setState(world: World, paused: boolean, speed: Speed, cam: CameraMode): void {
    this.clock.textContent = formatDateTime(this.scenario, world.tMin);
    if (this.pauseBtn.dataset['p'] !== String(paused)) {
      this.pauseBtn.dataset['p'] = String(paused);
      this.pauseBtn.replaceChildren(icon(paused ? 'playArrow' : 'pause'));
    }
    this.pauseBtn.setAttribute('aria-label', paused ? JA.ui.play : JA.ui.pause);
    this.pauseBtn.title = `${paused ? JA.ui.play : JA.ui.pause} (Space)`;
    if (this.speedSel.value !== String(speed)) this.speedSel.value = String(speed);
    this.speedSel.classList.toggle('paused', paused);
    if (this.povBtn.dataset['c'] !== cam) {
      this.cam = cam;
      this.povBtn.dataset['c'] = cam;
      // 追従のときは金色。押すたびに追従 ⇄ 俯瞰（一人称のときは押すと追従へ）
      this.povBtn.classList.toggle('on', cam === 'follow');
      this.povBtn.replaceChildren(icon(cam === 'follow' ? 'myLocation' : cam === 'eye' ? 'directionsWalk' : 'landscape'), cam === 'follow' ? JA.ui.camFollow : cam === 'eye' ? JA.ui.camFpv : JA.ui.camOverview);
    }
  }

  /** パネルの更新（4Hz） */
  updatePanels(world: World, selected: string | null): void {
    const sel = world.climbers.find((c) => c.id === selected) ?? world.climbers[0];
    const cards = (list: ClimberState[]): HTMLElement[] =>
      list.map((c) =>
        climberCard(
          c,
          this.god,
          c === sel,
          () => this.h.select(c.id),
          this.collapsed.has(c.id),
          () => {
            if (this.collapsed.has(c.id)) this.collapsed.delete(c.id);
            else this.collapsed.add(c.id);
            this.updatePanels(world, selected);
          },
          this.knows(c.id),
        ),
      );
    let list = world.climbers;
    if (this.sortByCore && world.climbers.every((c) => this.knows(c.id))) list = [...list].sort((a, b) => a.body.coreC - b.body.coreC);
    if (world.climbers.length > 6) {
      // 大人数: グループごとの折りたたみ一覧（docs/11 §2.1）
      const open = new Set([...this.climbersEl.querySelectorAll('details[open]')].map((d) => (d as HTMLElement).dataset['g'] ?? ''));
      const groups = [...new Set(list.map((c) => c.groupId ?? ''))];
      this.climbersEl.replaceChildren(
        ...groups.map((g) => {
          const members = list.filter((c) => (c.groupId ?? '') === g);
          const worst = Math.min(...members.map((c) => c.body.coreC));
          const d = el('details', { 'data-g': g, open: open.size === 0 || open.has(g) }, [
            el('summary', {}, `${groupLabel(world, g, members)}（${members.length}人・最低 ${worst.toFixed(1)}℃）`),
            ...cards(members),
          ]);
          return d;
        }),
      );
    } else {
      this.climbersEl.replaceChildren(...cards(list));
    }
    if (sel) this.updateTrip(sel);
    this.weatherEl.replaceChildren(weatherPanel(world, sel, this.god));
    // 予報のスパークラインは重いので 10 ゲーム分ごと
    if (!this.forecastEl.dataset['t'] || Math.abs(Number(this.forecastEl.dataset['t']) - world.tMin) >= 10 || this.forecastEl.dataset['g'] !== String(this.god)) {
      this.forecastEl.replaceChildren(forecastPanel(world, this.scenario, sel, this.god));
      this.forecastEl.dataset['t'] = String(world.tMin);
      this.forecastEl.dataset['g'] = String(this.god);
    }
  }

  /** 音のボタンの表示 */
  /** 録画の表示（録画中なら経過秒、していなければ null） */
  setRecording(sec: number | null): void {
    const on = sec !== null;
    this.recBtn.classList.toggle('on', on);
    if (on) {
      const t = `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
      const label = `${JA.capture.stop}（${t}）`;
      if (this.recBtn.title !== label) {
        this.recBtn.title = label;
        this.recBtn.setAttribute('aria-label', label);
        this.recBtn.replaceChildren(icon('stopCircle'), el('span', { class: 'rec-time' }, t));
      }
    } else if (this.recBtn.classList.contains('was-on') || this.recBtn.title !== JA.capture.record) {
      this.recBtn.title = JA.capture.record;
      this.recBtn.setAttribute('aria-label', JA.capture.record);
      this.recBtn.replaceChildren(icon('videocam'));
    }
  }

  setSound(on: boolean): void {
    this.soundBtn.replaceChildren(icon(on ? 'volumeUp' : 'volumeOff'));
    const label = JA.soundPanel.title;
    this.soundBtn.title = label;
    this.soundBtn.setAttribute('aria-label', label);
    this.soundBtn.classList.toggle('on', on);
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
    // 時刻を動かしたときは、その時刻までの最新を見せる
    this.followLog(true);
  }

  /** この時刻より後のログを消す（戻した先からやり直すとき） */
  truncate(tMin: number): void {
    closeLogDetail();
    this.lines = this.lines.filter((l) => l.tMin <= tMin + 1e-6);
    for (const li of [...this.logEl.children]) if (Number((li as HTMLElement).dataset['t']) > tMin + 1e-6) li.remove();
    this.lastSpeaker = null;
    this.setCutoff(null);
  }

  /** 直前の行の話し手（同じ人が続くときは顔と名前を省く。LINE のトーク画面と同じ） */
  private lastSpeaker: string | null = null;

  /** 続いている飲食の行（まとめる候補） */
  private run: { kind: 'drink' | 'eat'; lines: LogLine[]; lis: HTMLElement[]; grouped: HTMLElement | null } | null = null;

  /** 飲食の行を 1 行にまとめて描く（時刻・何をしたか・顔のアイコンの並び） */
  private groupLi(kind: 'drink' | 'eat', lines: LogLine[]): HTMLElement {
    const t0 = formatDateTime(this.scenario, lines[0]!.tMin).split(' ')[1] ?? '';
    const t1 = formatDateTime(this.scenario, lines[lines.length - 1]!.tMin).split(' ')[1] ?? '';
    const faces = lines.map((l) => {
      const who = this.party.get(l.climberId ?? '');
      if (!who) return null;
      const b = el('button', { class: 'gi-face', type: 'button', title: `${who.name}${l.amount ? `（${l.amount}）` : ''}` }, avatar(who, 26));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.h.select(who.id);
      });
      return b;
    });
    return el('li', { class: 'sys group-intake', 'data-t': lines[0]!.tMin }, [
      el('span', { class: 'pill' }, [
        el('time', {}, t0 === t1 ? t0 : `${t0}–${t1}`),
        icon(kind === 'drink' ? 'waterDrop' : 'restaurant'),
        fill(kind === 'drink' ? JA.ui.groupDrink : JA.ui.groupEat, { n: String(lines.length) }),
        el('span', { class: 'gi-faces' }, faces),
      ]),
    ]);
  }

  log(line: LogLine): void {
    this.lines.push(line);
    // 飲食: 同じ種類が続いて 3 人目になったら、それまでの行を 1 行にまとめ、そのあとはその行にアイコンを足す
    if (line.group) {
      const r = this.run;
      if (r && r.kind === line.group && line.tMin - r.lines[r.lines.length - 1]!.tMin <= GROUP_GAP_MIN && this.logEl.lastElementChild === (r.grouped ?? r.lis[r.lis.length - 1])) {
        r.lines.push(line);
        if (r.grouped || r.lines.length >= GROUP_MIN) {
          const g = this.groupLi(line.group, r.lines);
          if (this.cutoff !== null && line.tMin > this.cutoff + 1e-6) g.hidden = true;
          if (r.grouped) r.grouped.replaceWith(g);
          else {
            r.lis.forEach((x, i) => (i === 0 ? x.replaceWith(g) : x.remove()));
          }
          r.grouped = g;
          this.lastSpeaker = null;
          this.followLog();
          return;
        }
      } else this.run = { kind: line.group, lines: [line], lis: [], grouped: null };
    } else this.run = null;
    const time = formatDateTime(this.scenario, line.tMin).split(' ')[1] ?? '';
    const who = line.climberId ? this.party.get(line.climberId) : undefined;
    const kind = line.kind ?? (who ? 'action' : 'system');
    let li: HTMLElement;
    if (kind === 'system' || !who) {
      // 全体の出来事: 中央の帯
      this.lastSpeaker = null;
      const jump = line.jumpTo !== undefined && this.h.jumpToChoice
        ? el('button', { class: 'jump', type: 'button', title: JA.ui.jumpToChoice, onclick: (e: Event) => {
            e.stopPropagation();
            this.h.jumpToChoice?.(line.jumpTo!);
          } }, [icon('replay'), JA.ui.jumpToChoice])
        : null;
      li = el('li', { class: `sys${line.important ? ' imp' : ''}`, 'data-t': line.tMin }, [el('span', { class: 'pill' }, [el('time', {}, time), line.text]), jump]);
    } else {
      const cont = this.lastSpeaker === who.id;
      this.lastSpeaker = who.id;
      // 顔の下に、そのときの体力とスマホの電池を丸いメーターで出す
      // 顔、その右の 1 行目に名前とメーター（体力・スマホ）、2 行目に文と時刻（同じ人が続くときは顔と名前の行を省く）
      const face = cont ? el('span', { class: 'face-gap' }) : el('span', { class: 'face' }, avatar(who, 48));
      // 「＞」: そのときの状態の詳細を出す
      const snap = line.snap;
      const more = snap ? el('button', { class: 'more', type: 'button', title: JA.logDetail.open, 'aria-label': JA.logDetail.open }, icon('chevronRight')) : null;
      more?.addEventListener('click', (e) => {
        e.stopPropagation();
        openLogDetail({ who, time, text: line.bubble ?? line.text, snap: snap!, god: this.god, anchor: more, bodyHidden: !this.knows(who.id) });
      });
      const name = cont ? null : el('div', { class: 'name' }, [el('span', { class: 'who-name' }, who.name), line.to ? el('span', { class: 'to' }, `→ ${line.to}`) : null, line.snap && this.knows(who.id) ? snapGauges(line.snap) : null]);
      let body: HTMLElement;
      if (kind === 'speech' || kind === 'thought') {
        body = el('div', { class: 'msg' }, [
          el('div', { class: `bubble ${kind}${line.shout ? ' shout' : ''}${cont ? ' cont' : ''}` }, line.bubble ?? line.text),
          el('div', { class: 'meta' }, [line.tag ? el('span', { class: 'tag' }, line.tag) : null, el('time', {}, time)]),
          more,
        ]);
      } else {
        // 行動: 顔の横に 1 行（名前は文の中にあるので、見出しは出さない）
        body = el('div', { class: 'msg' }, [el('div', { class: `act${line.important ? ' imp' : ''}` }, [line.text, el('time', {}, time)]), more]);
      }
      li = el('li', { class: `who ${kind}${cont ? ' cont' : ''}`, 'data-t': line.tMin }, [face, el('div', { class: 'col' }, [name, body])]);
      li.addEventListener('click', () => this.h.select(who.id));
      // 顔・名前・メーターをタップしたときも、「＞」と同じく、その人のそのときの状態を出す
      if (snap) {
        const openInfo = (e: Event): void => {
          e.stopPropagation();
          this.h.select(who.id);
          openLogDetail({ who, time, text: line.bubble ?? line.text, snap, god: this.god, anchor: more ?? (e.currentTarget as HTMLElement), bodyHidden: !this.knows(who.id) });
        };
        for (const t of [face, name]) {
          if (!t || t.classList.contains('face-gap')) continue;
          t.classList.add('tappable');
          t.addEventListener('click', openInfo);
        }
      }
    }
    if (this.cutoff !== null && line.tMin > this.cutoff + 1e-6) li.hidden = true;
    this.logEl.append(li);
    if (line.group && this.run) this.run.lis.push(li);
    while (this.logEl.childElementCount > 300) this.logEl.firstElementChild?.remove();
    // ログはウィンドウの本体（親）がスクロールする。過去を見ているあいだは位置を保つ
    this.followLog();
  }
}
