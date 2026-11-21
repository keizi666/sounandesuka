/**
 * 開発用: 野生動物の造形と動きを確認するページ（animal-lab.html。ビルドには含めない）。
 * 種類ごとに 1 列: 草を食む・こちらを見る・うろつく（歩く）・立ち去る（走る）、熊は向かってくる動きも（人の前まで走り、立ち上がって前脚を振り、
 * そばにいてから立ち去る。80 秒ごと）。?night=1 で夜、?n=3 で群れ。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ANIMAL_SPECIES } from '../sim/hazards/animals';
import type { AnimalBehavior, AnimalState, World } from '../sim/types';
import { TUNING } from '../sim/tuning';
import { AnimalsView, type FigurePoint } from '../view/animals';

const params = new URLSearchParams(location.search);
const night = params.get('night') === '1';
const n = Number(params.get('n') ?? 1);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(night ? 0x0a0f1c : 0x9fb9d0);
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 400);
const controls = new OrbitControls(camera, canvas);
const sun = new THREE.DirectionalLight(0xfff2dc, night ? 0.05 : 2.4);
sun.position.set(10, 14, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 30, bottom: -30, near: 0.5, far: 80 });
scene.add(sun, new THREE.HemisphereLight(0xbcd4ee, 0x5a5346, night ? 0.15 : 0.9));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x77806a, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// シーン 1 単位 = 1 m
const view = new AnimalsView(scene, null, () => 0, 1);
const COLS: { b: AnimalBehavior; leave: boolean }[] = [
  { b: 'graze', leave: false },
  { b: 'watch', leave: false },
  { b: 'wander', leave: false },
  { b: 'flee', leave: true },
];
const animals: AnimalState[] = [];
ANIMAL_SPECIES.forEach((sp, row) => {
  COLS.forEach((col, k) => {
    const x = (k - 1.5) * 4 - (col.b === 'wander' ? 2 : 0);
    const z = (row - 2.5) * 3.2;
    animals.push({
      id: `${sp}-${col.b}`, species: sp, behavior: col.b, count: n, x, z, headingRad: Math.PI / 2,
      fromMin: -1, untilMin: 1e9, leaveMin: null, leaveX: x, leaveZ: z, leaveHeadingRad: Math.PI / 2, anxiety: 0, quiet: true, seenBy: [],
    });
  });
});
// 熊が向かってくる動き（5 列目。80 秒ごとに、6 m 先の人（印の柱）の前まで向かってきて、そばにいてから立ち去る）
const charging: AnimalState[] = (['bear', 'brownBear'] as const).map((sp, row) => ({
  id: `${sp}-charge`, species: sp, behavior: 'watch', count: 1, x: 10, z: (row - 2.5) * 3.2, headingRad: -Math.PI / 2,
  fromMin: -1, untilMin: 1e9, leaveMin: null, leaveX: 0, leaveZ: 0, leaveHeadingRad: 0, anxiety: 0, quiet: true, seenBy: [],
}));
animals.push(...charging);
// 襲われる人の目印（柱）
const victims: FigurePoint[] = charging.map((a) => ({ id: `v-${a.id}`, x: a.x - 6, z: a.z }));
for (const v of victims) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.7), new THREE.MeshStandardMaterial({ color: 0xd9452b }));
  post.position.set(v.x, 0.85, v.z);
  post.castShadow = true;
  scene.add(post);
}
const world = { animals, climbers: [] } as unknown as World;

controls.target.set(0, 0.5, 0);
camera.position.set(2, 5, 16);

function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}

function render(tMs: number): void {
  const t = tMs / 1000;
  resize();
  // 立ち去る（走る）列は、4 秒ごとに走り出しからやり直す（実際の時間の流れ）
  const tMin = t / 60;
  for (const a of animals) {
    if (a.behavior !== 'flee') continue;
    const start = Math.floor(t / 4) * 4;
    a.leaveMin = start / 60;
    a.fromMin = a.leaveMin - 1;
  }
  charging.forEach((a, i) => {
    const start = (Math.floor(t / 80) * 80) / 60;
    a.chargeMin = start;
    a.chargeX = a.x;
    a.chargeZ = a.z;
    a.leaveMin = start + TUNING.animals.chargeMin + TUNING.animals.attackHoldMin;
    a.leaveX = a.x - 6 + TUNING.animals.chargeStopM;
    a.leaveZ = a.z;
    a.leaveHeadingRad = Math.PI / 2;
    a.fromMin = start - 1;
    a.attack = { climberId: victims[i]!.id, injury: 'bruise', surprise: false, applied: true };
  });
  view.update(world, tMin, t, 1, victims);
  controls.update();
  renderer.render(scene, camera);
}

(window as unknown as Record<string, unknown>)['__lab'] = { render, camera, controls, scene, world };
function loop(t: number): void {
  render(t);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
