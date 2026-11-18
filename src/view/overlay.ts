/**
 * 地図レイヤー（docs/11 §2.3）: 電波・気温・風・危険を地形の色に重ねる。マップの格子と同じ解像度の DataTexture。
 * 気温と風は時刻で変わるので、ゲーム内 10 分ごとに作り直す。
 */
import * as THREE from 'three';
import type { MapRuntime, StaticContext, World } from '../sim/types';
import type { EnvUniforms } from './terrainMaterial';

export type OverlayKind = 'none' | 'radio' | 'temp' | 'wind' | 'hazard';

function ramp(t: number): [number, number, number] {
  // 青 → 水色 → 緑 → 黄 → 赤
  const k = Math.max(0, Math.min(1, t));
  const stops: [number, number, number][] = [[40, 80, 200], [60, 170, 220], [70, 190, 90], [235, 210, 60], [220, 60, 40]];
  const f = k * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const u = f - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

export class Overlay {
  kind: OverlayKind = 'none';
  private tex: THREE.DataTexture;
  private data: Uint8Array;
  private builtAt = -Infinity;

  constructor(
    private map: MapRuntime,
    private env: EnvUniforms,
  ) {
    const n = map.n;
    this.data = new Uint8Array(n * n * 4);
    this.tex = new THREE.DataTexture(this.data, n, n, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    env.uOverlay.value = this.tex;
    env.uMapHalf.value = map.half / 1000;
  }

  set(kind: OverlayKind): void {
    this.kind = kind;
    this.builtAt = -Infinity;
    this.env.uOverlayOn.value = kind === 'none' ? 0 : 1;
  }

  update(world: World, ctx: StaticContext): void {
    if (this.kind === 'none') return;
    const dynamic = this.kind === 'temp' || this.kind === 'wind';
    if (!dynamic && this.builtAt > -Infinity) return;
    if (dynamic && world.tMin - this.builtAt < 10) return;
    this.builtAt = world.tMin;
    const m = this.map;
    const sw = ctx.scenario.weather;
    const g = world.weather;
    const d = this.data;
    for (let i = 0; i < m.n * m.n; i += 1) {
      let rgb: [number, number, number] = [0, 0, 0];
      let a = 0.6;
      switch (this.kind) {
        case 'radio': {
          const r = m.radio[i]!;
          rgb = r > 0.5 ? [70, 190, 90] : r > 0.15 ? [235, 210, 60] : [200, 70, 60];
          a = 0.45;
          break;
        }
        case 'temp': {
          const t = g.tempC - (sw.lapseRateCPer100m * (m.heights[i]! - sw.refElevM)) / 100;
          rgb = ramp((t + 10) / 35);
          break;
        }
        case 'wind': {
          const w = g.windMs * m.exposure[i]!;
          rgb = ramp(w / 25);
          break;
        }
        case 'hazard': {
          const sl = m.slopeDeg[i]!;
          if (m.cliff[i]) rgb = [200, 40, 40];
          else if (sl > 35) rgb = [230, 90, 50];
          else if (sl > 25) rgb = [235, 190, 60];
          else a = 0;
          break;
        }
      }
      d[i * 4] = rgb[0];
      d[i * 4 + 1] = rgb[1];
      d[i * 4 + 2] = rgb[2];
      d[i * 4 + 3] = Math.round(a * 255);
    }
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
  }
}
