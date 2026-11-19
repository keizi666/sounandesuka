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
import { buildVegetation, buryUnderSnow, placeTrees, TREE_SCALE, type Vegetation } from './vegetation';
import { createWeatherFx, type WeatherFx } from './weatherFx';
import { baseSnowLineM } from './snowCover';
import { Overlay } from './overlay';
import { loadHqAssets, type HqState } from './assets';
import { assetUrl } from '../app/data';
import { buildGroundMasks } from './groundMasks';
import { reportProblem } from '../app/problem';
import { dlog } from '../app/version';
import { createPost, type Post } from './post';
import { createKishouClouds, type KishouClouds } from './kishouClouds';
import { createSky, skyColors, type Sky } from './sky';
import { buildWaterfalls } from './waterfalls';
import { Ghosts } from './ghosts';

/** この環境で使えなかった描画機能の覚え書き（localStorage）。設定の「初期化」とは別に、キーを消せば戻る */
const GFX_KEY = 'hks.v1.gfx';
function loadGfx(): { noBloom?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(GFX_KEY) ?? '{}') as { noBloom?: boolean };
  } catch {
    return {};
  }
}
function saveGfx(v: { noBloom?: boolean }): void {
  try {
    localStorage.setItem(GFX_KEY, JSON.stringify(v));
  } catch {
    // 保存できなくても続ける
  }
}

/** 夜の環境光の色（月明かりの空と地面） */
const MOON_SKY = new THREE.Color(0x6f8fd0);
const MOON_GROUND = new THREE.Color(0x232a3a);

export type Quality = 'low' | 'mid' | 'high';
export type CameraMode = 'overview' | 'follow' | 'eye';

export interface ViewOptions {
  quality: Quality;
  figureScale: number;
  vExag: number;
  /** 立体の雲（気象の計算） */
  clouds3d?: boolean;
}

