/**
 * 気象の表現（docs/10 §4）: 雲層（雲底に置くソフトパーティクル）、雨・雪・ひょう（箱の内側だけ）、
 * 雷雲（セルの位置に縦長の塊）、稲妻（ジグザグの線＋環境光のフラッシュ）、積雪線・濡れ・高度フォグの uniform。
 * 稲妻の発生など描画だけの乱数は Math.random を使ってよい（sim の結果に影響しない）。
 */
import * as THREE from 'three';
import { groundBin, GROUND_BINS, GROUND_BIN_M } from '../sim/weather/ground';
import type { MapRuntime, World } from '../sim/types';
import { toSceneY, UNIT, type ViewScale } from './scale';
import type { Quality } from './sceneView';
import type { EnvUniforms } from './terrainMaterial';

const COUNTS = {
  low: { clouds: 150, precip: 4000 },
  mid: { clouds: 300, precip: 10000 },
  high: { clouds: 600, precip: 20000 },
} as const;

function cloudTexture(): THREE.CanvasTexture {
  // ふわっとした塊: 柔らかい円をいくつか重ね、外周に向けて消える（固定の擬似乱数で毎回同じ形）
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 14; i += 1) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * 30;
    const x = 64 + Math.cos(a) * d;
    const y = 64 + Math.sin(a) * d * 0.6;
    const r = 18 + rnd() * 22;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.32)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

export interface WeatherFx {
  /** 雲のレイヤー表示 */
  showClouds: boolean;
  update(world: World, env: EnvUniforms, camera: THREE.Camera, timeSec: number): void;
}

