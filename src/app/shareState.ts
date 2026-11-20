/**
 * 状況を URL に入れる（ユーザーの指定: リロードしても同じ場面から始められ、URL で場面を共有できる）。
 * シミュレーションは決定論的なので、World そのものではなく「シナリオ・始まりの条件・選んだ順の選択・いまの時刻」だけを入れ、
 * 開いたときに最初から同じ選択で進め直して、その時刻の場面を作り直す（src/ui/simReplay.ts）。
 * 形: ?scenario=<id>&st=<base64url(deflate-raw(JSON))>
 */
import type { StartConditions } from '../sim/scenario/startConditions';
import type { World } from '../sim/types';

/** 遊び方（作り直すときも同じ遊び方で進める。時間制限ありは分岐点の待ちでも時間が進むため） */
export type PlayMode = 'i' | 't' | 'o';

export interface SharedState {
  v: 1;
  /** i: ふつう / t: 判断時間制限 / o: 観察のみ */
  mode: PlayMode;
  cond?: StartConditions;
  /** 選んだ順の選択: [分岐点, 選択肢, 時刻（分）, u: 自分で選んだ / b: その人らしく自動で選んだ] */
  d: [string, string, number, 'u' | 'b'][];
  /** いまの時刻（分） */
  t: number;
}

export const STATE_PARAM = 'st';
export const SCENARIO_PARAM = 'scenario';

export function stateOf(world: World, mode: PlayMode, cond: StartConditions | undefined): SharedState {
  return {
    v: 1,
    mode,
    ...(cond ? { cond } : {}),
    d: world.decisions.map((x) => [x.cpId, x.optionId, Math.round(x.tMin * 1000) / 1000, x.by === 'user' ? 'u' : 'b']),
    t: Math.round(world.tMin * 1000) / 1000,
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodeState(s: SharedState): Promise<string> {
  const stream = new Blob([JSON.stringify(s)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/** 読めなければ null（壊れた URL・古い形） */
export async function decodeState(text: string): Promise<SharedState | null> {
  try {
    const stream = new Blob([fromBase64Url(text)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const s = JSON.parse(await new Response(stream).text()) as SharedState;
    if (s?.v !== 1 || !Array.isArray(s.d) || typeof s.t !== 'number' || !['i', 't', 'o'].includes(s.mode)) return null;
    return s;
  } catch {
    return null;
  }
}

/** この状況を開く URL（いまのページの場所を使う） */
export function stateUrl(scenarioId: string, encoded: string): string {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set(SCENARIO_PARAM, scenarioId);
  u.searchParams.set(STATE_PARAM, encoded);
  return u.toString();
}

/** アドレス欄の URL を、履歴を増やさずに書き換える */
export function setAddress(url: string | null): void {
  const next = url ?? `${location.pathname}`;
  if (next === location.href || (url === null && location.search === '')) return;
  history.replaceState(history.state, '', next);
}
