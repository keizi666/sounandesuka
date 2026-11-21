# CLAUDE.md — 遭難ですよ（コードネーム: sounan-sim）

このリポジトリは、箱庭（ジオラマ）状の山で起きる山岳遭難の推移を 3D で観察する Web アプリと、そのシナリオを作る **シナリオエディター** である。
舞台は架空の山「箱庭岳」と、エディターで国土地理院の標高・OpenStreetMap の登山道から作る実在の山のエリア。
ユーザーは観察者として時間の流れを見守り、ときどき提示される選択肢で登山者の行動を決める。
選択は「結果」を直接決めない。選択は登山者の **行動** を変え、結果は気象・地形・生理・確率のシミュレーションが決める。

## 重要
ユーザーをClaudeCodeで会話する言語は日本語とする。

## 最初に読む順番

1. `docs/00_overview.md` — コンセプトと用語
2. `docs/01_requirements.md` — 機能要件 / 非機能要件（FR-xx / NFR-xx）
3. `docs/02_game_design.md` — 体験設計・選択肢の原則・結末
4. `docs/03_architecture.md` — 技術構成・ディレクトリ・ループ・決定論
5. 実装中のフェーズに対応する詳細設計（`docs/13_phases.md` に対応表あり）
   - エディター（P13 以降）: `docs/15_editor_overview.md` → `16`（地理データ）→ `17`（天候）→ `18`（シナリオ編集）
   - みんなの遭難記録（公開の記録・感想・サーバー）: `docs/20_community.md`
6. 型定義の正: `docs/appendix/types.ts`（`src/sim/types.ts` にコピーして開始する）

## 技術スタック

- 言語: TypeScript（`strict: true`, `noUncheckedIndexedAccess: true`）
- 基本の依存: ランタイム `three`（`three/examples/jsm` の OrbitControls・GLTFLoader 等を含む）。開発 `vite`, `typescript`, `vitest`, `tsx`, `@types/three`
- 静的ファイルとしてさくらのレンタルサーバー等に置けること。バックエンドは「みんなの遭難記録」の小さな API（PHP 8 + SQLite、`server/api/`、`docs/20_community.md`）だけ。ほかの機能はサーバーなしで動くこと
- 保存は `localStorage`（容量対策に `CompressionStream('gzip')`）。エディターのプロジェクトは IndexedDB

### 依存の追加

使ったほうが開発の質が上がり手間が減るライブラリ（UI・チャート・地図・検証・リンター・アセット変換など）は使ってよい。ただし **追加する前に人間に確認する**。

- 確認のときに示すこと: 何に使うか、自作と比べた利点、サイズ（gzip 後）、ライセンス、保守状況、代わりの候補
- 承認されたら `docs/DECISIONS.md` に記録してから追加する
- 選ぶ条件:
  - ライセンスが寛容（MIT / BSD / Apache-2.0 / ISC など）
  - 実行時に使うものはバンドルに同梱する（外部 CDN から読まない。NFR-09）
  - 外部への通信を伴うもの（地図 SDK の既定タイル・解析送信など）は、鉄則 8 の通信先の制限に従って設定できること
  - `src/sim/**` には原則として依存を入れない。入れる場合も DOM・通信・時刻・`Math.random` を使わず、Node で動き、決定論を壊さないもの
  - 初回ロードの容量（NFR-03）に収まること

## エントリポイント

- `index.html` → `src/main.ts`（プレイヤー）
- `editor.html` → `src/editor/main.ts`（シナリオエディター）。Vite のマルチページ設定（Vite 8 では `build.rolldownOptions.input`）で両方をビルドする。

## アーキテクチャの鉄則

1. `src/sim/**` は **three も DOM も import しない**。Node（vitest / tsx）でそのまま動くこと。
2. シミュレーション状態 `World` は **プレーンな JSON 互換オブジェクト**のみ（クラスインスタンス・関数・Map/Set を入れない）。`structuredClone` と `JSON.stringify` で往復できること。
3. 乱数は `World.rng` の **サブシステム別ストリーム**だけを使う。`Math.random()` と `Date.now()` は `src/sim/**` で禁止。超越関数（`Math.sin`・`Math.exp`・`Math.pow` など）と `**` は `src/sim/core/dmath.ts` 経由でだけ使う（`npm run check:sim-purity` スクリプトで検査する。ESLint を導入した場合はルールでも検査してよい）。
4. 調整用の数値定数はすべて `src/sim/tuning.ts` に集約し、コード中に魔法の数値を書かない。
5. 画面に出す日本語文字列は `src/i18n/ja.ts` に集約する（シナリオ JSON 内の文章は除く）。
6. シミュレーションの固定刻みは **ゲーム内 10 秒**。描画は前後 2 状態を補間する。
7. マップの大きさ・解像度は可変（一辺 2〜12.3 km、頂点 257/385/513）。`16 m` や `4096` をコードに直書きせず、必ず `map.cell` / `map.def.size` を使う。
8. 外部への通信は `src/editor/geo/**` と、プレイヤーの任意機能「背景に地理院地図」だけ。通信先は `docs/15_editor_overview.md` §4 の表にあるものに限る。新しい外部サービスを足さない。例外として、同じオリジンの自前の API（`<base>/api/index.php`、「みんなの遭難記録」）にだけ `src/net/**` から通信してよい（`src/sim/**` からは不可。記録を送るのはユーザーが「記録を載せる」を押したときだけ）。
9. 外部データ由来の内容を表示する画面には必ず出典を出す（地理院タイル、© OpenStreetMap contributors、Open-Meteo）。

