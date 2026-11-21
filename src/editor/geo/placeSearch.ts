/**
 * 地名・山名の検索（新しいプロジェクトの範囲選び）。通信先は docs/15 §4 の表にある Overpass API だけを使う
 * （国土地理院の地名検索 API は表にないので使わない）。日本の範囲で、名前が一致する山頂・火山・峠・山小屋・市町村・集落の点を引く。
 * 押したときに 1 回だけ問い合わせる（入力のたびには問い合わせない）。クエリの組み立てと応答の整理は Node でテストできる純粋関数。
 */
import { OVERPASS_URL, type OsmJson } from './overpass';

/** 日本のおおよその範囲（南, 西, 北, 東） */
const JAPAN_BBOX = '20,122,46,154';

export interface PlaceHit {
  name: string;
  /** 種類の表示（山頂・火山・峠・市・町・村・集落） */
  kind: string;
  lat: number;
  lon: number;
  elevM?: number;
}

/** Overpass の文字列に入れる名前（引用符・バックスラッシュ・改行は取り除く） */
export function cleanName(q: string): string {
  return q.replace(/["\\\n\r]/g, '').trim();
}

/**
 * 探す名前の書き方。日本全体の正規表現は重くて時間切れになる（試すと 26 秒で打ち切り）ので、
 * 名前の完全一致（索引が効く）で「〜山」「〜岳」「〜峠」「〜村」などの書き方を並べる
 */
export function nameVariants(q: string): string[] {
  const base = cleanName(q);
  if (!base) return [];
  const stem = base.replace(/(ヶ岳|ケ岳|が岳|岳|山|峠|市|町|村)$/, '');
  const out = [base];
  if (stem) for (const suf of ['', '山', '岳', 'ヶ岳', 'ケ岳', '峠', '市', '町', '村', '高原', '温泉']) out.push(stem + suf);
  return [...new Set(out)];
}

export function placeQuery(q: string): string {
  const lines = nameVariants(q).flatMap((v) => [`  node["name"="${v}"](${JAPAN_BBOX});`, `  node["name:ja"="${v}"](${JAPAN_BBOX});`]);
  return `[out:json][timeout:20];
(
${lines.join('\n')}
);
out 200;`;
}

/** 地図で移動先にする点か（駅・バス停・店などは除く） */
function usable(t: Record<string, string>): boolean {
  return /^(peak|volcano|saddle)$/.test(t['natural'] ?? '') || t['mountain_pass'] === 'yes' || /^(city|town|village|hamlet|locality|suburb|quarter|neighbourhood|isolated_dwelling)$/.test(t['place'] ?? '') || /^(alpine_hut|wilderness_hut)$/.test(t['tourism'] ?? '');
}

function kindOf(t: Record<string, string>): string {
  if (t['natural'] === 'peak') return '山頂';
  if (t['natural'] === 'volcano') return '火山';
  if (t['natural'] === 'saddle' || t['mountain_pass'] === 'yes') return '峠・鞍部';
  if (t['tourism']) return '山小屋';
  return { city: '市', town: '町', village: '村', hamlet: '集落', locality: '地名' }[t['place'] ?? ''] ?? '地名';
}

/** 応答を並べ替える: 入力どおりの名前 → 入力で始まる名前 → ほか。同じ順位なら山（高い順）、地名の順 */
export function parsePlaces(json: OsmJson, q: string, max = 20): PlaceHit[] {
  const key = q.trim();
  const hits: (PlaceHit & { rank: number })[] = [];
  const seen = new Set<string>();
  for (const e of json.elements) {
    if (e.type !== 'node' || e.lat === undefined || e.lon === undefined || !e.tags || !usable(e.tags)) continue;
    // 検索した書き方に合う方の名前を出す（name と name:ja が違う山がある。例: 川苔山 / 川乗山）
    const nm = e.tags['name'] ?? '';
    const ja = e.tags['name:ja'] ?? '';
    const name = (ja && ja.includes(key) && !nm.includes(key) ? ja : nm) || ja;
    if (!name) continue;
    const dup = `${name}/${e.lat.toFixed(3)}/${e.lon.toFixed(3)}`;
    if (seen.has(dup)) continue;
    seen.add(dup);
    const ele = Number.parseFloat(e.tags['ele'] ?? '');
    const kind = kindOf(e.tags);
    const mountain = kind === '山頂' || kind === '火山';
    const rank = (name === key ? 0 : name.startsWith(key) ? 1 : 2) * 2 + (mountain ? 0 : 1);
    hits.push({ name, kind, lat: e.lat, lon: e.lon, elevM: Number.isFinite(ele) ? Math.round(ele) : undefined, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || (b.elevM ?? -1) - (a.elevM ?? -1) || a.name.localeCompare(b.name, 'ja'));
  return hits.slice(0, max).map(({ rank: _r, ...h }) => h);
}

/** 混雑（429・502・503・504）のときに待ってやり直す間隔（ミリ秒）。Overpass の案内どおり、間を広げる */
const RETRY_MS = [4000, 10000];

/** onRetry は、混雑でやり直す前に呼ぶ（何回目か、待つミリ秒） */
export async function searchPlaces(q: string, onRetry?: (attempt: number, waitMs: number) => void): Promise<PlaceHit[]> {
  if (cleanName(q) === '') return [];
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: placeQuery(q) }) });
    const busy = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
    if (busy && attempt < RETRY_MS.length) {
      const wait = RETRY_MS[attempt]!;
      onRetry?.(attempt + 1, wait);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (busy) throw new Error(`OpenStreetMap の検索サーバーが混み合っています（${res.status}）。少し待ってからやり直すか、地図を動かして選んでください。`);
    if (!res.ok) throw new Error(`検索できませんでした（${res.status}）`);
    const json = (await res.json()) as OsmJson & { remark?: string };
    // 時間切れでも 200 で空の応答が返る（remark に理由）
    if (json.elements.length === 0 && json.remark) throw new Error('検索が時間切れになりました。少し待ってからやり直してください。');
    return parsePlaces(json, q);
  }
}
