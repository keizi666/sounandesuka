/**
 * 空（見た目の改善）。天頂から地平への階調、太陽とその周りの光、夜の星を描く半球。
 * 色は太陽高度・雲量から決める。カメラに付いて動く。
 */
import * as THREE from 'three';

export interface SkyColors {
  top: THREE.Color;
  horizon: THREE.Color;
  /** 地面からの照り返しの色（半球ライトの下側） */
  ground: THREE.Color;
  /** 0 = 昼、1 = 夜 */
  night: number;
}

const C = (h: number): THREE.Color => new THREE.Color(h);
const DAY_TOP = C(0x2f6fc4);
const DAY_HOR = C(0xb4d2ec);
const CLOUD_TOP = C(0x7f8a96);
const CLOUD_HOR = C(0xb4bac0);
const DUSK_TOP = C(0x3a4674);
const DUSK_HOR = C(0xf2a468);
const NIGHT_TOP = C(0x03050c);
const NIGHT_HOR = C(0x0e1626);

/** 太陽高度（度）と雲量から空の色を決める */
export function skyColors(sunElevDeg: number, cloud: number): SkyColors {
  const day = THREE.MathUtils.smoothstep(sunElevDeg, -2, 12);
  const dusk = 1 - Math.min(1, Math.abs(sunElevDeg - 1) / 9);
  const night = 1 - THREE.MathUtils.smoothstep(sunElevDeg, -9, 0);
  const top = NIGHT_TOP.clone().lerp(DAY_TOP, day);
  const horizon = NIGHT_HOR.clone().lerp(DAY_HOR, day);
  const k = Math.max(0, dusk) * (1 - 0.7 * cloud);
  top.lerp(DUSK_TOP, k * 0.7);
  horizon.lerp(DUSK_HOR, k * 0.85);
  // 曇り: 灰色に寄せる（夜は暗いまま）
  const g = cloud * cloud * (1 - night);
  top.lerp(CLOUD_TOP, g * 0.9);
  horizon.lerp(CLOUD_HOR, g * 0.9);
  const ground = new THREE.Color(0x6a5d4a).multiplyScalar(0.25 + 0.75 * day);
  return { top, horizon, ground, night };
}

export interface Sky {
  mesh: THREE.Mesh;
  update(camera: THREE.Camera, colors: SkyColors, sunDir: THREE.Vector3, sunColor: THREE.Color, cloud: number): void;
}

export function createSky(radius: number): Sky {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSun: { value: 1 },
      uStars: { value: 0 },
    },
    vertexShader: /* glsl */ `varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSun; uniform float uStars;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -1.0, 1.0);
        // 地平に近いほど白っぽく霞む。地平より下は霞の色を少し暗くして続ける
        vec3 col = mix(uHorizon, uTop, pow(max(h, 0.0), 0.55));
        col = mix(col, uHorizon * 0.82, (1.0 - smoothstep(-0.35, 0.0, h)));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * uSun * (pow(s, 900.0) * 6.0 + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);
        // 星
        vec3 g = floor(d * 220.0);
        float st = step(0.9975, hash(g)) * (0.4 + 0.6 * hash(g + 3.1));
        col += vec3(st) * uStars * smoothstep(0.0, 0.25, h);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), mat);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  const u = mat.uniforms;
  return {
    mesh,
    update(camera, colors, sunDir, sunColor, cloud) {
      mesh.position.copy(camera.position);
      (u['uTop']!.value as THREE.Color).copy(colors.top);
      (u['uHorizon']!.value as THREE.Color).copy(colors.horizon);
      (u['uSunDir']!.value as THREE.Vector3).copy(sunDir);
      (u['uSunColor']!.value as THREE.Color).copy(sunColor);
      u['uSun']!.value = (1 - colors.night) * (1 - 0.92 * cloud * cloud);
      u['uStars']!.value = colors.night * (1 - cloud);
    },
  };
}
