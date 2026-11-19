/**
 * 気象の計算（テングラフィカ由来のワーカー src/workers/kishouCfd.worker.js）を箱庭の地形の上で動かし、
 * 雲・雨の筋を立体（レイマーチング）で描く。後処理の 1 段として、場面の奥行き（深度）を見て、地形や人の手前で止める。
 *
 * - 計算の条件（地上気温・湿り・風・大規模な上昇気流）は、シナリオの天気（World.weather）から作り、ゲーム内 10 分ごとに寄せる
 *   （シミュレーションの天気が正。計算は見た目のためで、登山者の体や結末には使わない＝決定論を保つ）
 * - 雲底より上を湿らせるので、風上の斜面で雲が湧き、稜線を越えると切れる、といった地形と風による雲の出方が再現される
 * - 注目している登山者の周りとカメラからの見通しの線の上は、雲を薄くする（人が見えなくならないように）
 */
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { MapRuntime, ScenarioDef, World } from '../sim/types';
import { toSceneY, UNIT, type ViewScale } from './scale';

/** 計算の上端（km）。箱庭の山（〜3 km）に合わせて低めにし、鉛直の格子を細かくする */
const H_TOP_KM = 9;

function makeNoise3D(N = 32): THREE.Data3DTexture {
  const data = new Uint8Array(N * N * N);
  let seed = 1234567;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const octs = [4, 8, 16].map((c) => {
    const p = new Float32Array(c * c * c * 3);
    for (let i = 0; i < p.length; i += 1) p[i] = rnd();
    return { c, p };
  });
  const worley = (o: { c: number; p: Float32Array }, x: number, y: number, z: number): number => {
    const c = o.c;
    const fx = x * c;
    const fy = y * c;
    const fz = z * c;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const iz = Math.floor(fz);
    let best = 9;
    for (let dz = -1; dz <= 1; dz += 1)
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const cx = ix + dx;
          const cy = iy + dy;
          const cz = iz + dz;
          const k = ((((cx % c) + c) % c) + c * ((((cy % c) + c) % c) + c * (((cz % c) + c) % c))) * 3;
          const d = (cx + o.p[k]! - fx) ** 2 + (cy + o.p[k + 1]! - fy) ** 2 + (cz + o.p[k + 2]! - fz) ** 2;
          if (d < best) best = d;
        }
    return Math.min(1, Math.sqrt(best));
  };
  for (let z = 0; z < N; z += 1)
    for (let y = 0; y < N; y += 1)
      for (let x = 0; x < N; x += 1) {
        const px = (x + 0.5) / N;
        const py = (y + 0.5) / N;
        const pz = (z + 0.5) / N;
        const v = 0.6 * (1 - worley(octs[0]!, px, py, pz)) + 0.27 * (1 - worley(octs[1]!, px, py, pz)) + 0.13 * (1 - worley(octs[2]!, px, py, pz));
        data[x + N * (y + N * z)] = Math.max(0, Math.min(255, v * 255));
      }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RedFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

