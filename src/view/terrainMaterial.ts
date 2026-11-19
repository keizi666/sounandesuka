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
  /** 樹木の揺れ: 時刻（秒）と、揺れの大きさ */
  uTime: { value: number };
  uSway: { value: number };
  /** 空気遠近: 霞の色と濃さ（シーン 1 単位 = 1 km あたり） */
  uAirColor: { value: THREE.Color };
  uAirDensity: { value: number };
  /** 霞が始まる距離（手前は霞ませない。俯瞰では箱庭の手前側がくっきり見えるように） */
  uAirStart: { value: number };
  /** 注目している登山者の位置と、その手前を透かす半径（0 = 透かさない） */
  uFocus: { value: THREE.Vector3 };
  uFocusR: { value: number };
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
    uTime: { value: 0 },
    uSway: { value: 0.01 },
    uAirColor: { value: new THREE.Color(0xbfd9ee) },
    uAirDensity: { value: 0.05 },
    uAirStart: { value: 0 },
    uFocus: { value: new THREE.Vector3() },
    uFocusR: { value: 0 },
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
uniform float uTime;
uniform float uSway;
uniform vec3 uAirColor;
uniform float uAirDensity;
uniform float uAirStart;
uniform vec3 uFocus;
uniform float uFocusR;
varying float vElev;
varying vec3 vWorldPos;
varying float vSlopeUp;
varying vec2 vHkVar;
/** 陰影の段（日なた・半影・影の 3 段。境界は柔らかくつなぐ。docs/19 §4） */
float hkRamp(float d) {
  return smoothstep(0.03, 0.24, d) * 0.6 + smoothstep(0.5, 0.74, d) * 0.4;
}
float hk_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hk_noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hk_hash(i), hk_hash(i + vec2(1.0, 0.0)), u.x), mix(hk_hash(i + vec2(0.0, 1.0)), hk_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/** 頂点シェーダに標高と世界座標を渡す処理を入れる */
function patchVertex(shader: { vertexShader: string }, sway: boolean): void {
  if (sway) {
    // 高いところほど大きく、木ごとに位相をずらして揺らす（形は高さ 1 に正規化してある）
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float hkPh = instanceMatrix[3].x * 730.0 + instanceMatrix[3].z * 910.0;
        float hkH = clamp(position.y, 0.0, 1.2);
        float hkS = hkH * hkH * (sin(uTime * 1.6 + hkPh) * 0.6 + sin(uTime * 3.7 + hkPh * 1.7 + position.x * 9.0) * 0.4);
        transformed.x += uSway * hkS;
        transformed.z += uSway * 0.6 * hkH * hkH * sin(uTime * 2.3 + hkPh * 0.7);
      #endif`,
    );
  }
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
      vSlopeUp = normalize(mat3(modelMatrix) * objectNormal).y;
      vHkVar = vec2(0.5);
      #ifdef USE_INSTANCING
        vec2 hkIp = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xz;
        vHkVar = vec2(hk_noise(hkIp * 2.3) * 0.6 + hk_noise(hkIp * 9.0) * 0.4, hk_noise(hkIp * 1.4 + 17.0) * 0.65 + hk_noise(hkIp * 6.0 + 5.0) * 0.35);
      #endif`,
    );
}

export interface ToonStyle {
  /** 逆光側の縁の光の強さ（0 = なし） */
  rim?: number;
  /** 木ごとの色のゆらぎ（インスタンスの位置から決める） */
  vary?: boolean;
  /** カメラと登山者の間にあっても透かさない（人形そのもの） */
  noFade?: boolean;
  /** 葉の板: 裏面でも法線を反転しない（樹冠の中心から外向きの法線をそのまま使う） */
  leaf?: boolean;
}

/** 共通のトゥーン調: 段のある陰影、影側を青紫へ、縁の光、色のゆらぎ（docs/19 §4） */
function patchToon(shader: { fragmentShader: string }, style: ToonStyle): void {
  let f = shader.fragmentShader;
  f = f.replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace('vec3 irradiance = dotNL * directLight.color;', 'vec3 irradiance = hkRamp(dotNL) * directLight.color;'));
  if (style.leaf) f = f.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'));
  if (style.vary) {
    f = f.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      diffuseColor.rgb *= 0.84 + 0.32 * vHkVar.x;
      diffuseColor.rgb *= mix(vec3(0.92, 1.03, 1.1), vec3(1.1, 0.98, 0.84), vHkVar.y);`,
    );
  }
  f = f.replace(
    '#include <opaque_fragment>',
    `{
      // 影側は黒くせず、青紫へ寄せる。明るさは「表面の色に対してどれだけ光が当たっているか」で見る
      float hkLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
      float hkAlb = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.02);
      float hkLit = smoothstep(0.3, 0.85, hkLum / hkAlb);
      outgoingLight = mix(outgoingLight * vec3(0.84, 0.88, 1.32) + diffuseColor.rgb * vec3(0.018, 0.02, 0.05), outgoingLight, hkLit);
      ${style.rim ? `float hkRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.6);
      outgoingLight += uAirColor * diffuseColor.rgb * hkRim * ${style.rim.toFixed(2)} * (0.4 + 0.6 * hkLit);` : ''}
    }
    #include <opaque_fragment>`,
  );
  shader.fragmentShader = f;
}

