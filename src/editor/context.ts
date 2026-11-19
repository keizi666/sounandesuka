/**
 * エディターの共有状態（パネル・レイヤー・道具が使う）。EditorApp が実装する。
 */
import type { HeadlessResult } from '../sim/headless';
import type { EditorProject, MapRuntime } from '../sim/types';
import type { Issue } from '../sim/scenario/validate';
import type { TileMapView } from './map/TileMapView';

export type TabId = EditorProject['editorState']['tab'];
export type SelKind = EditorProject['editorState']['selection']['kind'];

export interface Ed {
  p: EditorProject;
  view: TileMapView;
  /** 現在のマップの実行時データ（地形がなければ null）。電波は Worker で後から入る */
  runtime(): MapRuntime | null;
  /** 変更を記録して反映する（Undo の単位）。mapChanged ならマップの実行時データを作り直す */
  change(label: string, mutate: () => void, mapChanged?: boolean): void;
  /** ドラッグ中の連続した変更: 始めに checkpoint で Undo 位置を記録し、終わりに touched で反映する */
  checkpoint(label: string): void;
  touched(mapChanged: boolean): void;
  /** 表示だけを更新（パネル・地図） */
  refresh(): void;
  select(kind: SelKind, id: string | null): void;
  /** インスペクタと下部パネルの入れ物 */
  inspector: HTMLElement;
  bottom: HTMLElement;
  /** 直近の試走 */
  lastRun: HeadlessResult | null;
  setLastRun(r: HeadlessResult | null): void;
  issues(): Issue[];
  goTab(t: TabId): void;
  toast(msg: string, ms?: number): void;
  /** タイムラインのカーソル時刻（tMin） */
  cursorMin: number;
  /** 地図の重ね表示（植生・電波・傾斜…）と塗り直しの表示 */
  setOverlay(kind: import('./map/layers').OverlayKind, paint?: 'veg' | 'radio' | null): void;
  /** 3D プレビューを開く・閉じる */
  toggle3d(on?: boolean): void;
  save(): Promise<void>;
  /** 地図の左端の道具パレット（null で消す）と、そのショートカットキー */
  setToolPalette(el: HTMLElement | null, keys?: Map<string, () => void>): void;
}
