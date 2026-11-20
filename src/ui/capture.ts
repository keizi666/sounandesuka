/**
 * シナリオ中の画面のスクリーンショットと録画（ユーザーの指定）。
 * UI ごと写す（ユーザーの指定）: PC のブラウザでは、いま見ているタブの画面共有（getDisplayMedia）で、見えている画面そのままを撮る・録る
 * （撮るたびにブラウザが「このタブを共有」の確認を出す。依存は増やさない）。
 * 画面共有ができない（スマホのブラウザ）・断られたときは、3D の画面に題・日時・出典（鉄則 9）・サービス名の帯を重ねた 1 枚（2D の canvas）。
 * WebGL の描画は描いた直後にしか読めない（preserveDrawingBuffer なし）ので、simScreen が view.render の直後に afterRender を呼ぶ。
 * 録画は MediaRecorder で、音はタブの音（取れなければアプリの効果音・曲）。SNS に載せやすい MP4 を優先する。
 */
import { JA } from '../i18n/ja';
import { audio } from './audio';

export type RecordQuality = 'low' | 'mid' | 'high';

/** 品質ごとの高さ（px。0 は画面のまま）・コマ数・映像のビットレート */
const PRESETS: Record<RecordQuality, { height: number; fps: number; bps: number }> = {
  low: { height: 720, fps: 30, bps: 3_000_000 },
  mid: { height: 1080, fps: 30, bps: 6_000_000 },
  high: { height: 0, fps: 60, bps: 12_000_000 },
};
/** 録画の長さの上限（秒）。これを過ぎたら自動で止める */
export const RECORD_MAX_SEC = 10 * 60;

const MIME_PREFS = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export interface CaptureInfo {
  title: string;
  /** 出典（地理院・OSM など）。空ならなし */
  attribution: string;
  /** 実在の山の注記（短く） */
  note: string;
  /** いまの日時の表示 */
  time(): string;
  quality(): RecordQuality;
}

export interface RecordResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  sec: number;
}

export interface Capture {
  /** view.render の直後に毎フレーム呼ぶ */
  afterRender(): void;
  /** いまの画面を PNG にする（UI ごと。できなければ 3D の画面に帯を重ねた合成） */
  snap(): Promise<Blob>;
  /** 録画を始める（できなければ理由の文） */
  start(onAutoStop: (r: RecordResult) => void): Promise<string | null>;
  stop(): Promise<RecordResult | null>;
  /** 録画中なら経過秒、していなければ null */
  elapsed(): number | null;
  dispose(): void;
}

/** 3D の画面に帯を重ねて描く */
function compose(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, w: number, h: number, info: CaptureInfo): void {
  ctx.drawImage(src, 0, 0, w, h);
  const u = h / 720;
  const bar = Math.round(44 * u);
  const g = ctx.createLinearGradient(0, h - bar * 1.8, 0, h);
  g.addColorStop(0, 'rgba(10,12,16,0)');
  g.addColorStop(1, 'rgba(10,12,16,0.78)');
  ctx.fillStyle = g;
  ctx.fillRect(0, h - bar * 1.8, w, bar * 1.8);
  const pad = Math.round(16 * u);
  const font = (px: number, weight = 600): string => `${weight} ${Math.round(px * u)}px system-ui, 'Hiragino Sans', 'Yu Gothic UI', sans-serif`;
  ctx.textBaseline = 'alphabetic';
  // 左: サービス名・題・日時
  ctx.fillStyle = '#d4a64a';
  ctx.font = font(15, 800);
  const brand = JA.app.title;
  ctx.fillText(brand, pad, h - pad - Math.round(18 * u));
  const bw = ctx.measureText(brand).width;
  ctx.fillStyle = '#f2f2f2';
  ctx.font = font(15, 600);
  ctx.fillText(`${info.title}　${info.time()}`, pad + bw + Math.round(10 * u), h - pad - Math.round(18 * u));
  // 下の行: 出典・注記（小さく）
  ctx.fillStyle = 'rgba(235,235,235,0.85)';
  ctx.font = font(11, 500);
  const foot = [info.attribution, info.note, JA.capture.fictionNote].filter((x) => x).join(' ／ ');
  ctx.fillText(foot, pad, h - pad, w - pad * 2);
}

