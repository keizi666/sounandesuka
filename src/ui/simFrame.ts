/**
 * 毎フレームの音と曲、描画の重さの見張り（simScreen.ts から分けた）。
 */
import { JA } from '../i18n/ja';
import type { ScenarioDef, World } from '../sim/types';
import type { AmbientSound } from '../view/ambientSound';
import type { CameraMode, SceneView } from '../view/sceneView';
import { audio } from './audio';
import { toast } from './dom';
import { autoMusic } from './simAudio';

export function createFrameExtras(d: {
  view: SceneView;
  sound: AmbientSound;
  scenario: ScenarioDef;
  cam(): CameraMode;
  /** シナリオの music アクションで指定された曲（なければ自動） */
  scriptMusic(): string | undefined;
  /** 画質が「低」なら、重いときの提案を出さない */
  lowQuality: boolean;
}): { update(w: World, now: number, sinceLastMs: number): void } {
  let wasFlash = false;
  let lastMusicAt = 0;
  // 描画が重い（平均 30fps 未満が 5 秒続く）ときは画質を下げる提案を 1 回だけ出す
  let slowSince = 0;
  let suggested = d.lowQuality;
  return {
    update(w, now, sinceLastMs) {
      // 音: 注目している登山者の場所の天気。カメラが遠いほど小さく
      const fc = w.climbers.find((x) => x.id === d.view.selected) ?? w.climbers[0];
      const near = d.cam() === 'eye' ? 1 : Math.max(0.12, Math.min(1, 1.25 - d.view.focusDistance() / 1.6));
      if (fc) d.sound.update(Math.min(0.1, sinceLastMs / 1000), { windMs: fc.local.windMs * w.weather.gust, precipMmH: fc.local.precipMmH, snow: fc.local.precipType === 'snow' || fc.local.precipType === 'sleet', near });
      const fl = d.view.flashing;
      if (fl && !wasFlash) d.sound.thunder(0.6 + (1 - Math.min(1, w.weather.thunder)) * 8);
      wasFlash = fl;
      // 曲: シナリオの指定がなければ、昼・夜・遭難のさなかで選ぶ（2 秒ごと）
      if (now - lastMusicAt > 2000) {
        lastMusicAt = now;
        audio().music(w.ended ? null : d.scriptMusic() ?? autoMusic(w, d.scenario));
      }
      if (!suggested && !document.hidden) {
        if (sinceLastMs > 1000 / 30 && sinceLastMs < 500) {
          slowSince ||= now;
          if (now - slowSince > 5000) {
            suggested = true;
            toast(JA.ui.slowHint, 6000);
          }
        } else slowSince = 0;
      }
    },
  };
}
