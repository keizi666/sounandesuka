/**
 * 環境音（雨・風・雷）。テングラフィカ（kzi.jp/kishou.html）の音づくりを組み込んだもの。音源はすべてその場で作る雑音（音声ファイルはない）。
 * - 風: 低いうなり（ローパスした褐色雑音）＋強風のときの笛のような音（バンドパスした桃色雑音）。突風でゆらぐ
 * - 雨: ざーっという高い成分と、地面をたたく低めの成分。雪のときは雨音を弱め、さらさらした音にする
 * - 雷: 稲妻が光るたびに、距離に応じた遅れと低さでゴロゴロ。近いときはバリッという音
 * 聞こえ方は、注目している登山者の場所の天気（シミュレーションの局地の値）と、カメラの近さで決める（俯瞰で遠くから見ているときは小さく）。
 * ブラウザの決まりで、最初の操作（ボタン）があるまで音は出せない。
 */
/** 雷鳴の遅れの上限（秒）。これより遠い雷も、この遅れで鳴らす */
export const THUNDER_MAX_DELAY_SEC = 15;

/** 雷まで distKm のとき、光ってから雷鳴が届くまでの秒（音は秒速 340 m） */
export function thunderDelaySec(distKm: number): number {
  return Math.min(THUNDER_MAX_DELAY_SEC, distKm / 0.34);
}

export interface AmbientInput {
  windMs: number;
  precipMmH: number;
  snow: boolean;
  /** 聞こえる度合い 0..1（登山者の視点・近い追従で 1、遠い俯瞰で小さい） */
  near: number;
}

export interface AmbientSound {
  readonly on: boolean;
  setOn(on: boolean): void;
  setVolume(v: number): void;
  update(dtSec: number, i: AmbientInput): void;
  /** 雷。distKm はその場所からの距離 */
  /** 雷鳴を鳴らす。音は秒速 340 m なので、光ってから距離の分だけ遅れて届く（thunderDelaySec） */
  thunder(distKm: number): void;
  dispose(): void;
}

