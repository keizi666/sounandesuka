# 進捗

フェーズの定義と受け入れ基準は `docs/13_phases.md`。各フェーズの終わりに `npm run typecheck` / `npm run test` / `npm run check:sim-purity`（P5 以降は `npm run sim:check` も）を通す。

## P0 土台 — 完了（2026-11-18）

- [x] Vite + TypeScript strict の雛形（`noUncheckedIndexedAccess`、マルチページ: `index.html` / `editor.html`）
- [x] npm スクリプト一式（未実装の `sim` / `mc` / `sim:check` / `validate` / `geo:smoke` はメッセージを出して exit 0）
- [x] `src/sim/types.ts`（appendix をコピー。一致をテストで確認）、`src/sim/tuning.ts`（空の定数オブジェクト）
- [x] `tools/purity.ts`（`Math.random` / `Date.now` / `performance` / three の import / `document` / `window` / `fetch` などを検出。テストつき）
- [x] `src/sim` を DOM・Node の型なしで型検査する `tsconfig.sim.json`
- [x] `docs/PROGRESS.md` と `docs/DECISIONS.md`
- [x] 受け入れ: `npm run typecheck && npm run test && npm run check:sim-purity` が通る。`npm run dev` で空の画面が出る

## P1 乱数・時刻・地形 — 完了（2026-11-18）

- [x] `core/rng.ts`（xoshiro128**、名前付きストリーム、既知ベクトルのテスト）
- [x] `core/clock.ts`（TimeRef、日付、太陽高度、次の日の出）
- [x] `core/dmath.ts`（超越関数の窓口）
- [x] `terrain/noise.ts` `generate.ts` `flow.ts` `derive.ts` `sample.ts` `coverage.ts` `polyline.ts` `map.ts`
- [x] 受け入れ: rng の一致と既知ベクトル / docs/04 §3.3 の 3 項目 / Node で 1 秒以内（約 0.35 秒）/ docs/04 §7 の電波の検証 / `npm run sim -- --dump-terrain` で PGM 出力
- [x] マップの急峻さ → P6 で地形を穏やかにした（DECISIONS）

## P2 登山道と移動 — 完了（2026-11-18）

- [x] `terrain/trails.ts`（ポリライン化、隣接、ルート解決、ダイクストラ、エッジ上の位置）
- [x] `climber/movement.ts`（Tobler と各係数、歩行 MET、MET 上限）、`climber/position.ts`（posToWorld）、`climber/walk.ts`、`climber/state.ts`
- [x] `core/world.ts`（createWorld・createStaticContext）、`core/step.ts`（時刻・太陽・移動）、`weather/sun.ts`、`weather/ground.ts`（読み出しのみ）
- [x] 受け入れ: 全エッジ両方向でコースタイム ±25%（実際は ±15%）/ s01 の計画ルートを標準登山者が 50 分歩行・10 分休憩で 9.1 時間

## P3 気象 — 完了（2026-11-18）

- [x] `weather/global.ts`（キーフレーム補間・風向の最短弧・時間ノイズ・雷雲セル・途中挿入のキーフレーム）
- [x] `weather/local.ts`（気温減率・風の高度/露出/風下/植生補正・地形性降水・降水種別・視程・体感温度・日射）
- [x] `weather/ground.ts`（標高ビンの積雪・濡れ・凍結）、`weather/sun.ts`（雲による暗さ）
- [x] 受け入れ: 補間のテスト / SUMMIT と TH_SAWA の気温差が減率どおり（誤差 0）/ SUMMIT の風が J_FOREST の 2 倍以上（s01 で最小 4.75 倍）/ s01 の 15:00 以降 2,200 m 以上はみぞれ・雪 / D1 03:00 の 2,300 m の積雪 42.7 cm

## P4 生理 — 完了（2026-11-18）

- [x] `climber/physiology.ts`（熱収支・震え・発汗・濡れ・エネルギー・水分・疲労・不安、熱環境）
- [x] `climber/capacity.ts`（J・M・段階・意識・心停止・死亡）
- [x] stepWorld に生理を組み込み（状態ごとの MET、地面との接触）
- [x] 受け入れ: 較正 C1〜C9 すべて合格（`tests/physiology.calibration.test.ts`）。最終定数は DECISIONS

## P5 シナリオ・分岐点・結末 — 完了（2026-11-19）

- [x] `scenario/`: vars・conditions・text・load・choices・events・endings・validate、`policy.ts`、`headless.ts`
- [x] `climber/`: actions・behavior（状態と自律ミクロ行動）・route・party（一緒に歩く）・perception（遅れ）
- [x] `tools/sim.ts`（--log）・`tools/validate.ts`・`tools/simcheck.ts`、`src/i18n/format.ts`
- [x] 受け入れ: validate で 3 シナリオ・1 マップにエラーなし、壊した JSON 9 種で期待どおりのパス / `npm run sim -- s01_cold_front --policy recommended --log` が結末まで走る / sim:check 合格

