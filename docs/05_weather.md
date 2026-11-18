# 05 気象モデル

気象は「シナリオが決める全体の推移（キーフレーム）」×「地形による局地補正」で作る。
全体推移はシナリオ作者が意図した筋書きを守り、局地補正が「稜線は寒く風が強い」「沢は風が弱いが電波も日も届かない」といった差を生む。

## 1. 全体気象（`sim/weather/global.ts`）

### 1.1 キーフレーム

シナリオの `weather.keyframes`（時刻昇順）。値は **基準標高 `refElevM`（既定 1000 m）** での値。

| フィールド | 単位 | 説明 |
|---|---|---|
| `at` | TimeRef | `"D0 05:30"` 形式 |
| `tempC` | ℃ | 基準標高の気温 |
| `windMs` | m/s | 基準標高の平均風速 |
| `windDirDeg` | 度 | 風が**吹いてくる**方位（北=0、時計回り） |
| `precipMmH` | mm/h | 降水強度（基準） |
| `cloudCover` | 0〜1 | 雲量 |
| `cloudBaseM` | m | 雲底高度（これより上は雲の中） |
| `visibilityM` | m | 雲の外の視程 |
| `inCloudVisibilityM` | m | 雲の中の視程（既定 60） |
| `thunder` | 0〜1 | 雷活動の全体強度（雷雲セルがない場合に使用） |
| `pressureHpa` | hPa | 表示用 |
| `gustiness` | 0〜1 | 突風の強さ（既定 0.25） |

補間: スカラーは線形、`windDirDeg` は最短弧で補間。最初のキーフレーム前は最初の値、最後の後は最後の値を保持。

### 1.2 時間ノイズ

`weather` 乱数ストリームでシードした 1 次元バリューノイズ（時間軸、周期 3〜7 分の 2 オクターブ）。

- 突風係数 `gust(t) = 1 + gustiness * max(0, n1(t)) * 1.6`（瞬間的に 1.0〜1.4 倍程度）
- 気温ゆらぎ `±0.4℃ * n2(t)`
- 降水ゆらぎ `precip * (1 + 0.35 * n3(t))`（0 未満は 0）

ノイズはティックごとに評価し `world.weather.global` に格納（描画もこの値を使う）。

### 1.3 雷雲セル

```jsonc
"thunderCells": [
  { "id": "cb1", "from": "D0 11:40", "peakAt": "D0 12:40", "to": "D0 14:00",
    "path": [[1800, -1800], [-1500, 1200]], "radiusM": 1400, "peak": 1.0, "heavyRainMmH": 25, "hail": true }
]
```

- セル中心は `from`→`to` の間に `path` 上を等速移動。
- 時間包絡: `from`→`peakAt` で 0→1（smoothstep）、`peakAt`→`to` で 1→0。
- 地点の雷強度 `thunderLocal = max(globalThunder, peak * env(t) * exp(-(d/radiusM)^2))`。
- セル直下（`d < radiusM*0.6`）は降水に `heavyRainMmH * env * gauss` を加算、風に突風 +6 m/s、気温 −3℃（ダウンバースト的な冷気）。
- 描画では積乱雲メッシュをセル中心に置く（`docs/10_rendering.md`）。

## 2. 局地気象（`sim/weather/local.ts`）

`sampleLocal(world, ctx, x, z, elevM, opts?) → LocalWeather`。毎ティック、登山者ごとに呼ぶ。描画のオーバーレイ用にはグリッド 64×64 に間引いて 1 ゲーム分ごとに計算する。

### 2.1 気温

```
tempC = g.tempC - lapse * (elevM - refElevM) / 100 + thunderCooling
lapse = scenario.weather.lapseRateCPer100m (既定 0.65)
```

夜間の谷の冷気湖は初版では扱わない（拡張: TPI<0 かつ夜かつ風<2 m/s で −2℃）。

### 2.2 風

```
altF   = clamp(1 + 0.45 * (elevM - refElevM) / 1000, 0.5, 2.0)
expF   = exposure[cell]                     // 0.4〜1.6（尾根で大）
leeF   = 1 - 0.6 * shelterFromWind(cell, g.windDirDeg)   // 風下の窪みで弱まる
vegF   = vegWindFactor[veg[cell]]           // 森林 0.4〜0.45
windMs = g.windMs * gust * altF * expF * leeF * vegF + thunderGust
```

`shelterFromWind` は `docs/04_map_terrain.md` §8 と同じ関数。小屋・ビバーク中の補正は生理モデル側で行う。

### 2.3 降水

