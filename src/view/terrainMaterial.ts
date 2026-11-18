/**
 * 地形のマテリアル（docs/10 §3.2）。MeshStandardMaterial を onBeforeCompile で拡張する。
 * 植生の色（頂点色）＋質感のノイズ、積雪、濡れ、高度フォグ（雲の中）、夜の色味。
 * 同じフォグの処理を樹木・建物にも注入する（injectFog）。
 */
import * as THREE from 'three';

export interface EnvUniforms {
  uSnowLine: { value: number };
  uWetLine: { value: number };
  uWet: { value: number };
  uCloudBase: { value: number };
  uCloudCover: { value: number };
  uNight: { value: number };
  uScaleY: { value: number };
  uBaseElev: { value: number };
  uPlinth: { value: number };
  uFogColor: { value: THREE.Color };
  /** 地図レイヤー（電波・気温・風・危険）。地形だけが使う */
  uOverlay: { value: THREE.Texture | null };
  uOverlayOn: { value: number };
  uMapHalf: { value: number };
  /** 高品質の追加アセット（docs/10 §10）。届くまでは 0 */
  uDetail: { value: THREE.Texture | null };
  uDetailOn: { value: number };
}

export function createEnvUniforms(): EnvUniforms {
  return {
    uSnowLine: { value: 99999 },
    uWetLine: { value: 99999 },
    uWet: { value: 0 },
    uCloudBase: { value: 99999 },
    uCloudCover: { value: 0 },
    uNight: { value: 0 },
    uScaleY: { value: 0.001 },
    uBaseElev: { value: 0 },
    uPlinth: { value: 0 },
    uFogColor: { value: new THREE.Color(0xd8dde2) },
    uOverlay: { value: null },
    uOverlayOn: { value: 0 },
    uMapHalf: { value: 1 },
    uDetail: { value: null },
    uDetailOn: { value: 0 },
  };
}

const COMMON = /* glsl */ `
uniform float uSnowLine;
uniform float uWetLine;
uniform float uWet;
uniform float uCloudBase;
uniform float uCloudCover;
uniform float uNight;
uniform float uScaleY;
uniform float uBaseElev;
uniform float uPlinth;
uniform vec3 uFogColor;
uniform sampler2D uOverlay;
uniform float uOverlayOn;
uniform float uMapHalf;
uniform sampler2D uDetail;
uniform float uDetailOn;
varying float vElev;
varying vec3 vWorldPos;
varying float vSlopeUp;
float hk_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hk_noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hk_hash(i), hk_hash(i + vec2(1.0, 0.0)), u.x), mix(hk_hash(i + vec2(0.0, 1.0)), hk_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/** 頂点シェーダに標高と世界座標を渡す処理を入れる */
function patchVertex(shader: { vertexShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${COMMON}`)
    .replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vec4 hkLocal = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        hkLocal = instanceMatrix * hkLocal;
      #endif
      vec4 hkWorld = modelMatrix * hkLocal;
      vWorldPos = hkWorld.xyz;
      vElev = hkWorld.y / uScaleY - uPlinth + uBaseElev;
      vSlopeUp = normalize(mat3(modelMatrix) * objectNormal).y;`,
    );
}

/** フラグメントの最後に雪・濡れ・霧・夜を足す */
function patchFragment(shader: { fragmentShader: string }, terrain: boolean): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${COMMON}`)
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      ${
        terrain
          ? `float hkN = hk_noise(vWorldPos.xz * 900.0) * 0.6 + hk_noise(vWorldPos.xz * 3500.0) * 0.4;
      if (uDetailOn > 0.5) {
        vec3 hkD1 = texture2D(uDetail, vWorldPos.xz * 1.6).rgb;
        vec3 hkD2 = texture2D(uDetail, vWorldPos.xz * 7.0).rgb;
        hkN = hkD1.r * 0.55 + hkD2.g * 0.3 + hkD1.b * 0.15 * (1.0 - vSlopeUp);
      }
      diffuseColor.rgb *= 0.86 + 0.28 * hkN;
      if (uOverlayOn > 0.5) {
        vec4 hkOv = texture2D(uOverlay, vWorldPos.xz / (uMapHalf * 2.0) + 0.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, hkOv.rgb, hkOv.a);
      }`
          : ''
      }
      // 積雪（雪線より上で、急すぎない面）
      float hkSnow = smoothstep(uSnowLine - 30.0, uSnowLine + 40.0, vElev) * smoothstep(0.55, 0.8, vSlopeUp);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.95, 0.97), hkSnow);
      // 濡れ（彩度・明度を下げる）
      float hkWet = uWet * (1.0 - smoothstep(uWetLine - 10.0, uWetLine + 10.0, vElev)) * (1.0 - hkSnow);
      diffuseColor.rgb *= 1.0 - 0.15 * hkWet;`,
    )
    .replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      // 雲の中は灰白色に霞む（俯瞰でも稜線が雲に隠れて見える）
      float hkFog = smoothstep(uCloudBase - 80.0, uCloudBase + 60.0, vElev) * uCloudCover * 0.85;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor * (1.0 - 0.75 * uNight), hkFog);
      gl_FragColor.rgb *= mix(vec3(1.0), vec3(0.35, 0.42, 0.62), uNight);`,
    );
}

export function injectEnv(material: THREE.Material, env: EnvUniforms, terrain = false): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, env);
    patchVertex(shader);
    patchFragment(shader, terrain);
  };
  material.customProgramCacheKey = () => (terrain ? 'hk-terrain' : 'hk-env');
}

export function createTerrainMaterial(env: EnvUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  injectEnv(m, env, true);
  return m;
}
