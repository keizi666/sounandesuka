# 03 アーキテクチャ

## 1. レイヤー構成

```
┌──────────────────────────────────────────────────────────┐
│ editor/   シナリオエディター（editor.html）                  │
│   geo/ は外部通信（地理院タイル・Overpass・Open-Meteo）を担当   │
├──────────────────────────────────────────────────────────┤
│ app/      画面遷移・設定・保存・メインループ                  │
├───────────────┬───────────────────┬──────────────────────┤
│ ui/ (DOM)     │ view/ (three.js)  │ workers/             │
│ パネル・モーダル │ ジオラマ・気象表現   │ What-if・電波圏計算    │
├───────────────┴───────────────────┴──────────────────────┤
│ sim/  純粋 TypeScript。three/DOM 非依存。決定論的            │
│   core / terrain / weather / climber / hazards / rescue   │
│   scenario / record                                       │
└──────────────────────────────────────────────────────────┘
```

依存方向は上→下のみ。`sim` は他のどれにも依存しない。`view` と `ui` は互いに直接依存せず、`app` が仲介する。
`editor` は `sim`・`view`・`ui` の部品（グラフ、2D 地図描画）を使ってよいが、逆方向の依存は禁止。

## 2. ディレクトリ構成

```
hakoniwa-sim/
├─ CLAUDE.md
├─ docs/                         仕様（本書）
├─ index.html                    プレイヤー
├─ editor.html                   シナリオエディター
├─ public/
│  ├─ maps/hakoniwa.json
│  └─ scenarios/
│     ├─ index.json              一覧（id, file または bundle, title, theme, difficulty, season, estMinutes, region）
│     ├─ s01_cold_front.json
│     ├─ s02_fog_descent.json
│     └─ s03_thunder_ridge.json
├─ src/
│  ├─ main.ts
│  ├─ app/
│  │  ├─ App.ts                  画面ルーター（単純な state machine）
│  │  ├─ loop.ts                 rAF ループ・速度制御・補間係数
│  │  ├─ session.ts              1 プレイの管理（World 生成、選択の受け渡し、保存）
│  │  ├─ storage.ts              localStorage + gzip
│  │  └─ settings.ts
│  ├─ sim/
│  │  ├─ types.ts                docs/appendix/types.ts をコピー
│  │  ├─ tuning.ts               全調整定数
│  │  ├─ core/
│  │  │  ├─ rng.ts               xoshiro128** と名前付きストリーム
│  │  │  ├─ clock.ts             tMin ⇔ 表示、TimeRef パース、日の出入り
│  │  │  ├─ world.ts             createWorld(map, scenario, seed)
│  │  │  ├─ step.ts              stepWorld(world, ctx) — 1 ティック
│  │  │  └─ snapshot.ts          serialize / restore / hash
│  │  ├─ terrain/
│  │  │  ├─ noise.ts             value/simplex noise（自作、シード付き）
│  │  │  ├─ generate.ts          特徴量から高さマップ生成
│  │  │  ├─ derive.ts            傾斜・方位・TPI・流量・植生・崖・空の見通し
│  │  │  ├─ sample.ts            双線形補間・法線
│  │  │  ├─ trails.ts            登山道グラフ構築・ポリライン化・距離パラメータ
│  │  │  ├─ coverage.ts          電波圏（見通し計算）※Worker からも呼ぶ
│  │  │  └─ pathing.ts           A*（GPS で道へ戻る、救助隊の経路）
│  │  ├─ weather/
│  │  │  ├─ global.ts            キーフレーム補間＋時間ノイズ、雷雲セル
│  │  │  ├─ local.ts             地点補正（気温減率・風の露出・視程・降水種別）
│  │  │  ├─ ground.ts            標高帯ごとの積雪・地面の濡れ
│  │  │  └─ sun.ts               太陽高度・暗さ・月明かり
│  │  ├─ climber/
│  │  │  ├─ physiology.ts        熱収支・濡れ・エネルギー・水分・疲労・意識
│  │  │  ├─ capacity.ts          判断力 J・運動能力 M・最大 MET
│  │  │  ├─ movement.ts          登山道上の移動・速度・MET 算出
│  │  │  ├─ navigation.ts        分岐の誤り・逸脱・気づき・道外移動
│  │  │  ├─ behavior.ts          状態機械・自律ミクロ行動
│  │  │  ├─ actions.ts           Action の適用
│  │  │  ├─ perception.ts        登山者の主観（推定位置・天気の受け止め）
│  │  │  ├─ devices.ts           スマホ・ヘッドランプ電池
│  │  │  └─ thoughts.ts          思考テンプレート
│  │  ├─ hazards/
│  │  │  ├─ slip.ts              転倒・滑落
│  │  │  └─ lightning.ts
│  │  ├─ rescue/rescue.ts
│  │  ├─ scenario/
│  │  │  ├─ load.ts              JSON → 内部表現（TimeRef→tMin 等）
│  │  │  ├─ validate.ts
│  │  │  ├─ conditions.ts        条件 DSL の評価
│  │  │  ├─ vars.ts              変数パスの解決
│  │  │  ├─ choices.ts           分岐点の発火・解決・自律バイアス
│  │  │  ├─ generic.ts           汎用分岐点の定義
│  │  │  ├─ events.ts            スクリプトイベント
│  │  │  ├─ endings.ts           結末判定
│  │  │  └─ text.ts              プレースホルダ展開
│  │  ├─ record/
│  │  │  ├─ recorder.ts          時系列サンプリング
│  │  │  └─ lessons.ts
│  │  └─ policy.ts               自動選択方針（recommended/bias/random/risky）
│  ├─ view/                      docs/10_rendering.md
│  ├─ ui/                        docs/11_ui.md
│  ├─ workers/
│  │  ├─ whatif.worker.ts
│  │  ├─ coverage.worker.ts
│  │  ├─ dem.worker.ts           標高タイルのデコードと再サンプル（エディター）
│  │  └─ mc.worker.ts            エディターのモンテカルロ
│  ├─ editor/                    docs/15〜18
│  │  ├─ main.ts
│  │  ├─ EditorApp.ts            タブ・上部バー・Undo/Redo・自動保存
│  │  ├─ store/
│  │  │  ├─ idb.ts               IndexedDB
│  │  │  ├─ project.ts           EditorProject の生成・保存・複製
│  │  │  ├─ history.ts           Undo/Redo（スナップショット方式）
│  │  │  └─ bundle.ts            バンドルの書き出し・読み込み・base64/RLE
│  │  ├─ geo/
│  │  │  ├─ projection.ts        局所接平面 ⇔ 緯度経度、タイル座標
│  │  │  ├─ tiles.ts             タイル取得（同時 4 本・LRU）
│  │  │  ├─ dem.ts               標高タイル → 高さマップ
│  │  │  ├─ overpass.ts          OSM 取得とグラフ変換
│  │  │  ├─ gpx.ts               GPX 解析・マップマッチング
│  │  │  ├─ openmeteo.ts         過去の気象 → キーフレーム
│  │  │  └─ sunrise.ts           日の出入りの計算
│  │  ├─ map/
│  │  │  ├─ TileMapView.ts       2D タイル地図
│  │  │  └─ layers/              trails / nodes / hazards / area / thunder / paint / route / track
│  │  ├─ weather/
│  │  │  ├─ Timeline.ts
│  │  │  └─ presets.ts
│  │  ├─ forms/                  ConditionBuilder, ActionEditor, ClimberCard, …
│  │  └─ panels/                 タブごとのパネル
│  └─ i18n/ja.ts
├─ tools/
│  ├─ sim.ts                     npm run sim
│  ├─ mc.ts                      npm run mc
│  ├─ simcheck.ts                npm run sim:check
│  ├─ validate.ts                npm run validate
│  └─ purity.ts                  npm run check:sim-purity
└─ tests/                        vitest（docs/14_testing_balancing.md）
```

