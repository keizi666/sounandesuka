/**
 * 「みんなの遭難記録」の API の型（docs/20_community.md §3）。サーバーは server/api/index.php、開発用の模擬は tools/devApi.ts。
 */
import type { AgeBand, Sex } from './rules';

/** 公開するプロフィール */
export interface PublicUser {
  id: number;
  nickname: string;
  sex: Sex;
  age: AgeBand;
  /** 顔のイラスト（"mid_m:3"。src/ui/avatar.ts の parsePortrait） */
  portrait: string;
  color: string;
}

/** 登録・更新のときに送るプロフィール */
export type ProfileInput = Omit<PublicUser, 'id'>;

/** 記録の要約（一覧に出す。記録そのものは詳細でだけ読む） */
export interface RunSummaryInput {
  scenarioId: string;
  scenarioTitle: string;
  /** 結末の種類（EndingKind） */
  ending: string;
  endingTitle: string;
  durationMin: number;
  distanceM: number;
  minCoreC: number;
  partySize: number;
  /** 亡くなった人の数 */
  deaths: number;
  /** 分岐での選択（時刻・選んだもの・自動か）。cpId・optionId は「みんなの選択」の集計に使う（入れる前の記録にはない） */
  decisions: { tMin: number; title: string; label: string; auto: boolean; cpId?: string; optionId?: string }[];
  /** 始まりの条件を変えて試したか */
  conditions: boolean;
  appVersion: string;
  /** 遊んだ難しさ（easy・normal・hard。難しさを入れる前の記録にはない） */
  difficulty?: 'easy' | 'normal' | 'hard';
  /** 週替わりのお題で遊んだ記録なら、その週の番号（src/app/weekly.ts） */
  week?: number;
}

export interface RunSummary extends RunSummaryInput {
  id: number;
  user: PublicUser;
  comment: string;
  createdAt: string;
  /** 自分の投稿か（トークンを付けて聞いたとき） */
  mine: boolean;
  /** 「参考になった」の数と、自分が押したか */
  likes?: number;
  liked?: boolean;
}

export interface RunDetail extends RunSummary {
  /** 記録（RecordPack の JSON を gzip して base64 にしたもの） */
  record: string;
}

export interface ListResponse {
  items: RunSummary[];
  total: number;
  /** 結末の種類ごとの件数（絞り込みの条件のとき） */
  counts: Record<string, number>;
  /** 投稿のあるシナリオ（絞り込みの候補） */
  scenarios: { id: string; title: string; n: number }[];
}

/** シナリオごとの集計（a=stats。載せた記録だけを数える。隠した記録は数えない） */
export interface ScenarioStats {
  id: string;
  title: string;
  /** 記録の数 */
  n: number;
  /** 載せた人の数 */
  players: number;
  /** 結末の種類ごとの件数 */
  counts: Record<string, number>;
  /** 亡くなった人が 1 人でも出た記録の数 */
  deathsAny: number;
}

export interface StatsResponse {
  /** 記録の多い順 */
  scenarios: ScenarioStats[];
}

/** 分岐ごとの、みんなの選択（a=choices）。分岐の鍵は cpId（古い記録は "t:" + 題）、選択肢の鍵は optionId（古い記録は "l:" + 選んだ文） */
export interface ChoicesResponse {
  /** 集計した記録の数 */
  n: number;
  cps: Record<string, { total: number; opts: Record<string, number> }>;
}

/** 戻ってきたときのお知らせ（a=notices） */
export interface NoticesResponse {
  /** since より後に、自分の記録に付いた「参考になった」（記録ごと） */
  likes: { runId: number; scenarioTitle: string; n: number }[];
  /** since より後に届いた、自分の挑戦状への答え */
  answers: ChallengeAnswer[];
  /** サーバーの今の時刻（次の since に使う） */
  now: string;
}

export interface ChallengeAnswer {
  k: string;
  scenarioTitle: string;
  /** 答えた人（プロフィールがなければ null） */
  user: PublicUser | null;
  ending: string;
  endingTitle: string;
  at: string;
}

/** 挑戦状（a=challenge GET） */
export interface ChallengeInfo {
  k: string;
  scenarioId: string;
  scenarioTitle: string;
  from: PublicUser;
  text: string;
  answers: number;
}

export interface ApiError {
  error: string;
}
