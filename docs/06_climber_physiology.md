# 06 登山者モデル（生理）

> 人体の反応は **生理学に基づいて** モデル化する。各式は §0 の知見に対応させ、定数は §9 の較正目標（実験条件の目安と、実際の遭難事故の記録）を満たすように調整する。
> 医療判断に使える精度のモデルではない。個々の数値は推定であり、UI では必ず「推定」と表示する。

## 0. 生理学的な根拠（実装の前提）

| 知見 | モデルへの反映 |
|---|---|
| 寒冷下では末梢血管収縮で熱損失を減らし、震えで熱産生を増やして深部体温を守る | `vaso`（§3）と `shiverMET`（§2.3） |
| 震えは約 32℃で弱まり、30℃前後で止まる。34℃前後から脳の機能が落ち始める（WMS 偶発性低体温症ガイドライン） | 震えは 32℃まで維持、32→30℃で 0 へ。判断力 J は 34℃から急低下（§6） |
| 段階分類: 35〜32℃ 軽度（意識あり・震えあり）、32〜28℃ 中等度（意識障害・震え消失）、28〜24℃ 重度（意識なし）（スイス式・WMS） | §7 の段階表 |
| 30℃未満では心拍出量低下と徐脈により不整脈を起こしやすい | 28℃未満で心停止の確率的判定（§7） |
| 震えの燃料は糖質と脂質。低強度の震えは糖質が枯渇しても脂質で数時間維持できるが、強い震えは糖質に依存する（Haman ら） | 糖質枯渇時は震えの上限を 0.6 倍に（0 にはしない）（§2.3） |
| 加齢で皮膚血管の収縮反応と寒冷時の熱産生が弱まる | 年齢係数 `ageV`, `ageS`（§2.3, §3） |
| 体が小さいほど体積あたりの表面積が大きく冷えやすい | 体表面積 `A ∝ 体重^0.6`、熱容量 ∝ 体重（§3） |
| 濡れた衣類は断熱が落ち、風で対流損失が増える。雨具の下にこもった水分は外気中ほど蒸発できない | `cloEff` の濡れ補正、雨具着用時は蒸発冷却を 0.35 倍（§3） |
| 倒れて地面に接すると、圧縮された衣類を通して地面へ熱が逃げる | 横臥・座位の地面伝導（§3.2） |
| 冷水（雪解け水）への浸水は短時間で大量の熱を奪う | 浸水 `soak`（§4.1） |
| 強風下の歩行は困難になり、向かい風では消費エネルギーが無風時の 1.5〜2 倍程度になる（トムラウシ山遭難事故調査報告書） | 風による速度低下と MET 増加（docs/07 §1.1） |
| 34℃程度までなら風雨を避けて保温すれば山中で回復しうるが、それ以下では回復が難しい（同報告書） | §7 の回復可否と思考テンプレート |

参考文献（実装者が確認する一次資料）:
- Dow J, Giesbrecht GG, Danzl DF, et al. Wilderness Medical Society Clinical Practice Guidelines for the Out-of-Hospital Evaluation and Treatment of Accidental Hypothermia: 2019 Update. *Wilderness Environ Med*.
- Musi ME, et al. Clinical staging of accidental hypothermia: The Revised Swiss System. *Resuscitation* 2021;162:182-187.
- Haman F. Shivering in the cold: from mechanisms of fuel selection to survival. *J Appl Physiol* 2006.
- Kenney WL, Munce TA. Aging and human temperature regulation. *J Appl Physiol* 2003（加齢と体温調節のミニレビュー）。加齢による皮膚血管収縮の低下については PMC4593810 のレビューも参照.
- トムラウシ山遭難事故調査特別委員会『トムラウシ山遭難事故調査報告書』日本山岳ガイド協会, 2010（実例の経過・低体温症の章）.

## 1. 状態変数（`ClimberBody`）

