# 09 シナリオ形式

シナリオは `public/scenarios/<id>.json`。型の正は `docs/appendix/types.ts` の `ScenarioDef`。
サンプル: `s01_cold_front.json`（低体温症）、`s02_fog_descent.json`（道迷い）、`s03_thunder_ridge.json`（落雷）。

## 1. トップレベル

```jsonc
{
  "id": "s01_cold_front", "version": 1,
  "title": "稜線の冷たい雨", "subtitle": "10月・単独・寒冷前線",
  "theme": "hypothermia", "difficulty": 3, "season": "autumn", "estMinutes": 15,
  "mapId": "sounan", "seed": 1017,
  "startDate": "2026-10-17",
  "startAt": "D0 05:30",
  "timeLimit": "D1 12:00",
  "sun":  { "sunrise": "05:52", "sunset": "17:04", "maxElevDeg": 42 },
  "moon": { "illumination": 0.2 },
  "briefing": { ... },        // §2
  "plan": { ... },            // §2
  "party": [ ... ],           // §3
  "weather": { ... },         // docs/05
  "events": [ ... ],          // §6
  "choices": [ ... ],         // §5
  "genericOverrides": { },    // §7
  "thoughts": [ ... ],        // docs/07 §6 と同形式
  "speech": [ ... ],          // セリフのテンプレート（§8.1）
  "endings": [ ... ],         // §8
  "lessons": [ ... ],         // §9
  "balanceTargets": { ... },  // docs/14
  "region": { "name": "北アルプス 燕岳", "real": true },   // 任意。実在の山なら注記を表示
  "nodeOverrides": { "HUT_X": { "open": false } },         // 任意。小屋の営業状態をシナリオごとに上書き
  "sources": [ "気象の下書き: Open-Meteo ERA5 …" ]        // 任意。データの出どころの記録
}
```

**TimeRef** は `"D{日} HH:MM"`（D0 = `startDate`）。正規表現 `^D(\d) ([01]\d|2[0-3]):([0-5]\d)$`。
内部では `tMin = 日*1440 + 時*60 + 分`。

## 2. ブリーフィングと計画

```jsonc
"briefing": {
  "text": "会社員の村井さん（52）は…",
  "forecast": [ { "label": "朝", "text": "晴れ", "icon": "sunny" } ]
},
"plan": {
  "route": ["TH_SAWA", "J_FOREST", "EBOSHI", "HUT_RIDGE", "SUMMIT", "SADDLE_N", "MIKAERI", "TH_KITA"],
  "goalNodes": ["TH_KITA", "TH_SAWA"],        // ここに着けば FINISHED
  "plannedFinish": "D0 15:30",
  "submittedPlan": true,                      // 登山計画書の提出（捜索範囲に影響）
  "reportIfNotBackBy": "D0 21:00"             // 家族が通報する時刻（null で通報なし）
}
```

## 3. パーティ

```jsonc
{ "id": "murai", "name": "村井", "age": 52, "sex": "m", "weightKg": 68, "packKg": 9,
  "experience": 0.5, "fitness": 0.95, "navSkill": 0.5, "riskTolerance": 0.6,
  "color": "#d9452b", "leader": true,
  "habits": { "eatEveryMin": 120, "drinkEveryMin": 60, "delaysRainwear": 0.6, "gpsCheckEveryMin": null },
  "gear": {
    "rainwear": "basic", "cloWorn": 0.9, "cloPack": 0.6, "gloves": "thin", "hat": true,
    "bivy": "none", "headlamp": { "has": true, "batteryH": 6, "inPack": true, "spareBatteryH": 0 },
    "phone": { "has": true, "batteryPct": 70, "gpsApp": true, "trackRecording": false, "satelliteSos": false },
    "map": true, "compass": false, "foodKcal": 1200, "waterL": 1.5,
    "stove": false, "crampons": false, "helmet": false, "trekkingPoles": true, "whistle": false
  } }
```

