# 04 マップと地形

## 1. 座標系とグリッド

- 箱庭の大きさ `size`（m）と頂点数 `resolution` はマップごとに可変。箱庭岳は **4,096 m 四方・257 頂点（セル 16 m）**。実在エリアは一辺 2〜12.3 km、257/385/513 頂点（`docs/16` §3.1）。
- `cell = size / (resolution - 1)`、`half = size / 2`。原点は中央。`x ∈ [-half, half]`（東が正）、`z ∈ [-half, half]`（南が正、北は -z）。
- 高さグリッド: `heights: Float32Array`（行優先、`i = iz * n + ix`）。
- 標高は実寸のメートル。描画時の鉛直誇張は既定 1.0（設定 0.8〜1.5）。sim は常に実寸。
- グリッド座標 ⇔ ワールド: `x = -half + ix * cell`, `z = -half + iz * cell`。
- 本章で「16 m」「257」「4096」と書いている数値は箱庭岳での値。コードでは `cell` / `n` / `size` を使う。半径などの距離パラメータはメートルのまま（セル数に換算しない）。
- 標高サンプリングは双線形補間 `sampleElev(x, z)`。法線は中心差分。

## 2. マップ JSON の構成（`public/maps/<id>.json`）

```jsonc
{
  "id": "hakoniwa",
  "name": "箱庭岳",
  "size": 4096,
  "resolution": 257,
  "terrain": { /* §3 */ },
  "vegetation": { "forestLine": 2150, "forestLineNoise": 60, "broadleafLine": 1600 },
  "nodes": [ /* §5 */ ],
  "edges": [ /* §5 */ ],
  "hazards": [ /* §6 */ ],
  "radio": { "stations": [ /* §7 */ ] }
}
```

完全な例は `public/maps/hakoniwa.json`。

## 3. 地形生成（`sim/terrain/generate.ts`）

`terrain.type` で 2 通り:

- `"procedural"`（省略時）: 本節の手続き生成（箱庭岳）。
- `"heightmap"`: 実在エリア。`data`（Uint16 LE の base64）を `h = minElevM + v/65535 × (maxElevM − minElevM)` で復元するだけ。ノードのスナップ（§3.2 の 7）は `snap: true` のノードだけに行う（実在エリアでは既定 false）。生成元は `docs/16` §3.2。

以下は procedural の説明。手続き生成だが、作者が置いた「尾根」「谷」「段差（滝）」に従う。乱数は `terrain.seed` のみ（World の rng は使わない）。

### 3.1 入力

```jsonc
"terrain": {
  "seed": 20261116,
  "baseElevation": 1150,
  "baseTilt": { "dx": 0.00, "dz": 0.03 },          // 1m あたりの傾き（南ほど低くしたいなら dz を負に）
  "ridges": [ { "id": "main", "width": 1300, "power": 1.35,
                "points": [[x, z, h], ...] } ],
  "valleys": [ { "id": "oni", "width": 300, "points": [[x, z, depth], ...] } ],
  "knickpoints": [ { "id": "uodome", "x": -1200, "z": -575, "drop": 25, "valley": "oni", "radius": 60 } ],
  "noise": { "fbmAmp": 55, "fbmScale": 900, "octaves": 5, "ridgedAmp": 45, "ridgedScale": 500, "ridgedAbove": 1800 },
  "erosion": { "thermalIterations": 20, "talusDeg": 38 }
}
```

### 3.2 アルゴリズム

各頂点 `p=(x,z)` について:

1. **基盤**: `b = baseElevation + dx*x + dz*z + fbm(p)`。
2. **尾根**: 各尾根ポリラインについて、`p` からポリラインへの最近点 `q`・距離 `d`・その点での尾根高 `hl`（点の高さを線形補間）を求める。
   `r = base + (hl - base) * (1 - smoothstep(0, width, d)) ^ power`
   全尾根の `max` を取り、`b` と `max` する: `h0 = max(b, max_i r_i)`。
   `power` は斜面の形状（>1 で尾根が痩せ、裾が広がる）。
3. **細部**: `hl` が `ridgedAbove` を超える範囲で、リッジノイズ `ridgedAmp * ridged(p)` を加え岩稜感を出す（ポリライン上では 0.3 倍に抑え、尾根筋を壊さない）。
4. **谷の刻み**: 各谷ポリラインについて距離 `d` と深さ `dep`（点の値を線形補間）から
   `cut = dep * (1 - smoothstep(0, width, d))^2` を引く。
5. **段差（滝）**: knickpoint の下流側（谷ポリラインの進行方向でその点より先）で、谷の中心から `radius` 以内の頂点をさらに `drop` 下げる。
   上流側との境界が 1〜2 セルの急崖になる。
6. **熱侵食**: `talusDeg` を超える隣接差を、指定回数だけ均す（ただし knickpoint 周辺 `radius*1.5` は除外して滝を残す）。
7. ノードのスナップ: `type: "peak"` のノードは半径 120 m 内の最高点に、`type: "saddle"` は尾根線上の最低点に位置を補正（補正量が 60 m を超えたら警告ログ）。

### 3.3 検証（テストで確認）

