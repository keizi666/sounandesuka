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
/** アップロードしたアイコン: 一辺（px）と、送られる画像の最大バイト数（src/net/rules.ts と同じ） */
const AVATAR_PX = 256;
const AVATAR_MAX_BYTES = 200000;
// アイコンにできる絵文字（src/net/rules.ts の EMOJIS と同じ並び）
const EMOJIS = ['🏔️', '⛰️', '🗻', '🌋', '🏕️', '⛺', '🌲', '🌳', '🍁', '🍂', '🌸', '🌼', '🍄', '🌿', '🌾', '☀️', '⛅', '🌧️', '⛈️', '🌨️', '❄️', '⛄', '🌈', '🌙', '⭐', '⚡', '🌊', '💧', '🔥', '🐻', '🦊', '🐗', '🦌', '🐿️', '🐇', '🦅', '🦉', '🐦', '🐸', '🐟', '🦋', '🐱', '🐶', '🐧', '🐢', '🎒', '🥾', '🧭', '🗺️', '🔦', '⛑️', '🧗', '🚶', '📷', '🍙', '🍵', '☕', '🍫', '🙂', '😊', '😎', '🤔', '😴', '🥶', '💪', '👍', '❤️'];
const BODY_MAX_BYTES = 800000;
const SEXES = ['m', 'f', 'x'];
const AGE_BANDS = ['10', '20', '30', '40', '50', '60', '70', 'x'];
/** 共有の短い URL（ユーザーの指定: X などでリンクのカードが出るように）。鍵の長さと、元の URL（? から後ろ）・本文の上限 */
const SHARE_KEY_LEN = 8;
const SHARE_TARGET_MAX = 6000;
const SHARE_TEXT_MAX = 140;
/** 場面リンクのカードの画像（端末で作った 1200×630 の JPEG）の上限 */
const SHARE_IMAGE_MAX_BYTES = 500000;
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
    CREATE TABLE IF NOT EXISTS shares (
      k TEXT PRIMARY KEY, target TEXT NOT NULL UNIQUE, scenario_id TEXT NOT NULL, text TEXT NOT NULL,
      created_at TEXT NOT NULL, opened INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS hits_key ON hits (ip_hash, kind, at);
    CREATE TABLE IF NOT EXISTS likes (
      run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS likes_at ON likes (created_at);
    CREATE TABLE IF NOT EXISTS challenges (
      k TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scenario_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS challenges_user ON challenges (user_id);
    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      k TEXT NOT NULL REFERENCES challenges(k) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ending TEXT NOT NULL, ending_title TEXT NOT NULL, created_at TEXT NOT NULL, ip_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS answers_k ON answers (k, created_at);
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

/**
 * プロフィールの入力を確かめる。$current は今のプロフィール（作るときは null）。
 * アイコンの画像（img:<版>）は、別の操作（avatar）で置いたものをそのまま使うときだけ受け付ける。
 */
function profile_input(array $b, ?array $current): array
{
  $nick = check_text((string) ($b['nickname'] ?? ''), NICK_MAX, 1, false);
  $sex = (string) ($b['sex'] ?? 'x');
  $age = (string) ($b['age'] ?? 'x');
  $portrait = (string) ($b['portrait'] ?? '');
  $color = (string) ($b['color'] ?? '');
  if (!in_array($sex, SEXES, true) || !in_array($age, AGE_BANDS, true)) fail(400, 'invalid');
  $okPortrait = preg_match('/^(child|young|mid|senior)_[mf]:[1-9][0-9]{0,2}$/', $portrait) === 1
    || (str_starts_with($portrait, 'emoji:') && in_array(substr($portrait, 6), EMOJIS, true))
    || ($current !== null && preg_match('/^img:[0-9a-f]{10}$/', $portrait) === 1 && $portrait === $current['portrait']);
  if (!$okPortrait) fail(400, 'invalid');
  if (!preg_match('/^#[0-9a-fA-F]{6}$/', $color)) fail(400, 'invalid');
  return ['nickname' => $nick, 'sex' => $sex, 'age' => $age, 'portrait' => $portrait, 'color' => strtolower($color)];
}

/** アップロードしたアイコンの置き場所（dataDir/avatars） */
function avatar_dir(): string
{
  $d = rtrim((string) config()['dataDir'], '/') . '/avatars';
  if (!is_dir($d)) @mkdir($d, 0700, true);
  return $d;
}

/** 利用者のアイコンの画像ファイル（なければ null） */
function avatar_file(int $userId): ?string
{
  foreach (['webp', 'png'] as $ext) {
    $f = avatar_dir() . '/' . $userId . '.' . $ext;
    if (is_file($f)) return $f;
  }
  return null;
}

function delete_avatar(int $userId): void
{
  foreach (['webp', 'png'] as $ext) @unlink(avatar_dir() . '/' . $userId . '.' . $ext);
}

/**
 * 送られた画像を確かめ、正方形 AVATAR_PX に描き直して保存する（EXIF などの付帯情報はここで落ちる）。
 * 返り値は版の印（10 桁の 16 進）。画像を扱えないサーバーなら 503。
 */
function store_avatar(int $userId, string $b64): string
{
  if (strlen($b64) > AVATAR_MAX_BYTES * 2) fail(413, 'tooLarge');
  $bin = base64_decode($b64, true);
  if ($bin === false || strlen($bin) < 16) fail(400, 'invalid');
  if (strlen($bin) > AVATAR_MAX_BYTES) fail(413, 'tooLarge');
  if (!function_exists('imagecreatefromstring') || !function_exists('imagecopyresampled')) fail(503, 'noImage');
  $info = @getimagesizefromstring($bin);
  $types = [IMAGETYPE_PNG, IMAGETYPE_JPEG];
  if (defined('IMAGETYPE_WEBP')) $types[] = IMAGETYPE_WEBP;
  if ($info === false || !in_array($info[2], $types, true)) fail(400, 'badImage');
  [$w, $h] = [(int) $info[0], (int) $info[1]];
  if ($w < 32 || $h < 32 || $w > 1024 || $h > 1024) fail(400, 'badImage');
  $src = @imagecreatefromstring($bin);
  if ($src === false) fail(400, 'badImage');
  $dst = imagecreatetruecolor(AVATAR_PX, AVATAR_PX);
  imagealphablending($dst, false);
  imagesavealpha($dst, true);
  imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 0, 0, 0, 127));
  // 正方形でなければ真ん中を切り抜く（端末で切り抜いてあるので、ふつうは正方形）
  $side = min($w, $h);
  imagecopyresampled($dst, $src, 0, 0, intdiv($w - $side, 2), intdiv($h - $side, 2), AVATAR_PX, AVATAR_PX, $side, $side);
  imagedestroy($src);
  ob_start();
  $ext = function_exists('imagewebp') ? 'webp' : 'png';
  $ok = $ext === 'webp' ? imagewebp($dst, null, 84) : imagepng($dst, null, 9);
  $out = (string) ob_get_clean();
  imagedestroy($dst);
  if (!$ok || $out === '') fail(500, 'server');
  delete_avatar($userId);
  $f = avatar_dir() . '/' . $userId . '.' . $ext;
  if (file_put_contents($f . '.tmp', $out) === false || !rename($f . '.tmp', $f)) fail(500, 'server');
  return substr(sha1($out), 0, 10);
}

/** 共有の短い鍵（英数字。紛らわしい 0 O 1 l I は使わない） */
function share_key(): string
{
  $chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  $k = '';
  for ($i = 0; $i < SHARE_KEY_LEN; $i++) $k .= $chars[random_int(0, strlen($chars) - 1)];
  return $k;
}

/** 公開しているシナリオの一覧（../scenarios/index.json）。ID → 項目 */
function scenario_index(): array
{
  static $idx = null;
  if ($idx !== null) return $idx;
  $idx = [];
  $raw = @file_get_contents(__DIR__ . '/../scenarios/index.json');
  $j = $raw === false ? null : json_decode($raw, true);
  if (is_array($j)) foreach ($j as $e) if (is_array($e) && isset($e['id'], $e['title'])) $idx[(string) $e['id']] = $e;
  return $idx;
}

/** 共有のカードの画像を置くフォルダー（データの中。直接は読めない。s.php?img= で出す） */
function share_dir(): string
{
  $d = rtrim((string) config()['dataDir'], '/') . '/shares';
  if (!is_dir($d)) @mkdir($d, 0700, true);
  return $d;
}

/** 共有のカードの画像を確かめて、1200×630 の JPEG に描き直して置く（描き直すので、画像に紛れた別のデータは残らない）。置けなければ false */
function store_share_image(string $k, string $b64): bool
{
  if ($b64 === '' || strlen($b64) > SHARE_IMAGE_MAX_BYTES * 2) return false;
  $bin = base64_decode($b64, true);
  if ($bin === false || strlen($bin) < 16 || strlen($bin) > SHARE_IMAGE_MAX_BYTES) return false;
  if (!function_exists('imagecreatefromstring') || !function_exists('imagejpeg')) return false;
  $info = @getimagesizefromstring($bin);
  if ($info === false || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG], true)) return false;
  [$w, $h] = [(int) $info[0], (int) $info[1]];
  if ($w < 200 || $h < 100 || $w > 2400 || $h > 1400) return false;
  $src = @imagecreatefromstring($bin);
  if ($src === false) return false;
  $dst = imagecreatetruecolor(1200, 630);
  imagecopyresampled($dst, $src, 0, 0, 0, 0, 1200, 630, $w, $h);
  imagedestroy($src);
  ob_start();
  $ok = imagejpeg($dst, null, 84);
  $out = (string) ob_get_clean();
  imagedestroy($dst);
  if (!$ok || $out === '') return false;
  $f = share_dir() . '/' . $k . '.jpg';
  return file_put_contents($f . '.tmp', $out) !== false && rename($f . '.tmp', $f);
}
