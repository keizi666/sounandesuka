/**
 * 「みんなの遭難記録」の自分のプロフィール（端末の localStorage）。
 * トークンはパスワードの代わりで、引き継ぎコードとしても見せる（docs/20_community.md §2）。
 */
import type { PublicUser } from './communityTypes';

const KEY = 'hks.v1.community.profile';
/** 自分が載せた記録（runId → 投稿の ID）。同じ記録を二度載せないため */
const POSTED_KEY = 'hks.v1.community.posted';

export interface LocalProfile {
  token: string;
  user: PublicUser;
}

export function loadProfile(): LocalProfile | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LocalProfile | null;
    return p && typeof p.token === 'string' && p.user ? p : null;
  } catch {
    return null;
  }
}

export function saveProfile(p: LocalProfile | null): void {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch {
    // 保存できない（プライベートモードなど）。この画面のあいだだけ使える
  }
}

/** 引き継ぎコードの見せ方（6 文字ずつハイフンで区切る） */
export function formatCode(token: string): string {
  return token.match(/.{1,6}/g)?.join('-') ?? token;
}

/** 入力された引き継ぎコードを正規化（24 文字でなければ null） */
export function parseCode(s: string): string | null {
  const t = s.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return t.length === 24 ? t : null;
}

export function postedRuns(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(POSTED_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export function markPosted(runId: string, id: number): void {
  try {
    localStorage.setItem(POSTED_KEY, JSON.stringify({ ...postedRuns(), [runId]: id }));
  } catch {
    // 保存できなくても投稿はできている
  }
}