`leader: true` が 1 人だけ必要（変数パス `leader` の対象）。最大 20 人（4 人以上のときは `groups` を書くことを推奨）。

複数日の山行の途中から始めるシナリオでは、前日までの疲れ・濡れ・食事不足を `initial` で与える:

```jsonc
"initial": { "wetness": 0.35, "glycogenKcal": 550, "fatigue": 35, "coreC": 36.9, "rainwearOn": true, "waterDeficitL": 0.5 }
```

記録に基づかない推定値には `estimated: ["weightKg", "fitness", "initial"]` のように印を付ける（ブリーフィングで「推定」と表示）。

### 3.1 グループ

```jsonc
"groups": [
  { "id": "main", "members": "all", "leader": "guide_B", "cohesion": "tight" }
]
```

- `members`: 登山者 ID の配列、または `"all"` / `"rest"`（他のグループに入っていない全員）/ `"incapacitated"`（その時点で M = 0 または意識なし）/ `"weak"`（`incapacitated` 以外で coreC < 35.0 または M < 0.5）。`splitParty` では上から順に割り当て、同じ人が 2 つのグループに入らない。`incapacitated` / `weak` が 0 人のグループは作られない。
- 分岐点は `"group": "<id>"` を指定するとそのグループで評価・適用される。変数パス `leader` はそのグループのリーダーを指す。`group.<id>.min.coreC` / `group.<id>.count` / `group.<id>.incapacitatedCount` / `group.<id>.below35Count` も使える。
- グループのリーダーが行動不能・死亡したら、同じグループで J が最も高い人が自動でリーダーになる（イベント `LEADER_CHANGED`）。

## 4. 条件 DSL（`scenario/conditions.ts`）

JSON で表す論理式。`eval` は使わない。

| 形 | 意味 |
|---|---|
| `{ "all": [C, ...] }` / `{ "any": [C, ...] }` / `{ "not": C }` | 論理 |
| `{ "var": "<path>", "op": "<|<=|>|>=|==|!=", "value": V }` | 変数比較 |
| `{ "after": "D0 11:00" }` / `{ "before": "D0 15:00" }` | 時刻 |
| `{ "atNode": "SADDLE_N" }` | リーダーがノードに到着した（そのティック） |
| `{ "beenAt": "HUT_RIDGE" }` | 一度でも到着したことがある |
| `{ "onEdge": "E5" }` | リーダーがエッジ上 |
| `{ "near": { "x": -1200, "z": -575, "r": 80 } }` | 半径内 |
| `{ "state": "LOST_AWARE" }` | リーダーの行動状態 |
| `{ "flag": "name" }` | フラグが立っている |
| `{ "chose": { "cp": "cp_eboshi", "option": "go" } }` | その選択をした |
| `{ "event": "RAIN_START" }` | そのティックに発生したイベント種別（`RAIN_START` はリーダー局地の降水が 0.5 mm/h 以上になった瞬間。止んで 30 分以上経ってからの再開でも発生） |
| `{ "chance": 0.3 }` | 評価が初めて真になる直前に `events` ストリームで 1 回だけ抽選し、結果を固定 |
| `{ "elapsedSince": { "flag": "x", "min": 30 } }` | フラグが立ってから N 分以上 |

### 4.1 変数パス（`scenario/vars.ts`）

