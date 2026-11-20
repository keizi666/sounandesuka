# 遭難ですよ（仕様パッケージ）

山岳遭難の推移を 3D のジオラマで観察する Web アプリと、そのシナリオを作るシナリオエディターの仕様と詳細設計です。
舞台は架空の山「箱庭岳」と、エディターで国土地理院の標高・OpenStreetMap の登山道から作る実在の山のエリアです。
実装は Claude Code が `CLAUDE.md` を起点に、`docs/13_phases.md` のフェーズ順で行います。

## 使い方

1. このフォルダを新しいリポジトリのルートに置く
2. Claude Code を起動し「CLAUDE.md を読んで P0 から始めて」と指示する
3. フェーズごとに受け入れ基準を確認してから次へ進める（P0〜P12 がプレイヤー、P13〜P18 がエディター）

## 中身

| パス | 内容 |
|---|---|
| `CLAUDE.md` | Claude Code への指示（技術スタック・依存の方針・鉄則・進め方・コマンド） |
| `docs/00_overview.md` | コンセプト・用語 |
| `docs/01_requirements.md` | 機能要件・非機能要件 |
| `docs/02_game_design.md` | 体験設計・選択肢の原則・結末 |
| `docs/03_architecture.md` | 構成・ディレクトリ・ティック処理順・決定論 |
| `docs/04_map_terrain.md` | 地形生成・植生・登山道グラフ・電波圏 |
| `docs/05_weather.md` | 全体気象・局地補正・雷雲セル・積雪 |
| `docs/06_climber_physiology.md` | 熱収支・濡れ・エネルギー・判断力・較正目標 |
| `docs/07_climber_behavior.md` | 移動・道迷い・状態機械・自律行動・思考 |
| `docs/08_hazards_rescue.md` | 転倒滑落・落雷・スマホ/ライト・救助 |
| `docs/09_scenario_format.md` | シナリオ JSON・条件 DSL・アクション・汎用分岐点 |
| `docs/10_rendering.md` | three.js によるジオラマ・モデル（人形・樹木・建物）・気象表現 |
| `docs/11_ui.md` | 画面・パネル・分岐点モーダル |
| `docs/12_debrief_replay.md` | 記録・振り返り・What-if |
| `docs/13_phases.md` | 実装フェーズと受け入れ基準 |
| `docs/14_testing_balancing.md` | テスト・モンテカルロ・バランス調整 |
| `docs/15_editor_overview.md` | エディター概要・データモデル・バンドル・外部データ源・権利表示 |
| `docs/16_editor_geodata.md` | エリア選択・標高タイル・OSM/GPX/手描きの登山道・植生・電波 |
| `docs/17_editor_weather.md` | 天候タイムライン・天気パターン9種・過去の天気の取り込み・雷雲 |
| `docs/18_editor_scenario.md` | 登山者・計画・分岐点（条件ビルダー）・試走・書き出し |
| `docs/appendix/types.ts` | 型定義（`src/sim/types.ts` の元） |
| `public/maps/sounan.json` | 箱庭岳のマップ |
| `public/scenarios/*.json` | サンプルシナリオ 3 本と一覧 |

## サンプルシナリオ

| ID | 題 | テーマ |
|---|---|---|
| `s01_cold_front` | 稜線の冷たい雨（10月・単独） | 寒冷前線・低体温症 |
| `s02_fog_descent` | 霧の下山路（6月・2人） | 遅れ・霧・廃道への道迷い・沢下り |
| `s03_thunder_ridge` | 稜線の雷雲（8月・3人） | 積乱雲・稜線での落雷 |
| `historical/s04_tomuraushi_2009` | トムラウシ 2009年7月16日（19人） | 史実の再構成。強風・濡れ・低体温症・パーティ分割。実地形はエディターで結合（P19） |

## ライセンス

- ソースコードと作者のオリジナルの内容は [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/) です。**非商用に限って**自由に使えます。
- **商用利用は許可制**です。販売・有料のサービスや製品・研修・広告などで使うときは、作者の許可（商用ライセンス）が必要です。[Issue](https://github.com/keizi666/sounandesuka/issues) でお問い合わせください。
- 非商用の制限があるため、OSI の定義する「オープンソース」ではなく、ソースを公開した非商用ライセンスです。
- 星の表（HYG、CC BY-SA 4.0）・月の画像（Solar System Scope、CC BY 4.0）・アイコン（Material Symbols、Apache 2.0）・npm の依存などの外部の素材は、それぞれのライセンスのままです。詳しくは [LICENSE](LICENSE) と `public/sky/CREDITS.md`・`public/audio/CREDITS.md`。
- 地理院タイル・OpenStreetMap から作る実在の山の地形データは、このリポジトリに含めていません（`tools/` で手元で作ります）。