## P6 道迷い・危険・機器・救助 — 完了（2026-11-19）

- [x] `climber/navigation.ts`・`offtrail.ts`（分岐の誤り・踏み外し・気づき・軌跡・沢下り・GPS・電波探し・風下探索）、`terrain/pathing.ts`（A*）
- [x] `hazards/slip.ts`・`lightning.ts`、`climber/devices.ts`、`rescue/rescue.ts`、`scenario/generic.ts`、`climber/thoughts.ts`
- [x] 受け入れ: s02 道迷い bias 59%・recommended 14% / 沢下り 100 回で鬼ヶ沢 100%・滝 72% / 山頂 30 分の被雷率 5〜25%・森林 2% 以下 / 圏外の通報失敗と電波探し後の成功 / 夜間ヘリ不可

## P7 記録・モンテカルロ・調整 — 完了（2026-11-19）

- [x] `record/recorder.ts`・`lessons.ts`、`core/snapshot.ts`（正規化 JSON・FNV-1a 64bit）、`mc.ts`、`tools/mc.ts`（--all で合否）
- [x] 受け入れ: 決定論テスト（同シード同方針・保存復元あり/なし）/ 3 シナリオ × 方針の balanceTargets すべて OK / 1 人の 24 時間分の実行 約 47 ms（3 人は約 76 ms）

## これから

- [x] P8 ジオラマ描画
  - 台座・断面・机、地形（植生の頂点色＋質感ノイズ）、樹木（近景・遠景の LOD、秋の紅葉）、登山道・建物、ブロック玩具風の人形（姿勢・雨具・ヘッドランプ）、俯瞰・追従・視点カメラ、前後 2 状態の補間、電波圏は Worker。
  - ブラウザで s01・s02・s03 を開き、登山者が歩き、時刻で光と空の色が変わることを確認した（開発機の画面で確認。ペインが隠れている間は rAF が止まるため、確認時は JS でフレームを進めた）。
- [x] P9 気象の描画
  - 雲層（柔らかい塊のスプライト、雲底より上の地形を霧で隠す）、降水（雨・みぞれ・雪を頂点シェーダで）、雷雲（塔状の雲＋金床）、稲妻と閃光、積雪線・濡れ、夜の色味（ヘッドランプと小屋の窓だけが光る）、地図レイヤー（気温・風・電波・危険）。
  - s01 で稜線が雲に隠れ雪が降る様子、s03 で雷雲が立ち上がる様子を確認。低品質では雲・降水の数を減らす。
- [x] P10 UI
  - 全画面（タイトル・選択・ブリーフィング・シミュレーション・分岐点・結末・履歴・設定）、情報モード（神の視点／登山者の視点）、判断時間制限モード（30 秒、登山者は立ち止まって待つ）、観察のみモード、キーボード（Space・1〜4・G・C・↑↓・Enter）、スマホ幅 360px。
  - セリフ（`sim/climber/speech.ts`: 組み込みテンプレート・シナリオの speech・応答、3 分間隔・同時 3 人まで、thoughts ストリームだけを使う）、`distort()`・`classify()`、吹き出し（SVG で本体と尻尾を一体で描く、思考は丸 2 つ、重なり回避、構音障害の揺れ、史実の※と記録・架空のバッジ、aria-live）。
  - 3 シナリオを最初から結末まで（観察のみ・通常の両方）ブラウザで通した。`bubbleLayout.test.ts` 合格。
- [x] P11 振り返り・What-if
  - 時系列グラフ（体温・気温・体感・風・降水、分岐点・出来事・実際の記録の目印、ホバー）、2D 地図（体温で塗った軌跡）、What-if（`sim/record/whatif.ts` と Worker、選択肢ごとに 30 回、結果が出た順に表示）、教訓、この分岐からやり直す（記録も分岐点で切って継続、parentRunId つき）。
  - s01 の振り返りで 3 分岐点・8 件の What-if が 6.0 秒で揃った（基準 20 秒以内）。やり直しで分岐点のモーダルから再開できた。`whatif.test.ts` 合格。
- [ ] P12 保存・設定・仕上げ
- [ ] P13 可変マップとバンドル
- [ ] P14 エディターの骨格とエリア・地形
- [ ] P15 登山道・地点・環境
- [ ] P16 天候エディター
- [ ] P17 シナリオ編集
- [ ] P18 試走・書き出し・仕上げ
- [ ] P19 大人数・グループ・史実シナリオ
