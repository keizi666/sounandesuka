<?php
/**
 * 「みんなの遭難記録」API の共通部分（docs/20_community.md）。
 * 設定は同じフォルダーの config.local.php（デプロイのときに deploy.config.json から作る。git に入れない）。
 * 投稿の決まりの数値は src/net/rules.ts と同じにすること。
 */
declare(strict_types=1);

const NICK_MAX = 12;
const COMMENT_MAX = 200;
const COMMENT_MAX_LINES = 6;
const RECORD_MAX_BYTES = 600000;
const REPORT_HIDE = 3;
const BODY_MAX_BYTES = 800000;
const SEXES = ['m', 'f', 'x'];
const AGE_BANDS = ['10', '20', '30', '40', '50', '60', '70', 'x'];
const ENDINGS = ['SAFE_RETURN', 'SAFE_SHELTER', 'ABORTED', 'SELF_RESCUE', 'RESCUED', 'RESCUED_CRITICAL', 'MISSING', 'FATAL'];
// 「少しねむい」のように普通の文に出る並び（しね・がいじ など）は入れない（src/net/rules.ts と同じ）
const NG_WORDS = [
  '死ね', '氏ね', '殺すぞ', 'ころすぞ', '殺してやる', 'ころしてやる', 'キモい', 'ガイジ',
  'ちんこ', 'ちんぽ', 'まんこ', 'セックス', 'せっくす', 'fuck', 'shit', 'bitch', 'nigger',
];
const URL_RE = '/(https?:|www\.|[a-z0-9-]+\.(com|net|org|jp|io|co|xyz|info|biz|me|ly|ru|cn|top|site|app|dev)\b)/iu';
const CTRL_RE = '/[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}]/u';

/** 送るときの見出し（どの応答にも付ける） */
function send_headers(string $type = 'application/json; charset=utf-8'): void
{
  header('Content-Type: ' . $type);
  header('Cache-Control: no-store');
  header('X-Content-Type-Options: nosniff');
  header('Referrer-Policy: same-origin');
  header('X-Frame-Options: DENY');
}

