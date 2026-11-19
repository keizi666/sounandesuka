/**
 * AI 用のプロンプトを作る（エディターの「AI」タブ）。遭難の大まかなストーリーから、
 * AI に「詳しいシナリオの設計 → 作成 → 検証」をさせるための指示文（Markdown）を組み立てる。
 * シミュレーターで使える仕組み（アクション・条件・変数・汎用の分岐・結末の種類）はコードから一覧にして入れる
 * （AI が存在しない仕組みを書かないように）。純粋な関数（テストできる）。
 */
import { CLIMBER_FIELDS, DEF_FIELDS, GLOBAL_FIELDS, LOCAL_FIELDS, REC_FIELDS } from '../sim/scenario/vars';
import { BGM_IDS, SE_IDS } from '../sim/scenario/soundCatalog';
import { ACTION_TYPES, STATES } from '../sim/scenario/validate';
import type { EditorProject } from '../sim/types';

export interface AiPromptInput {
  story: string;
  source?: string;
  area?: string;
  season?: string;
  people?: string;
  extra?: string;
  /** agent: このリポジトリで作業する AI エージェント向け、chat: 会話の AI に JSON を返させる */
  mode: 'agent' | 'chat';
  /** 実在の地形で作る（agent のとき） */
  real: boolean;
}

const GENERIC_KEYS = ['lostAware（道迷いに気づいた）', 'darkness（暗くなった）', 'hypothermia（低体温の兆し）', 'injured（けが）', 'lightning（雷が近い）', 'waterfall（沢で滝に行き当たった）', 'straggler（遅れている人がいる）', 'rescueFailed（通報がつながらない）'];
const ENDING_KINDS = ['SAFE_RETURN（無事下山）', 'SAFE_SHELTER（小屋で過ごした）', 'ABORTED（行かなかった）', 'SELF_RESCUE（ビバークの末に自力で）', 'RESCUED（救助）', 'RESCUED_CRITICAL（重い状態で救助）', 'MISSING（見つからない）', 'FATAL（死亡）'];
const EFFECTS = ['log', 'forecastUpdate', 'setFlag', 'clearFlag', 'injure', 'rockfall', 'actions', 'weatherOverride', 'pin', 'triggerChoice', 'soak', 'say'];

/** 今のプロジェクトの地図の要約（地点と道） */
function mapSummary(p: EditorProject): string {
  const m = p.map;
  const lines: string[] = [];
  lines.push(`- マップ ID: ${m.id}（${m.name}）。一辺 ${m.size} m、${m.resolution} 頂点${m.geo ? `、中心 ${m.geo.centerLat.toFixed(5)}, ${m.geo.centerLon.toFixed(5)}（実在の地形）` : '（架空の箱庭岳）'}`);
  if (m.nodes.length > 0) {
    lines.push('- 地点（ID: 名前・種類）:');
    for (const n of m.nodes) lines.push(`  - ${n.id}: ${n.name}・${n.type}${n.shelter ? `（${n.shelter.kind === 'staffed' ? '営業小屋' : '避難小屋'}）` : ''}`);
  }
  if (m.edges.length > 0) {
    lines.push('- 道（ID: 名前・from→to・難しさ）:');
    for (const e of m.edges) lines.push(`  - ${e.id}: ${e.name}・${e.from}→${e.to ?? '（偽の道。行き止まり）'}・${e.class}${e.kind === 'false' ? '・偽の道' : ''}`);
  }
  const s = p.scenario;
  if (s.party.length > 0) lines.push(`- いまのシナリオ: 「${s.title}」 登場人物 ${s.party.map((c) => `${c.name}（${c.age}）`).join('、')}`);
  return lines.join('\n');
}

