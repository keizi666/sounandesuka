import type { Ed, TabId } from '../context';
import type { MapTool } from '../map/TileMapView';

export interface Panel {
  id: TabId;
  label: string;
  /** インスペクタ（ed.inspector）と下部パネル（ed.bottom）を描く */
  render(ed: Ed): void;
  /** 地図の道具（なければパンだけ） */
  tool?(ed: Ed): MapTool | null;
  /** キー操作（true を返すと、そのキーはここで使った） */
  key?(ed: Ed, e: KeyboardEvent): boolean;
}