| 変数 | 初期値 | 範囲 | 意味 |
|---|---|---|---|
| `coreC` | 37.0 | 20〜42 | 深部体温 |
| `wetness` | 0 | 0〜1 | 衣類の濡れ（外から雨、内から汗） |
| `glycogenKcal` | 1500 | 0〜2000 | すぐ使えるエネルギー（「シャリバテ」の指標） |
| `gutKcal` | 0 | 0〜 | 食べて吸収待ちの量 |
| `waterDeficitL` | 0 | 0〜6 | 脱水量 |
| `fatigue` | 0 | 0〜100 | 疲労 |
| `anxiety` | 10 | 0〜100 | 不安 |
| `injury` | `none` | 表§7 | 負傷 |
| `conscious` | true | | 意識 |
| `alive` | true | | 生存 |
| `cloWorn` | 装備から | | 着ている衣類の断熱（clo） |
| `cloPack` | 装備から | | ザック内の予備（乾いている） |
| `rainwearOn` | false | | 雨具を着ているか |
| `inBivy` / `inShelter` | false / null | | ツェルト・シュラフカバー内か、小屋内か |

## 2. 代謝（MET）

### 2.1 活動 MET

歩行は ACSM の歩行式を簡略化:

```
v   = 速度 m/min（実距離ベース）
gr  = 実効勾配（dh/実距離）。下りは gr * 0.33（ただし下り急傾斜 > 0.25 は |gr| * 0.5 を加算＝ブレーキ負荷）
VO2 = 3.5 + 0.1 * v + 1.8 * v * max(gr, 0) + 下り項     [ml/kg/min]
MET_walk = VO2 / 3.5 * loadFactor                        loadFactor = 1 + packKg / weightKg * 0.6
```

| 状態 | MET |
|---|---|
| 休憩（立ち・座り） | 1.4 |
| ビバーク（座位・横臥） | 1.1 |
| 小屋内 | 1.2 |
| 意識なし | 0.9 |
| 道外の藪こぎ | 歩行 MET × 1.4 |

### 2.2 最大 MET と速度の上限

```
maxMET = 8 + 6 * fitness            // fitness 0.5〜1.3 → 11〜15.8
usableMET = maxMET * (glycogen < 300 ? 0.55 : 1) * M_motor * (1 - 0.3 * fatigue/100)
```

移動速度は `docs/07` で求めた候補速度から MET を計算し、`MET > 0.75 * usableMET` なら速度を下げて収める（二分探索 6 回で十分）。

### 2.3 震え

```
ageS = max(0.5, 1 - 0.01 * max(0, age - 40))          // 加齢で震えの熱産生が弱まる
fuel = glycogen > 300 ? 1.0 : 0.6 + 0.4 * glycogen / 300   // 糖質が尽きても脂質で 6 割は維持
if core < 36.8 and conscious:
   shiverMET = min(3.0, (36.8 - core) * 2.2) * ageS * fuel
   if core < 32: shiverMET *= max(0, (core - 30) / 2)  // 32℃から弱まり 30℃で消失
   if MET_act > 3: shiverMET *= 0.4                    // 歩行中は筋活動が熱を出すため震えは目立たない
```

震えの分もエネルギー（グリコーゲン→脂質）を消費する。

## 3. 熱収支（W、`physiology.ts`）

```
A       = 1.8 * (weightKg / 65) ^ 0.6               体表面積 m²
Hprod   = (MET_act + shiverMET) * 1.163 * weightKg * 0.85   （機械効率分を除く）
Hsolar  = solarW                                      （docs/05 §2.6）
Tsk     = core - 4.0
v_eff   = windAtBody + walkSpeedMs                   windAtBody は局地風 × 遮蔽
cloEff  = (cloWorn + rainwearClo) * (1 - 0.5*wetness) / (1 + windPen * v_eff)
            windPen = rainwearOn ? 0.02 : 0.08
            rainwearClo = rainwearOn ? 0.15 : 0
hc      = 3.0 + 4.0 * sqrt(v_eff)
R       = 0.155 * cloEff + 1 / (hc + 4.5)
ageV    = max(0.4, 1 - 0.012 * max(0, age - 40))     加齢で血管収縮が弱まる
vaso    = 1 - 0.25 * ageV * clamp((37 - core) / 1.5, 0, 1)  末梢血管収縮
Qdry    = A * (Tsk - Tair) / R * vaso
Ewet    = min(220, wetness * (30 + 12 * v_eff)) * (rainwearOn ? 0.35 : 1)   濡れからの蒸発冷却（雨具の下では抑えられる）
Eresp   = 0.09 * Hprod
Net     = Hprod + Hsolar - Qdry - Ewet - Eresp
```