| パス | 内容 |
|---|---|
| `t` | 経過分（開始時刻からではなく D0 0:00 から） |
| `clockMin` | その日の 0:00 からの分 |
| `sun.isDark`, `sun.elevDeg` | |
| `g.<field>` | 全体気象（`g.precipMmH` など） |
| `leader.<field>` / `c.<climberId>.<field>` | 登山者。`coreC`, `wetness`, `glycogenKcal`, `fatigue`, `anxiety`, `J`, `M`, `state`, `elevM`, `injury`, `rainwearOn`, `awareLost`, `phone.batteryPct`, `radio`, `timeBehindMin` |
| `leader.def.<field>` / `c.<id>.def.<field>` | 登山者定義（`experience`, `fitness`, `navSkill`, `riskTolerance`, `age` など。不変） |
| `leader.local.<field>` | 局地気象（`tempC`, `windMs`, `precipMmH`, `precipType`, `visibilityM`, `windChillC`, `thunder`） |
| `party.min.coreC` / `party.max.fatigue` 等 | 集計 |
| `rec.minCoreC`, `rec.maxAnxiety`, `rec.fallCount` | 記録（教訓の条件用） |
| `flags.<name>` | 真偽値 |
| `animal.<species>` / `animal.any` | リーダーから、いる（立ち去り始めていない）野生動物までの最短距離 m。いなければ 99999。`species` は下の §8 の表 |

存在しないパスは `validate` でエラー。

## 5. 分岐点（ChoicePoint）

```jsonc
{
  "id": "cp_eboshi",
  "title": "烏帽子ノ頭",
  "trigger": { "all": [ { "atNode": "EBOSHI" } ] },
  "once": true, "priority": 10,
  "situation": "{leader.name}さんは烏帽子ノ頭に着いた。西の空が暗い。風が強くなってきた（体感 {leader.local.windChillC:0}℃）。",
  "knowledge": [ "予報では夕方から雨", "ここから稜線小屋まで約40分", "引き返せば登山口まで約2時間" ],
  "timeoutSec": 30,
  "options": [
    { "id": "go", "label": "予定どおり稜線へ進む",
      "detail": "小屋まで40分。小屋で天気を見て判断すればいい。",
      "actions": [ { "type": "continueRoute" } ],
      "tags": ["risky"],
      "bias": { "base": 1.0, "mods": [ { "when": { "var": "leader.def.riskTolerance", "op": ">", "value": 0.5 }, "add": 0.8 } ] } },
    { "id": "back", "label": "ここで引き返す", "actions": [ { "type": "turnBack" } ],
      "tags": ["recommended"], "bias": { "base": 0.6 } }
  ]
}
```

- **発火**: 毎ティック、未発火（`once`）かつ `trigger` 真のものを集め、`priority` 最大を 1 つだけ発火（同値は定義順）。発火時にスナップショット保存。
- **available**: 選択肢ごとの条件。偽なら `unavailableText` を添えて無効表示、`hideIfUnavailable: true` なら非表示。
- **bias**: 自律選択の重み `w = max(0, base + Σ add)`。`choice` ストリームで重み比例抽選。
- **プレースホルダ**: `{path}` または `{path:小数桁}`。パスは §4.1。`{leader.name}` は名前。列挙値は日本語に変換して表示する（`precipType`: rain→雨, sleet→みぞれ, snow→雪, hail→ひょう, none→なし。`state` も `i18n` の表で変換）。
- 選択の結果、`actions` を先頭から順に適用し、`flags` があれば立てる。

## 6. アクション（`climber/actions.ts`）

対象は既定でパーティ全員（`"who": "leader" | "all" | "<climberId>"` で指定可）。

