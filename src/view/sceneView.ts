/**
 * ジオラマの描画の全体（docs/10）。World を読むだけで、描画用のキャッシュは view が持つ。
 * 地形・台座・樹木・登山道・建物・人形・太陽と空・カメラ（俯瞰／追従／登山者視点）。気象の表現は weatherFx.ts。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DEG } from '../sim/core/dmath';
import type { MapRuntime, ScenarioDef, World } from '../sim/types';
import { createFigure, type Figure } from './climberFigure';
import { makeScale, toSceneY, UNIT, type ViewScale } from './scale';
import { buildDiorama, buildTerrain } from './terrainMesh';
import { createEnvUniforms, type EnvUniforms } from './terrainMaterial';
import { buildStructures } from './structures';
import { buildTrails } from './trails';
import { buildVegetation, placeTrees, type Vegetation } from './vegetation';
import { createWeatherFx, type WeatherFx } from './weatherFx';
import { Overlay } from './overlay';
import { loadHqAssets, type HqState } from './assets';
import { createPost, type Post } from './post';
import { createSky, skyColors, type Sky } from './sky';

export type Quality = 'low' | 'mid' | 'high';
export type CameraMode = 'overview' | 'follow' | 'eye';

export interface ViewOptions {
  quality: Quality;
  figureScale: number;
  vExag: number;
}

const QUALITY = {
  low: { step: 2, shadow: 0, trees: 4000, pixelRatio: 1 },
  mid: { step: 1, shadow: 1024, trees: 12000, pixelRatio: 1.5 },
  high: { step: 1, shadow: 2048, trees: 25000, pixelRatio: 2 },
} as const;

/** 補間に使う姿勢（前のティックの値） */
export interface Pose {
  x: number;
  z: number;
  elevM: number;
  heading: number;
}

