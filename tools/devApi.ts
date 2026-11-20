/**
 * 開発サーバー用の「みんなの遭難記録」API の模擬（Vite のプラグイン。npm run dev のときだけ）。
 * 本番は server/api/index.php（PHP + SQLite）。手元には PHP がないので、同じ操作・同じ決まりをここで真似る。
 * データは .scratch/dev-community.json（git に入れない）。回数の制限は本番より緩い。
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { AGE_BANDS, checkComment, checkNickname, RECORD_MAX_BYTES, REPORT_HIDE, SEXES } from '../src/net/rules.ts';

interface DevUser { id: number; tokenHash: string; nickname: string; sex: string; age: string; portrait: string; color: string }
interface DevRun { id: number; userId: number; summary: Record<string, unknown> & { scenarioId: string; ending: string; scenarioTitle: string }; comment: string; record: string; createdAt: string; reports: string[]; hidden: boolean }
interface DevDb { users: DevUser[]; runs: DevRun[]; nextUser: number; nextRun: number }

const ENDINGS = ['SAFE_RETURN', 'SAFE_SHELTER', 'ABORTED', 'SELF_RESCUE', 'RESCUED', 'RESCUED_CRITICAL', 'MISSING', 'FATAL'];

class Fail extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export function devCommunityApi(root: string): Plugin {
  const file = resolve(root, '.scratch', 'dev-community.json');
  const load = (): DevDb => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as DevDb) : { users: [], runs: [], nextUser: 1, nextRun: 1 });
  const save = (db: DevDb): void => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(db));
  };
  const hashOf = (t: string): string => createHash('sha256').update(`dev|${t}`).digest('hex');
  const lastPost = new Map<string, number>();

  const readBody = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((ok, ng) => {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return ng(new Fail(415, 'invalid'));
      let s = '';
      req.on('data', (c: Buffer) => (s += c.toString('utf8')));
      req.on('end', () => {
        try {
          const j = JSON.parse(s) as unknown;
          if (typeof j !== 'object' || j === null) throw new Error();
          ok(j as Record<string, unknown>);
        } catch {
          ng(new Fail(400, 'invalid'));
        }
      });
    });

  const profileInput = (b: Record<string, unknown>): Omit<DevUser, 'id' | 'tokenHash'> => {
    const nickname = String(b['nickname'] ?? '').trim();
    const e = checkNickname(nickname);
    if (e) throw new Fail(400, e);
    const sex = String(b['sex'] ?? 'x');
    const age = String(b['age'] ?? 'x');
    const portrait = String(b['portrait'] ?? '');
    const color = String(b['color'] ?? '');
    if (!(SEXES as readonly string[]).includes(sex) || !(AGE_BANDS as readonly string[]).includes(age)) throw new Fail(400, 'invalid');
    if (!/^(child|young|mid|senior)_[mf]:[1-9][0-9]{0,2}$/.test(portrait) || !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Fail(400, 'invalid');
    return { nickname, sex, age, portrait, color: color.toLowerCase() };
  };

  const pub = (u: DevUser): Record<string, unknown> => ({ id: u.id, nickname: u.nickname, sex: u.sex, age: u.age, portrait: u.portrait, color: u.color });
  const out = (db: DevDb, r: DevRun, me: DevUser | null, withRecord: boolean): Record<string, unknown> => {
    const u = db.users.find((x) => x.id === r.userId)!;
    return { ...r.summary, id: r.id, user: pub(u), comment: r.comment, createdAt: r.createdAt, mine: me?.id === r.userId, ...(withRecord ? { record: r.record } : {}) };
  };

  const handle = async (req: IncomingMessage, url: URL): Promise<[number, unknown]> => {
    const db = load();
    const a = url.searchParams.get('a') ?? '';
    const token = String(req.headers['x-sounan-token'] ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    const me = token.length === 24 ? (db.users.find((u) => u.tokenHash === hashOf(token)) ?? null) : null;
    const needMe = (): DevUser => {
      if (!me) throw new Fail(401, 'auth');
      return me;
    };
    const live = db.runs.filter((r) => !r.hidden && db.users.some((u) => u.id === r.userId));
    if (req.method === 'GET' && a === 'list') {
      const scenario = url.searchParams.get('scenario') ?? '';
      const user = Number(url.searchParams.get('user') ?? 0);
      const ending = url.searchParams.get('ending') ?? '';
      const base = live.filter((r) => (!scenario || r.summary.scenarioId === scenario) && (!user || r.userId === user));
      const hit = base.filter((r) => !ending || r.summary.ending === ending).sort((x, y) => y.id - x.id);
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') ?? 20)));
      const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
      const counts: Record<string, number> = {};
      for (const r of base) counts[r.summary.ending] = (counts[r.summary.ending] ?? 0) + 1;
      const sc = new Map<string, { id: string; title: string; n: number }>();
      for (const r of live) {
        const v = sc.get(r.summary.scenarioId) ?? { id: r.summary.scenarioId, title: r.summary.scenarioTitle, n: 0 };
        v.n += 1;
        sc.set(v.id, v);
      }
      return [200, { items: hit.slice(offset, offset + limit).map((r) => out(db, r, me, false)), total: hit.length, counts, scenarios: [...sc.values()].sort((x, y) => y.n - x.n) }];
    }
    if (req.method === 'GET' && a === 'run') {
      const r = db.runs.find((x) => x.id === Number(url.searchParams.get('id')));
      if (!r || (r.hidden && me?.id !== r.userId)) throw new Fail(404, 'notFound');
      return [200, { run: out(db, r, me, true) }];
    }
    if (req.method === 'GET' && a === 'me') return [200, { user: pub(needMe()) }];
    if (req.method !== 'POST') throw new Fail(404, 'notFound');
    const b = await readBody(req);
    if (a === 'register') {
      const p = profileInput(b);
      const abc = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
      const tk = [...randomBytes(24)].map((x) => abc[x & 31]).join('');
      const u: DevUser = { id: db.nextUser++, tokenHash: hashOf(tk), ...p };
      db.users.push(u);
      save(db);
      return [200, { user: pub(u), token: tk }];
    }
    if (a === 'profile') {
      const u = needMe();
      Object.assign(u, profileInput(b));
      save(db);
      return [200, { user: pub(u) }];
    }
    if (a === 'post') {
      const u = needMe();
      const s = b['summary'] as DevRun['summary'] | undefined;
      if (!s || !/^[a-z0-9_]{1,64}$/.test(String(s.scenarioId)) || !ENDINGS.includes(String(s.ending))) throw new Fail(400, 'invalid');
      const comment = String(b['comment'] ?? '').trim();
      const ce = checkComment(comment);
      if (ce) throw new Fail(400, ce);
      const record = String(b['record'] ?? '');
      if (record.length > RECORD_MAX_BYTES) throw new Fail(413, 'tooLarge');
      if (!record.startsWith('H4sI')) throw new Fail(400, 'invalid');
      // 本番は 1 分に 1 件。模擬は 5 秒
      if (Date.now() - (lastPost.get(String(u.id)) ?? 0) < 5000) throw new Fail(429, 'rate');
      lastPost.set(String(u.id), Date.now());
      const r: DevRun = { id: db.nextRun++, userId: u.id, summary: s, comment, record, createdAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), reports: [], hidden: false };
      db.runs.push(r);
      save(db);
      return [200, { id: r.id }];
    }
    if (a === 'delete') {
      const u = needMe();
      const i = db.runs.findIndex((r) => r.id === Number(b['id']) && r.userId === u.id);
      if (i < 0) throw new Fail(404, 'notFound');
      db.runs.splice(i, 1);
      save(db);
      return [200, { ok: true }];
    }
    if (a === 'forget') {
      const u = needMe();
      db.runs = db.runs.filter((r) => r.userId !== u.id);
      db.users = db.users.filter((x) => x.id !== u.id);
      save(db);
      return [200, { ok: true }];
    }
    if (a === 'report') {
      const r = db.runs.find((x) => x.id === Number(b['id']));
      const ip = req.socket.remoteAddress ?? '';
      if (r && !r.reports.includes(ip)) {
        r.reports.push(ip);
        if (r.reports.length >= REPORT_HIDE) r.hidden = true;
        save(db);
      }
      return [200, { ok: true }];
    }
    throw new Fail(404, 'notFound');
  };

  return {
    name: 'sounan-dev-community-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.endsWith('/api/index.php')) return next();
        void handle(req, url)
          .then(([status, body]) => [status, body] as const)
          .catch((e: unknown) => (e instanceof Fail ? ([e.status, { error: e.code }] as const) : ([500, { error: 'server' }] as const)))
          .then(([status, body]) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(body));
          });
      });
    },
  };
}