| type | パラメータ | 効果 |
|---|---|---|
| `continueRoute` | | 計画ルートを続行（`WALKING`） |
| `setRoute` | `route: string[]` | ルートを差し替え（先頭は現在地または隣接ノード）。`goalNodes` も任意で上書き |
| `turnBack` | | 来たルートを逆順に（`plan.route` の通過済み部分を反転）。最初の登山口が目標 |
| `goToNode` | `node`, `then: "stay" \| "continue"` | 経路探索（ダイクストラ、コース時間）でノードへ。`stay` なら到着後 `SHELTERED`（小屋）または `RESTING` |
| `stayInShelter` | `until: TimeRef \| "weatherClears"` | 小屋に入る（現在地が小屋ノードであること） |
| `rest` | `minutes` | 休憩 |
| `eat` | `kcal` | 食べる（食料から） |
| `drink` | `liters` | 飲む |
| `wearRainwear` | | 雨具着用（所要時間あり） |
| `addLayer` | `clo?`（省略で全部） | 予備を着る |
| `changeDry` | | 乾いた衣類に着替え（docs/06 §4） |
| `stopAndCheck` | | 次の分岐で誤り率 ×0.1（10 分のロス）。`checkPosition` も実行 |
| `checkPosition` | | docs/07 §3.7 |
| `bivouac` | `until: TimeRef \| "dawn" \| "rescue"`, `findLee: boolean` | 風下探索→ビバーク（ツェルト等があれば使用） |
| `stayPut` | | `STAYING` |
| `backtrack` | | `BACKTRACKING` |
| `navigateToTrail` | | `NAVIGATING_TO_TRAIL`（`knowsPosition` が必要） |
| `descendDrainage` | | `DESCENDING_DRAINAGE` |
| `seekSignal` | `returnAfter?` | `SEEKING_SIGNAL`。`returnAfter: true` なら通報（成否問わず）後に元のグループへ戻る |
| `callRescue` | `via: "auto" \| "phone" \| "satellite"` | 通報を試行。失敗時イベント `RESCUE_CALL_FAILED` |
| `waitRescue` | | `WAITING_RESCUE`（ツェルトがあれば使用、風下探索あり） |
| `setPace` | `factor` | 速度倍率（0.6〜1.2）。1.1 超は `hurry` 扱い |
| `lightningPosture` | `minutes` | 雷しゃがみ（移動停止） |
| `moveOffRidge` | `minDropM` | 現在地から風下・低い側へ `minDropM` 下がる道外移動（または近い樹林帯ノードへ） |
| `removeMetal` | | 5 分のロスのみ（効果なし。教材用） |
| `setFlag` / `clearFlag` | `flag` | |
| `narrate` | `text` | ログに文章 |
| `abortTrip` | | 出発前の中止。結末 `ABORTED` で即終了 |
| `say` | `text`, `to?`, `tone?`, `documented?`, `source?` | 対象（`who`、既定はリーダー）が声に出して言う（吹き出し表示のみ。行動は変えない） |
| `splitParty` | `groups: { id, members, leader, cohesion?, actions }[]` | グループを分ける。`members` は ID 配列か `"rest"`。各グループに初期アクションを与える |
| `setCohesion` | `cohesion: "tight" \| "loose"` | グループのまとまり方を変える（docs/07 §1.4） |
| `soak` | `level: "feet" \| "knees" \| "waist" \| "full"`, `snowmelt?: boolean` | 冷水に浸かる（docs/06 §4.1）。`who` で対象を指定 |
| `detach` | `then: Action[]` | 対象をパーティから外し、個別に行動させる（例: 途中で引き返すシェルパ） |
| `joinGroup` | `group` | 対象（`who`）を別のグループに入れる（分かれていた仲間と同じ所で合流する）。そのグループのリーダーの計画・状態にそろえ、30 m 以内ならリーダーの位置に並ぶ。離れていれば歩いて追いつく |

**until の意味**
- `TimeRef`: その時刻まで。
- `dawn`: 次の日の出 + 30 分まで。
- `rescue`: 救助隊と接触するまで。
- `weatherClears`: 局地で `thunder < 0.1` かつ `precipMmH < 1` かつ `windMs < 12` かつ `visibilityM > 300` が 30 分続くまで（最長で翌朝 `dawn`）。

`SHELTERED` / `BIVOUAC` / `RESTING` の終了後は `WALKING` に戻り、その時点の計画ルート（`plan.route` の残り）を続ける。
`goToNode ... then: "stay"` の滞在は、次の分岐点が出るか `dawn` まで続く（営業小屋なら結末判定では安全扱い）。

## 7. 汎用分岐点（`scenario/generic.ts`）

シナリオに書かれていない状況のための組み込み分岐点。`priority` はシナリオ分岐点より低い（0〜5）。
シナリオの `genericOverrides.<key>` で `situation` / `options` / `enabled: false` を上書きできる。

