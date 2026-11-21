/**
 * トップ画面の「AI 向けプロンプト作成」: タイトル・参考文献の URL・登場人物の条件・ストーリーから、
 * Claude などの AI（このリポジトリの外の、ふつうの会話でよい）にそのまま渡せば、エディターで読み込めるシナリオの JSON を作ってもらえるプロンプトを作る。
 * 自己完結にするため、形式の説明（docs/09・docs/04 §5）と型の定義（src/sim/types.ts）をビルド時に埋め込み（aiSpec.ts）、
 * 使える仕組みの一覧はコードから作り（aiPrompt.ts と共通）、形式の見本は検証済みの例（aiExample.ts）から出す。純粋な関数（テストできる）。
 */
import type { MapDef, ScenarioDef } from '../sim/types';
import { EXAMPLE_NODE_LATLON, EXAMPLE_SCENARIO, EXAMPLE_SKELETON } from './aiExample';
import { designLines, mapSummary, mechanismLines, reviewLines } from './aiPrompt';
import { specAppendix } from './aiSpec';

/** 舞台: real 実在の山（スケルトンマップを作ってもらう）/ fictional 架空の箱庭岳 / project このブラウザのプロジェクトのマップ */
export type StandaloneStage = 'real' | 'fictional' | 'project';

export interface StandaloneInput {
  title: string;
  urls: string[];
  /** 登場人物の人数や条件（空欄なら AI が決める） */
  people: string;
  story: string;
  stage: StandaloneStage;
}

export interface StandaloneContext {
  /** fictional: 箱庭岳のマップ、project: そのプロジェクトのマップ（real では使わない） */
  map?: MapDef;
  /** project: いまのシナリオ（題と登場人物を参考に出す） */
  scenario?: ScenarioDef;
}

/** URL の欄を整える（空行を除き、前後の空白を取る。重複は 1 つに） */
export function cleanUrls(urls: readonly string[]): string[] {
  return [...new Set(urls.map((u) => u.trim()).filter((u) => u !== ''))];
}

/** 見本の JSON を読みやすく詰めて書く（短い配列・オブジェクトは 1 行に） */
export function compactJson(v: unknown, ind = ''): string {
  const one = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || one.length <= 150) return one;
  const ni = `${ind}  `;
  if (Array.isArray(v)) return `[\n${v.map((x) => ni + compactJson(x, ni)).join(',\n')}\n${ind}]`;
  const kv = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
  return `{\n${kv.map(([k, x]) => `${ni}${JSON.stringify(k)}: ${compactJson(x, ni)}`).join(',\n')}\n${ind}}`;
}

/** 出力するファイルの形の説明 */
function outputLines(i: StandaloneInput, ctx: StandaloneContext): string[] {
  const out: string[] = [];
  if (i.stage === 'real') {
    out.push('**バンドル**（スケルトンマップとシナリオを 1 つにした JSON。型 `SounanBundle`）を 1 つ返してください。形の概略:');
    out.push('');
    out.push('```text');
    out.push('{ "format": "sounan-bundle", "version": 1, "createdAt": "（今日の日付 ISO 8601）", "generator": "ai", "attribution": [],');
    out.push('  "map": { …スケルトンマップ（下の「舞台」と例 2）… },');
    out.push('  "nodeLatLon": { "地点ID": [緯度, 経度], … },');
    out.push('  "scenario": { …シナリオ（ScenarioDef。例 1 と同じ形。mapId は map.id と同じ）… } }');
    out.push('```');
    out.push('');
    out.push('人間はこれを `<シナリオID>.sounan.json` という名前のファイルに保存します。');
  } else {
    const id = i.stage === 'fictional' ? 'sounan' : (ctx.map?.id ?? '（マップ ID）');
    out.push(`**シナリオの JSON**（型 \`ScenarioDef\`）を 1 つ返してください。\`mapId\` は \`"${id}"\`。地点（ノード）と道（エッジ）の ID は、下の「舞台」に書いたものだけを使います。`);
    out.push('');
    out.push('人間はこれを `<シナリオID>.json` という名前のファイルに保存します。');
  }
  out.push('');
  out.push('- JSON は ```json のコードブロック 1 つに、省略せずに全部書く（「…」「同様に」で省かない）。JSON の中にコメントは書けない。');
  out.push('- 設計書（下の「進め方」の 1）と、確かめた結果（4）は JSON の前に短く書く。');
  out.push('- 長くて 1 回の返答に入らないときは、途中で切れたことを書いて止め、「続き」と言われたら切れた所からそのまま続ける。');
  return out;
}