export function createAmbientSound(): AmbientSound {
  let ctx: AudioContext | null = null;
  let on = false;
  let vol = 0.6;
  let master: GainNode | null = null;
  let wind: GainNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let whistle: GainNode | null = null;
  let whistleFilter: BiquadFilterNode | null = null;
  let rain: GainNode | null = null;
  let rainHi: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let gustPhase = 0;
  const sources: AudioBufferSourceNode[] = [];

  const makeNoise = (seconds: number, color: 'white' | 'pink' | 'brown'): AudioBuffer => {
    const c = ctx!;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch += 1) {
      const d = buf.getChannelData(ch);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let last = 0;
      for (let i = 0; i < len; i += 1) {
        const w = Math.random() * 2 - 1;
        if (color === 'brown') {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        } else if (color === 'pink') {
          b0 = 0.99765 * b0 + w * 0.099046;
          b1 = 0.963 * b1 + w * 0.2965164;
          b2 = 0.57 * b2 + w * 1.0526913;
          d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
        } else d[i] = w * 0.5;
      }
      // つなぎ目でぷつっと鳴らないように端をなめらかに
      const f = Math.min(2000, len / 10);
      for (let i = 0; i < f; i += 1) {
        const a = i / f;
        d[i]! *= a;
        d[len - 1 - i]! *= a;
      }
    }
    return buf;
  };
  const loop = (buf: AudioBuffer, rate = 1): AudioBufferSourceNode => {
    const s = ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(0, Math.random() * buf.duration);
    sources.push(s);
    return s;
  };
  const init = (): void => {
    if (master || !ctx) return;
    const c = ctx;
    master = c.createGain();
    // 大きくなりすぎないようにリミッターを通す
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 8;
    comp.attack.value = 0.005;
    comp.release.value = 0.3;
    master.connect(comp);
    comp.connect(c.destination);
    const brown = makeNoise(6, 'brown');
    const pink = makeNoise(5, 'pink');
    const white = makeNoise(3, 'white');
    noiseBuf = makeNoise(4, 'brown');
    windFilter = c.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.7;
    wind = c.createGain();
    wind.gain.value = 0;
    loop(brown).connect(windFilter);
    windFilter.connect(wind);
    wind.connect(master);
    whistleFilter = c.createBiquadFilter();
    whistleFilter.type = 'bandpass';
    whistleFilter.frequency.value = 900;
    whistleFilter.Q.value = 6;
    whistle = c.createGain();
    whistle.gain.value = 0;
    loop(pink, 0.9).connect(whistleFilter);
    whistleFilter.connect(whistle);
    whistle.connect(master);
    const rHp = c.createBiquadFilter();
    rHp.type = 'highpass';
    rHp.frequency.value = 1200;
    const rLp = c.createBiquadFilter();
    rLp.type = 'lowpass';
    rLp.frequency.value = 9000;
    rainHi = c.createGain();
    rainHi.gain.value = 0;
    loop(white).connect(rHp);
    rHp.connect(rLp);
    rLp.connect(rainHi);
    rainHi.connect(master);
    const rBp = c.createBiquadFilter();
    rBp.type = 'bandpass';
    rBp.frequency.value = 500;
    rBp.Q.value = 0.8;
    rain = c.createGain();
    rain.gain.value = 0;
    loop(pink, 1.1).connect(rBp);
    rBp.connect(rain);
    rain.connect(master);
  };
  const applyVolume = (): void => {
    if (!master || !ctx) return;
    master.gain.setTargetAtTime(on ? vol * vol * 0.7 : 0, ctx.currentTime, 0.1);
  };

  return {
    get on() {
      return on;
    },
    setOn(v) {
      on = v;
      if (v && !ctx) {
        try {
          ctx = new AudioContext();
        } catch {
          ctx = null;
        }
      }
      if (ctx && ctx.state === 'suspended') void ctx.resume();
      if (v) init();
      applyVolume();
    },
    setVolume(v) {
      vol = Math.max(0, Math.min(1, v));
      applyVolume();
    },
    update(dt, i) {
      if (!ctx || !master || !on || !wind || !rain || !rainHi || !whistle || !windFilter || !whistleFilter) return;
      const t = ctx.currentTime;
      gustPhase += dt * (0.3 + i.windMs * 0.03);
      const gust = 0.75 + 0.25 * Math.sin(gustPhase * 1.7) * Math.sin(gustPhase * 0.63 + 1.3) + 0.12 * (Math.random() - 0.5);
      const blizz = i.snow ? Math.min(1, i.precipMmH / 3) * Math.min(1, i.windMs / 12) : 0;
      const wl = i.near * Math.min(1, i.windMs / 22) * gust * (1 + 0.5 * blizz);
      const wh = i.near * Math.max(0, Math.min(1, (i.windMs - (i.snow ? 7 : 10)) / 15)) * gust * (1 + 0.6 * blizz);
      const rl = i.near * (i.snow ? 0.1 : 1) * Math.min(1, Math.sqrt(i.precipMmH / 40));
      const hiss = i.near * blizz * 0.35;
      wind.gain.setTargetAtTime(wl * 0.5, t, 0.25);
      windFilter.frequency.setTargetAtTime(250 + i.windMs * 22 * gust, t, 0.3);
      whistle.gain.setTargetAtTime(wh * 0.18, t, 0.3);
      whistleFilter.frequency.setTargetAtTime(700 + i.windMs * 35 * gust, t, 0.4);
      rainHi.gain.setTargetAtTime(rl * 0.3 + hiss * 0.12, t, 0.4);
      rain.gain.setTargetAtTime(rl * 0.38, t, 0.4);
    },
    thunder(distKm) {
      if (!ctx || !master || !on || !noiseBuf) return;
      const c = ctx;
      // 音は秒速 340 m。遠いほど遅れて、低く、長く尾を引く（遅れはゲームの速さに関係なく実際の秒で。
      // 光ってから雷鳴までの秒数 ÷ 3 でおよその km が分かる。ユーザーの指定で、実際と同じ遅れにする。15 秒＝約 5 km まで）
      const delay = thunderDelaySec(distKm);
      const t0 = c.currentTime + delay;
      const near = distKm < 1.2;
      const v = Math.min(1, 1.6 / (1 + distKm * 0.8));
      if (near) {
        const cr = c.createBufferSource();
        cr.buffer = makeNoise(0.4, 'white');
        const hp = c.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 1500;
        const g1 = c.createGain();
        g1.gain.setValueAtTime(0.0001, t0);
        g1.gain.exponentialRampToValueAtTime(v * 0.8, t0 + 0.01);
        g1.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
        cr.connect(hp);
        hp.connect(g1);
        g1.connect(master);
        cr.start(t0);
        cr.stop(t0 + 0.4);
      }
      const src = c.createBufferSource();
      src.buffer = noiseBuf;
      src.playbackRate.value = 0.8 + Math.random() * 0.3;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(near ? 900 : 420 / (1 + distKm / 10), t0);
      lp.frequency.exponentialRampToValueAtTime(90, t0 + 3 + distKm * 0.15);
      const g = c.createGain();
      const dur = 3 + distKm * 0.25;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(v, t0 + (near ? 0.05 : 0.4));
      g.gain.exponentialRampToValueAtTime(v * 0.35, t0 + dur * 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(lp);
      lp.connect(g);
      g.connect(master);
      src.start(t0, Math.random() * 1.0);
      src.stop(t0 + dur + 0.1);
    },
    dispose() {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          // 止まっていてもよい
        }
      }
      void ctx?.close();
      ctx = null;
    },
  };
}
