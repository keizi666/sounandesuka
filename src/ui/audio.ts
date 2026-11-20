/**
 * 効果音と音楽（public/audio/。一覧は src/sim/scenario/soundCatalog.ts）。
 * - 画面をまたいで 1 つだけ（タイトルからシナリオ選択へ移っても曲が途切れない）
 * - 曲はループし、別の曲へは数秒かけて切り替える。効果音は重ねて鳴らせる（同じ音は短い間に何度も鳴らさない）
 * - 場面の指定（scene:play など）では、その場面に合う曲からランダムに選び、終わったら同じ場面の別の曲へ続ける（ユーザーの指定）。
 *   設定で曲を選んでいれば、場面の曲の代わりにその曲を繰り返す
 * - ファイルは鳴らすときに初めて読む（最初の読み込みを重くしない。NFR-03）
 * - ブラウザの決まりで、最初の操作（クリック・キー）があるまでは鳴らせない。それまでの曲の指定は覚えておき、操作のときに始める
 */
import { assetUrl } from '../app/data';
import { BGM_CATALOG, SE_CATALOG, bgmForScene, type MusicScene } from '../sim/scenario/soundCatalog';

export interface AudioPrefs {
  se: boolean;
  seVolume: number;
  music: boolean;
  musicVolume: number;
  /** シナリオの曲: auto（場面に合わせてランダム）か、曲の ID */
  track?: string;
}

/** 場面の指定の頭（music('scene:night') のように使う） */
export const SCENE_PREFIX = 'scene:';

const FADE_SEC = 2.5;
const SE_GAP_MS = 2500;

