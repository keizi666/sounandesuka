/**
 * 効果音と音楽（public/audio/。一覧は src/sim/scenario/soundCatalog.ts）。
 * - 画面をまたいで 1 つだけ（タイトルからシナリオ選択へ移っても曲が途切れない）
 * - 曲はループし、別の曲へは数秒かけて切り替える。効果音は重ねて鳴らせる（同じ音は短い間に何度も鳴らさない）
 * - ファイルは鳴らすときに初めて読む（最初の読み込みを重くしない。NFR-03）
 * - ブラウザの決まりで、最初の操作（クリック・キー）があるまでは鳴らせない。それまでの曲の指定は覚えておき、操作のときに始める
 */
import { assetUrl } from '../app/data';
import { BGM_CATALOG, SE_CATALOG } from '../sim/scenario/soundCatalog';

export interface AudioPrefs {
  se: boolean;
  seVolume: number;
  music: boolean;
  musicVolume: number;
}

const FADE_SEC = 2.5;
const SE_GAP_MS = 2500;

class AudioBoard {
  private ctx: AudioContext | null = null;
  private seBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private prefs: AudioPrefs = { se: true, seVolume: 0.7, music: true, musicVolume: 0.3 };
  private wanted: string | null = null;
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
    this.prefs = { ...p };
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

  /** 曲を切り替える（null で止める）。同じ曲ならそのまま */
  music(id: string | null): void {
    this.wanted = id && BGM_CATALOG.some((x) => x.id === id) ? id : null;
    void this.apply();
  }

  private stopCurrent(fadeSec: number): void {
    const cur = this.current;
    if (!cur || !this.ctx) return;
    this.current = null;
    const t = this.ctx.currentTime;
    cur.gain.gain.cancelScheduledValues(t);
    cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
    cur.gain.gain.linearRampToValueAtTime(0, t + fadeSec);
    try {
      cur.src.stop(t + fadeSec + 0.05);
    } catch {
      // もう止まっている
    }
  }

  private async apply(): Promise<void> {
    if (!this.unlocked || !this.prefs.music) return;
    const id = this.wanted;
    if ((this.current?.id ?? null) === id) return;
    this.stopCurrent(FADE_SEC);
    if (!id) return;
    const buf = await this.load('bgm', id);
    const ctx = this.ctx;
    // 読み込みの間に別の曲が指定されたら、そちらに任せる
    if (!buf || !ctx || !this.musicBus || this.wanted !== id || this.current) return;
    const item = BGM_CATALOG.find((x) => x.id === id)!;
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
    const g = new GainNode(ctx, { gain: 0 });
    src.connect(g).connect(this.musicBus);
    const t = ctx.currentTime;
    g.gain.linearRampToValueAtTime(item.gain, t + FADE_SEC);
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
