// npm run deploy [-- --with-real-data] [--dry-run]
//
// 公開用にビルドして、サーバーへ SSH（scp）で上げる。設定はリポジトリに入れない deploy.config.json に書く
// （書き方は deploy.config.example.json）。パスワードは ssh・scp が聞いてくるので、その場で入れる（SSH 鍵を登録しておけば聞かれない）。
//
// - ビルドのベースパスは設定の base（例: /sounandesuka/）
// - 実在の山の地形データ（*.sounan.json。地理院の標高・OSM 由来）は、権利の確認が済むまで上げない。上げるときは --with-real-data
// - --dry-run: ビルドと、上げるファイルの一覧だけ（サーバーにはつながない）
// Windows 10 以降に入っている OpenSSH（ssh・scp）を使う。新しい依存は足さない。
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface DeployConfig {
  /** サーバーの名前（例: example.sakura.ne.jp） */
  host: string;
  /** SSH のユーザー名 */
  user: string;
  /** 置く場所（サーバーの絶対パス） */
  remoteDir: string;
  /** 公開する URL のパス（例: /sounandesuka/） */
  base: string;
  /** SSH のポート（省略は 22） */
  port?: number;
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

// 3) 上げるもの
const entries = readdirSync(dist).map((e) => join('dist', e));
const sizeOf = (p: string): number => (statSync(p).isDirectory() ? readdirSync(p).reduce((s, e) => s + sizeOf(join(p, e)), 0) : statSync(p).size);
console.log(`上げるもの: ${entries.length} 項目、${(sizeOf(dist) / 1024 / 1024).toFixed(1)} MB → ${cfg.user}@${cfg.host}:${remoteDir}/（URL のパス ${base}）`);
if (dry) {
  console.log('--dry-run なので、サーバーにはつないでいません');
  process.exit(0);
}

// 4) サーバーに置き場所を作り、scp で送る
const target = `${cfg.user}@${cfg.host}`;
const portSsh = cfg.port ? ['-p', String(cfg.port)] : [];
const portScp = cfg.port ? ['-P', String(cfg.port)] : [];
run('ssh', [...portSsh, target, `mkdir -p '${remoteDir}'`]);
run('scp', [...portScp, '-r', '-C', ...entries, `${target}:${remoteDir}/`]);
console.log(`上げ終わりました。ブラウザで確かめてください（${base}）`);