/** フラグメントの最後に雪・濡れ・霧・夜を足す */
function patchFragment(shader: { fragmentShader: string }, terrain: boolean, fade: boolean): void {
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
      // 大きな色むら（植生のまだら）と、急な面の岩肌（地層の縞）
      float hkBig = hk_noise(vWorldPos.xz * 11.0) * 0.6 + hk_noise(vWorldPos.xz * 37.0) * 0.4;
      diffuseColor.rgb *= 0.88 + 0.24 * hkBig;
      float hkSteep = (1.0 - smoothstep(0.56, 0.8, vSlopeUp));
      float hkStrata = hk_noise(vec2(vWorldPos.y * 240.0 + hk_noise(vWorldPos.xz * 30.0) * 4.0, vWorldPos.x * 12.0 + vWorldPos.z * 9.0));
      vec3 hkRock = mix(vec3(0.17, 0.16, 0.145), vec3(0.33, 0.31, 0.28), hkStrata) * (0.8 + 0.4 * hkN);
      diffuseColor.rgb = mix(diffuseColor.rgb, hkRock, hkSteep * 0.8);
      if (uOverlayOn > 0.5) {
        vec4 hkOv = texture2D(uOverlay, vWorldPos.xz / (uMapHalf * 2.0) + 0.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, hkOv.rgb, hkOv.a);
      }`
          : ''
      }
${
        terrain || !fade
          ? ''
          : `// カメラと登山者の間にあるものは透かす（網点状に抜く。半透明の描画順の問題を避けるため）
      if (uFocusR > 0.0) {
        vec3 hkAB = uFocus - cameraPosition;
        float hkT = dot(vWorldPos - cameraPosition, hkAB) / max(dot(hkAB, hkAB), 1e-9);
        if (hkT > 0.0 && hkT < 0.985) {
          float hkD = length(vWorldPos - (cameraPosition + hkAB * hkT));
          float hkK = 1.0 - smoothstep(uFocusR * 0.7, uFocusR * 1.5, hkD);
          float hkN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (hkN < hkK * 0.8) discard;
        }
      }`
      }
      // 積雪（雪線より上で、急すぎない面）
      float hkSnow = smoothstep(uSnowLine - 30.0, uSnowLine + 40.0, vElev) * smoothstep(0.55, 0.8, vSlopeUp);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.95, 0.97), hkSnow);
      // 濡れ（彩度・明度を下げる）
      float hkWet = uWet * (1.0 - smoothstep(uWetLine - 10.0, uWetLine + 10.0, vElev)) * (1.0 - hkSnow);
      diffuseColor.rgb *= 1.0 - 0.15 * hkWet;`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      ${
        terrain
          ? `{
        // 細かな凹凸（法線を揺らす）。遠くでは弱めてちらつきを抑える
        float hkE = 0.0025;
        vec2 hkP = vWorldPos.xz;
        float hkB0 = hk_noise(hkP * 170.0) * 0.65 + hk_noise(hkP * 560.0) * 0.35;
        float hkBx = hk_noise((hkP + vec2(hkE, 0.0)) * 170.0) * 0.65 + hk_noise((hkP + vec2(hkE, 0.0)) * 560.0) * 0.35;
        float hkBz = hk_noise((hkP + vec2(0.0, hkE)) * 170.0) * 0.65 + hk_noise((hkP + vec2(0.0, hkE)) * 560.0) * 0.35;
        float hkFade = (1.0 - smoothstep(0.6, 5.0, distance(cameraPosition, vWorldPos)));
        vec3 hkG = vec3(hkB0 - hkBx, 0.0, hkB0 - hkBz) * 1.6 * hkFade;
        normal = normalize(normal + (viewMatrix * vec4(hkG, 0.0)).xyz);
      }`
          : ''
      }`,
    )
    .replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      // 雲の中は灰白色に霞む（俯瞰でも稜線が雲に隠れて見える）
      float hkFog = smoothstep(uCloudBase - 80.0, uCloudBase + 60.0, vElev) * uCloudCover * 0.85;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor * (1.0 - 0.75 * uNight), hkFog);
      gl_FragColor.rgb *= mix(vec3(1.0), vec3(0.62, 0.7, 0.92), uNight);
      // 空気遠近: 遠いほど、また低いところほど霞の色に寄り、彩度が落ちる
      float hkDist = max(0.0, distance(cameraPosition, vWorldPos) - uAirStart);
      float hkLow = 1.0 - clamp((vWorldPos.y - 0.05) / 1.2, 0.0, 1.0);
      float hkAir = 1.0 - exp(-hkDist * uAirDensity * (0.75 + 0.6 * hkLow));
      vec3 hkGrey = vec3(dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, hkGrey, hkAir * 0.3);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, uAirColor, hkAir);`,
    );
}

export function injectEnv(material: THREE.Material, env: EnvUniforms, terrain = false, sway = false, style: ToonStyle = {}): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, env);
    patchVertex(shader, sway);
    patchFragment(shader, terrain, !style.noFade);
    patchToon(shader, style);
  };
  material.customProgramCacheKey = () => `hk-${terrain ? 't' : 'e'}${sway ? 's' : ''}-r${style.rim ?? 0}${style.vary ? 'v' : ''}${style.leaf ? 'l' : ''}${style.noFade ? 'n' : ''}`;
}

export function createTerrainMaterial(env: EnvUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  injectEnv(m, env, true);
  return m;
}
