/**
 * 地形のメッシュと台座・側面の断面・机（docs/10 §2〜3）。
 * 頂点色は植生クラスの基本色に、斜面方位による明度の差と小さなゆらぎを足す。
 */
import * as THREE from 'three';
import type { MapRuntime } from '../sim/types';
import { VegClass } from '../sim/types';
import { plinthTopY, toSceneY, UNIT, type ViewScale } from './scale';
import { createTerrainMaterial, type EnvUniforms } from './terrainMaterial';

/** 植生の基本色（docs/10 §3.2）。秋は広葉樹を紅葉に寄せる */
export function vegColors(season: string): Record<number, THREE.Color> {
  const autumn = season === 'autumn';
  const winter = season === 'winter';
  return {
    [VegClass.BROADLEAF]: new THREE.Color(autumn ? 0x9a6a2e : winter ? 0x6e6455 : 0x5b7f3a),
    [VegClass.CONIFER]: new THREE.Color(0x3e5f37),
    [VegClass.KRUMMHOLZ]: new THREE.Color(0x55703f),
    [VegClass.ALPINE]: new THREE.Color(autumn ? 0x9a8a62 : 0x8c8a73),
    [VegClass.ROCK]: new THREE.Color(0x7b7670),
    [VegClass.STREAM]: new THREE.Color(0x6c7e86),
    [VegClass.CLIFF]: new THREE.Color(0x5d5751),
  };
}

export interface TerrainBuild {
  mesh: THREE.Mesh;
  /** 高さの読み出し（シーン座標 x・z → シーンの y） */
  heightAt: (x: number, z: number) => number;
}

/** step: 頂点の間引き（1 = 全頂点、2 = 半分） */
export function buildTerrain(map: MapRuntime, s: ViewScale, env: EnvUniforms, season: string, step = 1): TerrainBuild {
  const n = map.n;
  const m = Math.floor((n - 1) / step) + 1;
  const pos = new Float32Array(m * m * 3);
  const col = new Float32Array(m * m * 3);
  const colors = vegColors(season);
  const tmp = new THREE.Color();
  for (let j = 0; j < m; j += 1) {
    for (let i = 0; i < m; i += 1) {
      const gx = Math.min(n - 1, i * step);
      const gz = Math.min(n - 1, j * step);
      const gi = gz * n + gx;
      const k = (j * m + i) * 3;
      pos[k] = (-map.half + gx * map.cell) * UNIT;
      pos[k + 1] = toSceneY(s, map.heights[gi]!);
      pos[k + 2] = (-map.half + gz * map.cell) * UNIT;
      tmp.copy(colors[map.veg[gi]!] ?? colors[VegClass.ALPINE]!);
      // 南向き（方位 π 付近）は明るく、北向きは暗く
      const aspect = map.aspect[gi]!;
      const shade = 0.92 + 0.08 * -Math.cos(aspect) * Math.min(1, map.slopeDeg[gi]! / 30);
      tmp.multiplyScalar(shade);
      col[k] = tmp.r;
      col[k + 1] = tmp.g;
      col[k + 2] = tmp.b;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < m - 1; j += 1) {
    for (let i = 0; i < m - 1; i += 1) {
      const a = j * m + i;
      idx.push(a, a + m, a + 1, a + 1, a + m, a + m + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, createTerrainMaterial(env));
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  const heightAt = (x: number, z: number): number => {
    const fx = Math.min(n - 1, Math.max(0, (x / UNIT + map.half) / map.cell));
    const fz = Math.min(n - 1, Math.max(0, (z / UNIT + map.half) / map.cell));
    const ix = Math.min(n - 2, Math.floor(fx));
    const iz = Math.min(n - 2, Math.floor(fz));
    const tx = fx - ix;
    const tz = fz - iz;
    const h = map.heights;
    const a = h[iz * n + ix]! + (h[iz * n + ix + 1]! - h[iz * n + ix]!) * tx;
    const b = h[(iz + 1) * n + ix]! + (h[(iz + 1) * n + ix + 1]! - h[(iz + 1) * n + ix]!) * tx;
    return toSceneY(s, a + (b - a) * tz);
  };
  return { mesh, heightAt };
}

/** 側面の断面（表土・礫層・岩盤の縞を y から生成）と台座・机 */
export function buildDiorama(map: MapRuntime, s: ViewScale, env: EnvUniforms): THREE.Group {
  const group = new THREE.Group();
  const n = map.n;
  const half = map.half * UNIT;
  const bottom = plinthTopY(s);
  // 側面: 外周の頂点列から台座上面まで
  const sides: [number, number][][] = [[], [], [], []];
  for (let i = 0; i < n; i += 1) {
    sides[0]!.push([0, i]);
    sides[1]!.push([n - 1, i]);
    sides[2]!.push([i, 0]);
    sides[3]!.push([i, n - 1]);
  }
  const wallMat = new THREE.ShaderMaterial({
    uniforms: { uBottom: { value: bottom }, uNight: env.uNight },
    vertexShader: `varying float vY; varying float vTopY; attribute float topY;
      void main(){ vY = position.y; vTopY = topY; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uBottom; uniform float uNight; varying float vY; varying float vTopY;
      void main(){
        float d = vTopY - vY;
        vec3 soil = vec3(0.33,0.25,0.17); vec3 gravel = vec3(0.52,0.47,0.40); vec3 rock = vec3(0.42,0.41,0.40);
        vec3 c = d < 0.006 ? vec3(0.30,0.36,0.22) : d < 0.02 ? soil : (fract(vY * 60.0) < 0.5 ? gravel : gravel * 0.9);
        if (d > 0.08) c = mix(rock, rock * 0.85, step(0.5, fract(vY * 25.0)));
        c *= mix(vec3(1.0), vec3(0.35,0.42,0.62), uNight);
        gl_FragColor = vec4(pow(max(c, 0.0), vec3(2.2)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  for (const side of sides) {
    const pos: number[] = [];
    const top: number[] = [];
    const idx: number[] = [];
    side.forEach(([gx, gz], k) => {
      const x = (-map.half + gx * map.cell) * UNIT;
      const z = (-map.half + gz * map.cell) * UNIT;
      const y = toSceneY(s, map.heights[gz * n + gx]!);
      pos.push(x, y, z, x, bottom, z);
      top.push(y, y);
      if (k > 0) {
        const a = (k - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('topY', new THREE.Float32BufferAttribute(top, 1));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, wallMat);
    (mesh.material as THREE.ShaderMaterial).side = THREE.DoubleSide;
    group.add(mesh);
  }
  // 木の台座
  const plinthH = Math.max(0.05, bottom);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.7 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.12, plinthH, half * 2 + 0.12), wood);
  base.position.y = plinthH / 2 - 0.0005;
  base.receiveShadow = true;
  base.castShadow = true;
  group.add(base);
  // 机（フェルト張りの台。外周は空の色に溶けるように透明にする）
  const fade = document.createElement('canvas');
  fade.width = fade.height = 128;
  const fg = fade.getContext('2d')!;
  const grd = fg.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  fg.fillStyle = grd;
  fg.fillRect(0, 0, 128, 128);
  const table = new THREE.Mesh(
    new THREE.CircleGeometry(half * 5, 64),
    new THREE.MeshStandardMaterial({ color: 0xa39d90, roughness: 0.95, transparent: true, alphaMap: new THREE.CanvasTexture(fade), depthWrite: false }),
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.001;
  table.receiveShadow = true;
  group.add(table);
  return group;
}