**発汗**: `core > 37.1` かつ `Net > 0` のとき、`sweatW = min(Net, 450)` を除去して `Net -= sweatW`。
発汗は内側から濡らす: `wetness += sweatW / 1800 * trapF * dtMin`（`trapF` 汗のこもりやすさ: 雨具を着ていない 0.5 / poncho 0.6 / basic 0.8 / goretex 0.5）。
ただし汗の多くは服を通して蒸発する。服を通して抜ける量 `evapThroughW = 150 × (1 + 0.05 × v) × coldF × (雨具の下 0.35) × dryF × (降水中 0.5)`（`coldF = clamp((気温 − 5) / 15, 0, 1)`。寒いと湿気は服の中で結露して抜けない）を超えた分だけが濡れになり、汗だけでは `wetness` 0.5 までしか上がらない（肌着が汗で湿る程度。雨に打たれた濡れとは違う）。汗が `evapThroughW` より少なければ、その余りの割合で乾く。
これで「登りで汗をかき、稜線の休憩で一気に冷える（汗冷え）」が出る。

**深部体温の変化**:

```
dCore/dt[℃/min] = Net * 60 / (weightKg * 3470 * k_mass)       k_mass = 2.8（体表の殻が先に冷える効果をまとめた係数。較正で調整）
core > 37.0 かつ Net ≤ 0 のときは 37.0 へ戻る緩和項 -0.02*(core-37) を追加
```

### 3.1 環境ごとの補正

| 状況 | Tair | windAtBody | 濡れの入力 | その他 |
|---|---|---|---|---|
| 屋外 | 局地気温 | 局地風 | 降水 | |
| ツェルト／シュラフカバー内 | 局地気温 + 3 | 局地風 × 0.08 | 0（結露で `+0.01/h`） | clo +0.6（カバー）/ +0.3（ツェルト） |
| 風下の避難地点 | 局地気温 | 局地風 × (1 − shelter) | 降水 × 0.8 | |
| 避難小屋 | max(局地気温 + 5, 局地気温) | 0 | 0 | 乾燥 −0.15/h |
| 営業小屋 | 18 | 0 | 0 | 乾燥 −0.6/h、食事で glycogen 回復、`core` は +1.0℃/h を上限に回復 |

### 3.2 地面への伝導

状態が `INCAPACITATED` / `UNCONSCIOUS` / `BIVOUAC` / `STAYING`（座る・倒れる）で、マット・ザックを敷いていない（`groundInsulation == false`）とき:

```
A_air   = A * 0.75                                 // 接地面は空気に触れない
Rground = 0.155 * cloWorn * 0.3 * (1 - 0.5 * wetness) + 0.02   // 圧縮された衣類＋接触抵抗
Qground = A * 0.25 * (Tsk - max(Tair - 1, 0)) / Rground * vaso
```

ビバークで `groundInsulation = true`（ザック・マットを敷く。行動 `bivouac` の既定）なら `Rground` に +0.15。
積雪・雪渓上では地面温度を 0℃とする。

## 4. 濡れ（`wetness`）

```
rainProtect = rainwearOn ? protect[type] * degrade : 0
  protect: poncho 0.6*(1 - min(1, wind/20)) / basic 0.8 / goretex 0.95
  degrade: 雨に当たった累積時間 3h 超で 0.1/h ずつ低下（basic のみ。下限 0.5）
input = precipMmH * (1 - rainProtect) * k_rain * typeF       k_rain = 0.12 /mm（1 時間あたり）
  typeF: rain 1.0 / sleet 0.8 / snow 0.25（気温 > -1℃ なら 0.5）/ hail 0.6
wetness += input / 60 * dtMin
drying (降水なし・発汗なし): wetness -= 0.15 * (1 + wind/10) * (Tair > 5 ? 1 : 0.5) / 60 * dtMin
```

### 4.1 浸水（`soak`）

渡渉・転倒で冷水に浸かったとき（スクリプト効果・アクション `soak`）:

| level | 濡れ | 追加の熱損失 |
|---|---|---|
| `feet` 足首まで | `wetness = max(wetness, wetness + 0.15)`、手足の冷え（`coldExtremities` 60 分: 細かい作業 ×1.5） | 水中時間 × 150 W |
| `knees` 膝まで | +0.25 | 水中時間 × 300 W |
| `waist` 腰まで | +0.5 | 水中時間 × 700 W |
| `full` 全身 | `wetness = 1.0` | 1 分あたり 1,200 W 相当を 2 分間 |

水温は雪解け水なら 2℃、それ以外は局地気温 − 2℃（下限 2℃）。追加損失は水温 10℃を基準に `× (37 - 水温) / 27` で補正。

**着替え**: アクション `changeDry` で `cloPack` から乾いた層を出すと、`wetness *= 0.4`、`cloWorn += 移した分`。屋外の強い雨の中で行うと 10 分間 `windAtBody` 補正なしで熱損失が増える（着替え中の冷え）。

## 5. エネルギー・水分・疲労

### 5.1 エネルギー

```
expend[kcal/min] = (MET_act + shiverMET) * weightKg / 60
glycoFrac = MET_act > 5 ? 0.65 : 0.45
glycogenKcal -= expend * glycoFrac * dtMin
absorb = min(gutKcal, 6 * dtMin)        // 吸収 6 kcal/min まで
gutKcal -= absorb; glycogenKcal += absorb * 0.9
```

- `glycogen < 300`（20%）: シャリバテ。usableMET ×0.55、震え能力低下、J ×0.8。
- 食事: `eat(kcal)` で `foodKcal` から `gutKcal` へ。1 回 200〜400 kcal、所要 3 分（休憩扱い）。

### 5.2 水分

```
lossL/h = 0.15 + 0.07 * MET_act * (Tair > 20 ? 1.6 : Tair > 10 ? 1.2 : 1.0)
```

`waterDeficitL > 2.0`（約 3%）: usableMET ×0.85、J ×0.9。`> 4.0`: ×0.6、J ×0.7。

### 5.3 疲労

```
gain/min  = max(0, MET_act - 3.5) * 0.045 / fitness + (gr > 0.15 ? 0.03 : 0)
recover/min = 休憩 0.35 / ビバーク 0.25（寒さで眠れない: core<35.5 なら 0.1）/ 小屋 0.6
```

効果: 速度 ×`(1 - 0.4*(F/100)^2)`、転倒率 ×`(1 + F/80)`。

### 5.4 不安

毎分の変化（目標値へ τ=20 分で近づく方式）:

```
target = 10
  + 15 * isDark + 10 * (vis < 100) + 10 * (wind > 15) + 10 * (precip > 5)
  + 30 * awareLost + 20 * (injury != none) + 15 * (同行者の状態悪化)
  + 10 * behindSchedule(> 60分)
  - 25 * inShelter - 20 * rescueContacted
target = clamp(target, 0, 100)
```

## 6. 判断力 J と運動能力 M（`capacity.ts`）

```
J0 = 0.4 + 0.6 * experience
fCore_J  = piecewise(core): ≥36:1.0, 35:0.85, 34:0.65, 33:0.45, 32:0.30, 31:0.18, ≤30:0.08 （線形補間）
fGly     = glycogen < 300 ? 0.8 : 1
fFat     = 1 - 0.3 * (fatigue/100)^2
fAnx     = anxiety > 70 ? 0.75 : anxiety > 50 ? 0.9 : 1
fDehyd   = docs §5.2
J = clamp(J0 * fCore_J * fGly * fFat * fAnx * fDehyd, 0.05, 1)

fCore_M  = piecewise(core): ≥35:1.0, 34:0.85, 33:0.6, 32:0.4, 31:0.2, ≤30:0
fInj_M   = injury表
M = clamp(fCore_M * fInj_M * (glycogen < 100 ? 0.7 : 1), 0, 1)
```

`M == 0` → 歩行不能（`INCAPACITATED`）。

## 7. 意識・生死・低体温症の段階