/** タブの画面共有が使えるか（PC の Chrome・Edge・Firefox など。スマホのブラウザはできない） */
export function displayCaptureAvailable(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/** いま見ているタブを共有してもらう（UI ごと写る）。品質の大きさ・コマ数を希望として渡す */
async function displayStream(q: RecordQuality | null, withAudio: boolean): Promise<MediaStream> {
  const p = q ? PRESETS[q] : null;
  const video: MediaTrackConstraints & Record<string, unknown> = { displaySurface: 'browser', cursor: 'never' };
  if (p) {
    video.frameRate = { ideal: p.fps, max: p.fps };
    if (p.height) video.height = { ideal: p.height, max: p.height };
  }
  // preferCurrentTab: Chrome で「このタブ」を先に出す。selfBrowserSurface: 自分のタブを選べるように
  const opts = { video, audio: withAudio, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'exclude' } as unknown as DisplayMediaStreamOptions;
  return navigator.mediaDevices.getDisplayMedia(opts);
}

/** 画面共有の映像から 1 コマを PNG にする */
async function frameOf(stream: MediaStream): Promise<Blob> {
  const v = document.createElement('video');
  v.srcObject = stream;
  v.muted = true;
  v.playsInline = true;
  await v.play();
  // 共有の始まりの表示が落ち着き、最初のコマがそろうまで少し待つ
  await new Promise((r) => window.setTimeout(r, 400));
  const c = document.createElement('canvas');
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext('2d')!.drawImage(v, 0, 0);
  v.pause();
  v.srcObject = null;
  return new Promise((ok, ng) => c.toBlob((b) => (b ? ok(b) : ng(new Error('blob'))), 'image/png'));
}

/** 録画中の状態 */
interface Rec {
  mr: MediaRecorder;
  chunks: Blob[];
  startedMs: number;
  ext: 'mp4' | 'webm';
  stream: MediaStream;
  timer: number;
  done: Promise<RecordResult | null>;
  mode: 'display' | 'canvas';
}

export function createCapture(canvas: HTMLCanvasElement, info: CaptureInfo): Capture {
  const out = document.createElement('canvas');
  const ctx = out.getContext('2d');
  let snapWait: ((b: Blob) => void)[] = [];
  /** display: タブの画面共有（UI ごと）/ canvas: 3D の画面に帯を重ねた合成（画面共有ができないとき） */
  let rec: Rec | null = null;

  const sizeFor = (q: RecordQuality | 'snap'): { w: number; h: number } => {
    const sw = canvas.width;
    const sh = canvas.height;
    const target = q === 'snap' ? sh : PRESETS[q].height || sh;
    const h = Math.max(2, Math.round(Math.min(target, sh * 2) / 2) * 2);
    const w = Math.max(2, Math.round((h * sw) / Math.max(1, sh) / 2) * 2);
    return { w, h };
  };

  const draw = (q: RecordQuality | 'snap'): void => {
    if (!ctx) return;
    const { w, h } = sizeFor(q);
    if (out.width !== w || out.height !== h) {
      out.width = w;
      out.height = h;
    }
    compose(ctx, canvas, w, h, info);
  };

  const finish = (r: Rec): Promise<RecordResult | null> =>
    new Promise((ok) => {
      r.mr.onstop = () => {
        for (const t of r.stream.getTracks()) t.stop();
        const sec = (performance.now() - r.startedMs) / 1000;
        ok(r.chunks.length > 0 ? { blob: new Blob(r.chunks, { type: r.mr.mimeType || (r.ext === 'mp4' ? 'video/mp4' : 'video/webm') }), ext: r.ext, sec } : null);
      };
    });

  /** 録画を始める（映像の stream に音を足して MediaRecorder へ） */
  const begin = (stream: MediaStream, mode: 'display' | 'canvas', onAutoStop: (r: RecordResult) => void): string | null => {
    const mime = MIME_PREFS.find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
      for (const t of stream.getTracks()) t.stop();
      return JA.capture.unsupported;
    }
    // 音: タブの音が取れなければ、アプリの効果音・曲
    if (stream.getAudioTracks().length === 0) for (const t of audio().captureStream()?.getAudioTracks() ?? []) stream.addTrack(t.clone());
    let mr: MediaRecorder;
    try {
      mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: PRESETS[info.quality()].bps, audioBitsPerSecond: 128_000 });
    } catch {
      for (const t of stream.getTracks()) t.stop();
      return JA.capture.unsupported;
    }
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const r: Rec = { mr, chunks, startedMs: performance.now(), ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm', stream, timer: 0, done: Promise.resolve(null), mode };
    r.done = finish(r);
    const autoStop = (): void => {
      if ((rec as Rec | null) !== r) return;
      rec = null;
      window.clearTimeout(r.timer);
      if (mr.state !== 'inactive') mr.stop();
      void r.done.then((x) => x && onAutoStop(x));
    };
    r.timer = window.setTimeout(autoStop, RECORD_MAX_SEC * 1000);
    // ブラウザの「共有を停止」で止められたとき
    stream.getVideoTracks()[0]?.addEventListener('ended', autoStop);
    mr.start(1000);
    rec = r;
    return null;
  };

  return {
    afterRender() {
      if (snapWait.length > 0) {
        const waiting = snapWait;
        snapWait = [];
        draw('snap');
        out.toBlob((b) => {
          if (b) for (const f of waiting) f(b);
        }, 'image/png');
      }
      if (rec?.mode === 'canvas') draw(info.quality());
    },
    async snap() {
      // UI ごと（タブの画面共有）。断られた・できないときは、3D の画面に帯を重ねた合成
      if (displayCaptureAvailable()) {
        try {
          const st = await displayStream(null, false);
          try {
            return await frameOf(st);
          } finally {
            for (const t of st.getTracks()) t.stop();
          }
        } catch {
          // 共有を断られた
        }
      }
      return new Promise<Blob>((ok) => snapWait.push(ok));
    },
    async start(onAutoStop) {
      if (rec) return null;
      if (typeof MediaRecorder === 'undefined') return JA.capture.unsupported;
      if (displayCaptureAvailable()) {
        let st: MediaStream;
        try {
          st = await displayStream(info.quality(), true);
        } catch {
          return JA.capture.declined;
        }
        return begin(st, 'display', onAutoStop);
      }
      if (typeof out.captureStream !== 'function' || !ctx) return JA.capture.unsupported;
      draw(info.quality());
      return begin(out.captureStream(PRESETS[info.quality()].fps), 'canvas', onAutoStop);
    },
    async stop() {
      const r = rec;
      if (!r) return null;
      rec = null;
      window.clearTimeout(r.timer);
      if (r.mr.state !== 'inactive') r.mr.stop();
      return r.done;
    },
    elapsed() {
      return rec ? (performance.now() - rec.startedMs) / 1000 : null;
    },
    dispose() {
      if (rec) {
        window.clearTimeout(rec.timer);
        try {
          if (rec.mr.state !== 'inactive') rec.mr.stop();
        } catch {
          // もう止まっている
        }
        for (const t of rec.stream.getTracks()) t.stop();
        rec = null;
      }
    },
  };
}