export function poseOf(world: World): Record<string, Pose> {
  const out: Record<string, Pose> = {};
  for (const c of world.climbers) out[c.id] = { x: c.x, z: c.z, elevM: c.elevM, heading: c.headingRad };
  return out;
}

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly env: EnvUniforms = createEnvUniforms();
  readonly s: ViewScale;
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private hemi = new THREE.HemisphereLight(0xc9dcf0, 0x5a4a3a, 0.8);
  private figures = new Map<string, Figure>();
  private veg: Vegetation;
  private windows: THREE.MeshStandardMaterial;
  private falseTrails: THREE.Object3D[];
  private heightAt: (x: number, z: number) => number;
  private fx: WeatherFx;
  readonly overlay: Overlay;
  private trailGroup: THREE.Object3D;
  private trackLine: THREE.Line;
  private trackCount = 0;
  mode: CameraMode = 'overview';
  /** 高品質の追加アセットの状態 */
  hq: HqState = 'none';
  selected: string | null = null;
  godView = true;
  private followTarget = new THREE.Vector3();
  private lastSunElev = 999;
  private lastShadowAt = 0;
  private sky: Sky;
  private post: Post | null = null;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private lastNight = -1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly map: MapRuntime,
    readonly scenario: ScenarioDef,
    readonly opts: ViewOptions,
  ) {
    const q = QUALITY[opts.quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.quality !== 'low' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadow > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.s = makeScale(map, opts.vExag);
    this.env.uScaleY.value = UNIT * this.s.vExag;
    this.env.uBaseElev.value = this.s.baseElevM;
    this.env.uPlinth.value = this.s.plinthM;
    const size = map.def.size * UNIT;
    this.camera = new THREE.PerspectiveCamera(40, 1, size * 0.002, size * 40);
    this.camera.position.set(size * 0.5, size * 0.62, size * 0.78);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, toSceneY(this.s, map.nodes[scenario.plan.route[0]!]?.elevM ?? this.s.baseElevM) * 0.8, 0);
    this.controls.enableDamping = true;
    // マウス: 左ドラッグでパン（地図を動かす）、右ドラッグで視点を回す、ホイールで拡大縮小（ユーザーの指定）
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    // 視点の回転は控えめに（既定の 1.0 では過敏で操作しづらい。ユーザーの指定）
    this.controls.rotateSpeed = 0.3;
    this.controls.minDistance = size * 0.01;
    this.controls.maxDistance = size * 3;
    this.controls.minPolarAngle = 15 * DEG;
    this.controls.maxPolarAngle = 80 * DEG;

    const terrain = buildTerrain(map, this.s, this.env, scenario.season, q.step);
    this.heightAt = terrain.heightAt;
    this.scene.add(terrain.mesh, buildDiorama(map, this.s, this.env));
    this.veg = buildVegetation(placeTrees(map, this.s, this.heightAt, q.trees), scenario.season, this.env, q.shadow > 0);
    this.scene.add(this.veg.group);
    const tr = buildTrails(map, this.s, this.heightAt);
    this.falseTrails = tr.falseTrails;
    this.trailGroup = tr.group;
    this.scene.add(tr.group);
    this.overlay = new Overlay(map, this.env);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 6000), 3));
    tg.setDrawRange(0, 0);
    this.trackLine = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xff5a36, depthTest: false, transparent: true, opacity: 0.9 }));
    this.trackLine.frustumCulled = false;
    this.trackLine.renderOrder = 10;
    this.scene.add(this.trackLine);
    const st = buildStructures(map, this.s, this.heightAt, this.env);
    this.windows = st.windows;
    this.scene.add(st.group);

    this.sun.castShadow = q.shadow > 0;
    this.sun.shadow.mapSize.set(q.shadow || 512, q.shadow || 512);
    const sc = this.sun.shadow.camera;
    sc.left = -size * 0.75;
    sc.right = size * 0.75;
    sc.top = size * 0.75;
    sc.bottom = -size * 0.75;
    sc.near = 0.01;
    sc.far = size * 6;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.fx = createWeatherFx(this.scene, map, this.s, opts.quality);
    // 空・環境光（質感のための映り込み）・後処理
    this.sky = createSky(size * 30);
    this.scene.add(this.sky.mesh);
    if (opts.quality !== 'low') {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      this.post = createPost(this.renderer, this.scene, this.camera, opts.quality === 'high');
    }
    // 高品質だけ、開始後に追加アセットを裏で読み込む（届くまでは基本の見た目）
    if (opts.quality === 'high') {
      this.hq = 'loading';
      window.setTimeout(() => void loadHqAssets(this.env, this.renderer).then((st) => (this.hq = st)), 1000);
    }
  }

  /** レイヤーの表示切替（docs/11 §2.3） */
  setLayer(name: 'trail' | 'track' | 'cloud', on: boolean): void {
    if (name === 'trail') this.trailGroup.visible = on;
    else if (name === 'track') this.trackLine.visible = on;
    else this.fx.showClouds = on;
  }

  /** 軌跡（記録の track: [x, z][]） */
  setTrack(track: readonly (readonly [number, number])[]): void {
    if (track.length === this.trackCount) return;
    const attr = this.trackLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = Math.min(track.length, attr.count);
    const lift = 3 * UNIT * this.s.vExag;
    for (let i = this.trackCount > n ? 0 : this.trackCount; i < n; i += 1) {
      const p = track[i]!;
      const x = p[0] * UNIT;
      const z = p[1] * UNIT;
      attr.setXYZ(i, x, this.heightAt(x, z) + lift, z);
    }
    attr.needsUpdate = true;
    this.trackLine.geometry.setDrawRange(0, n);
    this.trackCount = track.length;
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** 人形の高さ（シーン単位） */
  private figureHeight(): number {
    return (this.mode === 'eye' ? 1.7 : 1.7 * this.opts.figureScale) * UNIT * this.s.vExag;
  }

  /** prev と world の間を alpha で補間して描く */
  render(world: World, prev: Record<string, Pose> | null, alpha: number, timeSec: number): void {
    this.updateLight(world);
    this.fx.update(world, this.env, this.camera, timeSec);
    for (const f of this.falseTrails) f.visible = this.godView;
    for (const c of world.climbers) {
      let fig = this.figures.get(c.id);
      if (!fig) {
        fig = createFigure(c, this.figureHeight());
        this.figures.set(c.id, fig);
        this.scene.add(fig.root);
      }
      const p = prev?.[c.id];
      const x = p ? p.x + (c.x - p.x) * alpha : c.x;
      const z = p ? p.z + (c.z - p.z) * alpha : c.z;
      const sx = x * UNIT;
      const sz = z * UNIT;
      fig.root.position.set(sx, this.heightAt(sx, sz), sz);
      fig.root.scale.setScalar(this.figureHeight());
      // 進行方向（北=0、時計回り）→ three の回転
      fig.root.rotation.y = Math.PI - c.headingRad;
      // 登山者の視点では、道迷い中の人形を推定位置に置く（真の位置は描かない）
      fig.root.visible = this.godView || !c.perception.awareLost;
      fig.update(c, timeSec, this.selected === c.id);
    }
    this.updateCamera(world);
    this.veg.update(this.camera);
    this.controls.update();
    this.sky.mesh.position.copy(this.camera.position);
    // 人形の影が付いてくるよう、影は 0.4 秒ごとにも更新する
    if (timeSec - this.lastShadowAt > 0.4 || timeSec < this.lastShadowAt) {
      this.lastShadowAt = timeSec;
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (this.post) {
      this.post.setTilt(this.mode === 'eye' ? 0 : 1);
      this.post.render();
    } else this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(world: World): void {
    const c = world.climbers.find((x) => x.id === this.selected) ?? world.climbers[0];
    if (!c) return;
    const target = new THREE.Vector3(c.x * UNIT, this.heightAt(c.x * UNIT, c.z * UNIT), c.z * UNIT);
    if (this.mode === 'follow') {
      this.followTarget.lerp(target, 0.08);
      const d = this.controls.target.clone().sub(this.followTarget);
      this.controls.target.copy(this.followTarget);
      this.camera.position.sub(d);
      this.controls.enablePan = false;
    } else if (this.mode === 'eye') {
      const eye = target.clone().add(new THREE.Vector3(0, 1.6 * UNIT * this.s.vExag, 0));
      const dir = new THREE.Vector3(Math.sin(c.headingRad), 0, -Math.cos(c.headingRad));
      this.camera.position.copy(eye);
      this.controls.target.copy(eye.clone().add(dir.multiplyScalar(0.05)));
      const vis = Math.max(20, c.local.visibilityM);
      this.scene.fog = new THREE.FogExp2(world.sun.isDark ? 0x05070c : 0xc8cdd2, 3.0 / (vis * UNIT));
    } else {
      this.followTarget.copy(this.controls.target);
      this.controls.enablePan = true;
    }
    if (this.mode !== 'eye' && this.scene.fog) this.scene.fog = null;
  }

  private updateLight(world: World): void {
    const el = world.sun.elevDeg;
    const sunUp = Math.max(0, Math.sin(el * DEG));
    const size = this.map.def.size * UNIT;
    // 太陽の方位: 6 時に東、12 時に南、18 時に西（日周の近似）
    const clock = ((world.tMin % 1440) + 1440) % 1440;
    const az = ((clock / 1440) * 2 - 0.5) * Math.PI;
    this.sun.position.set(Math.cos(az) * size * 2, Math.max(0.05, Math.sin(el * DEG)) * size * 2.5, Math.sin(az) * size * 2);
    const warm = 1 - Math.min(1, Math.max(0, el) / 22);
    this.sun.color.setRGB(1, 1 - 0.32 * warm, 1 - 0.58 * warm);
    const cloud = world.weather.cloudCover;
    const dayK = Math.min(1, sunUp * 3.5);
    // 曇りは直射が弱まり、代わりに空全体からの柔らかい光が増える
    this.sun.intensity = 3.0 * Math.pow(sunUp, 0.6) * (1 - 0.78 * cloud * cloud) * (el > 0 ? 1 : 0);
    const sc = skyColors(el, cloud);
    this.hemi.color.copy(sc.top).lerp(sc.horizon, 0.6);
    this.hemi.groundColor.copy(sc.ground);
    this.hemi.intensity = 0.1 + dayK * (0.75 + 0.55 * cloud);
    this.scene.environmentIntensity = 0.04 + dayK * (0.32 + 0.2 * cloud);
    const night = world.sun.isDark ? 1 : world.sun.twilight ? 0.5 : 0;
    this.env.uNight.value = night;
    this.windows.emissiveIntensity = night > 0 ? 2.4 : 0;
    // 登山道の線（照明を受けない素材）も夜は暗くする
    if (this.lastNight !== night) {
      this.lastNight = night;
      this.trailGroup.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (!m || !m.color) return;
        m.userData['base'] ??= m.color.getHex();
        m.color.setHex(m.userData['base'] as number).multiplyScalar(1 - 0.8 * night);
      });
    }
    // 空
    this.sunDir.copy(this.sun.position).normalize();
    this.sky.update(this.camera, sc, this.sunDir, this.sun.color, cloud);
    this.scene.background = null;
    this.renderer.setClearColor(sc.horizon);
    // 影は太陽が 0.5° 動いたときだけ更新
    if (Math.abs(el - this.lastSunElev) > 0.5) {
      this.renderer.shadowMap.needsUpdate = true;
      this.lastSunElev = el;
    }
  }

  /** 登山者の頭の画面座標（吹き出し用。docs/11 §8.3） */
  headScreen(id: string, w: number, h: number): { x: number; y: number; front: boolean; inView: boolean; occluded: boolean } | null {
    const f = this.figures.get(id);
    if (!f || !f.root.visible) return null;
    const p = f.root.position.clone();
    p.y += this.figureHeight() * 1.05;
    const v = p.clone().project(this.camera);
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-v.y * 0.5 + 0.5) * h;
    const occluded = this.occluded(id, p);
    return { x, y, front: v.z < 1, inView: x >= 0 && x <= w && y >= 0 && y <= h, occluded };
  }

  private occCache = new Map<string, { at: number; v: boolean }>();
  /** 頭→カメラの線分を高さマップで 32 点サンプル（250ms ごと） */
  private occluded(id: string, head: THREE.Vector3): boolean {
    const now = performance.now();
    const c = this.occCache.get(id);
    if (c && now - c.at < 250) return c.v;
    const cam = this.camera.position;
    let hidden = false;
    for (let i = 1; i < 32 && !hidden; i += 1) {
      const t = i / 32;
      const x = head.x + (cam.x - head.x) * t;
      const y = head.y + (cam.y - head.y) * t;
      const z = head.z + (cam.z - head.z) * t;
      if (Math.abs(x) < this.map.def.size * UNIT * 0.5 && Math.abs(z) < this.map.def.size * UNIT * 0.5 && this.heightAt(x, z) > y) hidden = true;
    }
    this.occCache.set(id, { at: now, v: hidden });
    return hidden;
  }

  /** カメラをその登山者へ向ける */
  lookAt(id: string): void {
    const f = this.figures.get(id);
    if (!f) return;
    const d = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.copy(f.root.position);
    this.camera.position.copy(f.root.position).add(d);
  }

  dispose(): void {
    for (const f of this.figures.values()) f.dispose();
    this.overlay.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
