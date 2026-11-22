# 14 テストとバランス調整

## 1. テスト一覧（vitest、`tests/`）

| ファイル | 内容 |
|---|---|
| `rng.test.ts` | 既知ベクトル、ストリーム独立性（`thoughts` を回しても `nav` の出力が変わらない） |
| `clock.test.ts` | TimeRef ⇔ tMin、日付跨ぎ、太陽高度 |
| `terrain.test.ts` | docs/04 §3.3、派生レイヤーの値域、ノードスナップ |
| `coverage.test.ts` | docs/04 §7 |
| `trails.test.ts` | ポリライン長、ルート解決、逆方向移動 |
| `movement.test.ts` | コースタイム ±25% |
| `weather.test.ts` | P3 の受け入れ項目 |
| `physiology.calibration.test.ts` | C1〜C9 |
| `conditions.test.ts` | DSL の全演算子、`chance` の固定、未知パスのエラー |
| `choices.test.ts` | 優先度・once・available・バイアス抽選の分布（10,000 回で重み比 ±3%） |
| `navigation.test.ts` | 分岐誤り率が cue と navSkill で単調に変化 |
| `hazards.test.ts` | 被雷率・滑落率のオーダー確認 |
| `rescue.test.ts` | 夜間ヘリ不可、電波なし通報失敗、未帰還通報の時刻 |
| `snapshot.test.ts` | serialize→restore→続行 と 中断なし の最終ハッシュ一致 |
| `determinism.test.ts` | §2 |
| `speech.test.ts` | テンプレートの選択・クールダウン・同時発話数、`distort()` の段階（35/34/32℃）、史実シナリオで `classify()` が記録・架空を正しく分け、架空のセリフ・思考には必ず※と「架空」が付く（UI 文字列・ログ・aria-live の 3 か所） |
| `bubbleLayout.test.ts` | 重なり回避（3 つが近接しても重ならない）、尻尾の根元が角丸から 12px 内側に収まる、画面端で先端が頭を指し続ける（純関数としてテスト） |
| `scenarios.test.ts` | 3 シナリオを全方針で 1 回ずつ通し、例外なし・結末到達 |
| `heightmap.test.ts` | u16-base64 の往復誤差 < 0.05 m、RLE の往復一致、可変サイズ（2048/385、12288/513）で派生レイヤーが計算できる |
| `editor/projection.test.ts` | 緯度経度 ⇔ ローカル座標の往復誤差 < 0.01 m、タイル座標の既知値 |
| `editor/dem.test.ts` | 標高 PNG のデコード（正・負・無効値 (128,0,0)）。`tests/fixtures/dem/` の小さな PNG を使う（通信しない） |
| `editor/overpass.test.ts` | `tests/fixtures/osm/*.json`（手作りの小さな応答）からグラフ化: 分岐での分割、way の結合、境界での切断、タグからの属性 |
| `editor/gpx.test.ts` | GPX 解析、既存グラフへのマップマッチング |
| `editor/openmeteo.test.ts` | 固定の応答から基準標高への換算、雲底推定、間引き |
| `editor/presets.test.ts` | 各天気パターンが既存キーフレームに重なり、時刻順が保たれる。寒冷前線 s=1 の生成結果が docs/17 §4.1 の表と一致 |
| `editor/bundle.test.ts` | プロジェクト → バンドル → プロジェクトの往復で内容一致 |

テストは外部サービスに **通信しない**。通信部分は `fetch` を差し替えてフィクスチャを返す。実際の通信を確かめたいときは `npm run geo:smoke`（手動実行、CI では実行しない）で、地理院タイル 1 枚・Overpass の小さな範囲・Open-Meteo 1 日分を取得して形式を確認する。

## 2. 決定論テスト

```
for scenario in [s01, s02, s03]:
  for policy in [recommended, bias, random]:
    r1 = runHeadless(scenario, seed=42, policy)
    r2 = runHeadless(scenario, seed=42, policy)
    expect(hashRecord(r1)).toBe(hashRecord(r2))
```

さらに「分岐点ごとに snapshot→restore を挟む実行」と「挟まない実行」のハッシュ一致を確認。
将来ブラウザとの一致を確認するため、`tools/sim.ts --hash` の出力を `tests/fixtures/hashes.json` に保存し、Worker 内実行の結果と比較するデバッグ機能を P11 で付ける。