export function createWeatherFx(scene: THREE.Scene, map: MapRuntime, s: ViewScale, quality: Quality): WeatherFx {
  const q = COUNTS[quality];
  const half = map.half * UNIT;
  const tex = cloudTexture();

  // ---- 雲層: 雲底の高さに 2〜3 層 ----
  const cloudGeo = new THREE.BufferGeometry();
  const cpos = new Float32Array(q.clouds * 3);
  const seeds = new Float32Array(q.clouds);
  for (let i = 0; i < q.clouds; i += 1) {
    cpos[i * 3] = (Math.random() * 2 - 1) * half;
    cpos[i * 3 + 1] = Math.random();
    cpos[i * 3 + 2] = (Math.random() * 2 - 1) * half;
    seeds[i] = Math.random();
  }
  cloudGeo.setAttribute('position', new THREE.BufferAttribute(cpos, 3));
  cloudGeo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  const cloudMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTex: { value: tex },
      uBase: { value: 1 },
      uThick: { value: 0.3 },
      uCover: { value: 0 },
      uDrift: { value: new THREE.Vector2() },
      uHalf: { value: half },
      uSize: { value: 1100 * UNIT },
      uNight: { value: 0 },
      uDark: { value: 0 },
      uScaleH: { value: 1 },
    },
    vertexShader: `attribute float seed; uniform float uBase; uniform float uThick; uniform float uCover; uniform vec2 uDrift; uniform float uHalf; uniform float uSize; uniform float uScaleH;
      varying float vAlpha;
      void main(){
        vec3 p = position;
        p.x = mod(p.x + uDrift.x + uHalf, 2.0 * uHalf) - uHalf;
        p.z = mod(p.z + uDrift.y + uHalf, 2.0 * uHalf) - uHalf;
        p.y = uBase + position.y * uThick;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // カメラに近い塊は薄くする（画面いっぱいの白い玉にしない）
        vAlpha = step(seed, uCover) * (0.35 + 0.4 * uCover) * smoothstep(0.04, 0.6, -mv.z / uHalf);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uScaleH / -mv.z * (0.7 + seed * 0.6);
      }`,
    fragmentShader: `uniform sampler2D uTex; uniform float uDark; uniform float uNight; varying float vAlpha;
      void main(){ vec4 t = texture2D(uTex, gl_PointCoord); vec3 c = mix(vec3(0.93), vec3(0.45,0.47,0.5), uDark);
        c *= 1.0 - 0.82 * uNight; c *= 0.9 + 0.1 * (1.0 - gl_PointCoord.y);
        gl_FragColor = vec4(pow(max(c, 0.0), vec3(2.2)), t.a * vAlpha); if (gl_FragColor.a < 0.02) discard;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
  });
  const clouds = new THREE.Points(cloudGeo, cloudMat);
  clouds.frustumCulled = false;
  clouds.renderOrder = 5;
  scene.add(clouds);

  // ---- 降水: 頂点シェーダで時間から位置を計算（CPU で更新しない） ----
  const pGeo = new THREE.BufferGeometry();
  const ppos = new Float32Array(q.precip * 3);
  for (let i = 0; i < q.precip; i += 1) {
    ppos[i * 3] = (Math.random() * 2 - 1) * half;
    ppos[i * 3 + 1] = Math.random();
    ppos[i * 3 + 2] = (Math.random() * 2 - 1) * half;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  const precipMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uTop: { value: 1 },
      uBottom: { value: 0 },
      uAmount: { value: 0 },
      uSnowY: { value: 99 },
      uWind: { value: new THREE.Vector2() },
      uHalf: { value: half },
      uHail: { value: 0 },
      uNight: { value: 0 },
    },
    vertexShader: `uniform float uTime; uniform float uTop; uniform float uBottom; uniform float uAmount; uniform float uSnowY; uniform vec2 uWind; uniform float uHalf; uniform float uHail;
      varying float vSnow; varying float vShow;
      void main(){
        vec3 p = position;
        vShow = step(fract(p.x * 13.1 + p.z * 7.7), uAmount);
        float h = uTop - uBottom;
        float y0 = uBottom + p.y * h;
        float isSnow = 0.0;
        float speed = mix(0.35, 0.9, uHail);
        float y = uBottom + mod(y0 - uBottom - uTime * speed * h, h);
        isSnow = step(uSnowY, y) * (1.0 - uHail);
        if (isSnow > 0.5) { y = uBottom + mod(y0 - uBottom - uTime * 0.06 * h, h); p.x += sin(uTime * 2.0 + p.z * 50.0) * 0.004; }
        p.y = y;
        p.xz += uWind * (uTop - y) * 0.6;
        p.x = clamp(p.x, -uHalf, uHalf); p.z = clamp(p.z, -uHalf, uHalf);
        vSnow = isSnow;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (isSnow > 0.5 ? 3.0 : uHail > 0.5 ? 2.5 : 1.6) * (6.0 / -mv.z);
      }`,
    fragmentShader: `varying float vSnow; varying float vShow; uniform float uNight;
      void main(){ if (vShow < 0.5) discard; vec2 d = gl_PointCoord - 0.5;
        float a = vSnow > 0.5 ? smoothstep(0.5, 0.2, length(d)) : (abs(d.x) < 0.18 ? 0.55 : 0.0);
        if (a < 0.02) discard; vec3 c = mix(vec3(0.75,0.82,0.9), vec3(1.0), vSnow) * (1.0 - 0.7 * uNight);
        gl_FragColor = vec4(pow(max(c, 0.0), vec3(2.2)), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
  });
  const precip = new THREE.Points(pGeo, precipMat);
  precip.frustumCulled = false;
  precip.renderOrder = 6;
  scene.add(precip);

  // ---- 雷雲と稲妻: 雷雲は雲の塊を塔状に積み、上部を金床状に広げる（セルごとに 1 組の Points） ----
  const CB_PUFFS = quality === 'low' ? 60 : 140;
  const cbGroup = new THREE.Group();
  const cbs: { pts: THREE.Points; mat: THREE.ShaderMaterial }[] = [];
  for (let k = 0; k < 2; k += 1) {
    const pos = new Float32Array(CB_PUFFS * 3);
    const sd = new Float32Array(CB_PUFFS);
    for (let i = 0; i < CB_PUFFS; i += 1) {
      const h = Math.random();
      // 胴は細く、上 15% は金床として横に広がる
      const rad = h > 0.85 ? 0.6 + (h - 0.85) * 5 : 0.42 + 0.12 * Math.sin(h * 9);
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * rad;
      pos[i * 3] = Math.cos(a) * d;
      pos[i * 3 + 1] = h;
      pos[i * 3 + 2] = Math.sin(a) * d * (h > 0.85 ? 0.7 : 1);
      sd[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(sd, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTex: { value: tex }, uCenter: { value: new THREE.Vector3() }, uR: { value: 1 }, uH: { value: 1 }, uAlpha: { value: 0 }, uNight: { value: 0 }, uScaleH: { value: 1 } },
      vertexShader: `attribute float seed; uniform vec3 uCenter; uniform float uR; uniform float uH; uniform float uScaleH;
        varying float vShade; varying float vSeed;
        void main(){
          vec3 p = uCenter + vec3(position.x * uR, position.y * uH, position.z * uR);
          vShade = position.y; vSeed = seed;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uR * 1.1 * uScaleH / -mv.z * (0.7 + seed * 0.6);
        }`,
      fragmentShader: `uniform sampler2D uTex; uniform float uAlpha; uniform float uNight; varying float vShade; varying float vSeed;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord);
          // 下は暗い灰色、上は日を受けて白い
          vec3 c = mix(vec3(0.5,0.52,0.57), vec3(0.97), smoothstep(0.05, 0.7, vShade)) * (1.0 - 0.8 * uNight);
          gl_FragColor = vec4(pow(max(c, 0.0), vec3(2.2)), t.a * uAlpha * 1.3); if (gl_FragColor.a < 0.02) discard;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 7;
    pts.visible = false;
    cbs.push({ pts, mat });
    cbGroup.add(pts);
  }
  scene.add(cbGroup);
  const boltMat = new THREE.LineBasicMaterial({ color: 0xeef4ff, transparent: true, opacity: 0 });
  const bolt = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 12 }, () => new THREE.Vector3())), boltMat);
  bolt.frustumCulled = false;
  scene.add(bolt);
  const flash = new THREE.AmbientLight(0xdde8ff, 0);
  scene.add(flash);
  let boltUntil = 0;

  return {
    showClouds: true,
    update(world, env, _camera, t) {
      const w = world.weather;
      // 積雪線: 1 cm 以上積もっている最低の標高
      let snowLine = 99999;
      for (let b = 0; b < GROUND_BINS; b += 1) {
        if ((world.ground.snowCm[b] ?? 0) >= 1) {
          snowLine = b * GROUND_BIN_M;
          break;
        }
      }
      env.uSnowLine.value = snowLine;
      let wetLine = 0;
      let wet = 0;
      for (let b = GROUND_BINS - 1; b >= 0; b -= 1) {
        if ((world.ground.wet[b] ?? 0) > 0.5) {
          wetLine = (b + 1) * GROUND_BIN_M;
          wet = 1;
          break;
        }
      }
      env.uWetLine.value = wet ? 99999 : wetLine;
      env.uWet.value = wet;
      env.uCloudBase.value = w.cloudCover >= 0.6 ? w.cloudBaseM : 99999;
      env.uCloudCover.value = w.cloudCover;
      env.uTime.value = t;
      env.uSway.value = 0.006 + 0.05 * Math.min(1, w.windMs / 22);

      // 雲
      const cu = cloudMat.uniforms;
      cu.uBase!.value = toSceneY(s, w.cloudBaseM);
      cu.uThick!.value = 600 * UNIT * s.vExag;
      cu.uCover!.value = w.cloudCover;
      cu.uDark!.value = Math.min(1, w.precipMmH / 6) * 0.7;
      cu.uNight!.value = world.sun.isDark ? 1 : world.sun.twilight ? 0.5 : 0;
      const wr = (w.windDirDeg * Math.PI) / 180;
      const drift = cu.uDrift!.value as THREE.Vector2;
      drift.set(-Math.sin(wr) * world.tMin * w.windMs * 0.6 * UNIT, Math.cos(wr) * world.tMin * w.windMs * 0.6 * UNIT);
      cu.uScaleH!.value = window.innerHeight / 2;
      clouds.visible = this.showClouds;

      // 降水
      const pu = precipMat.uniforms;
      pu.uTime!.value = t;
      pu.uTop!.value = toSceneY(s, Math.min(w.cloudBaseM, 3200));
      pu.uBottom!.value = toSceneY(s, s.baseElevM - 50);
      pu.uAmount!.value = Math.min(1, w.precipMmH / 20);
      // 雪とみぞれの境目（基準標高の気温と減率から 0.5℃ の標高）
      const lapse = 0.65;
      const zeroElev = 1000 + ((w.tempC - 0.5) / lapse) * 100;
      pu.uSnowY!.value = toSceneY(s, zeroElev);
      pu.uWind!.value.set(-Math.sin(wr) * w.windMs * 0.004, Math.cos(wr) * w.windMs * 0.004);
      pu.uHail!.value = w.cells.some((c) => c.strength > 0.6) ? 1 : 0;
      pu.uNight!.value = world.sun.isDark ? 1 : 0;
      precip.visible = w.precipMmH > 0.05;

      // 雷雲
      cbs.forEach((cb, i) => {
        const c = w.cells[i];
        cb.pts.visible = !!c && c.strength > 0.02;
        if (!c) return;
        const u = cb.mat.uniforms;
        const base = toSceneY(s, w.cloudBaseM);
        (u.uCenter!.value as THREE.Vector3).set(c.x * UNIT, base - 150 * UNIT * s.vExag, c.z * UNIT);
        u.uR!.value = c.radiusM * UNIT * 0.9;
        // 雲頂は 10 km 前後まで（箱庭ではそのまま描くと高すぎるので圧縮する）
        u.uH!.value = (2500 + 4500 * c.strength) * UNIT * s.vExag;
        u.uAlpha!.value = Math.min(0.6, c.strength * 0.7);
        u.uNight!.value = world.sun.isDark ? 1 : 0;
        u.uScaleH!.value = window.innerHeight / 2;
      });
      const maxStrength = w.cells.reduce((a, c) => Math.max(a, c.strength), w.thunder);
      // 稲妻: 強さに比例した頻度で 0.15 秒
      if (t > boltUntil && maxStrength > 0.2 && Math.random() < maxStrength * 0.02) {
        const c = w.cells[0] ?? { x: 0, z: 0, radiusM: 1000 };
        const bx = (c.x + (Math.random() - 0.5) * c.radiusM) * UNIT;
        const bz = (c.z + (Math.random() - 0.5) * c.radiusM) * UNIT;
        const top = toSceneY(s, w.cloudBaseM);
        const pts = bolt.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < pts.count; i += 1) {
          const f = i / (pts.count - 1);
          pts.setXYZ(i, bx + (Math.random() - 0.5) * 0.03 * (i > 0 ? 1 : 0), top - f * (top - toSceneY(s, s.baseElevM + 800)), bz + (Math.random() - 0.5) * 0.03);
        }
        pts.needsUpdate = true;
        boltUntil = t + 0.15;
      }
      const on = t < boltUntil;
      boltMat.opacity = on ? 1 : 0;
      flash.intensity = on ? 2.5 : 0;
      void groundBin;
    },
  };
}
