import { describe, expect, it } from 'vitest';
import { buildMapRuntime } from '../src/sim/terrain/map';
import { nearestIndex, sampleElev, sampleNormal, vertexX, vertexZ } from '../src/sim/terrain/sample';
import { trailPolyline } from '../src/sim/terrain/polyline';
import { VegClass, type ProceduralTerrainDef } from '../src/sim/types';
import { sounanMap, loadSounanDef } from './helpers/map';

const RAD = 180 / Math.PI;

describe('箱庭岳の地形生成（docs/04 §3.3）', () => {
  // 並列実行で CPU が混むと揺れるため、再試行のたびに測り直す
  it('Node で 1 秒以内に生成できる（派生レイヤー・電波を含む）', { retry: 3 }, () => {
    const t0 = performance.now();
    buildMapRuntime(loadSounanDef());
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('同じ定義からは同じ高さマップになる（決定論）', () => {
    const a = sounanMap().map.heights;
    const b = buildMapRuntime(loadSounanDef(), { radio: false }).map.heights;
    expect(Buffer.from(b.buffer).equals(Buffer.from(a.buffer))).toBe(true);
  });

  it('SUMMIT は指定値 ±40 m で、半径 300 m 内の最高点', () => {
    const { map } = sounanMap();
    const def = map.def.terrain as ProceduralTerrainDef;
    const specified = def.ridges[0]!.points.find(([x, z]) => x === 300 && z === -480)![2];
    const s = map.nodes['SUMMIT']!;
    expect(Math.abs(s.elevM - specified)).toBeLessThanOrEqual(40);
    for (let iz = 0; iz < map.n; iz += 1) {
      for (let ix = 0; ix < map.n; ix += 1) {
        const dx = vertexX(map, ix) - s.x;
        const dz = vertexZ(map, iz) - s.z;
        if (dx * dx + dz * dz <= 300 * 300) expect(map.heights[iz * map.n + ix]!).toBeLessThanOrEqual(s.elevM + 1e-3);
      }
    }
  });

  it('登山道の 10 m ごとの実効勾配が正規の道で 38° 未満、偽の道で 50° 未満', () => {
    const { map } = sounanMap();
    for (const e of map.def.edges) {
      const pts = trailPolyline(e.waypoints, e.smooth !== false, 10);
      const limit = e.kind === 'false' ? 50 : 38;
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const dh = sampleElev(map, b.x, b.z) - sampleElev(map, a.x, a.z);
        const deg = Math.atan(Math.abs(dh) / ((b.sH - a.sH) * e.sinuosity)) * RAD;
        if (deg >= limit) throw new Error(`${e.id} の sH=${b.sH.toFixed(0)} で ${deg.toFixed(1)}°（上限 ${limit}°）`);
      }
    }
  });

  it('魚止ノ滝の位置に傾斜 50° 以上のセルがあり、崖になっている', () => {
    const { map } = sounanMap();
    const wf = map.def.hazards.find((h) => h.type === 'waterfall' && h.id === 'uodome');
    if (!wf || wf.type !== 'waterfall') throw new Error('uodome がない');
    let steep = 0;
    let cliff = 0;
    for (let iz = 0; iz < map.n; iz += 1) {
      for (let ix = 0; ix < map.n; ix += 1) {
        const dx = vertexX(map, ix) - wf.x;
        const dz = vertexZ(map, iz) - wf.z;
        if (dx * dx + dz * dz > wf.radius * wf.radius) continue;
        const i = iz * map.n + ix;
        if (map.slopeDeg[i]! >= 50) steep += 1;
        if (map.cliff[i]) cliff += 1;
      }
    }
    expect(steep).toBeGreaterThanOrEqual(1);
    expect(cliff).toBeGreaterThanOrEqual(1);
  });

  it('主要ノードの標高が仕様の試算（docs/04 §3.3 の表）から ±60 m 以内', () => {
    const { map } = sounanMap();
    const table: Record<string, number> = {
      TH_SAWA: 1120,
      J_FOREST: 1260,
      EBOSHI: 1960,
      HUT_RIDGE: 2150,
      SUMMIT: 2410,
      SADDLE_N: 2030,
      MIKAERI: 2180,
      TH_KITA: 1420,
      W_SHOULDER: 1820,
    };
    for (const [id, elev] of Object.entries(table)) {
      expect(Math.abs(map.nodes[id]!.elevM - elev), id).toBeLessThanOrEqual(60);
    }
  });

  it('ノードのスナップ: 鞍部は尾根線上へ少しだけ動き、斜面途中の EBOSHI は動かさず警告する', () => {
    const { map, warnings } = sounanMap();
    const sad = map.nodes['SADDLE_N']!;
    expect(Math.hypot(sad.x - -380, sad.z - -860)).toBeLessThanOrEqual(60);
    const ebo = map.nodes['EBOSHI']!;
    expect([ebo.x, ebo.z]).toEqual([850, 650]);
    expect(warnings.some((w) => w.includes('EBOSHI'))).toBe(true);
  });
});

describe('派生レイヤー（docs/04 §4）', () => {
  it('値域', () => {
    const { map } = sounanMap();
    const N = map.n * map.n;
    for (let i = 0; i < N; i += 1) {
      const e = map.exposure[i]!;
      const sv = map.skyView[i]!;
      if (e < Math.fround(0.4) || e > Math.fround(1.6)) throw new Error(`exposure ${e}`);
      if (sv < 0 || sv > 1) throw new Error(`skyView ${sv}`);
      if (map.veg[i]! > 6) throw new Error(`veg ${map.veg[i]}`);
      if (map.slopeDeg[i]! < 0 || map.slopeDeg[i]! >= 90) throw new Error(`slope ${map.slopeDeg[i]}`);
      if (map.flowAcc[i]! < 1) throw new Error(`flowAcc ${map.flowAcc[i]}`);
      if (map.aspect[i]! < 0 || map.aspect[i]! >= 2 * Math.PI + 1e-6) throw new Error(`aspect ${map.aspect[i]}`);
    }
  });

  it('TPI は山頂で正、谷で負。露出は山頂で大きく沢で小さい', () => {
    const { map } = sounanMap();
    const summit = nearestIndex(map, map.nodes['SUMMIT']!.x, map.nodes['SUMMIT']!.z);
    const valley = nearestIndex(map, -1250, -560); // 鬼ヶ沢
    expect(map.tpi[summit]!).toBeGreaterThan(60);
    expect(map.tpi[valley]!).toBeLessThan(0);
    expect(map.exposure[summit]!).toBeGreaterThan(map.exposure[valley]!);
  });

  it('谷筋に沢ができ、外周まで流れ出る', () => {
    const { map } = sounanMap();
    let streams = 0;
    for (const v of map.stream) streams += v;
    expect(streams).toBeGreaterThan(100);
    // 鬼ヶ沢の滝の下流付近に沢セルがある
    let found = false;
    for (let iz = 0; iz < map.n && !found; iz += 1) {
      for (let ix = 0; ix < map.n; ix += 1) {
        const dx = vertexX(map, ix) - -1400;
        const dz = vertexZ(map, iz) - -500;
        if (dx * dx + dz * dz <= 150 * 150 && map.stream[iz * map.n + ix]) {
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
    // 最大の集水は箱庭の面積の 1 割以上（外周に向かって集まっている）
    let maxAcc = 0;
    for (const v of map.flowAcc) maxAcc = Math.max(maxAcc, v);
    expect(maxAcc).toBeGreaterThan(map.n * map.n * 0.1 * 0.1);
  });

  it('植生: 登山口は広葉樹林、山頂は森林限界より上', () => {
    const { map } = sounanMap();
    const at = (id: string): number => map.veg[nearestIndex(map, map.nodes[id]!.x, map.nodes[id]!.z)]!;
    expect(at('TH_SAWA')).toBe(VegClass.BROADLEAF);
    expect([VegClass.ALPINE, VegClass.ROCK, VegClass.KRUMMHOLZ]).toContain(at('SUMMIT'));
  });

  it('森林内は空の見通しが森林補正（×0.6）以下', () => {
    const { map } = sounanMap();
    for (let i = 0; i < map.n * map.n; i += 1) {
      if (map.veg[i] === VegClass.BROADLEAF || map.veg[i] === VegClass.CONIFER) {
        if (map.skyView[i]! > 0.6 + 1e-6) throw new Error(`forest skyView ${map.skyView[i]}`);
      }
    }
  });

  it('法線は単位長で上向き', () => {
    const { map } = sounanMap();
    const nrm = sampleNormal(map, 300, -480);
    expect(Math.hypot(nrm.x, nrm.y, nrm.z)).toBeCloseTo(1, 9);
    expect(nrm.y).toBeGreaterThan(0);
  });
});
