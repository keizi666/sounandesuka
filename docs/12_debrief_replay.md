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

- 分岐点数 × 選択肢数のジョブを Worker 1 本で順に処理し、結果が出た順に UI を更新（進捗バー）。
- 速さの目安: 1 回の通し実行が中位 PC で 30ms 以下（24 時間 = 8,640 ティック）。
- `followPolicy` は設定で `bias`（その人らしく）/ `recommended`（以後は最善）を選べる。既定 `bias`。

## 4. やり直し

`session.choiceSnapshots[cpId]` を復元し、その分岐点の選択肢モーダルを再表示する。
記録は分岐点時刻以降を切り捨てて継続（`RunRecord` もスナップショットに含める）。
履歴には別の実行として保存（`parentRunId` を付ける）。

## 5. エクスポート（任意）

振り返りの「記録を保存」で `RunRecord` を JSON ダウンロード。シナリオ作者が検証に使う。
