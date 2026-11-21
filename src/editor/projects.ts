/**
 * プロジェクト一覧（docs/15 §3.1、docs/18 §8）: 新規（架空の箱庭岳 / 実在の山）、開く、複製、同じマップで新しいシナリオ、削除、読み込み。
 */
import { assetUrl, bundleExists, loadBundleFile, loadIndex, loadScenarioFile } from '../app/data';
import type { EditorProject, SounanBundle, MapDef, ScenarioDef, ScenarioIndexEntry } from '../sim/types';
import { el, toast } from '../ui/dom';
import { JA } from '../i18n/ja';
import { createAreaPicker } from './areaPicker';
import { gridFor } from './geo/projection';
import { deleteProject, getProject, listProjects, putProject } from './store/idb';
import { createFictionalProject, createRealProject, duplicateProject, fromBundle, fromSkeleton } from './store/project';
import { portraitCounts } from '../ui/avatar';
import { newProjectTemplateFields } from './panels/templateUi';
import { applyNewProjectTemplates } from './templates/apply';

export interface ProjectsHost {
  root: HTMLElement;
  open(id: string): void;
}

async function loadSounan(): Promise<MapDef> {
  const r = await fetch(assetUrl('maps/sounan.json'));
  return (await r.json()) as MapDef;
}

function newDialog(host: ProjectsHost): void {
  const name = el('input', { value: '新しいシナリオ' });
  const kind = el('select', {}, [el('option', { value: 'real' }, '実在の山で作る（地理院の標高・OSM の登山道）'), el('option', { value: 'fictional' }, '架空の箱庭岳で作る')]);
  const lat = el('input', { type: 'number', step: '0.0001', value: '36.40' });
  const lon = el('input', { type: 'number', step: '0.0001', value: '137.71' });
  const size = el('input', { type: 'number', step: '128', value: '6000' });
  // 日本地図から範囲を選ぶ（入力欄と同期）
  const picker = createAreaPicker({ lat, lon, size });
  for (const i of [lat, lon, size]) i.addEventListener('input', () => picker.sync());
  const realBox = el('div', {}, [
    picker.el,
    el('div', { class: 'area-picker-fields' }, [
      el('label', { class: 'f-row' }, [el('span', { class: 'f-label' }, '中心の緯度'), lat]),
      el('label', { class: 'f-row' }, [el('span', { class: 'f-label' }, '中心の経度'), lon]),
      el('label', { class: 'f-row' }, [el('span', { class: 'f-label' }, '一辺（m）'), size]),
    ]),
    el('p', { class: 'note' }, '一辺は 2,048〜12,288 m。後からエリアのタブでも範囲を動かせます。'),
  ]);
  const tpl = newProjectTemplateFields();
  const sync = (): void => {
    realBox.style.display = kind.value === 'real' ? '' : 'none';
    tpl.stageBox.style.display = kind.value === 'real' ? 'none' : '';
  };
  kind.addEventListener('change', sync);
  sync();
  const dlg = el('dialog', { class: 'ed-dialog wide' }, [
    el('h2', {}, '新しいプロジェクト'),
    el('label', { class: 'f-row' }, [el('span', { class: 'f-label' }, '名前'), name]),
    el('label', { class: 'f-row' }, [el('span', { class: 'f-label' }, '舞台'), kind]),
    realBox,
    tpl.el,
    el('p', { class: 'note' }, '実在の遭難事故をなぞる場合でも、登場人物は架空にし、実名や個人を特定できる記述は使わないでください。'),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'primary',
        onclick: async () => {
          try {
            const p =
              kind.value === 'real'
                ? (() => {
                    const g = gridFor(Math.min(12288, Math.max(2048, Number(size.value))));
                    return createRealProject(name.value, Number(lat.value), Number(lon.value), g.size, g.resolution);
                  })()
                : createFictionalProject(name.value, await loadSounan());
            applyNewProjectTemplates(p, tpl.read(), await portraitCounts());
            await putProject(p);
            dlg.close();
            host.open(p.id);
          } catch (e) {
            toast(String(e), 6000);
          }
        },
      }, '作る'),
      el('button', { onclick: () => dlg.close() }, 'やめる'),
    ]),
  ]);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/**
 * 収録のシナリオ（public/scenarios/index.json）を、編集用のプロジェクトとしてコピーして開く。
 * 実地形のシナリオはバンドル（地形）を使い、シナリオは元の JSON（あれば）を使う。シナリオの ID は元のまま（書き出した JSON で置き換えられるように）
 */