## 3. 方針（`sim/policy.ts`）

| 方針 | 分岐点での選び方 |
|---|---|
| `recommended` | `recommended` タグの選択肢（複数なら定義順で最初の利用可能なもの）。なければ bias |
| `bias` | 登山者の自律バイアス（実際の「観察のみモード」と同じ） |
| `random` | 利用可能な選択肢から一様 |
| `risky` | `risky` タグを優先。なければ bias |
| `historical` | `historical.recordedChoices` の選択肢。記録にない分岐点は bias |

## 4. モンテカルロ（`npm run mc`）

```
npm run mc -- s01_cold_front --policy bias --n 500 [--seed 1]
```

出力例:

```
s01_cold_front  policy=bias  n=500  avg 41ms/run
SAFE_RETURN        112  22.4%
SAFE_SHELTER       141  28.2%
RESCUED             88  17.6%
RESCUED_CRITICAL    54  10.8%
MISSING             12   2.4%
FATAL               93  18.6%   (hypothermia 81, fall 12)
minCoreC p10/p50/p90: 31.2 / 34.8 / 36.4
choices: cp_start {go:412, early:61, abort:27} ...
balanceTargets: OK  ✔ fatalMin 18.6%（16.4%〜21.0%） ≥ 10.0%  ✔ fatalMax 18.6%（16.4%〜21.0%） ≤ 35.0%
```

## 5. balanceTargets の形式

```jsonc
"balanceTargets": {
  "recommended": { "goodMin": 0.90, "fatalMax": 0.02 },
  "bias":        { "fatalMin": 0.10, "fatalMax": 0.35, "goodMax": 0.75 },
  "risky":       { "fatalMin": 0.30 }
}
```

- `good` = `SAFE_RETURN + SAFE_SHELTER + ABORTED`
- `bad` = `RESCUED_CRITICAL + MISSING + FATAL`
- 指定可能キー: `goodMin`, `goodMax`, `badMin`, `badMax`, `fatalMin`, `fatalMax`, `rescuedMin`, `rescuedMax`, `lostMin`（道迷い発生率）, `lostMax`, `deathCountMedian: [min, max]`（1 回あたりの死亡者数の中央値。大人数シナリオ用）

### 5.1 判定と揺れの幅

回数が 100〜300 回だと、同じ設定でも乱数の種によって率が数 % 揺れる（s04 の流されやすい方針は、60 回ずつ 4 組で 42〜67%）。
そこで判定は点の値だけでなく、揺れの幅（80% の区間。率は Wilson の区間、死亡者数の中央値は順序統計の区間。`src/sim/mc.ts` の `BALANCE_Z`）で 3 段階にする。

| 判定 | 意味 | 対応 |
|---|---|---|
| ✔ 合格 | 区間ごと目標の内 | なし |
| △ 境目 | 区間が目標をまたぐ | 回数を増やして測り直す。それでも境目なら、目標の近くにいるだけなので急いで直さない |
| ✖ 不合格 | 区間ごと目標の外 | 調整する（§6） |

`npm run mc` は不合格のときだけ exit 1。エディターの試走パネルも同じ判定を出す。

### 5.2 全シナリオをまとめて測る

```
npm run balance [-- --n 100] [--jobs 8] [--only s04,s16] [--policy bias] [--quick] [--out <dir>]
```

全シナリオ × balanceTargets のある方針を、別々のプロセスで並べて `npm run mc` する（直列だと 40 分以上、並べれば 10 分ほど）。
境目のものは回数を 4 倍にして自動で測り直す（`--quick` で省く）。不合格かエラーがあれば exit 1。

## 6. 調整の手順（Claude Code 向け）

1. まず生理の較正（P4）を固定する。以後むやみに生理定数を動かさない。
2. シナリオの目標から外れたら、次の順で調整する:
   1. シナリオの気象キーフレーム（強度・時刻）
   2. 登山者の装備・性格パラメータ
   3. 分岐点の `bias` の重み
   4. ナビゲーション・危険の `tuning.ts` 定数（全シナリオに影響するので最後）
3. 調整のたびに `npm run balance` で全シナリオを回し、他を壊していないか確認。
4. 変更と理由を `DECISIONS.md` に記録。