function make3D(nx: number, ny: number, nz: number): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(new Uint8Array(nx * ny * nz * 4), nx, ny, nz);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler3D uVolA0, uVolA1, uNoise;
uniform float uBlend, uL, uH, uVE, uYOff, uY0, uY1, uTime, uSteps, uNight, uFlash, uFocusR, uOn;
uniform vec3 uSunDir, uSunColor, uSkyColor, uGroundColor, uWindOff, uFocus;
uniform mat4 uInvProj, uCamWorld;
varying vec2 vUv;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 toTex(vec3 p) { return vec3(p.x / uL + 0.5, -p.z / uL + 0.5, (p.y / uVE + uYOff) / uH); }
vec4 volA(vec3 t) { return mix(texture(uVolA0, t), texture(uVolA1, t), uBlend); }
float cloudWater(vec4 a) { return a.r * a.r * 3.0; }
float precipWater(vec4 a) { return a.g * a.g * 6.0; }
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
// 注目している登山者の周りと、カメラからの見通しの線の上は薄く
float clearAt(vec3 p) {
  if (uFocusR <= 0.0) return 1.0;
  vec3 ab = uFocus - cameraPosition;
  float tt = clamp(dot(p - cameraPosition, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
  float ld = length(p - (cameraPosition + ab * tt));
  float fd = distance(p, uFocus);
  return min(mix(0.08, 1.0, smoothstep(uFocusR * 2.0, uFocusR * 6.0, ld)), mix(0.05, 1.0, smoothstep(uFocusR * 3.0, uFocusR * 10.0, fd)));
}
float density(vec3 p, vec3 tc, out float precip, out float tempK) {
  vec4 a = volA(tc);
  float qc = cloudWater(a);
  precip = precipWater(a);
  tempK = a.b * 120.0 + 193.0;
  if (qc < 0.006) return 0.0;
  float ice = smoothstep(258.0, 238.0, tempK);
  vec3 q = p + uWindOff;
  vec3 qs = vec3(q.x, q.y * 2.0 / mix(1.0, 0.45, ice), q.z);
  float n1 = texture(uNoise, qs * 0.35).r;
  float n2 = texture(uNoise, qs * 1.05 + vec3(0.3, 0.1, 0.7)).r;
  float n3 = texture(uNoise, qs * 3.1 + vec3(0.7, 0.4, 0.2)).r;
  float base = clamp(qc * 3.2, 0.0, 1.6);
  float d = base - (1.0 - n1) * 0.42 - (1.0 - n2) * 0.25 - (1.0 - n3) * 0.1 + 0.27;
  d = max(d, 0.0) * mix(1.0, 0.35, ice);
  float edge = min(min(tc.x, 1.0 - tc.x), min(tc.y, 1.0 - tc.y));
  d *= smoothstep(0.0, 0.05, edge);
  return d;
}
float lightMarch(vec3 p) {
  vec3 L = uSunDir.y > -0.05 ? uSunDir : vec3(0.0, 1.0, 0.0);
  float st = 0.12;
  float acc = 0.0;
  for (int i = 0; i < 6; i++) {
    vec3 q = p + L * st * (float(i) + 0.5);
    vec3 tc = toTex(q);
    if (tc.z > 1.0 || tc.x < 0.0 || tc.x > 1.0 || tc.y < 0.0 || tc.y > 1.0) break;
    vec4 a = volA(tc);
    acc += (clamp(cloudWater(a) * 3.2, 0.0, 1.6) * 0.8 + precipWater(a) * 0.05) * st * 6.0;
    st *= 1.4;
  }
  return acc;
}
void main() {
  vec4 scene = texture2D(tDiffuse, vUv);
  if (uOn < 0.5) { gl_FragColor = scene; return; }
  // 場面の奥行き（深度）から、この画素の地面・物までの距離
  float depth = texture2D(tDepth, vUv).x;
  vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 vp = uInvProj * ndc; vp /= vp.w;
  vec3 wp = (uCamWorld * vp).xyz;
  vec3 ro = cameraPosition;
  vec3 rd = normalize(wp - ro);
  float tScene = depth >= 0.99999 ? 1e9 : length(wp - ro);
  vec3 bmin = vec3(-uL * 0.5, uY0, -uL * 0.5), bmax = vec3(uL * 0.5, uY1, uL * 0.5);
  vec3 inv = 1.0 / rd;
  vec3 t0s = (bmin - ro) * inv, t1s = (bmax - ro) * inv;
  vec3 tsm = min(t0s, t1s), tbg = max(t0s, t1s);
  float tN = max(max(tsm.x, tsm.y), max(tsm.z, 0.0));
  float tF = min(min(min(tbg.x, tbg.y), tbg.z), tScene);
  if (tF <= tN) { gl_FragColor = scene; return; }
  float span = tF - tN;
  float stepLen = max(span / uSteps, 0.004);
  float t = tN + stepLen * hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 61.0);
  float T = 1.0;
  vec3 col = vec3(0.0);
  float cosT = dot(rd, uSunDir);
  float phase = mix(hg(cosT, 0.7), hg(cosT, -0.15), 0.35) * 4.0 * 3.14159;
  bool coarse = true;
  for (int i = 0; i < 260; i++) {
    if (t > tF || T < 0.02 || float(i) > uSteps * 2.5) break;
    vec3 p = ro + rd * t;
    vec3 tc = toTex(p);
    float pr, tk;
    float d = density(p, tc, pr, tk);
    float dr = smoothstep(0.05, 3.0, pr) * 0.16;
    float cl = clearAt(p);
    d *= cl; dr *= cl;
    if (d > 0.0 || dr > 0.002) {
      if (coarse) { coarse = false; t = max(tN, t - stepLen * 1.5); continue; }
      float sigma = d * 9.0 + dr * 2.0;
      float od = lightMarch(p);
      float sh = exp(-od * 1.4) + 0.22 * exp(-od * 0.3);
      float h01 = clamp(tc.z * 2.5, 0.0, 1.0);
      vec3 amb = mix(uGroundColor * 1.2 + uSkyColor * 0.25, uSkyColor * 0.95, h01) * (0.35 + 0.65 * exp(-od * 0.18));
      float powder = 1.0 - exp(-d * 4.0);
      vec3 c = uSunColor * sh * phase * mix(0.6, 1.0, powder) * 0.5 + amb;
      float rf = dr / max(sigma, 1e-4);
      c = mix(c, (amb * 0.6 + uSunColor * sh * 0.05) * (tk < 273.0 ? 1.4 : 0.75), rf);
      c += vec3(0.75, 0.8, 1.0) * uFlash * 3.0;
      float a = 1.0 - exp(-sigma * stepLen * 10.0);
      col += T * a * c;
      T *= 1.0 - a;
      t += stepLen;
    } else {
      coarse = true;
      t += stepLen * 2.5;
    }
  }
  gl_FragColor = vec4(scene.rgb * T + col, scene.a);
}`;

class CloudPass extends Pass {
  readonly mat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  constructor(private camera: THREE.PerspectiveCamera, uniforms: Record<string, THREE.IUniform>) {
    super();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, ...uniforms },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.mat.uniforms;
    u['tDiffuse']!.value = readBuffer.texture;
    u['tDepth']!.value = readBuffer.depthTexture;
    (u['uInvProj']!.value as THREE.Matrix4).copy(this.camera.projectionMatrixInverse);
    (u['uCamWorld']!.value as THREE.Matrix4).copy(this.camera.matrixWorld);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose(): void {
    this.mat.dispose();
    this.quad.dispose();
  }
}

export interface KishouClouds {
  /** 後処理に差し込む段 */
  pass: Pass;
  /** 計算が動いていて、立体の雲を描いているか（動いていれば、従来の点の雲は隠す） */
  readonly active: boolean;
  /** 毎フレーム。gameSecPerRealSec はゲームの速さ（一時停止なら 0） */
  update(world: World, o: { gameSecPerRealSec: number; timeSec: number; sunDir: THREE.Vector3; sunColor: THREE.Color; sunIntensity: number; skyColor: THREE.Color; groundColor: THREE.Color; night: number; flash: number; focus: THREE.Vector3; focusR: number }): void;
  /** 地点の風（m/s）と降水の強さ（雲の中の雨粒）。音に使う。計算がまだなら null */
  sample(xM: number, zM: number, elevM: number): { windMs: number; rain: number } | null;
  dispose(): void;
}

export function createKishouClouds(map: MapRuntime, scenario: ScenarioDef, s: ViewScale, camera: THREE.PerspectiveCamera, quality: 'mid' | 'high'): KishouClouds {
  const nx = quality === 'high' ? 56 : 44;
  const ny = nx;
  const nz = quality === 'high' ? 30 : 24;
  const Lkm = map.def.size / 1000;
  // 計算の格子へ地形を落とす（セルの平均。格子の j は北向き = シーンの -z 向き）
  const heights = new Float32Array(nx * ny);
  const sea = new Uint8Array(nx * ny);
  const n = map.n;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const gx0 = Math.floor((i / nx) * (n - 1));
      const gx1 = Math.ceil(((i + 1) / nx) * (n - 1));
      // j = 0 は南の端（マップの gz = n-1）
      const gz1 = n - 1 - Math.floor((j / ny) * (n - 1));
      const gz0 = n - 1 - Math.ceil(((j + 1) / ny) * (n - 1));
      let sum = 0;
      let c = 0;
      for (let gz = Math.max(0, gz0); gz <= Math.min(n - 1, gz1); gz += 1)
        for (let gx = gx0; gx <= Math.min(n - 1, gx1); gx += 1) {
          sum += map.heights[gz * n + gx]!;
          c += 1;
        }
      heights[i + nx * j] = c > 0 ? sum / c : 0;
    }
  }
  const texA0 = make3D(nx, ny, nz);
  const texA1 = make3D(nx, ny, nz);
  const noise = makeNoise3D(32);
  const uniforms: Record<string, THREE.IUniform> = {
    uVolA0: { value: texA0 },
    uVolA1: { value: texA1 },
    uNoise: { value: noise },
    uBlend: { value: 1 },
    uL: { value: Lkm },
    uH: { value: H_TOP_KM },
    uVE: { value: s.vExag },
    uYOff: { value: (s.baseElevM - s.plinthM) / 1000 },
    uY0: { value: Math.max(0, toSceneY(s, 0)) },
    uY1: { value: toSceneY(s, H_TOP_KM * 1000) },
    uTime: { value: 0 },
    uSteps: { value: quality === 'high' ? 72 : 52 },
    uNight: { value: 0 },
    uFlash: { value: 0 },
    uFocusR: { value: 0 },
    uOn: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSkyColor: { value: new THREE.Color(0.6, 0.7, 0.85) },
    uGroundColor: { value: new THREE.Color(0.3, 0.28, 0.24) },
    uWindOff: { value: new THREE.Vector3() },
    uFocus: { value: new THREE.Vector3() },
  };
  const pass = new CloudPass(camera, uniforms);

  // ---- 計算の条件（シナリオの天気から） ----
  const sw = scenario.weather;
  const lat = map.def.geo?.centerLat ?? 36.2;
  const month = Number(scenario.startDate.slice(5, 7)) || 7;
  const day = Number(scenario.startDate.slice(8, 10)) || 1;
  const doy = Math.round((month - 1) * 30.5 + day);
  const paramsOf = (w: World): Record<string, unknown> => {
    const g = w.weather;
    const lapse = Math.max(5, Math.min(8, sw.lapseRateCPer100m * 10));
    const tsfc = g.tempC + (lapse * sw.refElevM) / 1000;
    // 湿り: 雲底より上は飽和に近く、下は乾いている。雲量が多いほど厚く湿らせる
    const baseKm = Math.max(0.2, g.cloudBaseM / 1000);
    const thick = 0.6 + 2.2 * g.cloudCover + (g.precipMmH > 0.5 ? 1.5 : 0) + 4 * g.thunder;
    const rhProf: number[] = [];
    for (let k = 0; k <= 12; k += 1) {
      const z = k + 0.5;
      const inCloud = z >= baseKm - 0.15 && z <= baseKm + thick;
      // 雲量 0.7 以上（曇り）なら雲の層は飽和（層状の雲が一面に出る）。それより少なければ少し乾かして、持ち上げられた所（風上の斜面・積雲）だけに雲を出す
      const sat = 0.9 + 0.1 * Math.min(1, g.cloudCover / 0.7);
      rhProf.push(inCloud ? (g.cloudCover > 0.2 ? sat : 0.8) : Math.max(0.3, 0.75 - Math.max(0, z - (baseKm + thick)) * 0.08) * (0.7 + 0.3 * g.cloudCover));
    }
    return {
      lat,
      lon: map.def.geo?.centerLon ?? 137.7,
      doy,
      startHour: (((w.tMin % 1440) + 1440) % 1440) / 60,
      tsfc,
      sst: Math.max(5, tsfc - 2),
      rh: 75,
      rhProf,
      lapse,
      coldAloft: -6 * g.thunder,
      tropopause: 11,
      windDir: g.windDirDeg,
      windSpeed: Math.max(1, g.windMs * 0.75),
      upperWind: Math.max(4, g.windMs * 1.7),
      upperDir: g.windDirDeg + 15,
      soil: 0.5,
      snowInit: 0,
      invH: 0,
      invT: 0,
      wls: Math.min(8, (g.precipMmH > 0.3 ? 0.8 + Math.sqrt(g.precipMmH) * 1.2 : 0) + g.thunder * 3),
    };
  };

  let worker: Worker | null = null;
  let active = false;
  let started = false;
  let lastNudgeMin = -1e9;
  let lastSpeed = -1;
  let blendStart = 0;
  let latest: { uc: Float32Array; vc: Float32Array; qr: Float32Array; kg: Int32Array } | null = null;
  const start = (w: World): void => {
    started = true;
    try {
      worker = new Worker(new URL('../workers/kishouCfd.worker.js', import.meta.url));
    } catch {
      worker = null;
      return;
    }
    worker.onmessage = (e: MessageEvent): void => {
      const m = e.data as { type: string; volA: Uint8Array; uc: Float32Array; vc: Float32Array; qr: Float32Array; sfc: { kg: Int32Array } };
      if (m.type !== 'state') return;
      // 前の状態から新しい状態へ、なめらかに切り替える
      (texA0.image as { data: Uint8Array }).data.set((texA1.image as { data: Uint8Array }).data);
      texA0.needsUpdate = true;
      (texA1.image as { data: Uint8Array }).data.set(m.volA);
      texA1.needsUpdate = true;
      blendStart = performance.now();
      uniforms['uBlend']!.value = 0;
      latest = { uc: m.uc, vc: m.vc, qr: m.qr, kg: m.sfc.kg };
      active = true;
      uniforms['uOn']!.value = 1;
    };
    worker.onerror = (): void => {
      active = false;
      uniforms['uOn']!.value = 0;
    };
    const hcopy = new Float32Array(heights);
    worker.postMessage({ type: 'init', gen: 1, params: paramsOf(w), nx, ny, nz, L: Lkm, H: H_TOP_KM, heights: hcopy, sea, running: true, speed: 60, rain: null, cloud: null }, [hcopy.buffer]);
    lastNudgeMin = w.tMin;
  };

  const windOff = new THREE.Vector3();
  return {
    pass,
    get active() {
      return active;
    },
    update(w, o) {
      if (!started) start(w);
      if (!worker) return;
      // ゲームの速さに合わせる（一時停止なら止める）
      const speed = Math.round(o.gameSecPerRealSec);
      if (speed !== lastSpeed) {
        lastSpeed = speed;
        worker.postMessage({ type: 'run', running: speed > 0 });
        if (speed > 0) worker.postMessage({ type: 'speed', speed: Math.min(1800, speed) });
      }
      // ゲーム内 10 分ごとに、シナリオの天気へ寄せる
      if (Math.abs(w.tMin - lastNudgeMin) >= 10) {
        lastNudgeMin = w.tMin;
        worker.postMessage({ type: 'nudge', params: paramsOf(w), tau: 1200 });
      }
      const u = uniforms;
      u['uBlend']!.value = Math.min(1, (performance.now() - blendStart) / 400);
      u['uTime']!.value = o.timeSec;
      (u['uSunDir']!.value as THREE.Vector3).copy(o.sunDir);
      (u['uSunColor']!.value as THREE.Color).copy(o.sunColor).multiplyScalar(Math.max(0.05, o.sunIntensity) * 0.9);
      (u['uSkyColor']!.value as THREE.Color).copy(o.skyColor).multiplyScalar(1 - 0.85 * o.night);
      (u['uGroundColor']!.value as THREE.Color).copy(o.groundColor).multiplyScalar(1 - 0.85 * o.night);
      u['uFlash']!.value = o.flash;
      u['uFocusR']!.value = o.focusR;
      (u['uFocus']!.value as THREE.Vector3).copy(o.focus);
      // 雲の模様を風で流す
      const wr = (w.weather.windDirDeg * Math.PI) / 180;
      windOff.set(Math.sin(wr), 0, -Math.cos(wr)).multiplyScalar(w.tMin * w.weather.windMs * 0.06 * UNIT);
      (u['uWindOff']!.value as THREE.Vector3).copy(windOff);
    },
    sample(xM, zM, elevM) {
      if (!latest) return null;
      const i = Math.max(0, Math.min(nx - 1, Math.floor(((xM / 1000) / Lkm + 0.5) * nx)));
      const j = Math.max(0, Math.min(ny - 1, Math.floor((-(zM / 1000) / Lkm + 0.5) * ny)));
      const kz = Math.max(0, Math.min(nz - 1, Math.floor((elevM / 1000 / H_TOP_KM) * nz)));
      const k = Math.max(kz, latest.kg[i + nx * j] ?? 0);
      const c = i + nx * (j + ny * k);
      return { windMs: Math.hypot(latest.uc[c] ?? 0, latest.vc[c] ?? 0), rain: (latest.qr[c] ?? 0) * 1000 };
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pass.dispose();
      texA0.dispose();
      texA1.dispose();
      noise.dispose();
    },
  };
}