選択肢は 4 個を超える場合がある（汎用分岐点のみ例外として最大 5 個）。`available` を満たさないものは非表示。
記録上の分岐点 ID は `generic:<key>`、選択肢 ID は下表の英字（教訓の `chose` 条件で使う）。

| key | 発火条件 | 既定の選択肢 `id`: ラベル（tags）→ アクション |
|---|---|---|
| `lostAware` | 状態が `LOST_AWARE` になった | `backtrack`: 来た道を戻る(recommended)→backtrack / `gps`: 地図アプリで現在地を確かめる(recommended, GPS アプリと電池がある時)→checkPosition, navigateToTrail / `descend`: 下れば道に出るはず(risky)→descendDrainage / `call`: その場で救助要請(電波時)→callRescue, waitRescue / `stay`: 動かずに待つ→stayPut |
| `darkness` | 暗くなった かつ 行動中 かつ 目的地未着 | `continue`: ヘッドランプで続行→continueRoute / `bivouac`: その場でビバーク(recommended)→bivouac(dawn, findLee) / `toShelter`: 近い小屋を目指す（2 km 以内に小屋がある時）→goToNode(最寄り小屋, stay) |
| `hypothermia` | リーダー `coreC < 35.3` かつ 屋外（1 回、以後 `< 34.0` で再度 1 回） | `bivouac`: 風下でビバーク(recommended)→addLayer, eat, bivouac(dawn, findLee) / `push_eat`: 食べて着込み続行→addLayer, eat, continueRoute / `keep_walking`: 歩き続けて体を温める(risky)→setPace 1.1, continueRoute / `call`: 救助要請(recommended, 電波時)→callRescue, waitRescue |
| `injured` | 負傷 `sprain` 以上 | `slow_descend`: ゆっくり下山→setPace 0.6, continueRoute / `bivouac`: ビバークして待つ→bivouac(rescue) / `call`: 救助要請(recommended, 電波時)→callRescue, waitRescue / `seek_signal`: 電波を探して移動→seekSignal |
| `bruised` | 転んで打撲・擦り傷（歩ける） | `rest`: 休んでけがを確かめる(recommended, 歩いている途中だけ)→rest 15, continueRoute / `careful`: 足もとに気をつけてゆっくり(recommended)→setPace 0.85 / `push`: そのまま進む(risky)→setPace 1 |
| `lightning` | `leader.local.thunder > 0.5` かつ 稜線上（1 回） | `off_ridge`: 稜線を外れて下る(recommended)→moveOffRidge 80 / `rush`: 急いで通過(risky)→setPace 1.2, continueRoute / `crouch`: その場で雷しゃがみ→lightningPosture 30 / `remove_metal`: 金属を外して進む(risky)→removeMetal, continueRoute |
| `waterfall` | 滝の手前で停止 | `climb_back`: 登り返す(recommended)→backtrack / `high_route`: 高巻きする(risky)→descendDrainage（崖の判定が厳しくなる）/ `bivouac`: ここでビバーク→bivouac(dawn, findLee) |
| `straggler` | `loose` のグループでリーダーが遅れに気づいた | `wait`: 待って全員をそろえる(recommended)→rest 20, setCohesion tight / `go`: 先に進む(risky)→continueRoute / `back`: 遅れた人のところへ戻る→goToMember |
| `rescueFailed` | 通報失敗 | `seek_signal`: 電波を探す(recommended)→seekSignal / `wait`: 待つ→waitRescue / `descend`: 下る(risky)→descendDrainage |

## 8. スクリプトイベント

```jsonc
{ "id": "ev_forecast", "trigger": { "after": "D0 09:30" }, "once": true,
  "effects": [ { "type": "log", "text": "スマホに強風注意報が届いた" },
               { "type": "forecastUpdate", "entries": [ { "label": "午後", "text": "雨・強風" } ] } ] }
```

