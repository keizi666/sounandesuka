/**
 * 開発用: 人形の造形と動きを確認するページ（lab.html。ビルドには含めない）。
 * 状態ごとの人形を並べ、スタジオ風の照明で見る。?only=<番号> で 1 体だけ、?night=1 で夜。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ClimberDef, ClimberState } from '../sim/types';
import { createFigure, type Figure } from '../view/climberFigure';

interface Spec {
  label: string;
  def?: Partial<ClimberDef> & { gear?: Partial<ClimberDef['gear']> };
  set(c: ClimberState): void;
  grade?: number;
}

const gear: ClimberDef['gear'] = {
  rainwear: 'goretex' as ClimberDef['gear']['rainwear'], cloWorn: 1, cloPack: 1, gloves: 'thin', hat: true, bivy: 'sack',
  headlamp: { has: true, batteryH: 10, inPack: false, spareBatteryH: 0 },
  phone: { has: true, batteryPct: 80, gpsApp: true, trackRecording: false, satelliteSos: false },
  map: true, compass: true, foodKcal: 1000, waterL: 1, stove: false, crampons: false, helmet: false, trekkingPoles: false, whistle: true,
};

const COLORS = ['#d8452e', '#2f6fd0', '#e0a21a', '#2e9b62', '#8a4fc2', '#d4572a', '#1f8fa8', '#c23a6b'];

function mkClimber(i: number, spec: Spec): ClimberState {
  const def = {
    id: `c${i}`, name: spec.label, age: 30 + ((i * 11) % 35), sex: i % 3 === 1 ? 'f' : 'm', weightKg: 55 + ((i * 7) % 25), packKg: 6 + ((i * 5) % 14),
    experience: 0.5, fitness: 1, navSkill: 0.5, riskTolerance: 0.5, color: COLORS[i % COLORS.length]!,
    habits: { eatEveryMin: null, drinkEveryMin: null, delaysRainwear: 0, gpsCheckEveryMin: null },
    ...spec.def,
    gear: { ...gear, ...(spec.def?.gear ?? {}) },
  } as ClimberDef;
  const c = {
    id: def.id, def, groupId: null, state: 'WALKING', stateSinceMin: 0, x: 0, z: 0, elevM: 1000, headingRad: 0, speedMs: 0,
    body: { coreC: 37, wetness: 0, fatigue: 10, conscious: true, alive: true, rainwearOn: false, inBivy: false },
    plan: { postureUntilMin: null, busyWith: null },
    perception: { awareLost: false },
    local: { windMs: 2, windChillC: 10 },
    inv: { headlamp: { on: false } },
  } as unknown as ClimberState;
  spec.set(c);
  return c;
}

const SPECS: Spec[] = [
  { label: '歩く', set: (c) => void (c.speedMs = 1.1) },
  { label: '歩く（ストック・上り・雨具）', def: { gear: { trekkingPoles: true } as never }, grade: 0.3, set: (c) => { c.speedMs = 0.7; c.body.rainwearOn = true; c.body.wetness = 0.7; } },
  { label: '下り', grade: -0.3, set: (c) => void (c.speedMs = 0.9) },
  { label: '疲労・低体温で歩く', set: (c) => { c.speedMs = 0.5; c.body.fatigue = 90; c.body.coreC = 34.2; c.local.windMs = 18; } },
  { label: '立ち止まる', def: { gear: { trekkingPoles: true } as never }, set: () => undefined },
  { label: '道に迷って見回す', set: (c) => { c.state = 'LOST_AWARE'; c.perception.awareLost = true; } },
  { label: '電波を探す', set: (c) => void (c.state = 'SEEKING_SIGNAL') },
  { label: '休憩', set: (c) => void (c.state = 'RESTING') },
  { label: '寒さに耐える', set: (c) => { c.state = 'WAITING_RESCUE'; c.body.coreC = 35.2; c.body.rainwearOn = true; } },
  { label: 'ビバーク', set: (c) => { c.state = 'BIVOUAC'; c.body.inBivy = true; c.body.coreC = 35.6; } },
  { label: '落雷を避ける', set: (c) => void (c.plan.postureUntilMin = 9999) },
  { label: '作業中', set: (c) => void (c.plan.busyWith = 'rainwear') },
  { label: '行動不能', set: (c) => { c.state = 'INCAPACITATED'; c.body.coreC = 33; } },
  { label: '意識なし', set: (c) => { c.state = 'UNCONSCIOUS'; c.body.conscious = false; } },
  { label: '死亡', set: (c) => { c.state = 'DEAD'; c.body.alive = false; } },
  { label: 'ヘルメット・夜', def: { gear: { helmet: true, trekkingPoles: true } as never }, set: (c) => { c.speedMs = 0.9; c.inv.headlamp.on = true; } },
];

const params = new URLSearchParams(location.search);
const only = params.get('only');
const night = params.get('night') === '1';
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(night ? 0x0a0f1c : 0x9fb9d0);
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
const controls = new OrbitControls(camera, canvas);
const sun = new THREE.DirectionalLight(0xfff2dc, night ? 0.05 : 2.4);
sun.position.set(6, 9, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 8, bottom: -8, near: 0.5, far: 40 });
sun.shadow.bias = -0.0005;
scene.add(sun, new THREE.HemisphereLight(0xbcd4ee, 0x5a5346, night ? 0.15 : 0.9));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 30), new THREE.MeshStandardMaterial({ color: 0x77806a, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const list = SPECS.map((s, i) => ({ s, i })).filter(({ i }) => only === null || only.split(',').includes(String(i)));
const SP = 1.9;
const figs: { fig: Figure; c: ClimberState; spec: Spec }[] = list.map(({ s, i }, k) => {
  const c = mkClimber(i, s);
  const fig = createFigure(c, 1.7);
  fig.root.position.set((k - (list.length - 1) / 2) * SP, 0, 0);
  fig.root.rotation.y = 0.35;
  scene.add(fig.root);
  return { fig, c, spec: s };
});

const span = Math.max(1, list.length) * SP;
controls.target.set(0, 0.85, 0);
camera.position.set(span * 0.18, 1.6, 2.2 + span * 1.05);

function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}

let last = 0;
function render(tMs: number): void {
  const t = tMs / 1000;
  const dt = Math.min(0.1, Math.max(0, t - last));
  last = t;
  resize();
  for (const f of figs) {
    // その場で歩かせる（位置だけ進めて、勾配と速さを動きに伝える）
    f.c.x += f.c.speedMs * dt;
    f.c.elevM += f.c.speedMs * dt * (f.spec.grade ?? 0);
    f.fig.update(f.c, t, false);
  }
  controls.update();
  renderer.render(scene, camera);
}

(window as unknown as Record<string, unknown>)['__lab'] = { render, camera, controls, figs, scene, labels: SPECS.map((s) => s.label) };
function loop(t: number): void {
  render(t);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
