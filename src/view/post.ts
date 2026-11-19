/**
 * 後処理（見た目の改善）。three/examples の EffectComposer を使う（追加の依存なし）。
 * 光のにじみ（ブルーム）→ 仕上げ（箱庭らしい上下のぼかし・周辺減光・色の調整）→ トーンマッピングと色空間の変換。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    uTilt: { value: 1 },
    uVignette: { value: 0.32 },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.06 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uTilt; uniform float uVignette; uniform float uSaturation; uniform float uContrast;
    varying vec2 vUv;
    void main() {
      // 画面の上下の端だけをぼかす（ミニチュア写真の浅い被写界深度）
      float band = smoothstep(0.26, 0.5, abs(vUv.y - 0.52));
      float r = band * uTilt * 3.2;
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (r > 0.05) {
        vec3 acc = col * 2.0;
        float wsum = 2.0;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7853982 + 0.3;
          float rr = r * (mod(float(i), 2.0) < 0.5 ? 1.0 : 0.55);
          acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * rr * uTexel).rgb;
          wsum += 1.0;
        }
        col = acc / wsum;
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.18) * uContrast + 0.18;
      vec2 q = vUv - 0.5;
      col *= 1.0 - uVignette * smoothstep(0.25, 0.95, dot(q, q) * 2.2);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export interface Post {
  render(): void;
  setSize(w: number, h: number): void;
  /** 上下のぼかしの強さ（0 = なし。登山者の視点では切る） */
  setTilt(v: number): void;
  /** 段階の入切（不具合の切り分け用） */
  setStages(st: { bloom: boolean; finish: boolean }): void;
  /** 設定の説明（ログ用） */
  describe(): Record<string, unknown>;
  dispose(): void;
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, high: boolean): Post {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: high ? 4 : 2 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), high ? 0.26 : 0.2, 0.7, 0.95);
  composer.addPass(bloom);
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);
  composer.addPass(new OutputPass());
  const tilt = high ? 1 : 0.6;
  return {
    render() {
      composer.render();
    },
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      const pr = renderer.getPixelRatio();
      (finish.uniforms['uTexel']!.value as THREE.Vector2).set(1 / Math.max(1, w * pr), 1 / Math.max(1, h * pr)).multiplyScalar(pr);
    },
    setStages(st) {
      bloom.enabled = st.bloom;
      finish.enabled = st.finish;
    },
    describe() {
      return { samples: target.samples, type: 'HalfFloat', size: `${target.width}x${target.height}`, bloom: bloom.enabled, finish: finish.enabled, pixelRatio: renderer.getPixelRatio() };
    },
    setTilt(v) {
      finish.uniforms['uTilt']!.value = v * tilt;
    },
    dispose() {
      composer.dispose();
      target.dispose();
    },
  };
}
