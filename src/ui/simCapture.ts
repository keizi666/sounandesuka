/**
 * シナリオ画面のスクリーンショット・録画のつなぎ（simScreen.ts から分けた）。撮ったら確認の画面（captureDialog）を出す。
 */
import type { LoadedScenario } from '../app/data';
import type { Settings } from '../app/settings';
import { STATE_PARAM } from '../app/shareState';
import { fill, formatDateTime } from '../i18n/format';
import { JA } from '../i18n/ja';
import type { World } from '../sim/types';
import { createCapture, type RecordResult } from './capture';
import { download, openCaptureDialog } from './captureDialog';
import { toast } from './dom';
import { siteUrl } from './shareButtons';
import { shortTarget } from '../net/shareLink';
import { cardBase64, cardText, composeShareCard } from './shareCard';

export interface SimCapture {
  afterRender(): void;
  snap(): void;
  toggleRecord(): void;
  /** シナリオが終わった: 録画中なら止めて、動画を自動で保存する（ユーザーの指定） */
  finishOnEnd(): void;
  /** 録画中なら経過秒 */
  elapsed(): number | null;
  /** 場面リンクのカード（いまの 3D の画面に題・状況・メンバーを描いた画像と説明文） */
  card(): Promise<{ image: string; text: string } | null>;
  dispose(): void;
}

export function createSimCapture(o: { canvas: HTMLCanvasElement; loaded: LoadedScenario; world: () => World; settings: Settings; onChange: () => void; situation?: () => string[]; focus?: () => { x: number; y: number } | null }): SimCapture {
  const s = o.loaded.scenario;
  const timeText = (): string => formatDateTime(s, o.world().tMin);
  const cap = createCapture(o.canvas, {
    title: s.title,
    attribution: o.loaded.attribution.map((a) => a.text).join(' / '),
    note: s.region?.real ? JA.disclaimer.realMountainShort : '',
    time: timeText,
    quality: () => o.settings.recordQuality,
  });
  /** 共有の URL: 一覧のシナリオなら、この場面を開く URL（アドレス欄）。それ以外はサービスの URL */
  const shareTarget = (): { text: string; url: string } => ({
    text: fill(JA.capture.shareText, { title: s.title, time: timeText() }),
    url: o.loaded.listed && new URL(location.href).searchParams.has(STATE_PARAM) ? location.href : siteUrl(),
  });
  const stamp = (): string => timeText().replace(/[^0-9A-Za-z]+/g, '');
  const showVideo = (r: RecordResult): void => {
    openCaptureDialog({ blob: r.blob, kind: 'video', fileName: `sounandesuyo_${s.id}_${stamp()}.${r.ext}`, share: shareTarget(), shareLater: shortTarget(shareTarget(), card), sec: r.sec });
  };
  /** 場面リンクのカード（一覧のシナリオで、場面の URL のときだけ） */
  const card = async (): Promise<{ image: string; text: string } | null> => {
    if (!o.loaded.listed) return null;
    const frame = await Promise.race([cap.frame(), new Promise<null>((ok) => window.setTimeout(() => ok(null), 1500))]);
    if (!frame) return null;
    const input = { scenario: s, world: o.world(), situation: o.situation?.() ?? [] };
    return { image: cardBase64(composeShareCard({ frame, ...input, focus: o.focus?.() ?? null })), text: cardText(input) };
  };
  return {
    afterRender: () => cap.afterRender(),
    card,
    snap() {
      const share = shareTarget();
      const name = `sounandesuyo_${s.id}_${stamp()}.png`;
      const shareLater = shortTarget(share, card);
      void cap.snap().then((blob) => openCaptureDialog({ blob, kind: 'image', fileName: name, share, shareLater }));
    },
    toggleRecord() {
      if (cap.elapsed() !== null) {
        void cap.stop().then((r) => {
          o.onChange();
          if (r) showVideo(r);
        });
        return;
      }
      void cap
        .start((r) => {
          toast(JA.capture.autoStopped, 5000);
          o.onChange();
          showVideo(r);
        })
        .then((err) => {
          if (err) toast(err, 5000);
          else toast(JA.capture.started, 3000);
          o.onChange();
        });
    },
    finishOnEnd() {
      if (cap.elapsed() === null) return;
      void cap.stop().then((r) => {
        o.onChange();
        if (!r) return;
        download(r.blob, `sounandesuyo_${s.id}_${stamp()}.${r.ext}`);
        toast(JA.capture.savedOnEnd, 5000);
      });
    },
    elapsed: () => cap.elapsed(),
    dispose: () => cap.dispose(),
  };
}
