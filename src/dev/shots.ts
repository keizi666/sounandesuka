/**
 * 開発用: 固定視点のスクリーンショットと FPS の計測（shots.html。ビルドには含めない。docs/19 §8）。
 * シナリオ s01 を推奨方針で 9:30 まで進めた状態を、決まった 3 つの視点から描く。tools/shots.ts（Playwright）が操作する。
 *   ?quality=high|mid|low（既定 high）、?scenario=<id>、?t=<登山者の状態を取る時刻・分>（既定 450 = 7:30。樹林帯を歩いている）
 * 光は比較しやすいよう固定する: 快晴・無風に近い状態、時刻 9:30、太陽高度 38°（world の写しを書き換えるだけで、シミュレーションには影響しない）
 */
import { loadEntry, loadIndex } from '../app/data';
import { stepWorld } from '../sim/core/step';
import { createStaticContext, createWorld } from '../sim/core/world';
import { VegClass } from '../sim/types';
import { UNIT } from '../view/scale';
import { SceneView, type Quality } from '../view/sceneView';
import { findWaterfalls } from '../view/waterfalls';

const params = new URLSearchParams(location.search);
const quality = (params.get('quality') ?? 'high') as Quality;
const scenarioId = params.get('scenario') ?? 's01_cold_front';
const untilMin = Number(params.get('t') ?? 450);

export type Preset = 'overview' | 'forest' | 'ridge' | 'stream' | 'waterfall';

interface ShotsApi {
  ready: boolean;
  error: string | null;
  presets: Preset[];
  /** 視点を切り替えて数フレーム描く */
  setPreset(p: Preset): void;
  /** frames 回描いて、1 フレームの平均時間（ms。GPU の完了まで待つ）を返す */
  measure(frames?: number): { msPerFrame: number; fps: number; calls: number; triangles: number };
  info(): Record<string, unknown>;
}

const api: ShotsApi = {
  ready: false,
  error: null,
  presets: ['overview', 'forest', 'ridge', 'stream', 'waterfall'],
  setPreset: () => undefined,
  measure: () => ({ msPerFrame: 0, fps: 0, calls: 0, triangles: 0 }),
  info: () => ({}),
};
(window as unknown as { __shots: ShotsApi }).__shots = api;

