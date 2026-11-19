/**
 * 音の操作パネル（画面上のスピーカーのアイコンから開く）。音楽・効果音・環境音のオンオフと音量。
 * 変えた値は設定に保存する（saveSettings → audio の音量に反映）。環境音はシミュレーション画面だけ（onAmbient）。
 */
import type { AppContext } from '../app/App';
import { saveSettings, type Settings } from '../app/settings';
import { JA } from '../i18n/ja';
import { el } from './dom';
import { icon } from './icons';

type Key = 'music' | 'se' | 'sound';
const VOL: Record<Key, 'musicVolume' | 'seVolume' | 'soundVolume'> = { music: 'musicVolume', se: 'seVolume', sound: 'soundVolume' };

let open: HTMLElement | null = null;

/** 何か鳴る設定か（アイコンの表示用） */
export function anySoundOn(s: Settings, ambient: boolean): boolean {
  return s.music || s.se || (ambient && s.sound);
}

export function toggleSoundPanel(app: AppContext, anchor: HTMLElement, opts: { ambient: boolean; onChange?: () => void }): void {
  if (open) {
    open.remove();
    open = null;
    return;
  }
  const s = app.settings;
  const L = JA.soundPanel;
  const changed = (): void => {
    saveSettings(s);
    opts.onChange?.();
  };
  const row = (key: Key, label: string): HTMLElement => {
    const cb = el('input', { type: 'checkbox', checked: s[key] }) as HTMLInputElement;
    const range = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s[VOL[key]], 'aria-label': `${label} ${L.volume}` }) as HTMLInputElement;
    range.disabled = !s[key];
    cb.addEventListener('change', () => {
      s[key] = cb.checked;
      range.disabled = !cb.checked;
      changed();
    });
    range.addEventListener('input', () => {
      s[VOL[key]] = Number(range.value);
      changed();
    });
    return el('div', { class: 'snd-row' }, [el('label', { class: 'snd-on' }, [cb, el('span', {}, label)]), range]);
  };
  const panel = el('div', { class: 'snd-panel', role: 'dialog', 'aria-label': L.title }, [
    el('div', { class: 'snd-head' }, [icon('volumeUp'), L.title]),
    row('music', L.music),
    row('se', L.se),
    opts.ambient ? row('sound', L.ambient) : null,
  ]);
  document.body.append(panel);
  const r = anchor.getBoundingClientRect();
  const w = 260;
  panel.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  panel.style.top = `${r.bottom + 6}px`;
  open = panel;
  const close = (e: PointerEvent): void => {
    if (!open || panel.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
    open.remove();
    open = null;
    document.removeEventListener('pointerdown', close, true);
  };
  document.addEventListener('pointerdown', close, true);
}
