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
import { openCaptureDialog } from './captureDialog';
import { toast } from './dom';
import { siteUrl } from './shareButtons';

export interface SimCapture {
  afterRender(): void;
  snap(): void;
  toggleRecord(): void;
  /** 録画中なら経過秒 */
  elapsed(): number | null;
  dispose(): void;
}

export function createSimCapture(o: { canvas: HTMLCanvasElement; loaded: LoadedScenario; world: () => World; settings: Settings; onChange: () => void }): SimCapture {
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
    openCaptureDialog({ blob: r.blob, kind: 'video', fileName: `sounandesuyo_${s.id}_${stamp()}.${r.ext}`, share: shareTarget(), sec: r.sec });
  };
  return {
    afterRender: () => cap.afterRender(),
    snap() {
      const share = shareTarget();
      const name = `sounandesuyo_${s.id}_${stamp()}.png`;
      void cap.snap().then((blob) => openCaptureDialog({ blob, kind: 'image', fileName: name, share }));
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
    elapsed: () => cap.elapsed(),
    dispose: () => cap.dispose(),
  };
}