```
upslope = max(0, dot(windVectorTo, -gradient(elev)))     // 風上斜面で正
oroF    = 1 + 0.8 * clamp(upslope * 3, 0, 1)
cloudF  = elevM > g.cloudBaseM ? 1.15 : 1.0
precipMmH = g.precipMmH * oroF * cloudF + thunderRain
```

降水種別（局地気温で判定）:

| tempC | 種別 | 表示 |
|---|---|---|
| < 0.5 | `snow` | 雪 |
| 0.5〜2.0 | `sleet` | みぞれ |
| ≥ 2.0 | `rain` | 雨 |
| 雷雲セル内かつ `hail: true` かつ env>0.6 | `hail` | ひょう（10 分程度の短時間） |

### 2.4 視程

```
if elevM >= g.cloudBaseM and g.cloudCover >= 0.6: vis = g.inCloudVisibilityM
elif elevM >= g.cloudBaseM - 100 and g.cloudCover >= 0.6:
     vis = lerp(g.visibilityM, g.inCloudVisibilityM, (elevM - (cloudBase-100)) / 100)
else vis = g.visibilityM
vis = min(vis, 20000 / (1 + 1.5 * precipMmH))      // 降水で低下
if precipType == snow: vis = min(vis, 8000 / (1 + 4 * precipMmH))
```

暗さは視程とは別に扱う（§4）。

### 2.5 体感温度

風冷指数（JAG/TI）。`T ≤ 10℃` かつ `V ≥ 4.8 km/h` で適用、それ以外は気温そのまま。

```
V = windMs * 3.6
WCT = 13.12 + 0.6215*T - 11.37*V^0.16 + 0.3965*T*V^0.16
```

体感温度は **表示と思考テンプレート用**。生理モデルは風速を直接使う（二重計上しない）。

### 2.6 日射

`solarW = 120 * max(0, sin(sunElev)) * (1 - 0.85*cloudCover) * (inCloud ? 0.2 : 1) * skyView[cell]` — 生理モデルの熱獲得に加算。

## 3. 地面の状態（`sim/weather/ground.ts`）

標高を 50 m 刻みのビン（`floor(elev/50)`、0〜60）で管理する。全地点でグリッド計算はしない。

| 状態 | 更新（1 ゲーム分ごと） |
|---|---|
| `snowCm[bin]` | 雪なら `+ precip(bin) * 1.0 / 60` cm（降水 1mm ≈ 積雪 1cm）。みぞれは ×0.3。気温 > 0.5 で `- 0.25 * (T - 0.5) / 60` cm、雨なら追加で `- precip*0.1/60`。下限 0 |
| `wet[bin]` | 降水中は 1 に近づく（τ=10 分）。降水なしで乾く（τ = 90 分、気温<3℃ なら τ=240 分） |
| `icy[bin]` | `wet > 0.5` で気温が 0℃ 未満に下がったら 1。気温 > 1℃ が 60 分続くと 0 |

`bin` ごとの降水は、その標高・露出 1.0 の仮想地点で `sampleLocal` 相当の式を評価して代表値とする。

## 4. 太陽と暗さ（`sim/weather/sun.ts`）

- シナリオの `sun: { sunrise: "05:52", sunset: "17:04" }`（日付ごとに同じ値を使ってよい）。
- 太陽高度の近似: 日の出→南中→日の入りを半正弦で、最大高度 `sun.maxElevDeg`（既定 季節から: 夏 75°/秋 45°/冬 32°）。日の入り後は負の値を同様に。
- `twilight`: 太陽高度 −6°〜0° の間。`isDark`: 太陽高度 < −6°。
- 月: `moon: { illumination: 0..1, rise: "...", set: "..." }`（省略時 0）。暗いときの移動係数に寄与（`docs/07` §1）。
- 雲量が多いと暗さが早まる: `effectiveSunElev = sunElev - 3 * cloudCover`（度）で `isDark` を判定。

## 5. 予報（登山者が知っていること）

シナリオの `forecast` は、登山者が出発前に見た予報。真の推移とは一致しないことがある（それ自体が教材）。

```jsonc
"forecast": [
  { "label": "朝", "text": "晴れ時々くもり", "icon": "sunny_cloudy" },
  { "label": "昼過ぎ", "text": "くもり 夕方から雨", "icon": "cloudy_rain" },
  { "label": "注意報", "text": "強風注意報（山沿い）" }
]
```

イベントで「スマホで予報を確認したら更新されていた」を表現できる（`docs/09_scenario_format.md` の `forecastUpdate` 効果）。

## 6. 出力（UI・描画・記録が使う値）

`world.weather.global`（全体の現在値）と、登山者ごとの `climber.local`（直近ティックの局地気象）。
描画用の 64×64 グリッド（気温・風・降水）は `view` 側のキャッシュで、World には入れない。