| 深部体温 | 段階（表示） | 主な症状テキスト | 効果 |
|---|---|---|---|
| ≥ 36.0 | 正常 | | |
| 35.0〜36.0 | 寒冷ストレス | 震え、手がかじかむ | 細かい作業（雨具の着用・食事）に +50% 時間 |
| 32.0〜35.0 | 軽度低体温症 | 激しい震え、よろめき、ろれつが回らない | M/J 低下、自律ミクロ行動の成功率 ×J |
| 28.0〜32.0 | 中等度 | 震えが止まる、錯乱、無関心 | 歩行ほぼ不能、自律行動不可 |
| < 28.0 | 重度 | 意識なし | `conscious = false` |
| ≤ 24.0 | | | `alive = false`（原因 `hypothermia`） |

**心停止の確率判定**: 28℃未満では 10 ゲーム分ごとに `hazard` ストリームで判定し、`p(10分) = 0.02 + 0.06 × (28 − core)`（26℃で 0.14、25℃で 0.20）。心停止で `alive = false`。乱暴な移動（担いで運ぶ・落下）は 1 回ごとに 0.1 を加える。

**回復の見込み**: 34℃以上で、風雨を避け（小屋・テント・ツェルト＋風下）保温と温かい飲食ができれば回復方向に向かう。34℃未満では自力での回復は小さく（`Net` の正の値に ×0.3 を乗じる）、救助による加温が必要。

### 負傷（`injury`）

| 種別 | M 係数 | 備考 |
|---|---|---|
| `none` | 1.0 | |
| `bruise` 打撲・擦過傷 | 0.9 | 不安 +10 |
| `sprain` 捻挫 | 0.45 | 不安 +20、下りでさらに ×0.8 |
| `legFracture` 下肢骨折 | 0.03（這って移動） | 不安 +35 |
| `headInjury` 頭部外傷 | 0.5 | J ×0.4、30% で意識喪失（30〜180 分） |
| `severeTrauma` 重度外傷 | 0 | `hazard` ストリームで 0〜90 分後に死亡判定（確率 0.6、救助が先に来れば 0.3） |

### 高体温（夏シナリオ用）

`core ≥ 39.0`: 熱疲労（速度 ×0.7、J ×0.85）。`≥ 40.5`: 熱中症（M 0.2、意識喪失 20%/10分）。`≥ 42` で死亡。

## 8. 装備と体の関係（`ClimberDef.gear` → 初期状態）

| 装備 | 効果 |
|---|---|
| `rainwear` | `none / poncho / basic / goretex`。着用はミクロ行動または Action |
| `cloWorn` / `cloPack` | 着衣と予備の断熱（clo）。代表値: 夏の半袖+薄手 0.5、長袖+フリース 1.0、ダウン追加 +0.8 |
| `gloves` | `none / thin / waterproof`。なしで気温 < 5℃ のとき細かい作業時間 ×2 |
| `hat` | なしで熱損失 +6% |
| `bivy` | `none / tarp(ツェルト) / sack(シュラフカバー)` |
| `foodKcal` | 携行食 |
| `waterL` | 水（沢セルで補給可。沢水の衛生は扱わない） |
| `stove` | ビバーク中に温かい飲み物: 30 分ごとに +40W 相当（1 時間）、水 0.3L 消費 |

## 9. 較正目標（`tests/physiology.calibration.test.ts` で自動検証）

標準体: 体重 65 kg、fitness 1.0、experience 0.5、開始 core 37.0、glycogen 1500、食料は 90 分ごとに 300 kcal 摂取（C4〜C6 は指定どおり）。地形は平坦、局地気象は固定値を直接与える（気象モデルを通さない）。