/** 舞台（地図）の説明 */
function stageLines(i: StandaloneInput, ctx: StandaloneContext): string[] {
  const out: string[] = [];
  if (i.stage === 'real') {
    out.push('実在の山で作ります。地形（国土地理院の標高）と登山道（OpenStreetMap）は、あとで人間がエディターで取り込みます。あなたは **スケルトンマップ**（地点の名前・概略の標高・道のつながり）と、地点ごとのおおよその緯度経度（`nodeLatLon`）を書きます。エディターが地点の名前を OpenStreetMap の地点名と照らし合わせ（名前で見つからなければ緯度経度の近くの登山道に置き）、道は OSM の登山道をたどって線にします。');
    out.push('');
    out.push('- `map.skeleton` は `true`。`map.id` は英小文字と `_`（例 `takao_inari`）。`map.name` は山域と範囲がわかる名前。');
    out.push('- `nodeLatLon`（バンドルのいちばん外側。`map` の中ではない）: すべての地点について `"地点ID": [緯度, 経度]`（世界測地系の 10 進の度、小数 4 桁）。地図や山の記録で分かる値を書く。エディターは、名前の候補をこの位置から 1 km 以内で探し、名前で見つからない地点はこの位置の近くの登山道に置く。');
    out.push('- 範囲は正方形。すべての地点が、範囲の端から 500 m 以上内側に入るようにする: `map.geo`（`{ "centerLat": …, "centerLon": …, "projection": "local-tangent" }`）は地点の緯度経度の最小と最大のまん中、一辺 `map.areaHint.sizeM` は東西・南北の広がりの大きい方に 1,000 m 以上を足した長さ（2048〜12288 m。緯度 1 度 ≒ 111 km、経度 1 度 ≒ 111 km × cos(緯度)）。迷い込みうる尾根・沢も入れる。');
    out.push('- `map.areaHint.text` に範囲の説明（山域・どこからどこまで・含めたい尾根や沢）。`map.size` は `sizeM` と同じ値、`map.resolution` は 4000 m 未満なら 257、6000 m 未満なら 385、それ以上は 513。');
    out.push('- `map.terrain` は例 2 のとおり空のまま（`data: ""`）。`vegetation`・`hazards: []`・`radio: { "stations": [] }` も例 2 のとおりでよい（森林限界が低い山域なら `vegetation.forestLine` を変える）。');
    out.push('- 地点（`nodes`）: `x` と `z` は 0（位置は `nodeLatLon` に書く）。`osmName` に OpenStreetMap・地理院地図に載っている名前と同じ表記（山名・峠名・小屋名・駅名・バス停名）、`expectedElevM` に概略の標高。分岐・登山口・山頂・小屋・迷いやすい場所を地点にする。小屋には `shelter`（営業小屋 `staffed`・避難小屋 `emergency`）。地図に名前のない場所（分岐など）は `osmName` を書かず、`nodeLatLon` の位置に置かれる（人間が後で確かめる）。');
    out.push('- 道（`edges`）: `kind` は `"trail"`、`waypoints` は空の配列 `[]`。`from`・`to` は地点の ID。`courseTimeMin` に標準コースタイム（[from→to, to→from] の分。登山地図・山と高原地図の値に近いもの）。途中で必ず通る名前のある地点があれば `via` に OSM の名前で書く。`class`・`markers`・`drift`・`sinuosity` は付録 B の意味で道の様子に合わせる。');
    out.push('- 計画ルート（`plan.route`）の隣どうしの地点は、必ず道（エッジ）でつながっていること。');
    out.push('- シナリオの `region` は `{ "name": "山域の名前", "real": true }`（実在の山の注記が出る）。`sources` に参考文献と、地形・登山道の出典（「国土地理院」「© OpenStreetMap contributors」）を書く。');
    out.push('- 偽の道（`kind: "false"`、登山道ではない尾根や沢への迷い込み）は座標が要るので、スケルトンには書かない。道迷いを起こしたいときは、そのことを設計書に書いておけば、人間がエディターで描き足す（分岐の紛らわしさ `confusers` も同じ）。');
    out.push('- 登山道のない所（沢登り・バリエーションルートなど）は OSM に道がなく結び付かないので、なるべく OSM に登山道のある区間で組み立てる。');
  } else {
    const m = ctx.map;
    out.push(i.stage === 'fictional' ? '架空の山「箱庭岳」で作ります。地図はできあがっているので、地点と道の ID を使うだけです。' : 'エディターのプロジェクトにある地図で作ります。地図はできあがっているので、地点と道の ID を使うだけです。');
    out.push('');
    out.push(m ? mapSummary(m, i.stage === 'project' ? ctx.scenario : undefined) : '（地図の情報がありません）');
    if (m && m.edges.some((e) => e.kind === 'false')) out.push('- `偽の道` は登山道ではない踏み跡（迷い込むと末端で消える）。計画ルートには使わない。迷い込みは自動で起きる（分岐の紛らわしさ・霧・暗さ・読図の力による）。');
  }
  return out;
}

