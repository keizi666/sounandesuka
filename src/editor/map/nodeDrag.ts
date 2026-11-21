/**
 * 地点をドラッグで動かす（登山道と地点のタブ。ユーザーの指定: 道に地点を足して動かすのに 2 つのタブを往復しなくてよいように）。
 * 地点の上で押したら道具が受け取り、動かさずに離せばクリック（選ぶ）、動かせば地点が付いてくる。
 * やり直しの記録は、実際に動かし始めたときに 1 回だけ取る（クリックだけでは記録しない）。
 * どの道にもつながっていない地点を道の上で離したら、その道に挿入してつなぐ（ユーザーの指定）。
 */
import type { NodeDef } from '../../sim/types';
import type { Ed } from '../context';
import { nextId } from '../store/project';
import type { MapPointer } from './TileMapView';
import { hitEdge, hitNode, insertNodeOnEdge } from './tools';

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
  let last: MapPointer | null = null;
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
      last = p;
      ed.view.redraw();
      return true;
    },
    up() {
      const n = node;
      const was = moved;
      const at = last;
      node = null;
      moved = false;
      last = null;
      if (!n || !was) return false;
      ed.p.editorState.selection = { kind: 'node', id: n.id };
      const map = ed.p.map;
      const isolated = !map.edges.some((e) => e.from === n.id || e.to === n.id);
      const hit = isolated && at ? hitEdge(ed.view, map, ed.runtime(), at.px, at.py, 10) : null;
      if (hit && hit.edge.kind === 'trail' && hit.edge.to) {
        // 動かした分の記録（down の checkpoint）と同じ単位で、道に挿入する
        const ids = [...map.nodes.map((x) => x.id), ...map.edges.map((e) => e.id)];
        insertNodeOnEdge(map, ed.p.scenario, hit.edge, { x: n.x, z: n.z }, n.id, nextId(ids, 'E'), n);
        ed.toast(`${n.name || n.id} を道 ${hit.edge.name || hit.edge.id} につなぎました（Ctrl＋Z で戻せます）`, 4000);
      }
      ed.touched(true);
      return true;
    },
  };
}