async function editBuiltin(host: ProjectsHost, e: ScenarioIndexEntry): Promise<void> {
  try {
    let p;
    if (e.bundle) {
      const b = await loadBundleFile(e.bundle);
      p = fromBundle(b, `${e.title}（編集）`);
      try {
        const src = await loadScenarioFile(e.bundle.replace(/\.sounan\.json$/, '.json'));
        p.scenario = { ...src, mapId: b.map.id };
      } catch {
        // 元の JSON がなければバンドルの中のシナリオのまま
      }
    } else {
      const s = await loadScenarioFile(e.file ?? `${e.id}.json`);
      const map = s.mapId === 'sounan' || s.mapId === 'hakoniwa' ? await loadSounan() : null;
      if (!map) throw new Error(`マップ ${s.mapId} が見つかりません`);
      p = createFictionalProject(`${e.title}（編集）`, map);
      p.scenario = s;
    }
    await putProject(p);
    host.open(p.id);
  } catch (err) {
    toast(`開けませんでした: ${String(err)}`, 6000);
  }
}

/**
 * 収録のシナリオの編集は管理者だけ（開発サーバー、または VITE_ADMIN=1 でビルドしたとき）。公開用のビルドには出さない。
 * サーバーもログインもないので、これは「公開版に編集の入口を置かない」ための区別で、収録のファイルそのものは誰も書き換えられない
 * （編集はブラウザの中のコピーに対して行い、収録の分の差し替えは管理者がファイルを置き換える）
 */
export const ADMIN_MODE = import.meta.env.DEV || import.meta.env['VITE_ADMIN'] === '1';

async function builtinSection(host: ProjectsHost): Promise<HTMLElement> {
  if (!ADMIN_MODE) return el('div');
  let idx: ScenarioIndexEntry[] = [];
  try {
    idx = await loadIndex();
  } catch {
    return el('div');
  }
  const rows = await Promise.all(
    idx.map(async (e) => {
      const ok = await bundleExists(e);
      return el('tr', {}, [
        el('td', {}, e.title),
        el('td', {}, e.subtitle ?? ''),
        el('td', {}, e.region?.real ? '実在の山' : '箱庭岳'),
        el('td', {}, ok ? el('button', { onclick: () => void editBuiltin(host, e) }, '編集用にコピーして開く') : el('span', { class: 'note' }, '地形データ未作成')),
      ]);
    }),
  );
  return el('section', { class: 'ed-builtin' }, [
    el('h2', {}, '収録のシナリオを編集する（管理者）'),
    el('table', {}, [el('tr', {}, ['題名', '', '舞台', ''].map((t) => el('th', {}, t))), ...rows]),
    el('p', { class: 'note' }, '収録のシナリオをコピーしたプロジェクトを作って開きます（元のファイルは変わりません）。編集したシナリオは、同じブラウザのプレイヤーの「エディターで作ったシナリオ」から遊べます。収録の分を置き換えるときは、編集画面の「シナリオだけ書き出す」（実在の山はバンドル）で保存し、public/scenarios/ の同じ名前のファイルと入れ替えてください。'),
  ]);
}

