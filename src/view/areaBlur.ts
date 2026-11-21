/**
 * 見えている範囲のぼかし（ユーザーの指定。難しさ: src/app/settings.ts の difficulty）。
 * - 現在地が分からなくなった（道に迷った）とき: 自分たちから lostR m より遠い所を強くぼかし、少し色を抜く
 * - ハード: 自分たちから farR m より遠い所を軽くぼかす
 * 地形だけを描いた深度（sceneView が多重サンプルなしの小さな画面に描く）から画素ごとに地面の位置を戻し、
 * 中心からの水平の距離でぼかしの強さを決める（場面の深度は多重サンプルで、Windows では取り出せず 0 になる）。
 * 自分たちの人形は、ズームを引いても画面の上でぼかさない（keep: 人形の範囲の円。ユーザーの指定）。
 * ぼかした絵は、縮めた画面に分けたガウスを 2 回かけて作る（大きくにじませても軽い）
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UNIT } from './scale';

export interface AreaBlurParams {
  /** 中心（自分たちの位置。ワールド座標 m） */
  x: number;
  z: number;
  /** 現在地が分からない（強いぼかし） */
  lost: boolean;
  /** これより遠い所をぼかす（m。ハード）。なければ null */
  farM: number | null;
  /** ぼかさない人形（自分たち）の登山者 ID */
  keepIds: string[];
}

/** 現在地が分からないとき、はっきり見える範囲（m）とぼけていく幅 */
const LOST_R_M = 50;
const LOST_FEATHER_M = 15;
/** ハードの遠くのぼかしのぼけていく幅（m）と強さ（ユーザーの指定: 見える範囲の外はよく見えないくらい強く） */
const FAR_FEATHER_M = 40;
const FAR_STRENGTH = 1;
/** ぼかした絵を作る画面の縮め方 */
const DOWN = 6;

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

