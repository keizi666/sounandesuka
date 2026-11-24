# 12 記録・振り返り・What-if

## 1. 記録（`sim/record/recorder.ts`）

`RunRecord` は World とは別オブジェクト（ただし決定論の対象）。

| 項目 | 内容 |
|---|---|
| `samples[]` | ゲーム内 5 分ごと: `t`, 登山者ごとの `{x, z, elevM, coreC, glycogenKcal, waterDeficitL, fatigue, wetness, anxiety, J, M, state}`、リーダー局地の `{tempC, windMs, precipMmH, precipType, visibilityM, thunder}` |
| `decisions[]` | `{ cpId, title, t, optionId, label, by: "user" \| "bias" \| "policy", tags }` |
| `events[]` | 重要イベントのみ（RAIN_START, SUNSET, OFFROUTE, LOST_AWARE, FALL, STAGE_CHANGE, RESCUE_CALLED, RESCUED, DEATH, SHELTER_ENTER, ...） |
| `track[]` | リーダーの軌跡（20 m ごと、最大 5,000 点。超えたら間引き） |
| `stats` | `minCoreC`, `maxAnxiety`, `fallCount`, `rainwearDelayMin`, `wasLost`, `lostMinutes`, `darkMinutesMoving`, `rescueCalledAt`, `distanceM` |
| `ending` | `{ kind, title, text, perClimber[] }` |

`hashRecord(record)` は決定論テストで使う。

## 2. DebriefScreen

```
┌────────────────────────────────────────────────────────────────┐
│ 振り返り: 稜線の冷たい雨  ─  結末: 救助（重度低体温症）              │
├───────────────────────────────┬────────────────────────────────┤
│ 時系列グラフ（Canvas）            │ 2D 地図（Canvas: 陰影段彩＋等高線） │
│  体温 ───                        │   計画ルート（点線）              │
│  気温/体感 ･･･                    │   実際の軌跡（色＝体温）           │
│  降水 ▁▂▅▇ 風 ───                │   ◆分岐点 ●イベント 地点          │
│  ◆  ◆     ◆   ●     ●           │                                │
│  6:00   9:00   12:00   15:00     │                                │
├───────────────────────────────┴────────────────────────────────┤
│ 分岐点                                                         │
│ ◆ 10:48 烏帽子ノ頭  あなたの選択: 予定どおり進む                    │
│     もし…  引き返す        無事下山 ██████████ 96%                │
│            予定どおり（選択）無事 ██▌ 救助 ███ 重篤 ██ 死亡 █        │
│     [この分岐からやり直す]                                         │
│ ◆ 12:31 雨が降り始めた …                                          │
├────────────────────────────────────────────────────────────────┤
│ 教訓                                                            │
│ ■ 雨具は「降り始め」に着る — 降り始めから着用まで 52 分かかった…       │
└────────────────────────────────────────────────────────────────┘
```

- グラフにマウスを乗せると、その時刻の値と（地図上の）位置を表示。
- 史実シナリオ（docs/09 §11）では、`historical.reference` を時間軸に「実際の記録」の目印（▲）として重ね、地図にも地点を表示する。シミュレーションの出来事と実際の記録の時刻差を一覧で示す。
- 大人数のとき、体温グラフはグループごとに最低値・中央値の帯で表示し、クリックで個人の線に切り替える。
- 2D 地図は高さマップから陰影段彩を Canvas に 1 回描いてキャッシュ（512×512）。等高線 100 m ごと。

## 3. What-if（`workers/whatif.worker.ts`）

各分岐点について、ユーザーが選ばなかった選択肢 **と選んだ選択肢の両方** を試算する（選んだ選択肢でも結果が確率的であることを見せるため）。

```
input: { mapId, scenarioId, snapshotB64, cpId, optionId, n: 30, followPolicy: "bias", seedBase }
for i in 0..n-1:
  world = restore(snapshot); world.rng を seedBase+i で再シード（全ストリーム）
  resolveChoice(world, cpId, optionId)
  以降の分岐点は followPolicy で自動解決
  ヘッドレスで終了まで実行（最大 timeLimit）
  集計: endingKind, minCoreC
output: { counts: Record<EndingKind, number>, minCoreHistogram: number[] }
```

- 分岐点数 × 選択肢数のジョブを、Worker を 2〜4 本並べて処理し（`src/ui/whatIfPool.ts`）、結果が出た順に UI を更新する。回数は 1 選択肢 20 回（`WHATIF_N`）。
- 結果の画面と振り返りのパネルは、同じ結果を使う（1 回の結果ごとに、計算した・している選択肢を覚え、2 度計算しない）。結果の画面を離れると Worker を止める。

### 3.1 選択の振り返り（結果の画面。ユーザーの指定: どれが良かった・悪かった・意味がなかったか）

What-if の結果から、選んだ選択肢を判定する（`src/sim/record/choiceVerdict.ts`、数値は `tuning.choices.verdict*`）。

- 悪さ = 結末ごとの重みの平均（無事 0・小屋 0.05・自力で脱出 0.3・救助 0.4・重い状態で救助 0.7・行方不明 0.9・死亡 1）。
- **結果をほとんど変えない**: いちばん良い選択肢といちばん悪い選択肢の差が 0.06 未満か、試算の揺れの幅（z 1.5）に収まる。
- **良い判断**: いちばん良い選択肢との差が 0.05 未満か、揺れの幅に収まる。
- **悪い判断**: いちばん良い選択肢より、はっきり（0.15 以上、揺れの幅を超えて）悪い。
- **まずまず**: その間。
- **手遅れ**: 結果をほとんど変えない（上の条件）うえに、いちばん良い選択肢でも悪さの平均が 0.4 以上（救助・行方不明・死亡がほとんど）。それより前の判断で結末が決まっていたことを示す（ユーザーの指定。`verdictLateMean`）。

画面には、判定の札、判定の文（悪い・まずまずなら「〇〇なら無事 a% → b%」）、選んだ選択肢の試算（無事・行方不明／死亡の割合）、選択肢の意味（シナリオの `explain` → 汎用分岐点は `ja.ts` → `tags`）を出し、悪い・まずまずのときは、いちばん良い選択肢の意味も出す。試算は以後を傾向どおりに進めた場合で、架空のモデルであり回数が少なく揺れがあることを注記する。
- 速さの目安: 1 回の通し実行が中位 PC で 30ms 以下（24 時間 = 8,640 ティック）。
- `followPolicy` は設定で `bias`（その人らしく）/ `recommended`（以後は最善）を選べる。既定 `bias`。

## 4. やり直し

`session.choiceSnapshots[cpId]` を復元し、その分岐点の選択肢モーダルを再表示する。
記録は分岐点時刻以降を切り捨てて継続（`RunRecord` もスナップショットに含める）。
履歴には別の実行として保存（`parentRunId` を付ける）。

## 5. エクスポート（任意）

振り返りの「記録を保存」で `RunRecord` を JSON ダウンロード。シナリオ作者が検証に使う。