| 効果 type | パラメータ |
|---|---|
| `log` | `text`, `important?` |
| `forecastUpdate` | `entries`（登山者が知る予報を更新。電波があるときのみ届く: `requiresSignal: true` 既定） |
| `setFlag` / `clearFlag` | `flag` |
| `injure` | `who`, `injury` |
| `rockfall` | `who`, `p`（負傷確率）, `injuryTable: "T2" \| "EXPOSED"` |
| `actions` | `actions: Action[]`（強制行動。例: 小屋の主人に止められて泊まる） |
| `weatherOverride` | `keyframe`（その時刻以降に挿入。描画・UI にも反映） |
| `pin` | `x`, `z`, `label`（注目ピン） |
| `say` | `who`, `text`, `to?`, `tone?`, `documented?`, `source?`（セリフを言わせる） |
| `soak` | `who`, `level`, `snowmelt?`（渡渉での転倒など） |
| `triggerChoice` | `cp`（分岐点 ID を即発火） |
| `animal` | 野生動物を出す。`species`（`bear` ツキノワグマ / `brownBear` ヒグマ / `deer` シカ / `serow` カモシカ / `boar` イノシシ / `monkey` サル）、`count?`（1〜6）、場所は `at?`（地点 ID）か `x?`・`z?`、なければリーダーの位置。そこから `aheadM?`（進む向きへ）・`sideM?`（右へ。負で左）ずらす。`behavior?`（`graze` 草を食む / `watch` こちらを見る / `wander` うろつく / `cross` 道を横切る / `flee` すぐ逃げる / `stalk` 人に付きまとう。熊のみ: いちばん近い人へ歩いて近づき、近づくたびに襲うかを引く。襲わなければ 20 分止まって見ていて、また近づく。人が近づいても立ち去らず、いちばん近い人が 800 m より離れるか時間が来ると立ち去る。見えなくなったグループは、次に見えたときにまた「見つけた」になり、暗さや霧で気づかないうちに近づかれると鉢合わせの確率で引く）、`durationMin?`、`anxiety?`（見つけたときの不安。既定は種類ごと）、`quiet?`（自動のログを出さない）、`id?`、`headingDeg?`。人が種類ごとの距離まで近づくか、時間が来ると立ち去る。見つけると出来事 `ANIMAL`（条件 `event` で使える）とログ。熊（`bear`・`brownBear`）は、人が近づいた出会いごとに低い確率で向かってきて、いちばん近い人にけがをさせてから立ち去る（気づかずに近づいた鉢合わせのほうが高い。止まっている人・人数の多いグループでは下がる。`aggression?` で倍率、0 で襲わない。`attackInjury?` で襲われたときのけがの割合を上書き: 打撲・ねんざ・脚の骨折・頭のけが・重い外傷・死亡の 6 つ）。襲われるとフラグ `bearAttack` が立つ |
| `animalLeave` | `id?`・`species?`（動物を立ち去らせる。どちらもなければ全部） |

### 8.1 セリフのテンプレート（`speech`）

```jsonc
"speech": [
  { "key": "s02_doubt", "who": "tanaka", "to": "leader",
    "when": { "all": [ { "state": "OFFROUTE_UNAWARE" }, { "elapsedSince": { "flag": "offroute", "min": 10 } } ] },
    "lines": ["ねえ、この道で合ってる？", "さっきから踏み跡が細くない？"],
    "replies": { "who": "leader", "lines": ["大丈夫、たぶんこっちだよ"] },
    "tone": "normal", "priority": 20, "cooldownMin": 45 }
]
```