| ID | 条件 | 合格基準 |
|---|---|---|
| C1 | 15℃、風 2 m/s、乾燥、clo 0.8、3 km/h で勾配 10% の登り、8 時間 | core が常に 36.6〜37.8 |
| C2 | 5℃、風 10 m/s、雨 4 mm/h、雨具なし、clo 1.0、平地 3 km/h | core < 35.0 に到達するのが 2.0〜4.5 時間後 |
| C3 | C2 と同条件で goretex 着用 | 6 時間 core ≥ 36.0 |
| C4 | C2 の条件で休憩（MET 1.4）、開始時 wetness = 1.0 | core < 35.0 が 0.75〜2.0 時間後、< 32.0 が 2.5〜5.0 時間後 |
| C5 | −2℃、風 15 m/s、雪 2 mm/h、goretex 着用、clo 2.0、シュラフカバー、風下（shelter 0.7）、ビバーク、glycogen 750 + 800 kcal 摂取 | 10 時間 core ≥ 34.5 |
| C6 | C5 からカバーと風下を除き clo 1.2、開始時 wetness 0.2、雪の上に座る（マットなし） | core < 35.0 が 1.5〜4 時間後、< 34.0 が 3〜7 時間後 |
| C7 | core 34.0 から営業小屋 | 3 時間以内に core ≥ 36.0 |
| C8 | 30℃、風 1 m/s、日射 100W、clo 0.4、勾配 15% を 3 km/h、水 0 | 3 時間で core ≥ 38.8、かつ 4 時間以内に heat exhaustion 段階 |
| C9 | 5℃、風 12 m/s、乾燥、clo 0.9、雨具なし。2 時間急登（MET 8）→ 稜線で 30 分休憩 | 休憩開始時 wetness ≥ 0.3（汗）、休憩終了時 core が休憩開始時より 0.3℃ 以上低い |
| C10 | トムラウシ型の行動: 68 歳女性 52 kg、clo 0.9、goretex 着用、開始時 wetness 0.35・glycogen 550。気温 8.5→7℃・体に当たる風 17〜19 m/s・雨 1.5〜2.5 mm/h で 5 時間低速歩行（MET 4）→ 足首の浸水 → 1 時間立って待機（MET 1.4） | 35℃到達が歩き始めから 4.5〜6.5 時間（報告書: 多くは北沼分岐到着の約 5 時間後に発症） |
| C11 | C10 の終了状態（約 35℃）から、気温 6℃・風 15 m/s・wetness 0.6 で地面に倒れたまま（マットなし） | 28℃到達が 2.5〜5 時間後（報告書: 発症から死亡まで 2〜4 時間の例が 5 名） |
| C12 | 34℃から、テント内（風 ×0.1、気温 +3℃、ストーブなし）で横臥・マットあり | 6 時間後も core ≥ 30℃（報告書: テント内の 2 名は発症から 6〜10.5 時間） |
| C13 | C10 と同条件の 32 歳男性 65 kg（glycogen 1000） | 35℃到達が C10 より 1 時間以上遅い（若く体格が大きいほど遅い） |

合わないときは `k_mass`, `k_rain`, `windPen`, `hc` 係数, 震え係数, 発汗係数の順で調整し、`DECISIONS.md` に最終値を記録する。

**参考（仕様作成時の試算）**: 本章の式（年齢・地面伝導・雨具下の蒸発抑制を含む改訂版）を Python で素朴に積分（1 分刻み、`k_mass = 2.8`）した結果:
C1 37.1℃維持 / C2 35℃到達 2.4 時間 / C3 6 時間後 37.1℃ / C4 35℃ 0.9 時間・32℃ 2.9 時間 / C5 10 時間後 36.5℃ / C6 35℃ 1.9 時間・34℃ 3.7 時間 / C10 35℃ 5.9 時間 / C11 35→28℃ 3.6 時間 / C12 6 時間後も 30℃以上 / C13 35℃到達 C10 より 1 時間以上遅い。
C7〜C9 は未試算。実装の細部（震え・食事吸収の刻み方）で数値はずれるので、必ずテストで確認すること。

## 飲酒（DECISIONS 2026-11-19）

体内のアルコール `alcoholG`（g）から血中濃度 `bac`（%）= g ÷ (体重 kg × r) ÷ 10（r: 男 0.68・女 0.55）。7 g/時で分解し、分解した 1 g あたり 10 mL の尿が出る（水分不足が増える）。
影響: 判断力 J ×(1 − 3·bac)（下限 0.5）、転倒 ×(1 + 10·bac)、寒さによる皮膚の血管の収縮 ×(1 − min(0.8, 10·bac))、乾いた熱損失 ×(1 + 2·bac)、震え ×(1 − min(0.5, 4·bac))。