/** ユーザーの入力 */
function requestLines(i: StandaloneInput): string[] {
  const out: string[] = [];
  const urls = cleanUrls(i.urls);
  out.push(`- タイトル: ${i.title.trim() || '（未定。ストーリーに合う短い題を付ける）'}`);
  if (urls.length > 0) {
    out.push('- 参考文献（読めるなら読む。事故の報告書・山行記録・ニュース・地図など）:');
    for (const u of urls) out.push(`  - ${u}`);
  } else out.push('- 参考文献: なし');
  out.push(`- 登場人物の人数や条件: ${i.people.trim() || '（指定なし。ストーリーに合わせて決める）'}`);
  out.push('- ストーリー:');
  out.push('');
  out.push(i.story.trim() ? i.story.trim().split(/\r?\n/).map((l) => `  > ${l}`).join('\n') : '  > （ここにストーリーを書く）');
  return out;
}

/** 読み込みと確かめ方（人間の手順。AI はこれを最後に短く添える） */
function importLines(i: StandaloneInput): string[] {
  const out: string[] = ['1. JSON のコードブロックをファイルに保存し、「遭難ですよ」のシナリオエディター（`editor.html`）のトップで「ファイルから読み込む」に渡す。'];
  if (i.stage === 'real') {
    out.push('2. 範囲の中心の緯度経度を聞かれるので確かめる → プロジェクトが開く。');
    out.push('3. タブ「エリア」で標高を取得 → タブ「登山道」で「OpenStreetMap から取り込む」（下書きの道は「すべて除外」でよい）→「結合する（名前の候補＋補間）」。');
    out.push('4. タブ「地点」で地点の位置を確かめ、つながらなかった道はタブ「登山道」で直す（上部の検証が直し方を示す）。必要なら偽の道や分岐の紛らわしさを描き足す。');
    out.push('5. 上部の検証（⚠ 警告・✖ エラー）を見る → タブ「試走」で推奨の方針で 1 回走らせ、結末に着くか見る → まとめて試して（モンテカルロ）結果の割合を見る。');
  } else {
    out.push(i.stage === 'project' ? '2. 同じ地図のプロジェクトがこのブラウザにあれば、その地図で新しいプロジェクトとして開く。' : '2. 箱庭岳の新しいプロジェクトとして開く。');
    out.push('3. 上部の検証（⚠ 警告・✖ エラー）を見る → タブ「試走」で推奨の方針で 1 回走らせ、結末に着くか見る → まとめて試して（モンテカルロ）結果の割合を見る。');
  }
  out.push(`${i.stage === 'real' ? 6 : 4}. 読み込めない・検証のエラーが出たときは、出た文をそのまま AI に貼って直してもらう。`);
  return out;
}

