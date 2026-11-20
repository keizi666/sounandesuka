/**
 * データの読み込み（public/ の JSON、バンドル）。fetch は BASE_URL を前置する（docs/03 §10）。
 * マップの派生レイヤーは本体で作り、重い電波圏だけ Worker で計算して待つ（sim の結果を Node と一致させるため）。
 */
import type { StartConditions } from '../sim/scenario/startConditions';
import { validateScenario } from '../sim/scenario/validate';
import { buildMapRuntime } from '../sim/terrain/map';
import type { SounanBundle, MapDef, MapRuntime, ScenarioDef, ScenarioIndexEntry } from '../sim/types';

export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(assetUrl(path));
  if (!r.ok) throw new Error(`${path} を読み込めませんでした（${r.status}）`);
  return (await r.json()) as T;
}

export function loadIndex(): Promise<ScenarioIndexEntry[]> {
  return getJson<ScenarioIndexEntry[]>('scenarios/index.json');
}

export function loadMapDef(id: string): Promise<MapDef> {
  // 旧名の地図 ID（hakoniwa）も読めるように
  return getJson<MapDef>(`maps/${id === 'hakoniwa' ? 'sounan' : id}.json`);
}

export function loadScenarioFile(file: string): Promise<ScenarioDef> {
  return getJson<ScenarioDef>(`scenarios/${file}`);
}

export function loadBundleFile(file: string): Promise<SounanBundle> {
  return getJson<SounanBundle>(`scenarios/${file}`);
}

/** 進み具合を知らせながら JSON を取る（大きなバンドル用。サイズが分からなければ frac は null） */
async function getJsonWithProgress<T>(path: string, onProgress?: (frac: number | null) => void): Promise<T> {
  const r = await fetch(assetUrl(path));
  if (!r.ok) throw new Error(`${path} を読み込めませんでした（${r.status}）`);
  const total = Number(r.headers.get('content-length') ?? 0);
  if (!r.body || !onProgress) return (await r.json()) as T;
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(total > 0 ? got / total : null);
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.length;
  }
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}

const runtimeCache = new Map<string, Promise<MapRuntime>>();

/** MapRuntime を作る（電波圏は Worker）。同じ定義はキャッシュする */
export function buildRuntime(def: MapDef): Promise<MapRuntime> {
  const key = `${def.id}:${def.size}:${def.resolution}`;
  let p = runtimeCache.get(key);
  if (!p) {
    p = (async () => {
      const worker = new Worker(new URL('../workers/coverage.worker.ts', import.meta.url), { type: 'module' });
      const radio = new Promise<Float32Array>((resolve, reject) => {
        worker.onmessage = (ev: MessageEvent<{ radio: Float32Array }>) => resolve(ev.data.radio);
        worker.onerror = (e) => reject(new Error(e.message));
      });
      worker.postMessage({ def });
      const { map } = buildMapRuntime(def, { radio: false });
      map.radio = await radio;
      worker.terminate();
      return map;
    })();
    runtimeCache.set(key, p);
  }
  return p;
}

export interface LoadedScenario {
  scenario: ScenarioDef;
  map: MapRuntime;
  attribution: SounanBundle['attribution'];
  /** 始まりの条件を変えて試しているとき（scenario はもう当てたあと） */
  conditions?: StartConditions;
  /** 公開の一覧（index.json）から読んだシナリオ。URL で場面を共有できるのはこれだけ（エディター・ファイルのシナリオは開けないため） */
  listed?: boolean;
}

/** エディターのプロジェクト（同一オリジンの IndexedDB）をバンドルにして読む（docs/18 §6.3） */
export async function loadEditorProject(id: string): Promise<LoadedScenario> {
  const [{ getProject }, { toBundle }] = await Promise.all([import('../editor/store/idb'), import('../editor/store/project')]);
  const p = await getProject(id);
  if (!p) throw new Error('エディターのプロジェクトが見つかりません');
  const b = toBundle(p);
  return { scenario: b.scenario, map: await buildRuntime(b.map), attribution: b.attribution };
}

export async function listEditorProjects(): Promise<{ id: string; name: string; updatedAt: string; real: boolean }[]> {
  try {
    const { listProjects } = await import('../editor/store/idb');
    return await listProjects();
  } catch {
    return [];
  }
}

/** バンドルで登録したシナリオのファイルがあるか（実地形のバンドルはリポジトリに含めないので、ない場合がある） */
export async function bundleExists(e: ScenarioIndexEntry): Promise<boolean> {
  if (!e.bundle) return true;
  try {
    const r = await fetch(assetUrl(`scenarios/${e.bundle}`), { method: 'HEAD' });
    // 開発サーバーは、ないファイルにも index.html を返すことがあるので、種類も見る
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

/** 読み込みの段階（data: データの取得、terrain: 地形と電波の計算）と進み具合 */
export type LoadProgress = (stage: 'data' | 'terrain', frac: number | null) => void;

/**
 * 実在の山のシナリオは、バンドルの横にある元の JSON（<id>.json）を優先する（バンドルの中のシナリオは作ったときのままで古いことがある）。
 * 元の JSON が読めない・バンドルの地形と合わないときは、バンドルの中のシナリオを使う。
 */
async function freshScenario(bundlePath: string, b: SounanBundle): Promise<ScenarioDef> {
  try {
    const s = await loadScenarioFile(bundlePath.replace(/\.sounan\.json$/, '.json'));
    const fresh = { ...s, mapId: b.map.id };
    if (s.id === b.scenario.id && validateScenario(fresh, b.map).every((x) => x.level !== 'error')) return fresh;
  } catch {
    // 元の JSON がない（バンドルだけを配った）
  }
  return b.scenario;
}

export async function loadEntry(e: ScenarioIndexEntry, onProgress?: LoadProgress): Promise<LoadedScenario> {
  if (e.bundle) {
    const b = await getJsonWithProgress<SounanBundle>(`scenarios/${e.bundle}`, onProgress && ((f) => onProgress('data', f)));
    onProgress?.('terrain', null);
    return { scenario: await freshScenario(e.bundle, b), map: await buildRuntime(b.map), attribution: b.attribution, listed: true };
  }
  onProgress?.('data', null);
  const scenario = await loadScenarioFile(e.file ?? `${e.id}.json`);
  const def = await loadMapDef(scenario.mapId);
  onProgress?.('terrain', null);
  const map = await buildRuntime(def);
  return { scenario, map, attribution: [], listed: true };
}
