/**
 * 小屋と標識（見た目の改善で作り込み）。営業小屋は木造 2 階の切妻屋根、避難小屋は石積みの小さな小屋。
 * 山頂にはケルンと標柱、分岐には道標、登山口には案内板を置く。窓の材質を返して夜に灯す。
 */
import * as THREE from 'three';
import type { MapRuntime } from '../sim/types';
import { UNIT, type ViewScale } from './scale';
import { injectEnv, type EnvUniforms } from './terrainMaterial';

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** 描画用の決まった乱数 */
function rnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function plankTex(): THREE.CanvasTexture {
  return canvasTex(128, (g, s) => {
    const r = rnd(7);
    g.fillStyle = '#8a5d38';
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) {
      g.fillStyle = `hsl(${24 + r() * 8}, ${38 + r() * 12}%, ${30 + r() * 12}%)`;
      g.fillRect(0, y, s, 15);
      g.fillStyle = 'rgba(30,18,8,0.55)';
      g.fillRect(0, y + 15, s, 1);
      for (let k = 0; k < 14; k += 1) {
        g.fillStyle = `rgba(40,24,10,${0.05 + r() * 0.12})`;
        g.fillRect(r() * s, y + r() * 14, 10 + r() * 40, 1);
      }
    }
  });
}

function stoneTex(): THREE.CanvasTexture {
  return canvasTex(128, (g, s) => {
    const r = rnd(11);
    g.fillStyle = '#5d5952';
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) {
      let x = -r() * 20;
      while (x < s) {
        const w = 18 + r() * 22;
        g.fillStyle = `hsl(${30 + r() * 20}, ${4 + r() * 8}%, ${42 + r() * 20}%)`;
        g.beginPath();
        g.roundRect(x + 1, y + 1, w - 2, 14, 4);
        g.fill();
        x += w;
      }
    }
  });
}

function roofTex(): THREE.CanvasTexture {
  return canvasTex(64, (g, s) => {
    g.fillStyle = '#8a3628';
    g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 8) {
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(x, 0, 1.5, s);
      g.fillStyle = 'rgba(255,255,255,0.1)';
      g.fillRect(x + 2, 0, 1, s);
    }
  });
}

/** 切妻屋根（棟は x 方向）。w: 棟の長さ、d: 奥行、h: 棟の高さ */
function gableRoof(w: number, d: number, h: number, mat: THREE.Material, thick: number): THREE.Group {
  const g = new THREE.Group();
  const slope = Math.hypot(d / 2, h);
  const ang = Math.atan2(h, d / 2);
  for (const sgn of [-1, 1]) {
    const geo = new THREE.BoxGeometry(w, thick, slope);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, h / 2, (sgn * d) / 4);
    m.rotation.x = sgn * ang;
    g.add(m);
  }
  return g;
}

/** 妻壁（三角形）。棟が x 方向なので、x = ±w/2 の面に付ける */
function gableWall(d: number, h: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, h)]);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
  m.rotation.y = Math.PI / 2;
  return m;
}