- `SUMMIT` の標高が指定値 ±40 m、半径 300 m 内の最高点であること。
- 全登山道のサンプル点（10 m 間隔）の実効勾配（シヌオシティ考慮後）が 38° 未満（偽の道は 50° 未満）。超えたら `validate` が警告。
  ※ 本マップはノイズ・侵食なしの試作計算で、正規の道が最大約 35°、偽の道が最大約 45°、主要ノードの標高が下表になることを確認済み。ノイズと侵食を加えて外れた場合は、まず `noise.fbmAmp` を下げ、次に該当エッジの waypoints / sinuosity を調整する。

| ノード | 試作計算の標高 |
|---|---|
| TH_SAWA 沢入口登山口 | 約 1,120 m |
| J_FOREST 樹林帯分岐 | 約 1,260 m |
| EBOSHI 烏帽子ノ頭 | 約 1,960 m |
| HUT_RIDGE 稜線小屋 | 約 2,150 m |
| SUMMIT 箱庭岳山頂 | 約 2,410 m |
| SADDLE_N 北の鞍部 | 約 2,030 m |
| MIKAERI 見返り峰 | 約 2,180 m |
| TH_KITA 北登山口 | 約 1,420 m |
| W_SHOULDER 西尾根の肩 | 約 1,820 m |
- 魚止ノ滝の位置に傾斜 50° 以上のセルが 1 つ以上存在すること。

## 4. 派生レイヤー（`sim/terrain/derive.ts`）

すべて 257×257 の型付き配列。起動時に 1 回計算（電波圏のみ Worker）。

| レイヤー | 型 | 内容 |
|---|---|---|
| `slopeDeg` | Float32 | 傾斜（度） |
| `aspect` | Float32 | 斜面方位（rad、北=0、時計回り） |
| `tpi` | Float32 | 地形位置指数: 標高 − 半径 320 m 平均（2 段のボックスブラーで近似）。正=尾根、負=谷 |
| `exposure` | Float32 | 風の露出係数 0.4〜1.6: `clamp(1 + tpi/180, 0.4, 1.6)` |
| `flowAcc` | Float32 | D8 流量累積（priority-flood で窪地を埋めてから） |
| `stream` | Uint8 | `flowAcc > 350`（約 0.09 km²）で 1 |
| `veg` | Uint8 | 植生クラス（下表） |
| `cliff` | Uint8 | 傾斜 > 50° または knickpoint の段差セル |
| `skyView` | Float32 | 空の見通し 0〜1: 8 方位・半径 500 m の地平線仰角から `mean(cos²(仰角))`、森林内は ×0.6 |
| `radio` | Float32 | 電波強度 0〜1（§7） |

### 植生クラス（`veg`）

| 値 | 名前 | 判定 | 道外の速度係数 | 風の遮蔽（風速倍率） |
|---|---|---|---|---|
| 0 | BROADLEAF 広葉樹林 | 標高 < broadleafLine | 0.50 | 0.45 |
| 1 | CONIFER 針葉樹林 | < forestLine(+ノイズ) | 0.45 | 0.40 |
| 2 | KRUMMHOLZ ハイマツ帯 | < forestLine + 200 かつ傾斜 < 35° | 0.20 | 0.80 |
| 3 | ALPINE 草地・岩礫 | それ以外 | 0.70 | 1.00 |
| 4 | ROCK 岩場 | 傾斜 > 40° | 0.45 | 1.00 |
| 5 | STREAM 沢 | `stream == 1` | 0.35 | 0.60 |
| 6 | CLIFF 崖・滝 | `cliff == 1` | 0.05 | 1.00 |

判定順は CLIFF → STREAM → ROCK → 標高による分類。その後 `vegetation.overrides`（エディターの塗り直し）があれば上書きする（0 = 自動、1〜7 = クラス + 1）。
`stream` の閾値は面積で決める: `flowAcc × cell² > 90,000 m²`（箱庭岳で 350 セル相当）。

## 5. 登山道グラフ（`sim/terrain/trails.ts`）

### 5.1 ノード

```jsonc
{ "id": "HUT_RIDGE", "name": "稜線小屋", "type": "hut", "x": 620, "z": 60,
  "shelter": { "kind": "staffed", "open": true } }
```

`type`: `trailhead | junction | peak | saddle | hut | shelter | landmark`
`shelter.kind`: `staffed`（営業小屋：暖房・食事あり）/ `emergency`（避難小屋：無人、風雨を防ぐ）

### 5.2 エッジ

```jsonc
{ "id": "E8", "name": "西尾根道", "from": "SADDLE_N", "to": "W_SHOULDER",
  "kind": "trail",                       // trail | false
  "class": "T2",                         // T1 樹林の歩きやすい道 / T2 岩混じり / T3 岩稜・鎖場
  "markers": 0.5,                        // 道標・ペンキ印の密度 0〜1
  "drift": 0.02,                         // 100 m あたりの踏み外し基本率（不明瞭な道ほど大）
  "sinuosity": 1.3,                      // つづら折り係数。実距離 = 水平距離 × sinuosity
  "courseTimeMin": [70, 85],             // 標準コースタイム [from→to, to→from]（検証用）
  "waypoints": [[-380,-860],[-700,-560],[-1000,-250]] }
```

