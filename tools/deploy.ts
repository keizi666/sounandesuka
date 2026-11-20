// npm run deploy [-- --with-real-data] [--dry-run]
//
// 公開用にビルドして、サーバーへ SSH（scp）で上げる。設定はリポジトリに入れない deploy.config.json に書く
// （書き方は deploy.config.example.json）。パスワードは ssh・scp が聞いてくるので、その場で入れる（SSH 鍵を登録しておけば聞かれない）。
//
// - ビルドのベースパスは設定の base（例: /sounandesuyo/）
// - 実在の山の地形データ（*.sounan.json。地理院の標高・OSM 由来）は、権利の確認が済むまで上げない。上げるときは --with-real-data
// - --dry-run: ビルドと、上げるファイルの一覧だけ（サーバーにはつながない）
// - 「みんなの遭難記録」の API（server/api の PHP）を dist/api に写し、設定 config.local.php を作って一緒に上げる（docs/20_community.md §5）。
//   塩と管理トークンが deploy.config.json になければ作って書き足す（deploy.config.json は git に入れない）
// Windows 10 以降に入っている OpenSSH（ssh・scp）を使う。新しい依存は足さない。
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

interface DeployConfig {
  /** サーバーの名前（例: example.sakura.ne.jp） */
  host: string;
  /** SSH のユーザー名 */
  user: string;
  /** 置く場所（サーバーの絶対パス） */
  remoteDir: string;
  /** 公開する URL のパス（例: /sounandesuyo/） */
  base: string;
  /** SSH のポート（省略は 22） */
  port?: number;
  /** 「みんなの遭難記録」の API の設定（docs/20_community.md §5） */
  api?: {
    /** データベースを置くサーバーの絶対パス。公開フォルダーの外がよい（省略は remoteDir/api/data。.htaccess で読めなくする） */
    dataDir?: string;
    /** IP アドレスとトークンのハッシュに混ぜる塩（なければ作る） */
    salt?: string;
    /** 管理ページ（api/admin.php）に入るトークン（なければ作る） */
    adminToken?: string;
    /** false で API を上げない */
    enabled?: boolean;
  };
}

const ROOT = resolve(import.meta.dirname, '..');
const args = new Set(process.argv.slice(2));
const withReal = args.has('--with-real-data');
const dry = args.has('--dry-run');

const cfgPath = join(ROOT, 'deploy.config.json');
if (!existsSync(cfgPath)) {
  console.error('deploy.config.json がありません。deploy.config.example.json を写して、サーバーの情報を書いてください。');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as DeployConfig;
for (const k of ['host', 'user', 'remoteDir', 'base'] as const) {
  if (!cfg[k]) {
    console.error(`deploy.config.json に ${k} がありません`);
    process.exit(1);
  }
}
const base = cfg.base.endsWith('/') ? cfg.base : `${cfg.base}/`;
const remoteDir = cfg.remoteDir.replace(/\/+$/, '');
if (!remoteDir.startsWith('/') || /['"`$;&|]/.test(remoteDir)) {
  console.error('remoteDir は記号を含まない絶対パスにしてください');
  process.exit(1);
}

function run(cmd: string, cmdArgs: string[]): void {
  console.log(`> ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' && cmd === 'npx' });
  if (r.status !== 0) {
    console.error(`失敗しました（${cmd}、終了コード ${r.status ?? r.error?.message}）`);
    process.exit(1);
  }
}

// 1) ビルド
run('npx', ['vite', 'build', `--base=${base}`]);
const dist = join(ROOT, 'dist');

// 2) 実在の山の地形データを外す（権利の確認が済むまで）
if (!withReal) {
  let removed = 0;
  for (const dir of ['scenarios/real', 'scenarios/historical']) {
    const d = join(dist, dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (f.endsWith('.sounan.json') || f.endsWith('.hakoniwa.json')) {
        rmSync(join(d, f));
        removed += 1;
      }
    }
    const thumbs = join(d, 'thumbs');
    if (existsSync(thumbs)) rmSync(thumbs, { recursive: true });
  }
  console.log(`実在の山の地形データ ${removed} 件を外しました（上げるときは --with-real-data）`);
}

// 3) 「みんなの遭難記録」の API（PHP）と、その設定
if (cfg.api?.enabled !== false) {
  const api = { ...cfg.api };
  let changed = false;
  if (!api.salt) {
    api.salt = randomBytes(24).toString('base64url');
    changed = true;
  }
  if (!api.adminToken) {
    api.adminToken = randomBytes(18).toString('base64url');
    changed = true;
  }
  // --dry-run では設定を書き換えない（その回だけの値で作る）
  if (changed && !dry) {
    writeFileSync(cfgPath, `${JSON.stringify({ ...cfg, api }, null, 2)}\n`);
    console.log('deploy.config.json に API の塩と管理トークンを書き足しました（git に入れないこと。管理ページに入るときは api.adminToken を使う）');
  }
  const dataDir = (api.dataDir ?? `${remoteDir}/api/data`).replace(/\/+$/, '');
  // PHP の文字列にそのまま入れるので、使える文字を限る
  const safe = /^[A-Za-z0-9_./-]+$/;
  if (!dataDir.startsWith('/') || !safe.test(dataDir) || !safe.test(api.salt)) {
    console.error('api.dataDir は英数字と / . _ - だけの絶対パスに、api.salt は英数字と _ - だけにしてください');
    process.exit(1);
  }
  cpSync(join(ROOT, 'server', 'api'), join(dist, 'api'), { recursive: true });
  const adminHash = createHash('sha256').update(api.adminToken).digest('hex');
  writeFileSync(
    join(dist, 'api', 'config.local.php'),
    `<?php\n// npm run deploy が deploy.config.json から作る。git に入れない\nreturn ['dataDir' => '${dataDir}', 'salt' => '${api.salt}', 'adminTokenHash' => '${adminHash}'];\n`,
  );
  console.log(`API を dist/api に入れました（データ: ${dataDir}、管理ページ: ${base}api/admin.php）`);
}

// 4) 上げるもの
const entries = readdirSync(dist).map((e) => join('dist', e));
const sizeOf = (p: string): number => (statSync(p).isDirectory() ? readdirSync(p).reduce((s, e) => s + sizeOf(join(p, e)), 0) : statSync(p).size);
console.log(`上げるもの: ${entries.length} 項目、${(sizeOf(dist) / 1024 / 1024).toFixed(1)} MB → ${cfg.user}@${cfg.host}:${remoteDir}/（URL のパス ${base}）`);
if (dry) {
  console.log('--dry-run なので、サーバーにはつないでいません');
  process.exit(0);
}

// 5) サーバーに置き場所を作り、scp で送る
const target = `${cfg.user}@${cfg.host}`;
const portSsh = cfg.port ? ['-p', String(cfg.port)] : [];
const portScp = cfg.port ? ['-P', String(cfg.port)] : [];
run('ssh', [...portSsh, target, `mkdir -p '${remoteDir}'`]);
run('scp', [...portScp, '-r', '-C', ...entries, `${target}:${remoteDir}/`]);
console.log(`上げ終わりました。ブラウザで確かめてください（${base}）`);