export function buildStructures(map: MapRuntime, s: ViewScale, heightAt: (x: number, z: number) => number, env: EnvUniforms): { group: THREE.Group; windows: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const k = UNIT * 2.0 * s.vExag; // 建物も樹木と同じくやや大きめ
  const planks = plankTex();
  const stones = stoneTex();
  const stone = new THREE.MeshStandardMaterial({ map: stones, roughness: 0.95 });
  const wood = new THREE.MeshStandardMaterial({ map: planks, roughness: 0.82 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x3f2a1b, roughness: 0.85 });
  const paleWood = new THREE.MeshStandardMaterial({ color: 0xc9a777, roughness: 0.8 });
  const roof = new THREE.MeshStandardMaterial({ map: roofTex(), roughness: 0.5, metalness: 0.35 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.7 });
  const windows = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.15, metalness: 0.4, emissive: 0xffb65c, emissiveIntensity: 0 });
  for (const m of [stone, wood, darkWood, paleWood, roof, white]) injectEnv(m, env);
  const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, rep?: [number, number]): THREE.Mesh => {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (rep) {
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * rep[0], uv.getY(i) * rep[1]);
    }
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };
  /** 窓（枠＋ガラス）。面は +z 向き */
  const windowAt = (parent: THREE.Group, x: number, y: number, z: number, w: number, h: number, rotY = 0): void => {
    const g = new THREE.Group();
    g.add(box(w * 1.18, h * 1.18, 0.12 * k, white));
    g.add(box(w, h, 0.16 * k, windows));
    g.add(box(w * 0.06, h, 0.2 * k, white), box(w, h * 0.06, 0.2 * k, white));
    g.add(box(w * 1.3, 0.1 * k, 0.3 * k, white, 0, -h * 0.62, 0.08 * k));
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    parent.add(g);
  };

  for (const nd of Object.values(map.nodes)) {
    const x = nd.x * UNIT;
    const z = nd.z * UNIT;
    const y = heightAt(x, z);
    const r = rnd(Math.floor(nd.x * 13 + nd.z * 7) >>> 0);
    const obj = new THREE.Group();
    if (nd.shelter) {
      const staffed = nd.shelter.kind === 'staffed';
      const w = (staffed ? 15 : 7.5) * k;
      const d = (staffed ? 9 : 6) * k;
      const h = (staffed ? 5.4 : 2.9) * k;
      const baseH = (staffed ? 1.2 : 0.6) * k;
      // 斜面でも浮かないよう、石積みの土台を地面の下まで伸ばす
      obj.add(box(w * 1.06, baseH + 3 * k, d * 1.08, stone, 0, baseH / 2 - 1.5 * k, 0, [5, 2]));
      const wallMat = staffed ? wood : stone;
      obj.add(box(w, h, d, wallMat, 0, baseH + h / 2, 0, staffed ? [3, 3] : [3, 1.5]));
      const roofH = (staffed ? 3.4 : 2.0) * k;
      const eave = 1.0 * k;
      const rf = gableRoof(w + eave * 1.6, d + eave * 2, roofH * ((d + eave * 2) / d), roof, 0.22 * k);
      rf.position.y = baseH + h - (roofH * eave * 2) / d;
      obj.add(rf);
      obj.add(box(w + eave * 1.7, 0.3 * k, 0.5 * k, darkWood, 0, baseH + h + roofH + 0.05 * k, 0)); // 棟
      for (const sx of [-1, 1]) {
        const gw = gableWall(d, roofH, wallMat === stone ? darkWood : wood);
        gw.position.set((sx * w) / 2, baseH + h, 0);
        if (sx < 0) gw.rotation.y = -Math.PI / 2;
        obj.add(gw);
        // 破風板
        obj.add(box(0.14 * k, 0.3 * k, d * 0.98, darkWood, sx * (w / 2 + eave * 0.8), baseH + h + 0.1 * k, 0));
      }
      // 柱と梁（木造の骨組みを見せる）
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) obj.add(box(0.35 * k, h, 0.35 * k, darkWood, (sx * w) / 2, baseH + h / 2, (sz * d) / 2));
      obj.add(box(w, 0.25 * k, d * 1.01, darkWood, 0, baseH + 0.1 * k, 0));
      // 扉と入口の段
      const doorH = 2.1 * k;
      const doorX = staffed ? -w * 0.22 : 0;
      obj.add(box(1.5 * k, doorH + 0.25 * k, 0.16 * k, white, doorX, baseH + doorH / 2, d / 2));
      obj.add(box(1.2 * k, doorH, 0.22 * k, darkWood, doorX, baseH + doorH / 2 - 0.05 * k, d / 2));
      obj.add(box(2.4 * k, baseH * 0.5, 1.4 * k, stone, doorX, baseH * 0.25, d / 2 + 0.7 * k, [1, 0.3]));
      obj.add(box(1.8 * k, baseH, 0.9 * k, stone, doorX, baseH * 0.5, d / 2 + 0.3 * k, [1, 0.5]));
      if (staffed) {
        // 1 階と 2 階の窓
        for (const wx of [0.05, 0.25, 0.42]) windowAt(obj, w * wx, baseH + 1.5 * k, d / 2, 1.3 * k, 1.2 * k);
        for (const wx of [-0.36, -0.12, 0.12, 0.36]) windowAt(obj, w * wx, baseH + 3.9 * k, d / 2, 1.1 * k, 1.0 * k);
        for (const wx of [-0.3, 0, 0.3]) windowAt(obj, w * wx, baseH + 3.9 * k, -d / 2, 1.1 * k, 1.0 * k, Math.PI);
        for (const sx of [-1, 1]) windowAt(obj, (sx * w) / 2, baseH + 2.2 * k, 0, 1.3 * k, 1.2 * k, (sx * Math.PI) / 2);
        // 煙突・ひさし・ベンチ・薪
        obj.add(box(0.9 * k, 3.2 * k, 0.9 * k, stone, w * 0.28, baseH + h + roofH * 0.75, -d * 0.12, [0.6, 2]));
        obj.add(box(1.1 * k, 0.18 * k, 1.1 * k, darkWood, w * 0.28, baseH + h + roofH * 0.75 + 1.65 * k, -d * 0.12));
        const porch = box(3.4 * k, 0.16 * k, 2.0 * k, roof, doorX, baseH + doorH + 0.6 * k, d / 2 + 0.9 * k);
        porch.rotation.x = 0.3;
        obj.add(porch);
        for (const sx of [-1, 1]) obj.add(box(0.18 * k, doorH + 0.5 * k, 0.18 * k, darkWood, doorX + sx * 1.5 * k, baseH + doorH / 2, d / 2 + 1.7 * k));
        obj.add(box(2.6 * k, 0.14 * k, 0.6 * k, paleWood, w * 0.25, baseH * 0.2 + 0.5 * k, d / 2 + 1.2 * k));
        for (const sx of [-1, 1]) obj.add(box(0.14 * k, 0.5 * k, 0.5 * k, paleWood, w * 0.25 + sx * 1.1 * k, baseH * 0.2 + 0.25 * k, d / 2 + 1.2 * k));
        for (let i = 0; i < 12; i += 1) {
          const log = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * k, 0.16 * k, 0.9 * k, 6), paleWood);
          log.rotation.x = Math.PI / 2;
          log.position.set(-w / 2 - 0.6 * k, baseH * 0.3 + 0.2 * k + Math.floor(i / 4) * 0.32 * k, -d * 0.2 + (i % 4) * 0.34 * k);
          obj.add(log);
        }
      } else {
        windowAt(obj, w * 0.3, baseH + 1.6 * k, d / 2, 0.9 * k, 0.8 * k);
        windowAt(obj, w / 2, baseH + 1.6 * k, 0, 0.9 * k, 0.8 * k, Math.PI / 2);
        // 屋根の押さえ石
        for (let i = 0; i < 6; i += 1) {
          const rk = new THREE.Mesh(new THREE.DodecahedronGeometry((0.28 + r() * 0.15) * k, 0), stone);
          const sz = i % 2 ? 1 : -1;
          const t = 0.25 + r() * 0.5;
          rk.position.set((r() - 0.5) * w * 0.9, baseH + h + roofH * (1 - t) + 0.25 * k, sz * (d / 2) * t);
          obj.add(rk);
        }
      }
      obj.rotation.y = (nd.x * 13 + nd.z * 7) % Math.PI;
    } else if (nd.type === 'peak') {
      // 山頂: ケルン（積んだ石）と標柱
      let cy = 0;
      for (let i = 0; i < 7; i += 1) {
        const rr = (1.0 - i * 0.11) * k;
        const st = new THREE.Mesh(new THREE.DodecahedronGeometry(rr, 0), stone);
        st.scale.set(1 + r() * 0.3, 0.55, 1 + r() * 0.3);
        st.rotation.y = r() * 3;
        st.position.set((r() - 0.5) * 0.3 * k - 1.6 * k, cy + rr * 0.3, (r() - 0.5) * 0.3 * k);
        cy += rr * 0.55;
        obj.add(st);
      }
      obj.add(box(0.4 * k, 4.2 * k, 0.4 * k, paleWood, 0.6 * k, 2.1 * k, 0));
      obj.add(box(0.5 * k, 0.12 * k, 0.5 * k, darkWood, 0.6 * k, 4.25 * k, 0));
      obj.add(box(0.42 * k, 1.6 * k, 0.06 * k, darkWood, 0.6 * k, 3.0 * k, 0.21 * k));
      for (let i = 0; i < 5; i += 1) {
        const st = new THREE.Mesh(new THREE.DodecahedronGeometry((0.3 + r() * 0.2) * k, 0), stone);
        st.position.set(0.6 * k + (r() - 0.5) * 1.2 * k, 0.1 * k, (r() - 0.5) * 1.2 * k);
        obj.add(st);
      }
      obj.rotation.y = r() * Math.PI;
    } else if (nd.type === 'junction') {
      // 分岐: 柱と、向きの違う 2 枚の矢印板
      obj.add(box(0.3 * k, 3.4 * k, 0.3 * k, paleWood, 0, 1.7 * k, 0));
      for (let i = 0; i < 2; i += 1) {
        const arm = new THREE.Group();
        arm.add(box(2.2 * k, 0.5 * k, 0.1 * k, paleWood, 0.8 * k, 0, 0));
        const tipM = new THREE.Mesh(new THREE.CylinderGeometry(0.29 * k, 0.29 * k, 0.1 * k, 3), paleWood);
        tipM.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
        tipM.scale.set(1, 1, 1.3);
        tipM.position.set(2.0 * k, 0, 0);
        arm.add(tipM);
        arm.add(box(1.5 * k, 0.1 * k, 0.12 * k, darkWood, 0.8 * k, 0, 0));
        arm.position.y = (3.0 - i * 0.7) * k;
        arm.rotation.y = r() * Math.PI * 2;
        obj.add(arm);
      }
      for (let i = 0; i < 4; i += 1) {
        const st = new THREE.Mesh(new THREE.DodecahedronGeometry((0.25 + r() * 0.2) * k, 0), stone);
        st.position.set((r() - 0.5) * 0.9 * k, 0.1 * k, (r() - 0.5) * 0.9 * k);
        obj.add(st);
      }
    } else if (nd.type === 'trailhead') {
      // 登山口: 屋根つきの案内板と登山届のポスト
      for (const sx of [-1, 1]) obj.add(box(0.25 * k, 3.2 * k, 0.25 * k, darkWood, sx * 1.5 * k, 1.6 * k, 0));
      obj.add(box(2.8 * k, 1.7 * k, 0.1 * k, paleWood, 0, 2.0 * k, 0));
      obj.add(box(2.4 * k, 1.3 * k, 0.12 * k, white, 0, 2.0 * k, 0.02 * k));
      const cap = gableRoof(3.6 * k, 1.2 * k, 0.5 * k, roof, 0.1 * k);
      cap.position.y = 3.1 * k;
      obj.add(cap);
      obj.add(box(0.2 * k, 1.5 * k, 0.2 * k, darkWood, 2.6 * k, 0.75 * k, 0.3 * k));
      obj.add(box(0.6 * k, 0.6 * k, 0.45 * k, roof, 2.6 * k, 1.7 * k, 0.3 * k));
      obj.rotation.y = r() * Math.PI;
    } else continue;
    obj.position.set(x, y, z);
    obj.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    group.add(obj);
  }
  return { group, windows };
}
