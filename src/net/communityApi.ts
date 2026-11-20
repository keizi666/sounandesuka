/**
 * 「みんなの遭難記録」の API を呼ぶ（docs/20_community.md §3）。
 * 通信先は同じオリジンの api/index.php だけ（CLAUDE.md 鉄則 8 の例外。DECISIONS.md）。src/sim からは使わない。
 */
import type { ListResponse, ProfileInput, PublicUser, RunDetail, RunSummaryInput } from './communityTypes';
import { loadProfile } from './profile';

const API = `${import.meta.env.BASE_URL}api/index.php`;

/** API の誤り。code は src/i18n/ja.ts の community.errors の鍵 */
export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function call<T>(action: string, opts: { query?: Record<string, string | number>; body?: unknown; token?: string | null } = {}): Promise<T> {
  const q = new URLSearchParams({ a: action });
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== '' && v !== 0) q.set(k, String(v));
  const token = opts.token === undefined ? loadProfile()?.token : opts.token;
  const headers: Record<string, string> = {};
  if (token) headers['X-Sounan-Token'] = token;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let r: Response;
  try {
    r = await fetch(`${API}?${q.toString()}`, {
      method: opts.body === undefined ? 'GET' : 'POST',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('network');
  }
  let j: unknown = null;
  try {
    j = await r.json();
  } catch {
    // PHP が動いていない（開発中に模擬がない・サーバーの設定が違う）
    throw new ApiError(r.ok ? 'server' : r.status === 404 ? 'noServer' : 'server');
  }
  if (!r.ok) throw new ApiError((j as { error?: string } | null)?.error ?? 'server');
  return j as T;
}

export const communityApi = {
  list: (q: { scenario?: string; ending?: string; user?: number; offset?: number; limit?: number }): Promise<ListResponse> =>
    call('list', { query: { scenario: q.scenario ?? '', ending: q.ending ?? '', user: q.user ?? 0, offset: q.offset ?? 0, limit: q.limit ?? 20 } }),
  run: (id: number): Promise<{ run: RunDetail }> => call('run', { query: { id } }),
  me: (token: string): Promise<{ user: PublicUser }> => call('me', { token }),
  register: (p: ProfileInput): Promise<{ user: PublicUser; token: string }> => call('register', { body: p, token: null }),
  updateProfile: (p: ProfileInput): Promise<{ user: PublicUser }> => call('profile', { body: p }),
  post: (summary: RunSummaryInput, record: string, comment: string): Promise<{ id: number }> => call('post', { body: { summary, record, comment } }),
  remove: (id: number): Promise<{ ok: true }> => call('delete', { body: { id } }),
  forget: (): Promise<{ ok: true }> => call('forget', { body: {} }),
  report: (id: number): Promise<{ ok: true }> => call('report', { body: { id } }),
};
