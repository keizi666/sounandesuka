/**
 * 検証の項目ごとの「どう直すか」と、自動で直す処理（ユーザーの指定: 直し方が分かるように、できれば自動で直す）。
 * 直す処理は EditorProject を書き換える純粋な関数（Undo の単位は呼び出し側の ed.change）。Node でテストできる。
 */
import type { Issue } from '../sim/scenario/validate';
import { shortestPath } from '../sim/terrain/trails';
import type { EditorProject, MapRuntime } from '../sim/types';
import type { TabId } from './context';
import { connectorEdge, disambiguateRoute, nearestLinked } from './map/routeClick';
import { pruneConfusers } from './map/tools';
import { attributionFor } from './store/project';

export interface IssueHelp {
  /** どう直すか（1〜2 文） */
  hint: string;
  /** 自動で直す処理（ボタンの文と、直したときの説明を返す処理）。まとめて直すときにも使う */
  fix?: { label: string; run(p: EditorProject, rt: MapRuntime | null): string };
  /** その場所を開く（タブと、選ぶ地点・道） */
  locate?: { tab: TabId; kind?: 'node' | 'edge'; id?: string };
}

/** パスの末尾の ID（map.nodes.LM005 → LM005） */
function idOf(path: string, prefix: string): string | null {
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/** 名前のない分岐点・境界点か（消しても困らない） */
function anonymous(p: EditorProject, id: string): boolean {
  const n = p.map.nodes.find((x) => x.id === id);
  return !!n && (n.type === 'junction' || n.type === 'boundary') && (!n.name || n.name === n.id || n.name === '境界点');
}

/** シナリオのどこかでその地点を使っているか（ルート・下山口・分岐点の条件など） */
function referenced(p: EditorProject, id: string): boolean {
  return JSON.stringify(p.scenario).includes(`"${id}"`);
}

const fixIsolated = (id: string) => (p: EditorProject): string => {
  const n = p.map.nodes.find((x) => x.id === id);
  if (!n) return '';
  const near = nearestLinked(p.map, n);
  if (near) {
    const e = connectorEdge(p.map, near, n);
    p.map.edges.push(e);
    return `${n.name} を ${Math.round(Math.hypot(near.x - n.x, near.z - n.z))} m 先の ${near.name} と道 ${e.id} でつなぎました`;
  }
  if (anonymous(p, id) && !referenced(p, id)) {
    p.map.nodes = p.map.nodes.filter((x) => x.id !== id);
    return `どこにも使っていない分岐点 ${id} を消しました`;
  }
  return '';
};

/** ルートの最初と最後（と下山口）を登山口にする。山頂・小屋などの種類は変えない */
function fixTrailhead(p: EditorProject): string {
  const plan = p.scenario.plan;
  const ends = [...new Set([plan.route[0], plan.route[plan.route.length - 1], ...plan.goalNodes].filter((x): x is string => Boolean(x)))];
  const changed: string[] = [];
  for (const id of ends) {
    const n = p.map.nodes.find((x) => x.id === id);
    if (n && (n.type === 'junction' || n.type === 'boundary' || n.type === 'landmark')) {
      n.type = 'trailhead';
      if (n.name === '境界点' || n.name === n.id) n.name = `登山口（${n.id}）`;
      changed.push(n.id);
    }
  }
  if (plan.goalNodes.length === 0 && plan.route.length > 0) plan.goalNodes = [plan.route[plan.route.length - 1]!];
  return changed.length ? `ルートの端の ${changed.join('・')} を登山口にしました` : '';
}

/** ルートの道がつながらない区間は最短の道順で埋め、道が 2 本ある区間は短いほうに経由点を足す */
function fixRoute(p: EditorProject, rt: MapRuntime | null): string {
  const r = p.scenario.plan.route.filter((id) => p.map.nodes.some((n) => n.id === id));
  const out: string[] = r.length ? [r[0]!] : [];
  let filled = 0;
  for (let i = 1; i < r.length; i += 1) {
    const a = out[out.length - 1]!;
    const b = r[i]!;
    if (a === b) continue;
    const direct = p.map.edges.some((e) => e.kind === 'trail' && e.to && ((e.from === a && e.to === b) || (e.from === b && e.to === a)));
    const path = !direct && rt ? shortestPath(rt, a, b) : null;
    if (path) {
      out.push(...path.slice(1));
      filled += 1;
    } else out.push(b);
  }
  const d = disambiguateRoute(p.map, out);
  p.scenario.plan.route = d.route;
  const notes = [...(filled ? [`道のない区間 ${filled} か所を最短の道順で埋めました`] : []), ...d.notes];
  return notes.join('。');
}

function fixSources(p: EditorProject): string {
  const list = attributionFor(p).map((a) => a.text);
  if (list.length === 0) list.push(`地図データ: ${p.map.name}（エディターで作成）`);
  p.scenario.sources = [...new Set([...(p.scenario.sources ?? []), ...list])];
  return `sources に出典 ${list.length} 件を入れました`;
}

export function helpFor(p: EditorProject, i: Issue): IssueHelp {
  const node = idOf(i.path, 'map.nodes.') ?? idOf(i.path, 'nodes.');
  const edge = idOf(i.path, 'map.edges.');
  switch (i.code) {
    case 'isolated': {
      const n = p.map.nodes.find((x) => x.id === node);
      const near = n ? nearestLinked(p.map, n) : null;
      return {
        hint: near
          ? `道のそばの印（山頂・道標など）が道とつながっていません。そばの ${near.name}（${Math.round(Math.hypot(near.x - n!.x, near.z - n!.z))} m）と短い道でつなげます。ルートで通らないなら、このままでも動きます。`
          : '道とつながっていない地点です。近く（300 m 以内）に道がないので、要らなければ地点のタブで消してください。ルートで通らないなら、このままでも動きます。',
        fix: near || (node && anonymous(p, node) && !referenced(p, node)) ? { label: near ? `${near.name} とつなぐ` : 'この分岐点を消す', run: fixIsolated(node!) } : undefined,
        locate: node ? { tab: 'points', kind: 'node', id: node } : undefined,
      };
    }
    case 'confuserEdge':
      return {
        hint: '道を消したあとに、その道を指す「紛らわしい分岐」の設定が残っています（試走が止まることがあります）。ない道を指す設定を消します。',
        fix: { label: 'ない道を指す設定を消す', run: (pp) => `紛らわしい分岐の設定を ${pruneConfusers(pp.map)} 件消しました` },
        locate: node ? { tab: 'points', kind: 'node', id: node } : undefined,
      };
    case 'noTrailhead':
      return {
        hint: '種類が「登山口」の地点がありません（下山できたかの判定に使います）。ルートの最初と最後の地点を登山口にします。',
        fix: p.scenario.plan.route.length > 0 ? { label: 'ルートの端を登山口にする', run: fixTrailhead } : undefined,
        locate: { tab: 'points' },
      };
    case 'routeGap':
      return {
        hint: i.message.includes('決まりません')
          ? '2 つの地点を結ぶ道が 2 本以上あって、どちらを歩くか決まりません（0 本なら道がつながっていません）。短いほうの道に経由点を足し、つながらない区間は最短の道順で埋めます。'
          : 'ルートの隣り合う地点の間に道がありません。最短の道順で埋めます。',
        fix: { label: 'ルートを直す', run: fixRoute },
        locate: { tab: 'party' },
      };
    case 'undefinedNode':
      if (i.path.startsWith('plan.')) return { hint: 'ルート・下山口に、もうない地点が入っています。ルートから外して直します。', fix: { label: 'ルートを直す', run: fixRoute }, locate: { tab: 'party' } };
      return { hint: 'もうない地点を参照しています。該当の欄（分岐点・イベントなど）で選び直してください。' };
    case 'sources':
      return { hint: '実在の山のシナリオは、データの出どころ（出典）を書く決まりです。使った地図・登山道・気象のデータの出典を自動で入れます。', fix: { label: '出典を入れる', run: fixSources }, locate: { tab: 'json' } };
    case 'drafts':
      return {
        hint: 'OSM から取り込んだ道のうち、まだ確定していない（破線の）道があります。使う道を確定してください（下書きのままでも試走はできます）。',
        fix: { label: 'すべて確定', run: (pp) => ((pp.editorState.draftEdgeIds = []), '下書きの道をすべて確定しました') },
        locate: { tab: 'trails' },
      };
    case 'noHut':
    case 'noShelter':
      return { hint: '小屋・避難小屋がありません。小屋のない山ならそのままで構いません（夜はビバークになります）。あるなら地点のタブで種類を「小屋」にしてください。', locate: { tab: 'points' } };
    case 'steep':
      return { hint: '道の一部がとても急です（転倒・滑落が起きやすくなります）。実際に急な道ならそのままで構いません。標高の取り違えなら、道の形を直してください。', locate: edge ? { tab: 'trails', kind: 'edge', id: edge } : undefined };
    case 'courseTime':
      return { hint: '書かれたコースタイムと、地形からの試算が大きく違います。道のインスペクタで「歩きやすさ（paceAdj）」を変えるか、コースタイムを見直してください。', locate: edge ? { tab: 'trails', kind: 'edge', id: edge } : undefined };
    case 'outside':
      return { hint: 'エリアの外にある地点です。タブ 1 で範囲を広げるか、地点を消してください。', locate: node ? { tab: 'points', kind: 'node', id: node } : undefined };
    case 'terrainStale':
      return { hint: '範囲を動かした・広げたので、地形が前の範囲のままです。タブ 1（エリア）で「標高を取り直す」を押してください。', locate: { tab: 'area' } };
    case 'noTerrain':
      return { hint: 'タブ 1（エリア）で「標高を取得する」を押してください。', locate: { tab: 'area' } };
    case 'attribution':
      return { hint: '標高を取得し直すと、地理院の出典が自動で入ります。', locate: { tab: 'area' } };
    case 'dangling':
      return { hint: '道の端が地点につながっていません。道を消して描き直してください。', locate: edge ? { tab: 'trails', kind: 'edge', id: edge } : undefined };
    default:
      return { hint: i.path.startsWith('choices') ? '分岐点のタブで直してください。' : i.path.startsWith('endings') ? '結末のタブで直してください。' : i.path.startsWith('weather') ? '天候のタブで直してください。' : i.path.startsWith('party') ? '人と計画のタブで直してください。' : 'JSON のタブで該当の所を直してください。' };
  }
}

/**
 * 自動で直せるものをまとめて直す。同じ処理（ルート・登山口・出典）は 1 回だけ。
 * 登山口はルートを直したあとで（ルートの端が変わることがあるので）。返り値は直した内容の説明
 */
export function fixAll(p: EditorProject, rt: MapRuntime | null, issues: readonly Issue[]): string[] {
  const notes: string[] = [];
  const done = new Set<string>();
  const order = ['confuserEdge', 'isolated', 'routeGap', 'undefinedNode', 'drafts', 'noTrailhead', 'sources'];
  const list = [...issues].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  for (const i of list) {
    const h = helpFor(p, i);
    if (!h.fix) continue;
    const key = i.code === 'isolated' ? i.path : i.code === 'confuserEdge' ? 'confuserEdge' : i.code === 'undefinedNode' ? 'routeGap' : i.code;
    if (done.has(key)) continue;
    done.add(key);
    const note = h.fix.run(p, rt);
    if (note) notes.push(note);
  }
  return notes;
}