## 3. World（シミュレーション状態）

`World` はすべてプレーンデータ。巨大で不変なデータ（高さマップ・派生レイヤー・登山道ポリライン・シナリオ定義）は
`World` に入れず `StaticContext` として別に持ち、スナップショットにも含めない（マップ ID とシナリオ ID とシードから再生成できる）。

```ts
stepWorld(world: World, ctx: StaticContext): void
```

- `StaticContext` = `{ map: MapRuntime, scenario: ScenarioRuntime, tuning: Tuning }`
- `MapRuntime` は高さ `Float32Array` などの型付き配列を含んでよい（World ではないため）。
- 型の詳細は `docs/appendix/types.ts`。

## 4. 1 ティックの処理順（固定。変えると決定論テストが壊れる）

```
stepWorld(world, ctx):
  1. world.tMin += dtSec/60
  2. sun.update(world)                         太陽高度・暗さ
  3. weather.updateGlobal(world, ctx)          キーフレーム補間＋ノイズ＋雷雲セル
  4. weather.updateGround(world, ctx)          積雪・濡れ（標高帯）
  5. if world.pendingChoice: return            分岐点の回答待ち（インタラクティブ時）
  6. scenario.runEvents(world, ctx)            スクリプトイベント（条件→効果）
  7. scenario.checkChoices(world, ctx)         発火したら pendingChoice をセットして return
  8. for each climber (配列順):
       a. local = weather.sampleLocal(world, ctx, climber.pos)
       b. perception.update
       c. behavior.autonomous (ミクロ行動: 雨具・食事・休憩・ライト)
       d. behavior.step (状態ごとの移動・ナビゲーション)
       e. hazards.slip / hazards.lightning
       f. physiology.integrate(dtSec)
       g. devices.drain
       h. capacity.update (J, M)
       i. thoughts.maybeEmit
  9. party.cohesion(world)                     同行者を先頭に合わせる
 10. rescue.step(world, ctx)
 11. endings.check(world, ctx)                 終了なら world.ended をセット
 12. recorder.sample(world)                    ゲーム内 5 分ごと
```

