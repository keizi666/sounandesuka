/** 設定ダイアログ（docs/11 §6） */
import type { AppContext } from '../app/App';
import { saveSettings, type Settings } from '../app/settings';
import { JA } from '../i18n/ja';
import { el } from './dom';

export function openSettings(app: AppContext, onChange?: (s: Settings) => void): void {
  const S = JA.settingsUi;
  const s = app.settings;
  const select = <K extends keyof Settings>(key: K, opts: [Settings[K], string][]): HTMLSelectElement => {
    const sel = el('select', { onchange: () => {
      const v = opts[sel.selectedIndex]![0];
      (s as unknown as Record<string, unknown>)[key] = v;
      saveSettings(s);
      onChange?.(s);
    } }, opts.map(([v, label]) => el('option', { selected: v === s[key] }, label)));
    return sel;
  };
  const toggle = (key: keyof Settings): HTMLSelectElement => select(key, [[true, S.on], [false, S.off]] as never);
  const range = (key: 'figureScale' | 'vExag' | 'seVolume' | 'musicVolume' | 'soundVolume', min: number, max: number, step: number): HTMLInputElement => {
    const r = el('input', { type: 'range', min, max, step, value: s[key], oninput: () => {
      s[key] = Number(r.value);
      saveSettings(s);
      onChange?.(s);
    } });
    return r;
  };
  const row = (label: string, ctrl: HTMLElement): HTMLElement => el('label', { class: 'row' }, [el('span', {}, label), ctrl]);
  const dlg = el('dialog', { class: 'settings' }, [
    el('h2', {}, S.title),
    row(S.quality, select('quality', [['auto', S.qualityAuto], ['low', S.qualityLow], ['mid', S.qualityMid], ['high', S.qualityHigh]])),
    row(S.figureScale, range('figureScale', 10, 50, 1)),
    row(S.vExag, range('vExag', 0.8, 1.5, 0.05)),
    row(S.tiltShift, toggle('tiltShift')),
    row(S.clouds3d, toggle('clouds3d')),
    row(S.music, toggle('music')),
    row(S.musicVolume, range('musicVolume', 0, 1, 0.05)),
    row(S.se, toggle('se')),
    row(S.seVolume, range('seVolume', 0, 1, 0.05)),
    row(S.soundVolume, range('soundVolume', 0, 1, 0.05)),
    row(S.autoPause, select('autoPause', [['choice', S.autoPauseChoice], ['important', S.autoPauseImportant], ['all', S.autoPauseAll]])),
    row(S.timed, toggle('timed')),
    row(S.observe, toggle('observe')),
    row(S.infoDefault, select('godViewDefault', [[true, JA.ui.godView], [false, JA.ui.climberView]])),
    row(S.autoCamera, toggle('autoCamera')),
    row(S.speechBubbles, toggle('speechBubbles')),
    row(S.thoughtBubbles, toggle('thoughtBubbles')),
    row(S.fictionalSpeech, toggle('fictionalSpeech')),
    row(S.textSize, select('textSize', [['small', S.small], ['medium', S.medium], ['large', S.large]])),
    el('button', { onclick: () => dlg.close() }, JA.ui.close),
  ]);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