偽の道（`kind: "false"`）は `to` を持たず、末端で消える:

```jsonc
{ "id": "F1", "name": "旧巡視路（廃道）", "kind": "false", "from": "SADDLE_N",
  "class": "T2", "markers": 0.0, "drift": 0.06, "sinuosity": 1.1, "fadeOutM": 150,
  "attractiveness": 0.8, "waypoints": [[-380,-860],[-550,-790],[-800,-680]] }
```

### 5.3 分岐の紛らわしさ

ノードに `confusers` を書く。「`whenIntending` のエッジに進むつもりで、誤って `edge` に入る」基本確率。

```jsonc
{ "id": "SADDLE_N", ..., "confusers": [
    { "edge": "F1", "whenIntending": ["E8"], "ambiguity": 0.55 },
    { "edge": "E6", "whenIntending": ["E8"], "ambiguity": 0.10 } ] }
```

実際の誤り確率は `docs/07_climber_behavior.md` §3.2。

### 5.4 ポリライン化

1. `smooth !== false` なら waypoints を Catmull-Rom（centripetal, α=0.5）で補間し、10 m 間隔で再サンプル。`smooth: false`（実在データ）は折れ線のまま 10 m 間隔で再サンプル。
2. 各サンプルに `elevM`、累積水平距離 `sH`、累積実距離 `s = sH * sinuosity` を持たせる。
3. エッジの区間ごとの属性（鎖場など）は hazards の `onEdge` + `sRange` で付与。
4. 逆方向の移動は `s` を減らす方向に進むだけ（別ポリラインは作らない）。

### 5.5 ルートと位置表現

- ルート = ノード ID 列。隣接ノード間のエッジは一意に解決できること（`validate` で検査）。
- 登山者の位置（`ClimberPos`）:
  - 道の上: `{ mode: "edge", edgeId, s, dir: 1 | -1 }`
  - ノード滞在: `{ mode: "node", nodeId }`
  - 道外: `{ mode: "free", x, z }`
  ワールド座標 `(x, y, z)` は常に `posToWorld()` で求める（World には x,z,elevM もキャッシュする）。

## 6. 危険箇所（`hazards`）

```jsonc
{ "id": "chain1", "type": "chain", "name": "クサリ場", "onEdge": "E5", "sRange": [180, 420] },
{ "id": "uodome", "type": "waterfall", "name": "魚止ノ滝", "x": -1200, "z": -575, "radius": 45 },
{ "id": "rockfall1", "type": "rockfallZone", "onEdge": "E2", "sRange": [1500, 1700] }
```

- `chain`: 区間をクラス T3 扱い＋転倒時の重症度表を `EXPOSED` に。
- `waterfall`: 半径内の道外移動を CLIFF 扱い。登山者がここに達すると汎用分岐点 `waterfall` が発火可能。
- `rockfallZone`: スクリプトイベントの落石判定に使う（自動では起きない）。

## 7. 電波圏（`sim/terrain/coverage.ts`）

```jsonc
"radio": { "stations": [
  { "id": "town_se", "x": 3500, "z": 3500, "elevM": 1150, "antennaM": 80, "rangeM": 12000 },
  { "id": "pass_ne", "x": 3000, "z": -4000, "elevM": 1250, "antennaM": 30, "rangeM": 10000 } ] }
```

- 各セル（地上 1.5 m）から各局（局標高 + アンテナ高）へ 32 m 間隔で見通しを判定。地形の外（箱庭の外）は `baseElevation` の平地とみなす。したがって局は平地より高い位置（`elevM ≥ baseElevation`）に置く。
- 遮られなければ `strength = 1 - dist/rangeM`、遮られたら `max(0, 0.25 - 遮蔽量m/200)`（回折の近似）。全局の max。
- 森林セルは ×0.8。
- 見通し判定のサンプル間隔は `max(32, 2 × cell)` m。
- `radio.paint`（エディターの塗り直し）があれば最後に上書き: +1 → `max(値, 0.6)`、−1 → 0。
- 検証: `SUMMIT`, `EBOSHI`, `HUT_RIDGE` で ≥ 0.5、魚止ノ滝で < 0.1。満たさない場合は局の位置を調整してよい（`DECISIONS.md` に記録）。
- 通話可能: `radio ≥ 0.3`。メッセージのみ可能: `0.15 ≤ radio < 0.3`（救助要請は成功率 50%/試行）。

## 8. 風下の避難地点探索（ビバーク用）

`findLeeSpot(world, ctx, pos, radiusM=150)`: 半径内のセル候補について

`score = shelterFromWind(cell, windDir) * 0.6 + vegShelter(cell) * 0.3 - slopePenalty - streamPenalty - cliffPenalty`

- `shelterFromWind`: 風上方向 100 m 以内の地形がセルより何 m 高いか（`clamp(diff/30, 0, 1)`）。
- 沢セル・崖から 30 m 以内は除外。傾斜 25° 超は除外。
- 最良セルへ道外移動してからビバークする。半径内に適地がなければ現在地。