/** スケルトンマップの範囲の中心を聞く（map.geo があればそれを初期値に）。やめたら null */
function askCenter(sk: MapDef): [number, number] | null {
  const def = sk.geo ? `${sk.geo.centerLat},${sk.geo.centerLon}` : '43.526,142.846';
  const ans = prompt(`${sk.areaHint?.text ?? 'スケルトンマップです。'}

範囲の中心を「緯度,経度」で入力してください（後から地図で動かせます）`, def);
  if (!ans) return null;
  const [lat, lon] = ans.split(',').map((x) => Number(x.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('緯度・経度が読めません');
  return [lat!, lon!];
}

/** このブラウザのプロジェクトのうち、マップ ID が合うもの（いちばん新しいもの） */
async function projectWithMap(mapId: string): Promise<EditorProject | null> {
  for (const x of await listProjects()) {
    const p = await getProject(x.id);
    if (p?.map.id === mapId) return p;
  }
  return null;
}

/** バンドル・シナリオ JSON・マップ JSON の読み込み */
async function importFile(host: ProjectsHost, f: File): Promise<void> {
  try {
    const j = JSON.parse(await f.text()) as Partial<SounanBundle> & Partial<ScenarioDef> & Partial<MapDef>;
    let p;
    if ((j.format === 'sounan-bundle' || j.format === 'hakoniwa-bundle') && j.map?.skeleton) {
      // スケルトンマップとシナリオのバンドル（「AI 向けプロンプト作成」で AI に作らせたもの）
      const ll = askCenter(j.map);
      if (!ll) return;
      // nodeLatLon は AI 向けプロンプトで頼む、バンドルの外側の位置の手がかり（地点 ID → [緯度, 経度]。型 SounanBundle にはない）
      p = fromSkeleton(j.map, ll[0], ll[1], (j as SounanBundle).scenario, (j as { nodeLatLon?: Record<string, [number, number]> }).nodeLatLon);
      const half = p.map.size / 2;
      const outside = p.map.nodes.filter((n) => Math.abs(n.x) > half || Math.abs(n.z) > half).map((n) => n.name);
      if (outside.length) toast(`範囲の外の地点があります（エリアのタブで範囲を広げるか動かしてください）: ${outside.join('、')}`, 8000);
    } else if (j.format === 'sounan-bundle' || j.format === 'hakoniwa-bundle') p = fromBundle(j as SounanBundle);
    else if (j.version === 1 && (j as ScenarioDef).party) {
      // 既存マップを参照するシナリオ（箱庭岳、またはこのブラウザのプロジェクトのマップ）
      const s = j as ScenarioDef;
      const map = s.mapId === 'sounan' || s.mapId === 'hakoniwa' ? await loadSounan() : null;
      if (map) {
        p = createFictionalProject(s.title, map);
        p.scenario = s;
      } else {
        const base = await projectWithMap(s.mapId);
        if (!base) throw new Error(`マップ ${s.mapId} が見つかりません（バンドルで読み込むか、そのマップのプロジェクトを先に作ってください）`);
        p = duplicateProject(base, true);
        p.name = s.title;
        p.scenario = s;
      }
    } else if ((j as MapDef).skeleton) {
      // スケルトンマップ（docs/16 §8）: 範囲の中心を聞いて実在の山のプロジェクトにし、後で登山道と地点のタブで結合する
      const ll = askCenter(j as MapDef);
      if (!ll) return;
      p = fromSkeleton(j as MapDef, ll[0], ll[1]);
    } else if ((j as MapDef).nodes && (j as MapDef).terrain) {
      const map = j as MapDef;
      p = createFictionalProject(map.name, map);
    } else throw new Error('バンドル・シナリオ・マップのどれでもありません');
    await putProject(p);
    host.open(p.id);
  } catch (e) {
    toast(`読み込めませんでした: ${String(e)}`, 6000);
  }
}

export async function showProjects(host: ProjectsHost): Promise<void> {
  const list = await listProjects();
  const input = el('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void importFile(host, f);
  });
  const rows = list.map((x) =>
    el('tr', {}, [
      el('td', {}, el('a', { href: '#', onclick: (e: Event) => (e.preventDefault(), host.open(x.id)) }, x.name)),
      el('td', {}, x.real ? '実在の山' : '箱庭岳'),
      el('td', {}, new Date(x.updatedAt).toLocaleString('ja-JP')),
      el('td', {}, [
        el('button', { onclick: () => host.open(x.id) }, '開く'),
        el('button', {
          onclick: async () => {
            const p = await getProject(x.id);
            if (p) await putProject(duplicateProject(p, false));
            void showProjects(host);
          },
        }, '複製'),
        el('button', {
          title: 'このプロジェクトのマップを使って新しいシナリオを作る',
          onclick: async () => {
            const p = await getProject(x.id);
            if (p) await putProject(duplicateProject(p, true));
            void showProjects(host);
          },
        }, '同じマップで新規'),
        el('button', {
          onclick: async () => {
            if (!confirm(`「${x.name}」を削除しますか？（元に戻せません）`)) return;
            await deleteProject(x.id);
            void showProjects(host);
          },
        }, '削除'),
      ]),
    ]),
  );
  const builtinHost = el('div');
  host.root.replaceChildren(
    el('main', { class: 'ed-projects' }, [
      el('header', {}, [el('h1', {}, '遭難ですよ シナリオエディター'), el('a', { href: `${import.meta.env.BASE_URL}index.html` }, 'プレイヤーへ')]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'primary', onclick: () => newDialog(host) }, '新しいプロジェクト'),
        el('label', { class: 'drop' }, ['ファイルから読み込む（バンドル・シナリオ・マップ）', input]),
        el('button', { class: 'ed-ai-open', title: JA.editor.aiTool.openTitle, onclick: () => void import('./aiTool').then((m) => m.showAiToolDialog()) }, JA.editor.aiTool.open),
      ]),
      list.length === 0 ? el('p', { class: 'note' }, 'まだプロジェクトがありません。') : el('table', {}, [el('tr', {}, ['名前', '舞台', '更新', ''].map((t) => el('th', {}, t))), ...rows]),
      el('p', { class: 'note' }, `プロジェクトはこのブラウザの中（IndexedDB）に保存されます。別の端末へは「書き出し」したバンドルで移してください。`),
      builtinHost,
    ]),
  );
  builtinHost.replaceWith(await builtinSection(host));
}