| フィールド | 内容 |
|---|---|
| `who` | 話し手: 登山者 ID / `"leader"` / `"any"`（条件に合う誰か） / `"role:<役割>"`（例 `role:ガイド`） |
| `to` | 話しかける相手（省略時は独り言・全体への声かけ）。吹き出しの尻尾は話し手に付け、相手の名前を小さく添える |
| `when` | 条件 DSL。`leader` 等の解決は話し手の所属グループ基準 |
| `lines` | 候補（ランダムに 1 つ）。プレースホルダ可 |
| `replies` | 相手の応答（任意） |
| `tone` | `normal` / `shout`（叫ぶ） / `whisper`（小声） / `sound`（笛・擬音） |
| `priority`, `cooldownMin`, `once` | |
| `documented`, `source` | 史実シナリオで記録に残る発言であることを示す。指定のないセリフは史実シナリオでは架空として※を付けて表示する（docs/07 §7.5） |

## 9. 結末（`endings`）

エンジンの判定（docs/02 §5）で `kind` が決まった後、シナリオの `endings` を上から評価し、
`kind` が一致し `when` が真の最初の定義の `title` / `text` を使う。なければ `i18n` の既定文。

```jsonc
{ "kind": "SAFE_SHELTER", "when": { "beenAt": "HUT_RIDGE" }, "title": "稜線小屋の一夜",
  "text": "窓を叩く雨の音を聞きながら…" }
```

## 10. 教訓（`lessons`）

```jsonc
{ "id": "l_rainwear", "when": { "var": "rec.rainwearDelayMin", "op": ">", "value": 30 },
  "title": "雨具は「降り始め」に着る",
  "text": "降り始めから雨具を着るまでに{rec.rainwearDelayMin:0}分かかった。…" }
```

`rec.*` 変数: `deathCount`, `minCoreC`, `maxAnxiety`, `fallCount`, `rainwearDelayMin`（降水開始から着用まで）, `wasLost`, `lostMinutes`,
`darkMinutesMoving`, `rescueCalledAt`, `finalState`, `endingKind`。

## 11. 史実シナリオ（`historical`）

実際の遭難事故の経過をもとにしたシナリオのための追加フィールド。

```jsonc
"historical": {
  "event": "2009年7月16日 トムラウシ山遭難事故",
  "sources": [ { "title": "トムラウシ山遭難事故調査報告書", "publisher": "日本山岳ガイド協会 トムラウシ山遭難事故調査特別委員会", "year": 2010 } ],
  "labelsNote": "人物は調査報告書の記号で表記",
  "disclaimer": "…",
  "recordedChoices": { "cp_depart": "delay30", "cp_ridge": "go" },
  "reference": [ { "at": "D0 05:30", "label": "ヒサゴ沼避難小屋を出発", "who": null } ]
}
```

- 方針 `historical`（docs/14 §3）は `recordedChoices` の選択肢を選ぶ。記録にない分岐点は `bias`。
- `reference` は振り返りのグラフと地図に「実際の記録」として重ねて表示し、シミュレーションとの差を見せる（docs/12 §2）。
- 史実シナリオでは、ブリーフィングの最初に `disclaimer` と出典を必ず表示する。結末画面では、シミュレーション上の結果と実際の結果を混同しないよう「実際の記録」欄を分けて表示する。
- 人物は実名を使わず、公開報告書の記号（または役割名）で表記する。

## 12. バンドル

マップとシナリオを 1 ファイルにまとめた形式（`docs/15` §3.2、型 `SounanBundle`）。`index.json` のエントリは `file`（シナリオのみ）か `bundle` のどちらかを持つ。
`npm run validate` はバンドルも検証する（`public/scenarios/*.sounan.json`）。

## 13. 検証（`npm run validate`）

- TimeRef の書式、昇順（keyframes）
- ノード / エッジ / 分岐点 / 選択肢 / 登山者 ID の参照解決
- `plan.route` の隣接ノード間にエッジがあること
- 変数パスが既知であること
- 各分岐点に 2〜4 個の選択肢、`recommended` が 1 つ以上
- `leader` がちょうど 1 人
- 文字列プレースホルダのパス解決
エラーは `s01_cold_front.json: choices[2].options[1].actions[0].node: 未定義のノード "HUT"` の形式で列挙。