/** JSON で返して終わる */
function respond(int $status, array $body): void
{
  http_response_code($status);
  send_headers();
  echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function fail(int $status, string $code): void
{
  respond($status, ['error' => $code]);
}

/** 設定（config.local.php）を読む */
function config(): array
{
  static $cfg = null;
  if ($cfg !== null) return $cfg;
  $path = __DIR__ . '/config.local.php';
  if (!is_file($path)) fail(503, 'config');
  $c = require $path;
  if (!is_array($c) || empty($c['salt']) || empty($c['dataDir'])) fail(503, 'config');
  $cfg = $c;
  return $cfg;
}

/** データベース（SQLite。初めてのときに表を作る） */
function db(): PDO
{
  static $pdo = null;
  if ($pdo !== null) return $pdo;
  $dir = rtrim((string) config()['dataDir'], '/');
  if (!is_dir($dir) && !@mkdir($dir, 0700, true)) fail(503, 'config');
  // 公開フォルダーの中に置いた場合のために、念のため直接読めなくする
  if (!is_file($dir . '/.htaccess')) @file_put_contents($dir . '/.htaccess', "Require all denied\n");
  $pdo = new PDO('sqlite:' . $dir . '/sounan.sqlite', null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);
  $pdo->exec('PRAGMA journal_mode = WAL');
  $pdo->exec('PRAGMA busy_timeout = 3000');
  $pdo->exec('PRAGMA foreign_keys = ON');
  $pdo->exec(<<<SQL
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL, sex TEXT NOT NULL, age TEXT NOT NULL, portrait TEXT NOT NULL, color TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scenario_id TEXT NOT NULL, ending TEXT NOT NULL,
      summary TEXT NOT NULL, comment TEXT NOT NULL, record TEXT NOT NULL,
      created_at TEXT NOT NULL, ip_hash TEXT NOT NULL,
      reports INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS runs_scenario ON runs (scenario_id, id);
    CREATE INDEX IF NOT EXISTS runs_user ON runs (user_id, id);
    CREATE TABLE IF NOT EXISTS reports (
      run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE, ip_hash TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, ip_hash)
    );
    CREATE TABLE IF NOT EXISTS hits (ip_hash TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS hits_key ON hits (ip_hash, kind, at);
  SQL);
  return $pdo;
}

function now_iso(): string
{
  return gmdate('Y-m-d\TH:i:s\Z');
}

/** IP アドレスは塩を混ぜたハッシュにして持つ（そのままは残さない） */
function ip_hash(): string
{
  $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
  return substr(hash('sha256', config()['salt'] . '|ip|' . $ip), 0, 32);
}

function token_hash(string $token): string
{
  return hash('sha256', config()['salt'] . '|tk|' . $token);
}

/** 引き継ぎコードにもなるトークン（24 文字。読み違えやすい I L O U を使わない） */
function new_token(): string
{
  $abc = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  $s = '';
  foreach (str_split(random_bytes(24)) as $b) $s .= $abc[ord($b) & 31];
  return $s;
}

/** 送られたトークンを正規化（ハイフン・空白を除き、大文字に） */
function clean_token(?string $t): string
{
  $t = strtoupper(preg_replace('/[^0-9A-Za-z]/', '', (string) $t) ?? '');
  return strlen($t) === 24 ? $t : '';
}

/**
 * 回数の制限。kind ごとに、window 秒の間に max 回まで。超えたら 429 で終わる。
 * 古い記録はときどき消す。
 */
function rate_limit(string $kind, int $max, int $window): void
{
  $pdo = db();
  $ip = ip_hash();
  $t = time();
  if (random_int(0, 49) === 0) $pdo->prepare('DELETE FROM hits WHERE at < ?')->execute([$t - 2 * 86400]);
  $q = $pdo->prepare('SELECT COUNT(*) FROM hits WHERE ip_hash = ? AND kind = ? AND at > ?');
  $q->execute([$ip, $kind, $t - $window]);
  if ((int) $q->fetchColumn() >= $max) fail(429, 'rate');
}

function hit(string $kind): void
{
  db()->prepare('INSERT INTO hits (ip_hash, kind, at) VALUES (?, ?, ?)')->execute([ip_hash(), $kind, time()]);
}

/** 比べるための正規化（全角英数を半角に、小文字に、空白を詰める） */
function normalize_text(string $s): string
{
  if (class_exists('Normalizer')) $s = (string) Normalizer::normalize($s, Normalizer::FORM_KC);
  else $s = mb_convert_kana($s, 'asKV', 'UTF-8');
  return preg_replace('/\s+/u', '', mb_strtolower($s, 'UTF-8')) ?? '';
}

/** サーバーだけの NG ワード（dataDir/ngwords.txt。1 行に 1 語。git に入れない） */
function extra_ng_words(): array
{
  $f = rtrim((string) config()['dataDir'], '/') . '/ngwords.txt';
  if (!is_file($f)) return [];
  $lines = file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
  return array_values(array_filter(array_map('trim', $lines), fn ($w) => $w !== '' && $w[0] !== '#'));
}

function has_ng_word(string $s): bool
{
  $n = normalize_text($s);
  foreach (array_merge(NG_WORDS, extra_ng_words()) as $w) {
    $w = normalize_text($w);
    if ($w !== '' && str_contains($n, $w)) return true;
  }
  return false;
}

/** 文字列を確かめる。$max は文字数、$lines は改行を許す行数（1 = 改行なし）。問題があれば 400 で終わる */
function check_text(string $s, int $max, int $lines, bool $allowEmpty): string
{
  $s = trim(str_replace(["\r\n", "\r"], "\n", $s));
  if (!mb_check_encoding($s, 'UTF-8')) fail(400, 'badChar');
  if ($s === '') {
    if ($allowEmpty) return '';
    fail(400, 'nickEmpty');
  }
  if (mb_strlen($s, 'UTF-8') > $max) fail(400, $lines > 1 ? 'commentLong' : 'nickLong');
  if (substr_count($s, "\n") + 1 > $lines) fail(400, $lines > 1 ? 'commentLines' : 'badChar');
  if (preg_match(CTRL_RE, $s) || ($lines === 1 && preg_match('/[\n\t]/', $s))) fail(400, 'badChar');
  $nfkc = class_exists('Normalizer') ? (string) Normalizer::normalize($s, Normalizer::FORM_KC) : $s;
  if (preg_match(URL_RE, $nfkc)) fail(400, 'url');
  if (has_ng_word($s)) fail(400, 'ngWord');
  return $s;
}

/** 送られた JSON の本文 */
function body(): array
{
  $type = (string) ($_SERVER['CONTENT_TYPE'] ?? '');
  // application/json に限る（よそのサイトのフォームからは送れない）
  if (!str_starts_with(strtolower($type), 'application/json')) fail(415, 'invalid');
  $len = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
  if ($len > BODY_MAX_BYTES) fail(413, 'tooLarge');
  $raw = (string) file_get_contents('php://input', false, null, 0, BODY_MAX_BYTES + 1);
  if (strlen($raw) > BODY_MAX_BYTES) fail(413, 'tooLarge');
  $j = json_decode($raw, true);
  if (!is_array($j)) fail(400, 'invalid');
  return $j;
}

/** 見出しのトークンから利用者を探す（なければ null） */
function current_user(): ?array
{
  $t = clean_token($_SERVER['HTTP_X_SOUNAN_TOKEN'] ?? '');
  if ($t === '') return null;
  $q = db()->prepare('SELECT * FROM users WHERE token_hash = ?');
  $q->execute([token_hash($t)]);
  $u = $q->fetch();
  return $u === false ? null : $u;
}

function require_user(): array
{
  $u = current_user();
  if ($u === null) fail(401, 'auth');
  return $u;
}

function public_user(array $u): array
{
  return [
    'id' => (int) $u['id'], 'nickname' => $u['nickname'], 'sex' => $u['sex'], 'age' => $u['age'],
    'portrait' => $u['portrait'], 'color' => $u['color'],
  ];
}

/** プロフィールの入力を確かめる */
function profile_input(array $b): array
{
  $nick = check_text((string) ($b['nickname'] ?? ''), NICK_MAX, 1, false);
  $sex = (string) ($b['sex'] ?? 'x');
  $age = (string) ($b['age'] ?? 'x');
  $portrait = (string) ($b['portrait'] ?? '');
  $color = (string) ($b['color'] ?? '');
  if (!in_array($sex, SEXES, true) || !in_array($age, AGE_BANDS, true)) fail(400, 'invalid');
  if (!preg_match('/^(child|young|mid|senior)_[mf]:[1-9][0-9]{0,2}$/', $portrait)) fail(400, 'invalid');
  if (!preg_match('/^#[0-9a-fA-F]{6}$/', $color)) fail(400, 'invalid');
  return ['nickname' => $nick, 'sex' => $sex, 'age' => $age, 'portrait' => $portrait, 'color' => strtolower($color)];
}
