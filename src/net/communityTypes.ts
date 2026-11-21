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
  /** 分岐での選択（時刻・選んだもの・自動か） */
  decisions: { tMin: number; title: string; label: string; auto: boolean }[];
  /** 始まりの条件を変えて試したか */
  conditions: boolean;
  appVersion: string;
  /** 遊んだ難しさ（easy・normal・hard。難しさを入れる前の記録にはない） */
  difficulty?: 'easy' | 'normal' | 'hard';
}

export interface RunSummary extends RunSummaryInput {
  id: number;
  user: PublicUser;
  comment: string;
  createdAt: string;
  /** 自分の投稿か（トークンを付けて聞いたとき） */
  mine: boolean;
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

export interface ApiError {
  error: string;
}