const QUALITY = {
  low: { step: 2, shadow: 0, trees: 2500, pixelRatio: 1 },
  mid: { step: 1, shadow: 1024, trees: 6000, pixelRatio: 1.5 },
  high: { step: 1, shadow: 2048, trees: 11000, pixelRatio: 2 },
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
  /** 亡くなった人の半透明の姿が昇る演出。前のフレームで生きていたか */
  private ghosts!: Ghosts;
  private wasAlive = new Map<string, boolean>();
  /** 俯瞰で登山者の位置を示す赤い円（画面上の大きさが一定） */
  private locators = new Map<string, THREE.Sprite>();
  private locatorTex: THREE.Texture | null = null;
  /** 並びのずれ（シーン単位の x・z） */
  private formation = new Map<string, THREE.Vector2>();
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
  /** 箱庭風の上下ぼかし（設定で切替） */
  tiltShift = true;
  godView = true;
  private followTarget = new THREE.Vector3();
  private lastMode: CameraMode = 'overview';
  /** 登山者の視点での見回し（ドラッグで動かす。進行方向からの左右の角度と、上下の角度） */
  private eyeYaw = 0;
  private eyePitch = 0;
  /** 進行方向の地面の傾き（上りでは少し見上げる）。なめらかに追従させる */
  private eyeSlope = 0;
  private nearSaved = 0.01;
  private lastSunElev = 999;
  private lastShadowAt = 0;
  private sky: Sky;
  private post: Post | null = null;
  /** 立体の雲（気象の計算）。画質「低」と、後処理が使えない環境ではなし */
  kishou: KishouClouds | null = null;
  /** ゲームの速さ（ゲーム内の秒 / 実際の秒）。立体の雲の計算の速さに使う */
  gameSpeed = 0;
  private frames = 0;
  private drawOk = false;
  private sizeLogTimer = 0;
  private blackStage = 0;
  private lastSunUp = false;
  private sunDir = new THREE.Vector3(0, 1, 0);
  /** 影を落とす範囲の中心と半径（視点に合わせて動かす） */
  private shadowCenter = new THREE.Vector3();
  private shadowR = 0;
  private lastNight = -1;
  private baseSnowLine = Infinity;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly map: MapRuntime,
    readonly scenario: ScenarioDef,
    readonly opts: ViewOptions,
  ) {
    const q = QUALITY[opts.quality];
    const tBuild = performance.now();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.quality !== 'low' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadow > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // シェーダーが通らないときは、理由を画面に出す
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].filter(Boolean).join(' / ').slice(0, 900);
      reportProblem(`シェーダーのエラー（${this.gpuName()}）`, log);
    };
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
    this.installEyeLook(canvas);
    this.controls.minDistance = size * 0.01;
    this.controls.maxDistance = size * 3;
    this.controls.minPolarAngle = 15 * DEG;
    this.controls.maxPolarAngle = 80 * DEG;

    // 登山道と沢の地図（地面の塗り分けと掘り下げに使う）と、写真から作ったテクスチャ
    const masks = buildGroundMasks(map);
    this.env.uMask.value = masks.texture;
    this.env.uMaskOn.value = 1;
    this.env.uMapHalf.value = map.half * UNIT;
    this.env.uAutumn.value = scenario.season === 'autumn' ? 1 : 0;
    if (opts.quality !== 'low') {
      const loader = new THREE.TextureLoader();
      const load = (name: string): Promise<THREE.Texture> =>
        loader.loadAsync(assetUrl(`textures/${name}.jpg`)).then((t) => {
          t.wrapS = THREE.RepeatWrapping;
          t.wrapT = THREE.RepeatWrapping;
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
          return t;
        });
      void Promise.all([load('rock'), load('gravel'), load('soil')])
        .then(([rock, gravel, soil]) => {
          this.env.uTexRock.value = rock!;
          this.env.uTexGravel.value = gravel!;
          this.env.uTexSoil.value = soil!;
          this.env.uTexOn.value = 1;
        })
        .catch(() => undefined); // 読めなければ、テクスチャなしの塗り分けのまま続ける
    }
    const terrain = buildTerrain(map, this.s, this.env, scenario.season, q.step, masks, opts.quality === 'high' ? 2 : 1);
    this.heightAt = terrain.heightAt;
    this.scene.add(terrain.mesh, buildDiorama(map, this.s, this.env));
    // 雪山: 始まりの積雪の線（シナリオの snowpack か、月と緯度の目安）。草・ハイマツは埋もれる
    this.baseSnowLine = baseSnowLineM(scenario, map.def.geo?.centerLat ?? 36);
    this.veg = buildVegetation(buryUnderSnow(placeTrees(map, this.s, this.heightAt, q.trees), this.s, this.baseSnowLine), scenario.season, this.env, q.shadow > 0);
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
    this.ghosts = new Ghosts(this.scene);
    // 沢の急な所の滝（見た目だけ）
    this.scene.add(buildWaterfalls(map, this.s, this.heightAt, this.env));

    this.sun.castShadow = q.shadow > 0;
    this.sun.shadow.mapSize.set((q.shadow || 256) * 2, (q.shadow || 256) * 2);
    const sc = this.sun.shadow.camera;
    sc.left = -size * 0.75;
    sc.right = size * 0.75;
    sc.top = size * 0.75;
    sc.bottom = -size * 0.75;
    sc.near = 0.01;
    sc.far = size * 6;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.004;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.fx = createWeatherFx(this.scene, map, this.s, opts.quality, this.env);
    this.fx.baseSnowLine = this.baseSnowLine;
    // 空・環境光（質感のための映り込み）・後処理
    this.sky = createSky(size * 30);
    this.scene.add(this.sky.mesh);
    if (opts.quality !== 'low') {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      this.post = createPost(this.renderer, this.scene, this.camera, opts.quality === 'high');
      // 立体の雲（テングラフィカの気象の計算）。場面を描いた直後の段に差し込む
      if (opts.clouds3d !== false) {
        this.kishou = createKishouClouds(map, scenario, this.s, this.camera, opts.quality === 'high' ? 'high' : 'mid');
        this.post.insertAfterScene(this.kishou.pass);
      }
      // 前に「にじみ」で真っ黒になった環境では、最初から切っておく
      if (loadGfx().noBloom) {
        this.post.setStages({ bloom: false, finish: true });
        dlog('後処理: この環境では光のにじみを使わない（前回の自己診断の結果）');
      }
    }
    {
      const gl = this.renderer.getContext();
      const cap = this.renderer.capabilities;
      dlog('描画の初期化', {
        gpu: this.gpuName(),
        webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
        glVersion: gl.getParameter(gl.VERSION),
        quality: opts.quality,
        pixelRatio: this.renderer.getPixelRatio(),
        devicePixelRatio: window.devicePixelRatio,
        maxSamples: cap.maxSamples,
        maxTextureSize: cap.maxTextureSize,
        colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
        colorBufferHalfFloat: !!gl.getExtension('EXT_color_buffer_half_float'),
        floatLinear: !!gl.getExtension('OES_texture_float_linear'),
        shadows: this.renderer.shadowMap.enabled,
        post: this.post ? this.post.describe() : null,
        buildMs: Math.round(performance.now() - tBuild),
        three: THREE.REVISION,
        threeGlobal: (globalThis as { __THREE__?: string }).__THREE__,
      });
      canvas.addEventListener('webglcontextlost', () => reportProblem('WebGL のコンテキストが失われました', this.gpuName()));
      canvas.addEventListener('webglcontextrestored', () => dlog('WebGL のコンテキストが戻りました'));
    }
    // 高品質だけ、開始後に追加アセットを裏で読み込む（届くまでは基本の見た目）
    if (opts.quality === 'high') {
      this.hq = 'loading';
      window.setTimeout(() => void loadHqAssets(this.env, this.renderer).then((st) => (this.hq = st)), 1000);
    }
  }

  /** レイヤーの表示切替（docs/11 §2.3） */
  setLayer(name: 'trail' | 'track' | 'cloud', on: boolean): void {
    if (name === 'trail') {
      this.trailGroup.visible = on;
      this.env.uTrailOn.value = on ? 1 : 0;
    }
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
    window.clearTimeout(this.sizeLogTimer);
    this.sizeLogTimer = window.setTimeout(() => dlog('画面の大きさ', { css: `${Math.round(w)}x${Math.round(h)}`, buffer: `${this.renderer.domElement.width}x${this.renderer.domElement.height}`, post: this.post?.describe() ?? null }), 400);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** 赤い円の目印。遠くから見ても位置が分かるよう、画面上で一定の大きさに描く。近づいたら消す */
  private updateLocator(id: string, fig: Figure, timeSec: number, alive: boolean, lead: boolean): void {
    let sp = this.locators.get(id);
    if (!sp) {
      if (!this.locatorTex) {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 128;
        const g = c.getContext('2d')!;
        g.lineWidth = 9;
        g.strokeStyle = 'rgba(0,0,0,0.45)';
        g.beginPath();
        g.arc(64, 64, 52, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 6;
        g.strokeStyle = '#ffffff';
        g.beginPath();
        g.arc(64, 64, 52, 0, Math.PI * 2);
        g.stroke();
        this.locatorTex = new THREE.CanvasTexture(c);
        this.locatorTex.colorSpace = THREE.SRGBColorSpace;
      }
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.locatorTex, color: 0xff2a1f, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false, toneMapped: false }));
      sp.renderOrder = 30;
      this.locators.set(id, sp);
      this.scene.add(sp);
    }
    const h = this.figureHeight();
    sp.position.copy(fig.root.position);
    sp.position.y += h * 0.5;
    const dist = this.camera.position.distanceTo(sp.position);
    // 人形が画面の高さの 1/9 より大きく見える距離では不要
    const tanHalf = Math.tan((this.camera.fov * DEG) / 2);
    const figFrac = h / (2 * dist * tanHalf);
    const fade = 1 - THREE.MathUtils.smoothstep(figFrac, 0.07, 0.12);
    // 並んでいる仲間は先頭の円 1 つにまとめる
    sp.visible = lead && fig.root.visible && this.mode !== 'eye' && fade > 0.01;
    const pulse = 1 + 0.12 * Math.sin(timeSec * 3.2);
    sp.scale.setScalar(0.085 * pulse);
    const m = sp.material;
    m.opacity = 0.95 * fade;
    m.color.setHex(alive ? 0xff2a1f : 0x9a9a9a);
  }

  /** 人形の高さ（シーン単位） */
  private figureHeight(): number {
    return (this.mode === 'eye' ? 1.7 : 1.7 * this.opts.figureScale) * UNIT * this.s.vExag;
  }

  /** prev と world の間を alpha で補間して描く */
  render(world: World, prev: Record<string, Pose> | null, alpha: number, timeSec: number): void {
    this.updateLight(world);
    this.fx.update(world, this.env, this.camera, timeSec);
    if (this.kishou) {
      this.fx.spriteClouds = !this.kishou.active;
      this.kishou.update(world, {
        gameSecPerRealSec: this.gameSpeed,
        timeSec,
        sunDir: this.sunDir,
        sunColor: this.sun.color,
        sunIntensity: this.sun.intensity,
        skyColor: this.hemi.color,
        groundColor: this.hemi.groundColor,
        night: this.env.uNight.value,
        flash: this.fx.flash,
        focus: this.env.uFocus.value,
        focusR: this.mode === 'eye' ? 0 : this.env.uFocusR.value,
      });
    }
    for (const f of this.falseTrails) f.visible = this.godView;
    // 同じ場所にいる仲間は、描くときだけ一列に並べる（シミュレーション上は同じ位置を歩いている）
    const rank = new Map<string, number>();
    {
      const seen: { x: number; z: number; g: string | null; n: number }[] = [];
      for (const c of world.climbers) {
        let slot = seen.find((q) => q.g === c.groupId && Math.hypot(q.x - c.x, q.z - c.z) < 4);
        if (!slot) {
          slot = { x: c.x, z: c.z, g: c.groupId, n: 0 };
          seen.push(slot);
        }
        rank.set(c.id, slot.n);
        slot.n += 1;
      }
    }
    for (const c of world.climbers) {
      let fig = this.figures.get(c.id);
      if (!fig) {
        fig = createFigure(c, this.figureHeight(), this.env);
        this.figures.set(c.id, fig);
        this.scene.add(fig.root);
      }
      const p = prev?.[c.id];
      const x = p ? p.x + (c.x - p.x) * alpha : c.x;
      const z = p ? p.z + (c.z - p.z) * alpha : c.z;
      // 並びのずれ: 先頭から k 人目は進行方向の後ろへ。少し左右に振って一直線にしない。向きが変わっても急に飛ばないよう、ゆっくり追従させる
      const k = rank.get(c.id) ?? 0;
      const gap = this.figureHeight() * 0.62;
      const side = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * gap * 0.22;
      const wantX = -Math.sin(c.headingRad) * gap * k + Math.cos(c.headingRad) * side;
      const wantZ = Math.cos(c.headingRad) * gap * k + Math.sin(c.headingRad) * side;
      let off = this.formation.get(c.id);
      if (!off) {
        off = new THREE.Vector2(wantX, wantZ);
        this.formation.set(c.id, off);
      }
      off.x += (wantX - off.x) * 0.06;
      off.y += (wantZ - off.y) * 0.06;
      const sx = x * UNIT + off.x;
      const sz = z * UNIT + off.y;
      fig.root.position.set(sx, this.heightAt(sx, sz), sz);
      fig.root.scale.setScalar(this.figureHeight());
      // 進行方向（北=0、時計回り）→ three の回転
      fig.root.rotation.y = Math.PI - c.headingRad;
      // 登山者の視点では、道迷い中の人形を推定位置に置く（真の位置は描かない）
      // 地図の外（駅など）へ移った人は描かない
      fig.root.visible = !c.offMap && (this.godView || !c.perception.awareLost);
      fig.update(c, timeSec, this.selected === c.id);
      this.updateLocator(c.id, fig, timeSec, c.body.alive, k === 0);
      // 亡くなった瞬間（前のフレームでは生きていた）に、半透明の姿が昇っていく。読み込み・巻き戻しで最初から亡くなっていれば出さない
      if (this.wasAlive.get(c.id) === true && !c.body.alive && fig.root.visible) this.ghosts.spawn(c.def, fig.root.position, c.headingRad, this.figureHeight(), timeSec);
      this.wasAlive.set(c.id, c.body.alive);
    }
    this.ghosts.update(timeSec);
    this.updateCamera(world);
    this.veg.update(this.camera);
    // カメラと注目している登山者の間にある木・建物を透かす
    {
      const fc = world.climbers.find((x) => x.id === this.selected) ?? world.climbers[0];
      const ff = fc ? this.figures.get(fc.id) : undefined;
      if (ff && this.mode !== 'eye') {
        const h = this.figureHeight();
        this.env.uFocus.value.copy(ff.root.position);
        this.env.uFocus.value.y += h * 0.55;
        this.env.uFocusR.value = h * 1.0;
      } else this.env.uFocusR.value = 0;
    }
    if (this.mode !== 'eye') this.controls.update();
    this.keepCameraAboveGround();
    this.sky.mesh.position.copy(this.camera.position);
    // 人形の影が付いてくるよう、影は 0.4 秒ごとにも更新する
    const moved = this.shadowCenter.distanceTo(this.controls.target) > this.shadowR * 0.2 || Math.abs(this.camera.position.distanceTo(this.controls.target) * 0.8 - this.shadowR) > this.shadowR * 0.25;
    if (timeSec - this.lastShadowAt > 0.4 || timeSec < this.lastShadowAt || moved) {
      this.lastShadowAt = timeSec;
      this.fitShadow();
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (this.post) {
      this.post.setTilt(this.mode === 'eye' || !this.tiltShift ? 0 : 1);
      this.post.render();
    } else this.renderer.render(this.scene, this.camera);
    this.frames += 1;
    if (this.frames <= 3 || this.frames === 60) {
      const info = this.renderer.info;
      dlog(`フレーム ${this.frames}`, { calls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length, textures: info.memory.textures, geometries: info.memory.geometries, sunUp: this.lastSunUp, post: !!this.post, glError: this.renderer.getContext().getError() });
    }
    // 画面が一度でも正しく描けたと確かめられるまで、ときどき調べる（夜も月明かりがあるので真っ黒にはならない）
    if (!this.drawOk && this.frames % 30 === 4) this.checkBlack();
  }

  /** カメラが地面にめり込まないよう、地表（地図の外では台の面）より少し上に保つ */
  private keepCameraAboveGround(): void {
    if (this.mode === 'eye') return;
    const p = this.camera.position;
    const half = this.map.def.size * UNIT * 0.5;
    const margin = this.map.def.size * UNIT * 0.012;
    const inside = Math.abs(p.x) <= half && Math.abs(p.z) <= half;
    // 縁の近くでは、縁の地面の高さも見る（崖のような側面にもぐらない）
    const cx = Math.min(half, Math.max(-half, p.x));
    const cz = Math.min(half, Math.max(-half, p.z));
    const edgeDist = Math.hypot(p.x - cx, p.z - cz);
    const ground = inside ? this.heightAt(p.x, p.z) : edgeDist < margin * 2 ? this.heightAt(cx, cz) : 0;
    const minY = ground + margin;
    if (p.y < minY) {
      p.y = minY;
      this.camera.lookAt(this.controls.target);
    }
  }

  /**
   * 影を落とす範囲を、いま見ているあたりに絞る（地図全体を 1 枚で覆うと、木 1 本の影がぼやけて消える）。
   * 影の地図を描き直すときにだけ動かす（途中で動かすと影がずれる）。
   */
  private fitShadow(): void {
    const size = this.map.def.size * UNIT;
    const dist = this.camera.position.distanceTo(this.controls.target);
    const r = Math.min(size * 0.8, Math.max(size * 0.05, dist * 0.8));
    this.shadowR = r;
    this.shadowCenter.copy(this.controls.target);
    const sc = this.sun.shadow.camera;
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.near = 0.01;
    sc.far = size * 6;
    sc.updateProjectionMatrix();
    this.sun.target.position.copy(this.shadowCenter);
    this.sun.position.copy(this.shadowCenter).addScaledVector(this.sunDir, size * 3);
    this.sun.target.updateMatrixWorld();
  }

  /** 稲妻が光っているか（雷の音のきっかけに使う） */
  get flashing(): boolean {
    return this.fx.flash > 0;
  }

  /** カメラから注目している登山者までの距離（シーン単位 = km） */
  focusDistance(): number {
    return this.camera.position.distanceTo(this.env.uFocus.value);
  }

  /** 地表の高さ（シーン座標） */
  groundY(x: number, z: number): number {
    return this.heightAt(x, z);
  }

  gpu(): string {
    return this.gpuName();
  }

  private gpuName(): string {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'GPU 不明';
  }

  /**
   * 昼なのに画面が真っ黒なら、描画に失敗している。後処理を使っていれば切って描き直し、それでも黒ければ知らせる。
   * （GPU やドライバーによって後処理の中間バッファが使えないことがある）
   */
  /** 画面の数か所の色を読む。lit は黒でない点の数 */
  private samplePixels(): { lit: number; samples: string[] } {
    const gl = this.renderer.getContext();
    this.renderer.setRenderTarget(null);
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    let lit = 0;
    const samples: string[] = [];
    for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.8], [0.8, 0.8], [0.3, 0.3], [0.7, 0.4], [0.5, 0.92]] as const) {
      gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[0]! + px[1]! + px[2]! > 6) lit += 1;
      samples.push(`${px[0]},${px[1]},${px[2]}`);
    }
    return { lit, samples };
  }

  private checkBlack(): void {
    const gl = this.renderer.getContext();
    const first = this.samplePixels();
    dlog('黒画面の検査', { frame: this.frames, stage: this.blackStage, post: this.post?.describe() ?? null, ...first });
    if (first.lit > 0) {
      this.drawOk = true;
      return;
    }
    const gpu = this.gpuName();
    this.blackStage += 1;
    if (this.blackStage === 1 && this.post) {
      // 後処理のどの段階が原因かを切り分ける。描ける組み合わせがあれば、それで続ける
      const tries = [
        { name: 'にじみなし', bloom: false, finish: true },
        { name: '仕上げなし', bloom: true, finish: false },
        { name: 'にじみ・仕上げなし', bloom: false, finish: false },
      ];
      for (const t of tries) {
        this.post.setStages(t);
        this.post.render();
        const r = this.samplePixels();
        dlog(`後処理の切り分け: ${t.name}`, r);
        if (r.lit > 0) {
          this.drawOk = true;
          if (!t.bloom && t.finish) saveGfx({ noBloom: true });
          reportProblem(`後処理の一部を切りました（${t.name}）`, `この組み合わせでは描けます。次回からは最初から切ります。GPU: ${gpu}`);
          return;
        }
      }
      this.post.dispose();
      this.post = null;
      this.renderer.render(this.scene, this.camera);
      const r = this.samplePixels();
      dlog('後処理なしで描画', r);
      reportProblem('画面が真っ黒だったため、後処理（光のにじみ・ぼかし）を切りました', `GPU: ${gpu}`);
    } else if (this.blackStage <= 2) {
      this.blackStage = 2;
      this.scene.environment = null;
      this.sky.mesh.visible = false;
      this.scene.background = new THREE.Color(0x9fb9d0);
      reportProblem('まだ真っ黒なので、空の描画と環境光の映り込みを切りました', `GPU: ${gpu}`);
    } else if (this.blackStage === 3) {
      this.renderer.shadowMap.enabled = false;
      this.sun.castShadow = false;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const x of Array.isArray(m) ? m : m ? [m] : []) x.needsUpdate = true;
      });
      reportProblem('まだ真っ黒なので、影を切りました', `GPU: ${gpu}`);
    } else if (this.blackStage === 4) {
      this.drawOk = true;
      reportProblem('3D 画面が真っ黒です（後処理・空・影を切っても表示できません）', `GPU: ${gpu} / WebGL エラー: ${gl.getError()}`);
    }
  }

  /** 登山者の視点から戻る: 操作を元に戻し、登山者を斜め上から見る位置にカメラを置く */
  private leaveEye(target: THREE.Vector3): void {
    this.controls.enabled = true;
    this.camera.near = this.nearSaved;
    this.camera.updateProjectionMatrix();
    const d = this.figureHeight() * 9;
    this.controls.target.copy(target);
    this.camera.position.set(target.x + d * 0.6, target.y + d * 0.6, target.z + d * 0.7);
  }

  /** 登山者の視点での見回し: ドラッグ（マウス・タッチ）で向きを変え、ダブルクリック（ダブルタップ）で正面に戻す */
  private installEyeLook(canvas: HTMLCanvasElement): void {
    let drag: { id: number; x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'eye') return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id || this.mode !== 'eye') return;
      const k = 0.0045;
      this.eyeYaw -= (e.clientX - drag.x) * k;
      this.eyePitch = Math.max(-1.2, Math.min(1.2, this.eyePitch + (e.clientY - drag.y) * k));
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const end = (e: PointerEvent): void => {
      if (drag && e.pointerId === drag.id) drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('dblclick', () => {
      if (this.mode !== 'eye') return;
      this.eyeYaw = 0;
      this.eyePitch = 0;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * 追従の近い画に据える（シナリオの始まり）。登山者を中心に、斜め上（俯角 55°）から、操作できる最短距離の 12 倍ほど（登山者と周りの木々が見える近さ）で見下ろす。
   * 見る向きは今のカメラの方位を保つ
   */
  frameClose(world: World, distFactor = 12): void {
    const c = world.climbers.find((x) => x.id === this.selected) ?? world.climbers[0];
    if (!c) return;
    const target = new THREE.Vector3(c.x * UNIT, this.heightAt(c.x * UNIT, c.z * UNIT), c.z * UNIT);
    const flat = this.camera.position.clone().sub(this.controls.target).setY(0);
    if (flat.lengthSq() < 1e-12) flat.set(0, 0, 1);
    flat.normalize();
    const pitch = (55 * Math.PI) / 180;
    const dist = this.controls.minDistance * distFactor;
    const dir = flat.multiplyScalar(Math.cos(pitch)).add(new THREE.Vector3(0, Math.sin(pitch), 0));
    this.controls.target.copy(target);
    this.followTarget.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.lookAt(target);
    this.controls.update();
    this.lastMode = 'follow';
  }

  private updateCamera(world: World): void {
    const c = world.climbers.find((x) => x.id === this.selected) ?? world.climbers[0];
    if (!c) return;
    const target = new THREE.Vector3(c.x * UNIT, this.heightAt(c.x * UNIT, c.z * UNIT), c.z * UNIT);
    if (this.mode === 'follow') {
      if (this.lastMode === 'eye') this.leaveEye(target);
      if (this.lastMode !== 'follow') {
        // 追従に切り替えた瞬間: 見ている向きと「カメラから登山者までの距離」を保ったまま、登山者を中心に据える。
        // （注視点が登山者から離れていると、そのままの相対位置では引いた画になってしまう）
        const dir = this.camera.position.clone().sub(this.controls.target).normalize();
        const dist = Math.max(this.controls.minDistance, this.camera.position.distanceTo(target));
        this.followTarget.copy(target);
        this.controls.target.copy(target);
        this.camera.position.copy(target).addScaledVector(dir, dist);
      }
      this.followTarget.lerp(target, 0.08);
      const d = this.controls.target.clone().sub(this.followTarget);
      this.controls.target.copy(this.followTarget);
      this.camera.position.sub(d);
      this.controls.enablePan = false;
    } else if (this.mode === 'eye') {
      if (this.lastMode !== 'eye') {
        this.eyeYaw = 0;
        this.eyePitch = 0;
        this.controls.enabled = false;
        // 目の高さより手前で地面が切れないよう、手前の描画の限界を近づける
        this.nearSaved = this.camera.near;
        this.camera.near = 0.0006;
        this.camera.updateProjectionMatrix();
      }
      // 目の高さは、木や草の拡大率に合わせる（等身大の 1.6 m では、拡大した草に埋もれる）
      const eye = target.clone().add(new THREE.Vector3(0, 1.6 * TREE_SCALE * UNIT * this.s.vExag, 0));
      // 上りで地面しか見えなくならないよう、30 m 先の地面の高さに合わせて視線を上下させる
      const ahead = 30 * UNIT;
      const fx = Math.sin(c.headingRad);
      const fz = -Math.cos(c.headingRad);
      const slope = Math.atan2(this.heightAt(target.x + fx * ahead, target.z + fz * ahead) - target.y, ahead);
      this.eyeSlope += (slope - this.eyeSlope) * 0.05;
      const yaw = c.headingRad + this.eyeYaw;
      const pitch = Math.max(-1.3, Math.min(1.3, this.eyeSlope * 0.9 + this.eyePitch));
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      this.camera.position.copy(eye);
      this.controls.target.copy(eye.clone().add(dir.multiplyScalar(0.05)));
      this.camera.lookAt(this.controls.target);
      const vis = Math.max(20, c.local.visibilityM);
      this.scene.fog = new THREE.FogExp2(world.sun.isDark ? 0x05070c : 0xc8cdd2, 3.0 / (vis * UNIT));
    } else {
      if (this.lastMode === 'eye') this.leaveEye(target);
      this.followTarget.copy(this.controls.target);
      this.controls.enablePan = true;
    }
    if (this.mode !== 'eye' && this.scene.fog) this.scene.fog = null;
    this.lastMode = this.mode;
  }

  private updateLight(world: World): void {
    const el = world.sun.elevDeg;
    const sunUp = Math.max(0, Math.sin(el * DEG));
    this.lastSunUp = el > 5;
    const size = this.map.def.size * UNIT;
    // 太陽の方位: 6 時に東、12 時に南、18 時に西（日周の近似）
    const clock = ((world.tMin % 1440) + 1440) % 1440;
    const az = ((clock / 1440) * 2 - 0.5) * Math.PI;
    const warm = 1 - Math.min(1, Math.max(0, el) / 22);
    const cloud = world.weather.cloudCover;
    // 明るさは「夜 → 薄明 → 昼」へ一方向に増える（途中で暗くならない）。
    // dawn: 太陽高度 -9°（夜）から +9°（昼）で 0 → 1。空からの光はこれに沿って増える
    const dawn = THREE.MathUtils.smoothstep(el, -9, 9);
    const nightK = 1 - THREE.MathUtils.smoothstep(el, -9, 4);
    if (el > 0) {
      // 光の向きは、低すぎる太陽を少し持ち上げ、真上にもしない（影がはっきり落ちる 20°〜55°）
      const elLight = Math.min(55, Math.max(el, 20 * THREE.MathUtils.smoothstep(el, 0, 6))) * DEG;
      this.sunDir.set(Math.cos(az) * Math.cos(elLight), Math.sin(elLight), Math.sin(az) * Math.cos(elLight)).normalize();
      this.sun.color.setRGB(1, 1 - 0.32 * warm, 1 - 0.58 * warm);
      // 曇りは直射が弱まり、代わりに空全体からの柔らかい光が増える
      this.sun.intensity = 3.0 * Math.pow(sunUp, 0.6) * (1 - 0.78 * cloud * cloud);
    } else {
      // 月（太陽と同じ光源を使い回す）: 高い位置から青白く、弱く照らす。薄明が進むにつれて消える
      this.sunDir.set(-1.2, 2.2, 0.9).normalize();
      this.sun.color.setRGB(0.62, 0.74, 1.0);
      this.sun.intensity = (0.22 + 0.2 * world.sun.moonIllum) * (1 - 0.6 * cloud) * (1 - THREE.MathUtils.smoothstep(el, -6, 0));
    }
    const sc = skyColors(el, cloud);
    this.hemi.color.copy(sc.top).lerp(sc.horizon, 0.6).lerp(MOON_SKY, nightK);
    this.hemi.groundColor.copy(sc.ground).lerp(MOON_GROUND, nightK);
    this.hemi.intensity = THREE.MathUtils.lerp(0.42, 0.85 + 0.55 * cloud, dawn);
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.05, 0.36 + 0.2 * cloud, dawn);
    // 夜の色味（シェーダー側）もなめらかに変える。登山道の線の色は 0.1 刻みで更新する
    this.env.uNight.value = nightK;
    const night = Math.round(nightK * 10) / 10;
    this.windows.emissiveIntensity = 2.4 * Math.min(1, nightK * 2);
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
    this.sky.update(this.camera, sc, this.sunDir, this.sun.color, cloud);
    // 空気遠近の霞: 地平の空の色。曇りや夜は濃く見える
    this.env.uAirColor.value.copy(sc.horizon).multiplyScalar(1 - 0.55 * nightK);
    this.env.uAirDensity.value = 0.07 + 0.08 * cloud;
    this.env.uAirStart.value = this.mode === 'eye' ? 0 : this.camera.position.distanceTo(this.controls.target) * 0.75;
    if (this.sky.mesh.visible) this.scene.background = null;
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
    // 見ている向きと「カメラからその登山者までの距離」を保つ（注視点が離れていても、引いた画にならない）
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = Math.max(this.controls.minDistance, this.camera.position.distanceTo(f.root.position));
    this.controls.target.copy(f.root.position);
    this.camera.position.copy(f.root.position).addScaledVector(dir, dist);
    this.followTarget.copy(f.root.position);
  }

  dispose(): void {
    this.ghosts.dispose();
    this.kishou?.dispose();
    for (const f of this.figures.values()) f.dispose();
    for (const sp of this.locators.values()) sp.material.dispose();
    this.locatorTex?.dispose();
    this.overlay.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