class AudioBoard {
  private ctx: AudioContext | null = null;
  private seBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private prefs: AudioPrefs = { se: true, seVolume: 0.7, music: true, musicVolume: 0.3 };
  private wanted: string | null = null;
  /** いま鳴らそうとしている曲（場面の指定なら、選んだ曲） */
  private target: string | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private current: { id: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private lastSe = new Map<string, number>();
  private unlocked = false;

  constructor() {
    const unlock = (): void => {
      if (this.unlocked) return;
      this.unlocked = true;
      this.ensure();
      void this.ctx?.resume();
      void this.apply();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const ctx = new AudioContext();
      this.seBus = new GainNode(ctx, { gain: this.prefs.seVolume });
      this.seBus.connect(ctx.destination);
      this.musicBus = new GainNode(ctx, { gain: this.prefs.musicVolume });
      this.musicBus.connect(ctx.destination);
      this.ctx = ctx;
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  private load(kind: 'se' | 'bgm', id: string): Promise<AudioBuffer | null> {
    const key = `${kind}/${id}`;
    let job = this.buffers.get(key);
    if (!job) {
      job = (async () => {
        const ctx = this.ensure();
        if (!ctx) return null;
        try {
          const r = await fetch(assetUrl(`audio/${kind}/${id}.m4a`));
          if (!r.ok) return null;
          return await ctx.decodeAudioData(await r.arrayBuffer());
        } catch {
          return null;
        }
      })();
      this.buffers.set(key, job);
    }
    return job;
  }

  setPrefs(p: AudioPrefs): void {
    const trackChanged = (p.track ?? 'auto') !== (this.prefs.track ?? 'auto');
    this.prefs = { ...p };
    if (trackChanged) this.target = null;
    const t = this.ctx?.currentTime ?? 0;
    this.seBus?.gain.setTargetAtTime(p.se ? p.seVolume : 0, t, 0.05);
    this.musicBus?.gain.setTargetAtTime(p.music ? p.musicVolume : 0, t, 0.3);
    if (!p.music && this.current) this.stopCurrent(0.6);
    if (p.music) void this.apply();
  }

  /** 効果音（ID は soundCatalog の SE_CATALOG）。volume は 0..1 */
  play(id: string, volume = 1): void {
    if (!this.prefs.se || !this.unlocked) return;
    const item = SE_CATALOG.find((x) => x.id === id);
    if (!item) return;
    const now = performance.now();
    if (now - (this.lastSe.get(id) ?? -1e9) < SE_GAP_MS) return;
    this.lastSe.set(id, now);
    void this.load('se', id).then((buf) => {
      const ctx = this.ctx;
      if (!buf || !ctx || !this.seBus) return;
      const src = new AudioBufferSourceNode(ctx, { buffer: buf });
      const g = new GainNode(ctx, { gain: item.gain * volume });
      src.connect(g).connect(this.seBus);
      src.start();
    });
  }

  /** 曲を切り替える（null で止める）。曲の ID か、場面の指定（scene:play / scene:night / scene:distress）。同じならそのまま */
  music(id: string | null): void {
    const ok = id !== null && (id.startsWith(SCENE_PREFIX) || BGM_CATALOG.some((x) => x.id === id));
    const next = ok ? id : null;
    if (next !== this.wanted) this.target = null;
    this.wanted = next;
    void this.apply();
  }

  /** 次の曲へ（場面の曲を自動で選んでいるときだけ。同じ場面の別の曲） */
  nextTrack(): void {
    if (!this.wanted?.startsWith(SCENE_PREFIX) || this.userTrack() !== null) return;
    void this.apply(this.current?.id ?? this.target ?? '');
  }

  /** 録画用: 効果音と曲を流す MediaStream（なければ作る） */
  captureStream(): MediaStream | null {
    const ctx = this.ensure();
    if (!ctx || !this.seBus || !this.musicBus) return null;
    if (!this.recordDest) {
      this.recordDest = new MediaStreamAudioDestinationNode(ctx);
      this.seBus.connect(this.recordDest);
      this.musicBus.connect(this.recordDest);
    }
    return this.recordDest.stream;
  }

  /** 設定で選んだ曲（自動なら null） */
  private userTrack(): string | null {
    const t = this.prefs.track;
    return t && t !== 'auto' && BGM_CATALOG.some((x) => x.id === t) ? t : null;
  }

  /** 鳴らす曲を決める。場面の指定なら、いま鳴っている曲がその場面に合えば続け、合わなければ候補からランダム（except は避ける） */
  private choose(except: string | null = null): string | null {
    const w = this.wanted;
    if (!w) return null;
    if (!w.startsWith(SCENE_PREFIX)) return w;
    const user = this.userTrack();
    if (user) return user;
    const pool = bgmForScene(w.slice(SCENE_PREFIX.length) as MusicScene);
    if (pool.length === 0) return null;
    if (this.current && pool.includes(this.current.id) && except === null) return this.current.id;
    const cand = pool.length > 1 ? pool.filter((x) => x !== except && x !== this.current?.id) : pool;
    return cand[Math.floor(Math.random() * cand.length)] ?? pool[0]!;
  }

  private stopCurrent(fadeSec: number): void {
    const cur = this.current;
    if (!cur || !this.ctx) return;
    this.current = null;
    const t = this.ctx.currentTime;
    cur.src.onended = null;
    cur.gain.gain.cancelScheduledValues(t);
    cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
    cur.gain.gain.linearRampToValueAtTime(0, t + fadeSec);
    try {
      cur.src.stop(t + fadeSec + 0.05);
    } catch {
      // もう止まっている
    }
  }

  private async apply(except: string | null = null): Promise<void> {
    if (!this.unlocked || !this.prefs.music) return;
    if (this.target === null || except !== null) this.target = this.choose(except);
    const id = this.target;
    if ((this.current?.id ?? null) === id && except === null) return;
    this.stopCurrent(FADE_SEC);
    if (!id) return;
    const buf = await this.load('bgm', id);
    const ctx = this.ctx;
    // 読み込みの間に別の曲が指定されたら、そちらに任せる
    if (!buf || !ctx || !this.musicBus || this.target !== id || this.current) return;
    const item = BGM_CATALOG.find((x) => x.id === id)!;
    // 場面の曲を自動で選んでいるときは、1 曲終わったら同じ場面の別の曲へ。曲を指定したときはその曲を繰り返す
    const shuffle = (this.wanted?.startsWith(SCENE_PREFIX) ?? false) && this.userTrack() === null;
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, loop: !shuffle });
    const g = new GainNode(ctx, { gain: 0 });
    src.connect(g).connect(this.musicBus);
    const t = ctx.currentTime;
    g.gain.linearRampToValueAtTime(item.gain, t + FADE_SEC);
    if (shuffle) {
      // 終わりの少し前から次の曲へ（フェードで重ねる）
      src.onended = () => {
        if (this.current?.src !== src) return;
        this.current = null;
        void this.apply(id);
      };
    }
    src.start();
    this.current = { id, src, gain: g };
  }
}

let board: AudioBoard | null = null;

/** 画面をまたいで共通の効果音・音楽 */
export function audio(): AudioBoard {
  if (!board) board = new AudioBoard();
  return board;
}
