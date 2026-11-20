/**
 * シナリオ中の曲を選ぶ（ユーザーの指定）。「場面に合わせて自動（ランダム）」か、好きな 1 曲（その曲を繰り返す）。
 * 設定の画面と、画面上の音のパネルで使う。選んだ曲は設定（musicTrack）に保存する
 */
import { saveSettings, type Settings } from '../app/settings';
import { JA } from '../i18n/ja';
import { BGM_CATALOG } from '../sim/scenario/soundCatalog';
import { el } from './dom';

export function musicSelect(s: Settings, onChange?: () => void): HTMLSelectElement {
  const S = JA.settingsUi;
  const label = (scenes: readonly string[] | undefined): string => (scenes && scenes.length > 0 ? `（${scenes.map((x) => S.musicScenes[x] ?? x).join('・')}）` : '');
  const items = BGM_CATALOG.filter((x) => x.scenes && x.scenes.length > 0);
  const sel = el('select', { 'aria-label': S.musicTrack }, [
    el('option', { value: 'auto', selected: s.musicTrack === 'auto' }, S.musicTrackAuto),
    ...items.map((x) => el('option', { value: x.id, selected: s.musicTrack === x.id }, `${x.name}${label(x.scenes)}`)),
  ]);
  sel.addEventListener('change', () => {
    s.musicTrack = sel.value;
    saveSettings(s);
    onChange?.();
  });
  return sel;
}