async function main(): Promise<void> {
  const idx = await loadIndex();
  const entry = idx.find((e) => e.id === scenarioId);
  if (!entry) throw new Error(`シナリオ ${scenarioId} が見つかりません`);
  const { scenario, map } = await loadEntry(entry);
  const world = createWorld(map, scenario);
  const ctx = createStaticContext(map, scenario, { mode: 'headless', policy: 'recommended' });
  while (world.tMin < untilMin && !world.ended) stepWorld(world, ctx);
  // 歩いている瞬間で止める（休憩中だと動きの比較にならない）
  for (let i = 0; i < 720 && !world.ended && !(world.climbers[0]!.state === 'WALKING' && world.climbers[0]!.speedMs > 0.3); i += 1) stepWorld(world, ctx);
  // 光と天気を固定する（描画用）
  world.tMin = 570;
  world.sun.elevDeg = 38;
  world.sun.isDark = false;
  world.sun.twilight = false;
  world.weather.cloudCover = 0.15;
  world.weather.precipMmH = 0;
  world.weather.windMs = 3;
  world.weather.cloudBaseM = 4000;

  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const view = new SceneView(canvas, map, scenario, { quality, figureScale: 25, vExag: 1 });
  view.mode = 'overview';
  view.controls.enableDamping = false;
  view.controls.minDistance = 0.0005;
  view.camera.near = 0.002;
  view.resize(canvas.clientWidth, canvas.clientHeight);

  const size = map.def.size * UNIT;
  let t = 1000;
  const frame = (): void => {
    t += 1 / 60;
    view.render(world, null, 1, t);
  };

  api.setPreset = (p) => {
    const c = world.climbers[0]!;
    const cx = c.x * UNIT;
    const cz = c.z * UNIT;
    const cy = view.groundY(cx, cz);
    if (p === 'overview') {
      view.controls.target.set(0, cy * 0.7, 0);
      view.camera.position.set(size * 0.62, size * 0.5, size * 0.78);
    } else if (p === 'forest') {
      // 登山者を斜め後ろから（人物が画面の高さの約 1/4）
      const h = 1.7 * 25 * UNIT;
      const back = Math.PI - c.headingRad + Math.PI + 0.55;
      view.controls.target.set(cx, cy + h * 0.9, cz);
      const d = h * 6;
      view.camera.position.set(cx + Math.sin(back) * d, cy + h * 2.6, cz + Math.cos(back) * d);
    } else if (p === 'waterfall') {
      // いちばん急な滝を、下流の斜め上から見る
      const f = findWaterfalls(map)[0];
      if (f) {
        const tx = ((f.x0 + f.x1) / 2) * UNIT;
        const tz = ((f.z0 + f.z1) / 2) * UNIT;
        const ty = view.groundY(tx, tz);
        const dx = f.x1 - f.x0;
        const dz = f.z1 - f.z0;
        const len = Math.hypot(dx, dz) || 1;
        view.controls.target.set(tx, ty, tz);
        view.camera.position.set(tx + (dx / len) * size * 0.012, ty + size * 0.008, tz + (dz / len) * size * 0.012);
      }
    } else if (p === 'stream') {
      // 登山者にいちばん近い沢を、低い位置から見る（水面と岸の確認用）
      let best = { d: Infinity, x: 0, z: 0 };
      for (let i = 0; i < map.n * map.n; i += 3) {
        if (map.veg[i] !== VegClass.STREAM) continue;
        const x = (-map.half + (i % map.n) * map.cell) * UNIT;
        const z = (-map.half + Math.floor(i / map.n) * map.cell) * UNIT;
        const d = Math.hypot(x - cx, z - cz);
        if (d < best.d) best = { d, x, z };
      }
      const ty = view.groundY(best.x, best.z);
      view.controls.target.set(best.x, ty, best.z);
      view.camera.position.set(best.x + size * 0.05, ty + size * 0.085, best.z + size * 0.06);
    } else {
      // 最も高い地点の近くから、いちばん近い沢と稜線を見下ろす
      const nodes = Object.values(map.nodes);
      const peak = nodes.reduce((a, b) => (b.elevM > a.elevM ? b : a));
      const px = peak.x * UNIT;
      const pz = peak.z * UNIT;
      let best = { d: Infinity, x: 0, z: 0 };
      for (let i = 0; i < map.n * map.n; i += 7) {
        if (map.veg[i] !== VegClass.STREAM) continue;
        const x = (-map.half + (i % map.n) * map.cell) * UNIT;
        const z = (-map.half + Math.floor(i / map.n) * map.cell) * UNIT;
        const d = Math.hypot(x - px, z - pz);
        if (d > size * 0.12 && d < best.d) best = { d, x, z };
      }
      const tx = Number.isFinite(best.d) ? best.x : 0;
      const tz = Number.isFinite(best.d) ? best.z : 0;
      view.controls.target.set(tx, view.groundY(tx, tz), tz);
      const dx = px - tx;
      const dz = pz - tz;
      const len = Math.hypot(dx, dz) || 1;
      view.camera.position.set(px + (dx / len) * size * 0.06, view.groundY(px, pz) + size * 0.07, pz + (dz / len) * size * 0.06);
    }
    view.controls.update();
    for (let i = 0; i < 6; i += 1) frame();
  };

  api.measure = (frames = 60) => {
    const gl = view.renderer.getContext();
    frame();
    gl.finish();
    const t0 = performance.now();
    for (let i = 0; i < frames; i += 1) frame();
    gl.finish();
    // 完了を確実に待つ（finish が非同期の実装でも、読み出しは同期する）
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    const ms = (performance.now() - t0) / frames;
    const info = view.renderer.info.render;
    return { msPerFrame: +ms.toFixed(2), fps: +(1000 / ms).toFixed(1), calls: info.calls, triangles: info.triangles };
  };

  api.info = () => ({ quality, scenario: scenarioId, tMin: world.tMin, canvas: `${canvas.width}x${canvas.height}`, gpu: view.gpu(), climber: world.climbers[0]?.state });

  // 写真のテクスチャが届くのを待つ（最長 4 秒）
  await new Promise<void>((resolve) => {
    const t0 = performance.now();
    const tick = (): void => {
      if (view.env.uTexOn.value > 0.5 || performance.now() - t0 > 4000) resolve();
      else window.setTimeout(tick, 50);
    };
    tick();
  });
  api.setPreset('overview');
  api.ready = true;
}

main().catch((e: unknown) => {
  api.error = String(e instanceof Error ? (e.stack ?? e.message) : e);
  console.error(e);
});
