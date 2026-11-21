/**
 * 地点をドラッグで動かす（登山道タブ・地点タブで共通。ユーザーの指定: 道に地点を足して動かすのに 2 つのタブを往復しなくてよいように）。
 * 地点の上で押したら道具が受け取り、動かさずに離せばクリック（選ぶ）、動かせば地点が付いてくる。
 * やり直しの記録は、実際に動かし始めたときに 1 回だけ取る（クリックだけでは記録しない）。
 */
import type { NodeDef } from '../../sim/types';
import type { Ed } from '../context';
import type { MapPointer } from './TileMapView';
import { hitNode } from './tools';

export interface NodeDragger {
  /** 地点の上なら受け取って true */
  down(p: MapPointer): boolean;
  /** ドラッグ中なら地点を動かして true */
  move(p: MapPointer, dragging: boolean): boolean;
  /** 動かし終えたら true（選んだ状態にし、地図を作り直す） */
  up(): boolean;
}

export function nodeDragger(ed: Ed): NodeDragger {
  let node: NodeDef | null = null;
  let moved = false;
  return {
    down(p) {
      node = hitNode(ed.view, ed.p.map, p.px, p.py, 12);
      moved = false;
      return node !== null;
    },
    move(p, dragging) {
      if (!dragging || !node) return false;
      if (!moved) {
        ed.checkpoint('地点を動かす');
        moved = true;
      }
      node.x = Math.round(p.x * 10) / 10;
      node.z = Math.round(p.z * 10) / 10;
      ed.view.redraw();
      return true;
    },
    up() {
      const n = node;
      const was = moved;
      node = null;
      moved = false;
      if (!n || !was) return false;
      ed.p.editorState.selection = { kind: 'node', id: n.id };
      ed.touched(true);
      return true;
    },
  };
}
