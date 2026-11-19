/**
 * 空・太陽・月・星・天の川（ユーザーの指定: 雨かしらR・ジオノスタルジカのように、日照・星空・月明かりを精緻に）。
 * - 空の色: 大気の散乱（atmosphere.ts）の表を、太陽と月それぞれの高さで引いて足す。薄明・地球の影・高い山の濃い青も出る
 * - 明るさ: 目が暗さに慣れる（明るさの比の 0.105 乗で見える明るさ。新月の夜は昼の 17%、満月で 26% ほど。ジオノスタルジカの夜の明るさに近い）
 * - 月: 本当の位置と大きさ、満ち欠けは太陽の向きで月面の写真を照らす。低い月は赤く暗い
 * - 星: HYG の 6 等星まで。見える限界の等級は太陽の高さと月明かりで決まる。地平線の近くは暗く赤い
 * - 天の川: 銀河座標で描く帯（射手座の方向が明るく、はくちょう座の暗黒帯）。暗い夜だけ
 * 太陽・月・空からの光の強さと色も、ここで決めて返す（sceneView が照明に使う）。
 */
import * as THREE from 'three';
import { assetUrl } from '../app/data';
import { DAY_METER, deepTwilightDim, LUT_AZ, LUT_EL, skyLut, transmittance } from './atmosphere';
import type { SkyState } from './astro';

/** 満月の光（月が天頂にあるとき）の、昼の太陽に対する明るさ（0.25 lx / 10 万 lx） */
const MOON_GAIN = 2.5e-6;
/** 月も太陽もない夜空の明るさ（大気光・星の光。昼の空の 4×10⁻⁸） */
const NIGHT_GLOW = 4e-8;
/** 目の慣れ: 見える明るさ = (明るさの比)^SEE_EXP */
const SEE_EXP = 0.105;
/** 空そのものの見え方の慣れ（ジオノスタルジカと同じ: 明るさの比の −0.7 乗、上限 1 万倍）。地面の照明より弱く慣れるので、夜空は暗い */
const SKY_ADAPT = 0.7;
const SKY_GAIN_MAX = 10000;
/** 月も太陽もない夜空の色（ジオノスタルジカの #0d1730 を線形に） */
const SKY_NIGHT = [0.004, 0.0085, 0.029] as const;
/** 昼（太陽 45°）の直射と空の光の強さ（three の値） */
const SUN_I_DAY = 3.0;
const HEMI_I_DAY = 0.85;

const luma = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
const T45 = luma(transmittance(45));

export interface SkyLight {
  sunColor: THREE.Color;
  sunIntensity: number;
  moonColor: THREE.Color;
  moonIntensity: number;
  ambientColor: THREE.Color;
  ambientIntensity: number;
  /** 地平線の空の色（霞・背景） */
  horizon: THREE.Color;
  /** 見える明るさ（昼 1） */
  seen: number;
  /** 0 = 昼、1 = 夜（太陽の高さから） */
  night: number;
}

export interface Sky {
  mesh: THREE.Group;
  update(camera: THREE.Camera, st: SkyState, cloud: number, timeSec: number): SkyLight;
}

function lutTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint16Array(LUT_AZ * LUT_EL * 4), LUT_AZ, LUT_EL, THREE.RGBAFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
function fillLut(t: THREE.DataTexture, data: Float32Array): void {
  const out = t.image.data as Uint16Array;
  for (let i = 0; i < LUT_AZ * LUT_EL; i += 1) {
    out[i * 4] = THREE.DataUtils.toHalfFloat(data[i * 3]!);
    out[i * 4 + 1] = THREE.DataUtils.toHalfFloat(data[i * 3 + 1]!);
    out[i * 4 + 2] = THREE.DataUtils.toHalfFloat(data[i * 3 + 2]!);
    out[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  t.needsUpdate = true;
}

const SKY_VERT = /* glsl */ `varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SKY_FRAG = /* glsl */ `
uniform sampler2D uSunLut, uMoonLut;
uniform vec3 uSunDir, uMoonDir, uGlow, uDisc, uNight;
uniform float uSunK, uMoonK, uCloud, uMilky;
uniform mat3 uHorToGal;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; } return s; }
vec3 lut(sampler2D t, vec3 d, vec3 L) {
  float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float v = sqrt(clamp((el + 8.0) / 98.0, 0.0, 1.0));
  vec2 a = normalize(d.xz + 1e-6), b = normalize(L.xz + 1e-6);
  float u = degrees(acos(clamp(dot(a, b), -1.0, 1.0))) / 180.0;
  return texture2D(t, vec2((u * ${(LUT_AZ - 1).toFixed(1)} + 0.5) / ${LUT_AZ.toFixed(1)}, (v * ${(LUT_EL - 1).toFixed(1)} + 0.5) / ${LUT_EL.toFixed(1)})).rgb;
}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = lut(uSunLut, d, uSunDir) * uSunK + lut(uMoonLut, d, uMoonDir) * uMoonK + uGlow;
  // 天の川（暗い夜だけ。地平線の近くは空気で薄れる）
  if (uMilky > 0.001 && d.y > -0.02) {
    vec3 g = uHorToGal * d;
    float b = asin(clamp(g.z, -1.0, 1.0));
    float l = atan(g.y, g.x);
    float band = exp(-pow(b / 0.16, 2.0)) * (0.5 + 0.5 * cos(l * 0.9)) + exp(-pow(l / 0.5, 2.0) - pow(b / 0.22, 2.0)) * 1.4;
    float clump = fbm(vec2(l * 9.0, b * 18.0));
    // 暗黒帯（はくちょう座〜わし座〜いて座の、銀河面のすぐ北）
    float rift = exp(-pow((b - 0.035) / 0.03, 2.0)) * smoothstep(1.4, 0.2, abs(l - 0.6)) * smoothstep(0.35, 0.7, fbm(vec2(l * 6.0, b * 30.0) + 7.0));
    float mw = band * (0.45 + 0.9 * clump) * (1.0 - 0.75 * rift);
    col += vec3(0.78, 0.82, 1.0) * mw * uMilky * smoothstep(-0.02, 0.25, d.y);
  }
  // 曇り: 空は灰色に（明るさは呼ぶ側で落としている）
  float y = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(y) * vec3(0.96, 0.98, 1.02), smoothstep(0.15, 0.9, uCloud));
  // 太陽の円盤（視半径 0.27°、周辺減光）とすぐまわりのにじみ
  float c = dot(d, uSunDir);
  float ang = acos(clamp(c, -1.0, 1.0));
  float disc = 1.0 - smoothstep(0.0044, 0.0050, ang);
  float limb = sqrt(max(0.0, 1.0 - pow(ang / 0.0047, 2.0)));
  col += uDisc * (disc * (0.45 + 0.55 * limb) * 40.0 + exp(-ang * 55.0) * 0.6 + exp(-ang * 9.0) * 0.08);
  // 空の階調はジオノスタルジカと同じく 1 − exp(−x)（暗い薄明の空が黒につぶれない）。ACES は使わない
  // 地平線より下（台座の下に見える所）は、地面の照り返しの暗い色へ
  col *= mix(0.3, 1.0, smoothstep(-0.25, 0.0, d.y));
  col = 1.0 - exp(-col * 1.5) + uNight;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** 星の色（B−V から）。ホシノグラフィカと同じ表 */
const BV_TABLE: [number, number, number, number][] = [
  [-0.4, 155, 176, 255], [-0.15, 170, 191, 255], [0, 202, 215, 255], [0.15, 232, 238, 255], [0.3, 255, 247, 245], [0.45, 255, 244, 232],
  [0.6, 255, 240, 220], [0.8, 255, 229, 196], [1.0, 255, 219, 174], [1.2, 255, 206, 150], [1.4, 255, 195, 130], [1.7, 255, 180, 110], [2.0, 255, 167, 90],
];
function bvRGB(bv: number): [number, number, number] {
  if (bv <= BV_TABLE[0]![0]) return [BV_TABLE[0]![1], BV_TABLE[0]![2], BV_TABLE[0]![3]];
  for (let k = 1; k < BV_TABLE.length; k += 1) {
    const b = BV_TABLE[k]!;
    if (bv <= b[0]) {
      const a = BV_TABLE[k - 1]!;
      const w = (bv - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w, a[3] + (b[3] - a[3]) * w];
    }
  }
  const z = BV_TABLE[BV_TABLE.length - 1]!;
  return [z[1], z[2], z[3]];
}
/** 太陽の高さ（度）と、見える限界の等級（ジオノスタルジカの表） */
const STAR_LIM: [number, number][] = [[-1, -2.0], [-3, -0.5], [-6, 1.5], [-9, 3.5], [-12, 5.0], [-15, 5.7], [-18, 6.0]];
function limitingMag(sunEl: number): number {
  if (sunEl >= STAR_LIM[0]![0]) return -9;
  for (let k = 1; k < STAR_LIM.length; k += 1) {
    const b = STAR_LIM[k]!;
    if (sunEl >= b[0]) {
      const a = STAR_LIM[k - 1]!;
      return a[1] + ((b[1] - a[1]) * (sunEl - a[0])) / (b[0] - a[0]);
    }
  }
  return 6.0;
}

