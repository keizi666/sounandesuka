/**
 * 3D プレビュー（docs/16 §6.3）: プレイヤーと同じ view/ で箱庭を表示する（登山道・地点つき）。
 * シナリオがまだ不完全でも表示できるよう、最初の地点に仮の登山者を置いた World を作る。
 */
import { createWorld } from '../sim/core/world';
import type { MapRuntime, ScenarioDef, World } from '../sim/types';
import { SceneView } from '../view/sceneView';
import { el } from '../ui/dom';
import { defaultClimber } from './store/project';

export interface Preview3d {
  root: HTMLElement;
  dispose(): void;
}

/** 表示用の World。シナリオが不完全なら、中心に仮の地点を置いて登山者のいない World を作る */
function previewWorld(map: MapRuntime, s: ScenarioDef): World {
  try {
    return createWorld(map, s);
  } catch {
    const tmp = '_preview';
    const m2: MapRuntime = { ...map, nodes: { ...map.nodes, [tmp]: { id: tmp, name: '', type: 'landmark', x: 0, z: 0, elevM: map.heights[(map.n * map.n) >> 1] ?? 0 } }, adjacency: { ...map.adjacency, [tmp]: [] } };
    const stub: ScenarioDef = { ...s, party: [defaultClimber('c1', '仮', '#d9452b', true)], plan: { ...s.plan, route: [tmp], goalNodes: [tmp] }, choices: [], events: [] };
    const w = createWorld(m2, stub);
    w.climbers = [];
    return w;
  }
}

export function openPreview3d(host: HTMLElement, map: MapRuntime, s: ScenarioDef, quality: 'low' | 'mid' | 'high', vExag: number): Preview3d {
  const canvas = el('canvas', { class: 'scene' });
  const root = el('div', { class: 'preview3d' }, [canvas, el('p', { class: 'note' }, '3D プレビュー（左ドラッグ 移動 / 右ドラッグ 回転 / ホイール 拡大）')]);
  host.append(root);
  const view = new SceneView(canvas, map, s, { quality, figureScale: 25, vExag });
  const world = previewWorld(map, s);
  // 地形を見るためのプレビューなので、昼の光にする
  world.sun = { ...world.sun, elevDeg: 40, isDark: false, twilight: false };
  let alive = true;
  const resize = (): void => {
    const r = root.getBoundingClientRect();
    view.resize(r.width, r.height);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  const frame = (t: number): void => {
    if (!alive) return;
    view.render(world, null, 1, t / 1000);
    requestAnimationFrame(frame);
  };
  resize();
  view.render(world, null, 1, 0);
  requestAnimationFrame(frame);
  return {
    root,
    dispose() {
      alive = false;
      ro.disconnect();
      view.dispose();
      root.remove();
    },
  };
}