分岐点の待ちは「ティック 5 で return」で表現する。気象は分岐点待ちでも進まない（3,4 の前にチェックを置くと
時間停止になるため、実装では `if (world.pendingChoice && mode === 'interactive') return` を **ステップ 1 の前**に置く）。
判断時間制限モードでは `pendingChoice` があっても 1〜4 と 8 以降を進め（登山者はその場で立ち止まった扱い = `RESTING`）、
制限時間後に自律バイアスで解決する。

## 5. 乱数

- アルゴリズム: xoshiro128**（32bit 整数演算のみで実装し、全環境で同一結果）。シードは splitmix32 で 4 語に展開。
- ストリーム（`world.rng[name]` に 4 語の状態を保持）:
  `weather`, `nav`, `hazard`, `behavior`, `rescue`, `thoughts`, `choice`, `events`
- `thoughts` のように結果に影響しない用途を分離し、思考テンプレートを変更してもシミュレーション結果が変わらないようにする。
- What-if やモンテカルロでは `seed = hash(baseSeed, runIndex)` で派生させる。

## 6. メインループ（app/loop.ts）

```
onFrame(now):
  realDt = min(now - last, 100ms)
  if (!paused) accumulator += realDt * speedTicksPerMs
  steps = 0
  while accumulator >= 1 and steps < MAX_STEPS_PER_FRAME(=400):
     prev = lightweight copy of climber poses/weather render-params
     stepWorld(world, ctx); steps++; accumulator -= 1
     drain world.events → ui.log / view.pins / autoPause判定
     if world.pendingChoice → paused=true; ui.showChoice(); break
     if world.ended → paused=true; app.toEnding(); break
  alpha = accumulator  (0..1)
  view.render(prevPose, currPose, alpha, world)   補間
  ui.update(world) は 4Hz に間引き
```

- `world.events` は `stepWorld` 内で push し、ループ側で毎フレーム取り出して空にする（World には残さない。記録は recorder が別に持つ）。
- 描画用の補間は位置・向き・時刻・気象の描画パラメータのみ。

## 7. スナップショットと決定論

- `serialize(world)` = `JSON.stringify(world)` を gzip（`CompressionStream`）→ base64。
- `hashWorld(world)` = 正規化 JSON（キー順ソート、数値は `toFixed(6)`）の FNV-1a 64bit。
- 決定論テスト: 同一シード・同一選択列で 2 回実行し、最終ハッシュとレコードハッシュが一致。
- 分岐点発火時に必ずスナップショットを `session.choiceSnapshots[cpId]` に保存（What-if とやり直しで使用）。

## 8. Web Worker

| Worker | 入力 | 出力 |
|---|---|---|
| `coverage.worker` | マップ ID（Worker 内でマップ JSON を fetch し地形生成） | 電波強度 `Float32Array`（Transferable） |
| `whatif.worker` | マップ ID, シナリオ ID, スナップショット, 分岐点 ID, 選択肢 ID, N, 以降の方針 | 結末種別ごとの件数、最低体温の分布 |

Worker でも同じ `sim/` コードを使う（Vite の `new Worker(new URL(...), { type: 'module' })`）。

## 9. 保存（app/storage.ts）

| キー | 内容 |
|---|---|
| `hks.v1.settings` | 設定 JSON |
| `hks.v1.save.<scenarioId>` | 最新の自動保存（gzip+base64 の World + 選択履歴 + 分岐点スナップショット） |
| `hks.v1.history` | 実行履歴の配列（最大 50 件） |

容量超過時は古い履歴から削除し、それでも失敗したら保存をあきらめてトースト表示。

## 10. ビルドと配置

- `vite build` で `dist/` を生成。`VITE_BASE` 環境変数で `base` を設定（例: `/hakoniwa/`）。
- `public/` 配下の JSON は相対パスで fetch（`import.meta.env.BASE_URL` を前置）。
- さくらのレンタルサーバーには `dist/` をそのまま配置する。`.htaccess` 不要（SPA ルーティングを使わず、画面遷移はハッシュなしの内部状態）。