export function createSky(radius: number): Sky {
  const group = new THREE.Group();
  group.frustumCulled = false;
  const sunLut = lutTexture();
  const moonLut = lutTexture();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uSunLut: { value: sunLut },
      uMoonLut: { value: moonLut },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uGlow: { value: new THREE.Color() },
      uNight: { value: new THREE.Color(SKY_NIGHT[0], SKY_NIGHT[1], SKY_NIGHT[2]) },
      uDisc: { value: new THREE.Color() },
      uSunK: { value: 1 },
      uMoonK: { value: 0 },
      uCloud: { value: 0 },
      uMilky: { value: 0 },
      uHorToGal: { value: new THREE.Matrix3() },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    toneMapped: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), mat);
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  group.add(dome);

  // ---- 星 ----
  const R = radius * 0.9;
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uM: { value: new THREE.Matrix3() }, uLim: { value: -9 }, uPR: { value: 1 }, uR: { value: R }, uK: { value: 1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute float mag;
      uniform mat3 uM; uniform float uLim, uPR, uR, uK, uTime;
      varying vec3 vC;
      void main() {
        vec3 d = uM * position;
        // 地平線に近いほど厚い空気を通る（暗く、赤く）
        float am = min(1.0 / max(d.y + 0.03, 0.025), 38.0);
        float m = mag + 0.25 * (am - 1.0);
        float vis = clamp((uLim - m) / 1.2 + 0.3, 0.0, 1.0);
        if (d.y < -0.03 || vis <= 0.0 || uK <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + d * uR, 1.0);
        gl_PointSize = clamp(1.4 + (uLim - m) * 0.5, 1.4, 5.0) * uPR;
        // またたき（地平線に近いほど強い）
        float tw = 1.0 + (0.12 + 0.3 * smoothstep(0.4, 0.0, d.y)) * sin(uTime * (6.0 + fract(mag * 13.7) * 9.0) + position.x * 900.0);
        vec3 red = vec3(1.0, 0.72, 0.5);
        vC = color * mix(vec3(1.0), red, smoothstep(0.25, 0.0, d.y)) * vis * tw * uK * (0.7 + 0.8 * clamp((uLim - m) / 3.0, 0.0, 1.0));
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.15, r);
        if (a < 0.01) discard;
        gl_FragColor = vec4(vC * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
  let stars: THREE.Points | null = null;
  fetch(assetUrl('sky/stars.json'))
    .then((r) => (r.ok ? (r.json() as Promise<{ n: number; ra: number[]; dec: number[]; mag: number[]; bv: number[] }>) : Promise.reject(new Error(String(r.status)))))
    .then((st) => {
      const n = st.n;
      const pos = new Float32Array(n * 3);
      const colA = new Float32Array(n * 3);
      const mag = new Float32Array(n);
      const D = Math.PI / 180;
      for (let i = 0; i < n; i += 1) {
        const ra = st.ra[i]! * D;
        const de = st.dec[i]! * D;
        pos[i * 3] = Math.cos(de) * Math.cos(ra);
        pos[i * 3 + 1] = Math.cos(de) * Math.sin(ra);
        pos[i * 3 + 2] = Math.sin(de);
        const c = bvRGB(st.bv[i]!);
        colA[i * 3] = c[0] / 255;
        colA[i * 3 + 1] = c[1] / 255;
        colA[i * 3 + 2] = c[2] / 255;
        mag[i] = st.mag[i]!;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colA, 3));
      g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
      stars = new THREE.Points(g, starMat);
      stars.frustumCulled = false;
      stars.renderOrder = -90;
      group.add(stars);
    })
    .catch(() => undefined); // 星の表が読めなければ、星なしの空のまま

  // ---- 月（月面の写真を太陽の向きで照らして満ち欠け。まわりに淡いにじみ） ----
  const MOON_K = 5;
  const moonMat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: null as THREE.Texture | null }, uHasTex: { value: 0 }, uD: { value: new THREE.Vector3(0, 1, 0) }, uRt: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 0, -1) },
      uL: { value: new THREE.Vector3(0, 0, 1) }, uSize: { value: 1 }, uR: { value: R * 0.98 }, uBright: { value: 1 }, uGlow: { value: 0.5 }, uTint: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uD, uRt, uUp; uniform float uSize, uR;
      varying vec2 vUv;
      void main() {
        vUv = position.xy * ${MOON_K.toFixed(1)};
        vec3 wp = cameraPosition + uD * uR + (uRt * position.x + uUp * position.y) * uSize * ${(2 * MOON_K).toFixed(1)};
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex; uniform vec3 uL, uTint; uniform float uBright, uGlow, uHasTex;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        vec3 col = vec3(0.0);
        if (r < 1.0) {
          vec3 n = vec3(vUv.x, vUv.y, sqrt(1.0 - r * r));
          vec2 tuv = vec2(0.5 + atan(n.x, n.z) / 6.2831853, 0.5 + asin(clamp(n.y, -1.0, 1.0)) / 3.1415927);
          vec3 alb = uHasTex > 0.5 ? texture2D(uTex, tuv).rgb * 1.25 : vec3(0.8);
          float li = smoothstep(-0.03, 0.07, dot(n, uL));
          col = alb * (li + 0.018) * uTint; // 0.018: 地球照
          col *= smoothstep(1.0, 0.94, r);
        }
        col += uTint * vec3(0.78, 0.84, 1.0) * uGlow * exp(-max(r - 1.0, 0.0) * 1.6) * 0.06 * smoothstep(1.0, 1.08, r) * (1.0 - smoothstep(${(MOON_K - 0.5).toFixed(1)}, ${MOON_K.toFixed(1)}, r));
        gl_FragColor = vec4(col * uBright, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), moonMat);
  moon.frustumCulled = false;
  moon.renderOrder = -85;
  group.add(moon);
  new THREE.TextureLoader().load(assetUrl('sky/moon.jpg'), (t) => {
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    moonMat.uniforms['uTex']!.value = t;
    moonMat.uniforms['uHasTex']!.value = 1;
  });

  const u = mat.uniforms;
  let sunKey = NaN;
  let moonKey = NaN;
  const light: SkyLight = {
    sunColor: new THREE.Color(),
    sunIntensity: 0,
    moonColor: new THREE.Color(),
    moonIntensity: 0,
    ambientColor: new THREE.Color(),
    ambientIntensity: 0,
    horizon: new THREE.Color(),
    seen: 1,
    night: 0,
  };
  const tmpC = new THREE.Color();
  const rt = new THREE.Vector3();

  return {
    mesh: group,
    update(camera, st, cloud, timeSec) {
      group.position.copy(camera.position);
      const sunEl = st.sunElDeg;
      const moonEl = st.moonElDeg;
      // 空の表（0.25° 刻み）
      const ls = skyLut(sunEl);
      const lm = skyLut(moonEl);
      const sk = Math.round(Math.max(sunEl, -5) * 4);
      const mk = Math.round(Math.max(moonEl, -5) * 4);
      if (sk !== sunKey) {
        sunKey = sk;
        fillLut(sunLut, ls.data);
      }
      if (mk !== moonKey) {
        moonKey = mk;
        fillLut(moonLut, lm.data);
      }
      const dimSun = deepTwilightDim(sunEl);
      const moonOn = st.moonBright > 0 && moonEl > -8;
      const moonK = moonOn ? MOON_GAIN * st.moonBright * deepTwilightDim(moonEl) : 0;
      // 曇りは空の明るさを落とす（雲の下は暗い）
      const cloudDim = 1 - 0.55 * cloud;
      const Y = (ls.meter * dimSun + lm.meter * moonK) * cloudDim + DAY_METER * NIGHT_GLOW;
      const ratio = Y / DAY_METER;
      const seen = Math.min(1.05, Math.pow(ratio, SEE_EXP));
      const G = seen / ratio; // 地面を照らす光の慣れ（昼 1、夜は数十万倍）
      const Gs = Math.min(SKY_GAIN_MAX, Math.pow(1 / ratio, SKY_ADAPT)); // 空の見え方の慣れ
      u['uSunK']!.value = dimSun * cloudDim * Gs;
      u['uMoonK']!.value = moonK * cloudDim * Gs;
      (u['uSunDir']!.value as THREE.Vector3).copy(st.sunDir);
      (u['uMoonDir']!.value as THREE.Vector3).copy(st.moonDir);
      // 大気光（月のない夜空のほのかな明るさ）。慣れた目には暗い青灰色
      (u['uGlow']!.value as THREE.Color).setRGB(0.55, 0.66, 1.0).multiplyScalar(0.17 * NIGHT_GLOW * Gs * cloudDim);
      // 夜空の底の色は、夜だけ（昼の空には足さない）
      (u['uNight']!.value as THREE.Color).setRGB(SKY_NIGHT[0], SKY_NIGHT[1], SKY_NIGHT[2]).multiplyScalar(1 - THREE.MathUtils.smoothstep(sunEl, -8, 0));
      u['uCloud']!.value = cloud;
      (u['uHorToGal']!.value as THREE.Matrix3).copy(st.horToGal);
      // 太陽の円盤の色（大気を抜けてきた光。雲で隠れる）
      const T = transmittance(sunEl);
      (u['uDisc']!.value as THREE.Color).setRGB(T[0], T[1], T[2]).multiplyScalar((sunEl > -1 ? 1 : 0) * (1 - 0.95 * cloud * cloud) * Gs);
      // 星と天の川: 見える限界の等級（太陽の高さで決め、月明かりで下げる）。雲で隠れる
      const moonUp = THREE.MathUtils.smoothstep(moonEl, -1, 10);
      const lim = limitingMag(sunEl) - 1.2 * st.moonFrac * moonUp;
      starMat.uniforms['uM']!.value.copy(st.starMatrix);
      starMat.uniforms['uLim']!.value = lim;
      starMat.uniforms['uK']!.value = Math.max(0, 1 - cloud * 1.15);
      starMat.uniforms['uTime']!.value = timeSec;
      starMat.uniforms['uPR']!.value = Math.min(2, window.devicePixelRatio || 1);
      if (stars) stars.visible = lim > -1.5 && cloud < 0.85;
      u['uMilky']!.value = THREE.MathUtils.smoothstep(lim, 4.6, 5.9) * Math.max(0, 1 - cloud * 1.3) * 0.05;
      // 月の円盤
      moon.visible = moonEl > -1 && st.moonBright > 0;
      if (moon.visible) {
        const md = st.moonDir;
        rt.crossVectors(md, st.moonUp).normalize();
        moonMat.uniforms['uD']!.value.copy(md);
        moonMat.uniforms['uUp']!.value.copy(st.moonUp);
        moonMat.uniforms['uRt']!.value.copy(rt);
        moonMat.uniforms['uL']!.value.set(st.sunDir.dot(rt), st.sunDir.dot(st.moonUp), -st.sunDir.dot(md));
        moonMat.uniforms['uSize']!.value = R * 0.98 * Math.tan((st.moonRadiusDeg * Math.PI) / 180);
        const Tm = transmittance(moonEl);
        const tm = Math.max(Tm[0], Tm[1], Tm[2]) || 1;
        (moonMat.uniforms['uTint']!.value as THREE.Color).setRGB(Tm[0] / tm, Tm[1] / tm, Tm[2] / tm).multiplyScalar(Math.min(1, luma(Tm) / T45 + 0.15));
        const day = 1 - (light.night = 1 - THREE.MathUtils.smoothstep(sunEl, -10, 2));
        moonMat.uniforms['uBright']!.value = (1 - 0.65 * day) * Math.max(0, 1 - cloud * 1.1);
        moonMat.uniforms['uGlow']!.value = st.moonFrac * (1 - day);
      }

      // ---- 照明 ----
      light.night = 1 - THREE.MathUtils.smoothstep(sunEl, -10, 2);
      // 太陽の直射: 大気を抜けてきた光。地平線に沈むにつれて消える
      const tmx = Math.max(T[0], T[1], T[2]) || 1;
      light.sunColor.setRGB(T[0] / tmx, T[1] / tmx, T[2] / tmx);
      light.sunIntensity = SUN_I_DAY * (luma(T) / T45) * G * (1 - 0.78 * cloud * cloud) * THREE.MathUtils.smoothstep(sunEl, -0.8, 1.5);
      // 月の光: 満ち欠けと高さ。慣れた目には青白く見える
      const Tm = transmittance(moonEl);
      const red = 1 - Math.min(Tm[0], Tm[1], Tm[2]) / (Math.max(Tm[0], Tm[1], Tm[2]) || 1);
      light.moonColor.setRGB(0.62, 0.74, 1.0).lerp(tmpC.setRGB(1.0, 0.72, 0.45), red * 0.7);
      light.moonIntensity = moonOn ? SUN_I_DAY * MOON_GAIN * st.moonBright * (luma(Tm) / T45) * G * (1 - 0.6 * cloud) * THREE.MathUtils.smoothstep(moonEl, -0.5, 3) : 0;
      // 空からの光（半球ライト）: 空の平均の色。暗いほど色が抜けて青灰色に（暗いところでは色が見えにくい）
      tmpC.copy(ls.ambient).multiplyScalar(dimSun).add(lm.ambient.clone().multiplyScalar(moonK));
      const am = Math.max(tmpC.r, tmpC.g, tmpC.b) || 1;
      light.ambientColor.setRGB(tmpC.r / am, tmpC.g / am, tmpC.b / am);
      const scot = 1 - THREE.MathUtils.smoothstep(seen, 0.15, 0.45);
      light.ambientColor.lerp(tmpC.setRGB(0.55, 0.65, 0.9), scot * 0.8);
      light.ambientColor.lerp(tmpC.setRGB(0.82, 0.85, 0.9), cloud * 0.7);
      // 夜は空の光の割合が大きい（直射がないぶん、慣れた目には空全体からの光で地形が見える）
      light.ambientIntensity = HEMI_I_DAY * seen * (1 + 0.45 * cloud) * (1 + 0.8 * light.night);
      // 地平線の空の色（霞）
      const hi = Math.round(((Math.sqrt(9 / 98) * (LUT_EL - 1)) | 0)) * LUT_AZ * 3;
      let hr = 0;
      let hg = 0;
      let hb = 0;
      for (let j = 0; j < LUT_AZ; j += 1) {
        hr += ls.data[hi + j * 3]! * dimSun + lm.data[hi + j * 3]! * moonK;
        hg += ls.data[hi + j * 3 + 1]! * dimSun + lm.data[hi + j * 3 + 1]! * moonK;
        hb += ls.data[hi + j * 3 + 2]! * dimSun + lm.data[hi + j * 3 + 2]! * moonK;
      }
      light.horizon.setRGB(hr / LUT_AZ, hg / LUT_AZ, hb / LUT_AZ).multiplyScalar(cloudDim * Gs);
      light.horizon.r = 1 - Math.exp(-light.horizon.r * 1.5);
      light.horizon.g = 1 - Math.exp(-light.horizon.g * 1.5);
      light.horizon.b = 1 - Math.exp(-light.horizon.b * 1.5);
      light.horizon.add(tmpC.setRGB(SKY_NIGHT[0], SKY_NIGHT[1], SKY_NIGHT[2]).multiplyScalar(1 - THREE.MathUtils.smoothstep(sunEl, -8, 0)));
      const hy = light.horizon.r * 0.2126 + light.horizon.g * 0.7152 + light.horizon.b * 0.0722;
      light.horizon.lerp(tmpC.setRGB(hy, hy, hy * 1.03), Math.min(1, cloud * 1.1));
      light.seen = seen;
      return light;
    },
  };
}