export function buildStandalonePrompt(i: StandaloneInput, ctx: StandaloneContext = {}): string {
  const out: string[] = [];
  const push = (...xs: string[]): void => void out.push(...xs);
  push('# 「遭難ですよ」のシナリオを作ってください', '');
  push('あなたは山岳遭難シミュレーション「遭難ですよ」のシナリオ作者です。「遭難ですよ」は、箱庭（ジオラマ）のような山で起きる山岳遭難の経過を 3D で見守る、山岳安全教育のための Web アプリです。プレイヤーは観察者として時間の流れを見守り、ときどき出る選択肢で登山者の行動を決めます。');
  push('シナリオは JSON のファイル 1 つで、アプリの「シナリオエディター」で読み込みます。このプロンプトだけで作れるように、ファイルの形式と仕様を付録にすべて付けました。アプリのソースコードは見られなくてかまいません。', '');
  push('## 依頼', '');
  push(...requestLines(i), '');
  push('## このシミュレーターの考え方（守ること）', '');
  push('- 選択は結果を直接決めません。選択は登場人物の **行動** を変え、結果は気象・地形・体（体温・エネルギー・水分・疲労・けが・急病）・道迷い・確率のシミュレーションが決めます。選択肢に「助かる」「倒れる」のような結果を書かず、行動（アクション）を書きます。結末（endings）は、起きたことに応じて `when` で出し分けます。');
  push('- 分岐点は、現実に人が迷う場面に置きます。選択肢は 2〜4 個、`recommended`（推奨）を 1 つ以上。推奨の選び方を続ければ、ほとんど無事に下りられるように（`balanceTargets.recommended.goodMin` を 0.85 以上に）。原案に近い選び方では、原案のような結果が一定の割合で起きるのがよい。');
  push('- 登場人物は、その人の知っていること・持ち物・体の状態・時刻・天気と矛盾しない行動・セリフ・一人言にします。');
  push('- 表現は事実に沿って、煽らず、淡々と。死亡は静かに書き、けがの生々しい描写はしません。登場人物は架空の人にし、実在の人物の名前や、個人を特定できることは書きません。');
  push('- 実際の遭難事故をもとにするとき（参考文献が事故の報告書など）: 人物は報告書の記号（A、B など）や役割名で書き、実名を出しません。`historical`（付録 A §11）に出典と注記（`disclaimer`）を書き、シミュレーションの結果と実際の記録を混同させない文にします。');
  push('- 「これは架空のモデルであり、実際の判断は状況により異なる」旨の注記や、実在の山の「実際の山行計画には使えない」旨の注記はアプリが自動で出します（`region.real` を正しく書くこと）。シナリオの文に書く必要はありません。');
  push('- 参考文献の URL が読めないときは、読めなかったことを書き、知っていることだけで作ります。分からないこと（時刻・天気・装備など）は推測だと分かるように設計書に書き、もっともらしく作ります。出典は `sources`（と `historical.sources`）に書きます。', '');
  push('## 舞台', '');
  push(...stageLines(i, ctx), '');
  push('## 進め方', '');
  push('### 1. 調べて、短い設計書を書く', '');
  push(...designLines(), '');
  push('### 2. 仕組みに当てはめる', '');
  push('- 下の「使える仕組み」と付録の形式だけを使います（存在しないアクション・条件・変数・フィールドを書かない）。');
  push('- 時刻は `"D0 06:00"` の形（D0 が `startDate` の日、D1 が翌日）。天気は時刻つきのキーフレーム（`weather.keyframes`、時刻の順）で、`refElevM` の高さの値を書きます（気温は標高とともに `lapseRateCPer100m` で下がる）。日の出・日の入り（`sun`）は日付と場所に合わせます。');
  push('- 文の中に `{leader.local.tempC:0}` のような差し込み（付録 A §4.1 の変数パス）が使えます。存在しないパスは書かないでください。', '');
  push('### 3. JSON を書く', '');
  push(...outputLines(i, ctx), '');
  push('### 4. 自分で確かめる（出す前に）', '');
  push('- 形式: JSON として正しいか（末尾のカンマ・コメントがない）。必須のフィールドがすべてあるか（例 1 と見比べる）。列挙の値（`theme`・`season`・アクションの `type`・状態・結末の `kind` など）が付録 C の型にあるものか。');
  push('- 参照: 地点・道・登山者・分岐点・選択肢の ID が、定義されたものだけを指しているか。計画ルートの隣どうしの地点が道でつながっているか。');
  push('- 付録 A §13 の検証項目: 時刻の書式と順序、分岐点ごとに 2〜4 個の選択肢と `recommended`、`leader: true` がちょうど 1 人、差し込みのパス。');
  push(...reviewLines(), '');
  push('### 5. 読み込みの手順を添える', '');
  push('JSON の後に、人間がする次の手順を短く添えてください。', '');
  push(...importLines(i), '');
  push('## 使える仕組み（これ以外は書かない）', '');
  push(...mechanismLines(), '');
  push('## 例 1: シナリオ（架空の箱庭岳、mapId "sounan"。形式の見本）', '');
  push('小さいけれど検証を通る完全な例です。実際にはストーリーに合わせて、分岐点・イベント・一人言・セリフ・結末・教訓をもっと書きます。', '');
  push('```json', compactJson(EXAMPLE_SCENARIO), '```', '');
  if (i.stage === 'real') {
    push('## 例 2: スケルトンマップ（実在の山。バンドルの "map" に入れる）と nodeLatLon', '');
    push('形式の見本です（標高・コースタイム・緯度経度はおおよその値）。', '');
    push('```json', compactJson(EXAMPLE_SKELETON), '```', '');
    push('```json', compactJson({ nodeLatLon: EXAMPLE_NODE_LATLON }), '```', '');
  }
  push(...specAppendix());
  return out.join('\n');
}