## 作業の進め方

- `docs/13_phases.md` のフェーズを **番号順に** 実装する。各フェーズの受け入れ基準をすべて満たすまで次に進まない。
- 各フェーズ終了時に必ず実行して通すこと:
  - `npm run typecheck`
  - `npm run test`
  - `npm run check:sim-purity`
  - フェーズ 5 以降: `npm run sim:check`（全シナリオを推奨方針で 1 回ずつヘッドレス実行し、例外なく結末に到達すること）
- 進捗は `docs/PROGRESS.md` にチェックリストで記録する（なければ作る）。
- 仕様が曖昧なときは「受け入れ基準を満たす最も単純な実装」を選び、`docs/DECISIONS.md` に 1〜3 行で記録する。
- フェーズごとにコミットする。コミットメッセージは `P{番号}: {要約}`。

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー（http://localhost:5281 。`/` プレイヤー、`/editor.html` エディター） |
| `npm run dev:quiet` | 自動で読み込み直さない開発サーバー（http://localhost:5282 。ファイルが変わっても画面はそのまま。変更を見るときは手で読み込み直す） |
| `npm run build` | `dist/` に静的ビルド（`VITE_BASE` でベースパス指定可） |
| `npm run build:sounan` | `/sounandesuyo/` に置く用の静的ビルド |
| `npm run deploy [-- --with-real-data] [--dry-run]` | 公開用にビルドしてサーバーへ scp で上げる。「みんなの遭難記録」の API（`server/api`）と、その設定 `api/config.local.php` も一緒に作って上げる（設定は git に入れない `deploy.config.json`、見本は `deploy.config.example.json`。実在の山の地形データは権利の確認まで既定で上げない） |
| `npm run typecheck` | `tsc --noEmit`（全体と、DOM・Node の型なしで `src/sim` だけを見る `tsconfig.sim.json` の 2 回） |
| `npm run test` | vitest（ユニット・較正・決定論テスト） |
| `npm run sim -- <scenarioId> [--policy recommended\|bias\|random\|risky] [--seed N] [--log]` | ヘッドレス1回実行 |
| `npm run mc -- <scenarioId> --policy <p> --n 500` | モンテカルロ集計 |
| `npm run sim:check` | 全シナリオ×推奨方針の通し確認 |
| `npm run validate` | `public/maps` と `public/scenarios` の JSON 検証 |
| `npm run check:sim-purity` | `src/sim` 内の禁止 API 検査（`fetch` も禁止に含める） |
| `npm run geo:smoke` | 手動用。地理院タイル・Overpass・Open-Meteo に実際に 1 回ずつ問い合わせ、応答形式を確認（テストでは通信しない） |

## ドメイン上の注意

- これは山岳安全教育のためのシミュレーションである。低体温症・道迷い・落雷などの描写は **事実に沿って、煽らず、淡々と**。
- 死亡は「倒れた姿勢のフィギュア＋マーカーが静かに灰色になる」と「半透明の姿が静かに空へ昇って消える」（ユーザーの指定）程度で表現し、流血・損傷表現はしない。
- 結末画面と振り返りには必ず「これは架空のモデルであり、実際の判断は状況により異なる」旨の注記を出す。
- 史実シナリオ（`historical`）では人物を報告書の記号で表記し、実名を出さない。シミュレーション結果と実際の記録を混同させない表示にする（docs/09 §11）。
- 実在の山のシナリオ（`region.real: true`）では「実在の山を舞台にした架空のシナリオ。地形・登山道データは不正確な場合があり、実際の山行計画には使えない」旨も出す。
- 生理モデルは医学モデルではなくゲームモデル。正確な数式より **較正目標（`docs/06_climber_physiology.md`）を満たすこと** を優先する。

## コーディング規約

- 1 ファイル 400 行以内を目安。超える場合は分割。
- sim 内の関数は原則として純粋関数 `(world, ...) => void` か `(input) => output`。副作用は `World` の書き換えと `world.events.push` のみ。
- 単位はコード中の変数名で明示する: `tempC`, `windMs`, `precipMmH`, `elevM`, `distM`, `tMin`（ゲーム内分）, `dtSec`。
- 座標系: ワールド座標は **メートル**。`x` が東、`z` が南（three の右手系で `y` が上）。北は `-z`。
- 時刻はシナリオ開始日 0 時からの経過分 `tMin`（整数とは限らない）。表示時のみ `D0 05:30` / `05:30` 形式に変換。
