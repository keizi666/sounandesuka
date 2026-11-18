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
- [ ] 要検討: マップの急峻さ（DECISIONS「要検討」）。P6 の前に決める

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

## これから

- [ ] P5 シナリオ・分岐点・結末
- [ ] P6 道迷い・危険・機器・救助
- [ ] P7 記録・モンテカルロ・調整
- [ ] P8 ジオラマ描画
- [ ] P9 気象の描画
- [ ] P10 UI
- [ ] P11 振り返り・What-if
- [ ] P12 保存・設定・仕上げ
- [ ] P13 可変マップとバンドル
- [ ] P14 エディターの骨格とエリア・地形
- [ ] P15 登山道・地点・環境
- [ ] P16 天候エディター
- [ ] P17 シナリオ編集
- [ ] P18 試走・書き出し・仕上げ
- [ ] P19 大人数・グループ・史実シナリオ