export function buildAiPrompt(p: EditorProject, i: AiPromptInput): string {
  const out: string[] = [];
  const agent = i.mode === 'agent';
  out.push('# 遭難シミュレーターのシナリオを作る');
  out.push('');
  out.push('あなたは山岳遭難シミュレーター「山の遭難シミュレータ」のシナリオ作者です。下の「大まかなストーリー」から、詳しいシナリオを設計し、作り、検証してください。');
  out.push('このシミュレーターでは、選択は結果を直接決めません。選択は登場人物の **行動** を変え、結果は気象・地形・体（体温・エネルギー・水分・疲労・けが・急病）・道迷い・確率のシミュレーションが決めます。');
  out.push('');
  out.push('## 大まかなストーリー');
  out.push('');
  out.push(i.story.trim() || '（ここにストーリーを書く）');
  out.push('');
  const notes: [string, string | undefined][] = [['原案・出典', i.source], ['山域・地名', i.area], ['時期・天気', i.season], ['登場人物', i.people], ['そのほかの希望', i.extra]];
  if (notes.some(([, v]) => v && v.trim())) {
    out.push('## 補足');
    out.push('');
    for (const [k, v] of notes) if (v && v.trim()) out.push(`- ${k}: ${v.trim()}`);
    out.push('');
  }
  out.push('## いまのプロジェクト（エディターで開いているもの）');
  out.push('');
  out.push(mapSummary(p));
  out.push('');
  out.push('## 進め方');
  out.push('');
  out.push('### 1. 調べて、詳しいシナリオの設計書を書く（まだ作らない）');
  out.push('');
  out.push('- 場所: 実在の山なら、登山口・小屋・分岐・山頂・沢・間違えやすい尾根や沢を地名と緯度経度で書き出す。コースタイムを調べる。');
  out.push('- 時期と天気: 日付・曜日・日の出と日の入り・気温（標高による）・風・雨や霧・雷・雪の推移を、時刻つきで決める。');
  out.push('- 登場人物: 年齢・性別・体重・経験・体力・読図の力・慎重さ・装備（雨具・防寒着・ヘッドランプ・スマホと電池・地図・笛・ツエルト・水と食料）・計画書と家族への連絡。');
  out.push('- 経過: 時刻つきのタイムライン。遭難が「なぜ」起きるのかを、物事の機序（例: 長い昼食 → 遅れ → 霧の時間帯に分岐 → 焦り → 見落とし）として書く。結果を台本で決めず、仕組みから起きるようにする。');
  out.push('- 分岐点: 現実に人が迷う場面ごとに、選択肢と、それぞれがどんな行動になり、どんな結果になりうるかを書く。遭難の後の行動（待つ・戻る・下る・通報・合図・パーティを分ける など）も現実に取りうるものを全部。');
  out.push('- 捜索: 誰がいつ気づき、どこを探すか（計画書・家族への連絡・小屋の予約・車やバスのカメラ・小屋のノート・通りかかる人）。手がかりがなければ捜索隊は出られない。');
  out.push('- 結末と教訓: 結末ごとの文と、選んだことに応じた教訓。');
  out.push('');
  out.push('### 2. 作る');
  out.push('');
  if (agent) {
    out.push('- このリポジトリの CLAUDE.md を最初に読み、従う。例として `public/scenarios/real/s06_sekirou.json`（家族・パーティの分割・電話・会話）、`s10_kobushi.json`（急病・通りかかる人・小屋の予約）、`s05_shounoiwa.json`（道迷い・偽の道・手がかりによる捜索）と、それぞれの `.build.json`・`public/maps/real/*.skeleton.json` を読む。');
    if (i.real) {
      out.push('- 実在の地形: `public/maps/real/<マップID>.skeleton.json`（地点と道のつながり）と `public/scenarios/real/<シナリオID>.build.json`（範囲・地点の座標・偽の道・速度係数・基地局）を書き、`npm run make:real -- <シナリオID>` で地形（地理院の標高・OSM の登山道・地理院の植生記号）と結合する。地点の座標は Overpass で調べる（User-Agent を付け、混雑していたら少し待ってやり直す）。登山道ではない尾根や沢は、標高の格子を読んで「偽の道」にする。');
    } else {
      out.push('- 箱庭岳の地図（`public/maps/sounan.json`）の地点と道を使い、`public/scenarios/<シナリオID>.json` を作る。');
    }
    out.push('- 一覧 `public/scenarios/index.json` に登録する。出典（原案のタイトル・作者・日付・URL、地理院、OSM）を `sources` に書く。');
  } else {
    out.push('- 下の「形式」に合うシナリオの JSON を 1 つだけ返す（説明は JSON の前に短く）。`mapId` は上の「いまのプロジェクト」のマップ ID、地点と道の ID もそこにあるものだけを使う。エディターの JSON タブに貼り付けて「適用」する。');
  }
  out.push('');
  out.push('### 3. 確かめる');
  out.push('');
  if (agent) {
    out.push('- `npm run validate`、`npm run typecheck`、`npm run test` を通す。');
    out.push('- 走らせたログを物語として読む（`.scratch/` に使い捨てのスクリプトを書き、選択を指定して 1 回ずつ走らせ、時刻・出来事・会話・一人言を出す）。コースタイムが現実に合うか（`paceAdj` で合わせる）、それぞれの選択が仕組みとしてどんな結果を生むかを確かめる。');
    out.push('- `npm run mc -- <シナリオID> --policy recommended|bias|risky --n 200` で結果の割合を見て、`balanceTargets` を決める。推奨の選び方ではほとんど助かり、原案に近い選び方では原案のような結果が一定の割合で起きるのがよい。');
  }
  out.push('- **人間らしさ**: 各人の選択（自動の選択と汎用の分岐を含む）、セリフ、一人言が、その人の知っていること・持ち物・状態・時刻・天気と矛盾しないか。例: ヘッドランプがないのに「つけて進む」、スマホをなくしたのに「通報する」、気づいた後に「道は合っているはず」、子どもが大人の計画の考えを言う、まだ遅れていないのに「遅いね」、電話をかけていないのに「つながらない」。一人言は `who` で持ち主を決める。合わない汎用の分岐は `genericOverrides` で状況と選択肢を上書きする。');
  out.push('- 表現: 事実に沿って、煽らず、淡々と。死亡は静かに。実在の人物の名前は使わない。実在の山なら「架空のシナリオ」である注記が出る（`region.real: true`）。');
  out.push('');
  out.push('## 使える仕組み（これ以外は書かない）');
  out.push('');
  out.push(`- アクション（選択肢の actions、イベントの actions。\`who\` で人を指せる）: ${ACTION_TYPES.join(', ')}`);
  out.push(`- イベントの効果: ${EFFECTS.join(', ')}`);
  out.push('- 条件: all / any / not / var（比較）/ after / before（時刻 "D0 13:00"）/ atNode（着いた瞬間）/ beenAt / onEdge / near / state / flag / chose / event / chance（1 回だけ抽選）/ elapsedSince（フラグからの経過分）');
  out.push(`- 変数: leader.<…>・c.<登山者ID>.<…> で ${CLIMBER_FIELDS.join(', ')}、local.<${LOCAL_FIELDS.join(', ')}>、def.<${DEF_FIELDS.join(', ')}>、g.<${GLOBAL_FIELDS.join(', ')}>、sun.isDark、flags.<名前>、rec.<${REC_FIELDS.join(', ')}>（結末と教訓だけ）`);
  out.push(`- 状態（state）: ${STATES.join(', ')}`);
  out.push(`- 汎用の分岐（genericOverrides で上書きできる）: ${GENERIC_KEYS.join('、')}`);
  out.push(`- 結末の種類: ${ENDING_KINDS.join('、')}。同じ種類を when で出し分ける（上から最初に合うもの）。`);
  out.push(`- そのほか: 天気のキーフレームと雷雲（weather.keyframes / thunderCells）、捜索の手がかり（plan.searchLeads）、通りかかる登山者（passersby）、パーティの分割（splitParty・groups）、一人言（thoughts、who）、会話（speech、who / to / replies。返事は言葉と同じ数なら同じ番目が組になる）、急病（illness: angina / mi / dissection / arrhythmia / benign / random）、ハチ（sting・epipen。刺された人の一部がアナフィラキシー）、飲酒（drinkAlcohol）、スマホの紛失（setPhone）、家族の届け出（reportMissing）、動揺（addAnxiety）、電波の入る地点まで歩いて通報（detach + goToNode の then: "call"）、下山した人が駅・バス停などへ移る（leaveMap。3D から消える。話の筋と位置を合わせるため、下山した人を入口に立たせたままにしない）、自分のグループの集計（mates.count・mates.unwellCount など）。効果音（sound: ${SE_IDS.join(' / ')}。電話・救助・転落・急病・分岐点は自動でも鳴る）、音楽（music アクション、シナリオの music: briefing / play / night / distress / good / bad。曲: ${BGM_IDS.join(' / ')}）。休む → 進むの順に並べると、休み終えてから進む。`);
  out.push('');
  out.push('## 形式');
  out.push('');
  out.push('型の定義は `src/sim/types.ts`（ScenarioDef）。検証は `src/sim/scenario/validate.ts`。画面の文は日本語。');
  return out.join('\n');
}