/** 分けたガウス（9 点） */
const BLUR_FRAG = /* glsl */ `uniform sampler2D tSrc; uniform vec2 uStep; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += texture2D(tSrc, vUv + uStep * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv - uStep * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv + uStep * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tSrc, vUv - uStep * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const MIX_FRAG = /* glsl */ `uniform sampler2D tDiffuse; uniform sampler2D tBlur; uniform sampler2D tDepth;
uniform mat4 uInvProj, uCamWorld; uniform vec2 uCenter; uniform float uMeterPerUnit;
uniform vec4 uLost; uniform vec4 uFar;
uniform vec3 uKeep; uniform vec2 uRes;
varying vec2 vUv;
void main() {
  vec4 scene = texture2D(tDiffuse, vUv);
  float depth = texture2D(tDepth, vUv).x;
  float d = 1.0e6;
  if (depth < 0.999999) {
    vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 vp = uInvProj * ndc; vp /= vp.w;
    vec3 wp = (uCamWorld * vp).xyz;
    d = length(wp.xz - uCenter) * uMeterPerUnit;
  }
  float lostK = uLost.w * smoothstep(uLost.x, uLost.x + uLost.y, d);
  float farK = uFar.w * uFar.z * smoothstep(uFar.x, uFar.x + uFar.y, d);
  float k = max(lostK, farK);
  // 自分たちの人形のまわり（画面の上の円）はぼかさない（ズームを引いても人形が見えるように）
  float sd = length(vUv * uRes - uKeep.xy);
  float keep = 1.0 - smoothstep(uKeep.z, uKeep.z * 1.2 + 6.0, sd);
  k *= 1.0 - keep;
  lostK *= 1.0 - keep;
  vec3 col = mix(scene.rgb, texture2D(tBlur, vUv).rgb, k);
  // 現在地が分からない所は、少し色を抜いて暗くする（分からないことが分かるように）
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(l) * 0.8, lostK * 0.4);
  gl_FragColor = vec4(col, scene.a);
}`;

export class AreaBlurPass extends Pass {
  private readonly mix: THREE.ShaderMaterial;
  private readonly blur: THREE.ShaderMaterial;
  private readonly mixQuad: FullScreenQuad;
  private readonly blurQuad: FullScreenQuad;
  private rtA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private rtB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });

  constructor(
    private camera: THREE.Camera,
    private depth: () => THREE.Texture | null,
  ) {
    super();
    this.blur = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uStep: { value: new THREE.Vector2() } }, vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
    this.mix = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tBlur: { value: null },
        tDepth: { value: null },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCenter: { value: new THREE.Vector2() },
        uMeterPerUnit: { value: 1 / UNIT },
        uLost: { value: new THREE.Vector4(LOST_R_M, LOST_FEATHER_M, 1, 0) },
        uFar: { value: new THREE.Vector4(500, FAR_FEATHER_M, FAR_STRENGTH, 0) },
        uKeep: { value: new THREE.Vector3(0, 0, 0) },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: VERT,
      fragmentShader: MIX_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.blurQuad = new FullScreenQuad(this.blur);
    this.mixQuad = new FullScreenQuad(this.mix);
    this.enabled = false;
  }

  /** ぼかす範囲（null ならぼかさない） */
  setParams(p: AreaBlurParams | null): void {
    const u = this.mix.uniforms;
    if (!p || (!p.lost && p.farM === null)) {
      this.enabled = false;
      return;
    }
    this.enabled = true;
    (u['uCenter']!.value as THREE.Vector2).set(p.x * UNIT, p.z * UNIT);
    (u['uLost']!.value as THREE.Vector4).w = p.lost ? 1 : 0;
    const far = u['uFar']!.value as THREE.Vector4;
    far.x = p.farM ?? 0;
    far.w = p.farM === null ? 0 : 1;
  }

  /** 人形をぼかさない画面の上の円（画素。描き込み先の画面の大きさに対して） */
  setKeep(cx: number, cy: number, r: number, w: number, h: number): void {
    (this.mix.uniforms['uKeep']!.value as THREE.Vector3).set(cx, cy, r);
    (this.mix.uniforms['uRes']!.value as THREE.Vector2).set(w, h);
  }

  override setSize(w: number, h: number): void {
    const sw = Math.max(1, Math.round(w / DOWN));
    const sh = Math.max(1, Math.round(h / DOWN));
    this.rtA.setSize(sw, sh);
    this.rtB.setSize(sw, sh);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const depth = this.depth() ?? readBuffer.depthTexture;
    if (this.rtA.width <= 1) this.setSize(readBuffer.width, readBuffer.height);
    const step = this.blur.uniforms['uStep']!.value as THREE.Vector2;
    const tx = 1 / this.rtA.width;
    const ty = 1 / this.rtA.height;
    // 縮めながら横 → 縦、もう一度 横 → 縦（強くにじませる）
    const passes: [THREE.Texture, THREE.WebGLRenderTarget, number, number][] = [
      [readBuffer.texture, this.rtA, tx, 0],
      [this.rtA.texture, this.rtB, 0, ty],
      [this.rtB.texture, this.rtA, tx * 2, 0],
      [this.rtA.texture, this.rtB, 0, ty * 2],
    ];
    for (const [src, dst, sx, sy] of passes) {
      this.blur.uniforms['tSrc']!.value = src;
      step.set(sx, sy);
      renderer.setRenderTarget(dst);
      this.blurQuad.render(renderer);
    }
    const u = this.mix.uniforms;
    u['tDiffuse']!.value = readBuffer.texture;
    u['tBlur']!.value = this.rtB.texture;
    u['tDepth']!.value = depth;
    (u['uInvProj']!.value as THREE.Matrix4).copy((this.camera as THREE.PerspectiveCamera).projectionMatrixInverse);
    (u['uCamWorld']!.value as THREE.Matrix4).copy(this.camera.matrixWorld);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.mixQuad.render(renderer);
  }

  override dispose(): void {
    this.mix.dispose();
    this.blur.dispose();
    this.mixQuad.dispose();
    this.blurQuad.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
  }
}

/**
 * 後処理を使わない画質（低）でも、ぼかすときだけ通す短い道（場面 → ぼかし → 仕上げ）。
 * ぼかさないときは今までどおり直接描く
 */
export interface LowBlur {
  pass: AreaBlurPass;
  render(): void;
  setSize(w: number, h: number): void;
  dispose(): void;
}

export function createLowBlur(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, depth: () => THREE.Texture | null): LowBlur {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const pass = new AreaBlurPass(camera, depth);
  composer.addPass(pass);
  composer.addPass(new OutputPass());
  return {
    pass,
    render() {
      composer.render();
    },
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    },
    dispose() {
      composer.dispose();
      target.dispose();
      pass.dispose();
    },
  };
}
