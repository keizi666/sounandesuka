<?php
/**
 * 「みんなの遭難記録」API（docs/20_community.md §3）。?a=<操作> で振り分ける。
 * 利用者はパスワードなしの端末トークン（見出し X-Sounan-Token）で見分ける。トークンはハッシュにして持つ。
 * 開発用の模擬（tools/devApi.ts）も同じ動きにすること。
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

/** 指定がないときに読む件数と、一度に読める最大の件数 */
const LIST_DEFAULT = 20;
const LIST_MAX = 50;

/** 公開しているシナリオの一覧（../scenarios/index.json）。題名はここから取る（送られた題名は使わない） */
function scenario_titles(): array
{
  static $titles = null;
  if ($titles !== null) return $titles;
  $titles = [];
  $raw = @file_get_contents(__DIR__ . '/../scenarios/index.json');
  $j = $raw === false ? null : json_decode($raw, true);
  if (is_array($j)) foreach ($j as $e) if (is_array($e) && isset($e['id'], $e['title'])) $titles[(string) $e['id']] = (string) $e['title'];
  return $titles;
}

/** 共有のカードの説明文。合わない（長い・URL・禁止語）ときは捨てる（共有そのものは止めない） */
function share_text(string $s): string
{
  $s = trim((string) preg_replace('/\s+/u', ' ', $s));
  if ($s === '' || !mb_check_encoding($s, 'UTF-8') || mb_strlen($s, 'UTF-8') > SHARE_TEXT_MAX) return '';
  if (preg_match(CTRL_RE, $s) || preg_match(URL_RE, $s) || has_ng_word($s)) return '';
  return $s;
}

function num($v, float $lo, float $hi): float
{
  if (!is_int($v) && !is_float($v)) fail(400, 'invalid');
  $f = (float) $v;
  if (!is_finite($f) || $f < $lo || $f > $hi) fail(400, 'invalid');
  return $f;
}

/** 記録の要約を確かめて、保存する形にする */
function summary_input(array $s): array
{
  $id = (string) ($s['scenarioId'] ?? '');
  if (!preg_match('/^[a-z0-9_]{1,64}$/', $id)) fail(400, 'invalid');
  $titles = scenario_titles();
  if ($titles !== [] && !isset($titles[$id])) fail(400, 'invalid');
  $ending = (string) ($s['ending'] ?? '');
  if (!in_array($ending, ENDINGS, true)) fail(400, 'invalid');
  $decisions = [];
  foreach (array_slice(is_array($s['decisions'] ?? null) ? $s['decisions'] : [], 0, 40) as $d) {
    if (!is_array($d)) fail(400, 'invalid');
    $decisions[] = [
      'tMin' => num($d['tMin'] ?? null, 0, 60 * 24 * 30),
      'title' => check_text((string) ($d['title'] ?? ''), 80, 1, true),
      'label' => check_text((string) ($d['label'] ?? ''), 80, 1, true),
      'auto' => (bool) ($d['auto'] ?? false),
    ];
  }
  return [
    'scenarioId' => $id,
    'scenarioTitle' => $titles[$id] ?? check_text((string) ($s['scenarioTitle'] ?? ''), 60, 1, false),
    'ending' => $ending,
    'endingTitle' => check_text((string) ($s['endingTitle'] ?? ''), 40, 1, true),
    'durationMin' => num($s['durationMin'] ?? null, 0, 60 * 24 * 30),
    'distanceM' => num($s['distanceM'] ?? null, 0, 1000000),
    'minCoreC' => num($s['minCoreC'] ?? null, 0, 45),
    'partySize' => (int) num($s['partySize'] ?? null, 1, 99),
    'deaths' => (int) num($s['deaths'] ?? null, 0, 99),
    'decisions' => $decisions,
    'conditions' => (bool) ($s['conditions'] ?? false),
    // 遊んだ難しさ（ユーザーの指定: 記録のカードに出す）。ないとき・知らない値は入れない
    'difficulty' => in_array($s['difficulty'] ?? null, ['easy', 'normal', 'hard'], true) ? (string) $s['difficulty'] : null,
    'appVersion' => substr(preg_replace('/[^0-9A-Za-z.+*_-]/', '', (string) ($s['appVersion'] ?? '')) ?? '', 0, 40),
  ];
}

/** 記録の行を、返す形にする */
function run_out(array $r, ?array $me, bool $withRecord): array
{
  $o = json_decode((string) $r['summary'], true) ?: [];
  $o['id'] = (int) $r['id'];
  $o['user'] = ['id' => (int) $r['user_id'], 'nickname' => $r['nickname'], 'sex' => $r['sex'], 'age' => $r['age'], 'portrait' => $r['portrait'], 'color' => $r['color']];
  $o['comment'] = (string) $r['comment'];
  $o['createdAt'] = (string) $r['created_at'];
  $o['mine'] = $me !== null && (int) $me['id'] === (int) $r['user_id'];
  if ($withRecord) $o['record'] = (string) $r['record'];
  return $o;
}

const RUN_COLS = 'runs.id, runs.user_id, runs.summary, runs.comment, runs.created_at, users.nickname, users.sex, users.age, users.portrait, users.color';

try {
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  $a = (string) ($_GET['a'] ?? '');
  $pdo = db();

  if ($method === 'GET' && $a === 'list') {
    $me = current_user();
    $where = ['runs.hidden = 0'];
    $args = [];
    $scenario = (string) ($_GET['scenario'] ?? '');
    if ($scenario !== '') {
      $where[] = 'runs.scenario_id = ?';
      $args[] = $scenario;
    }
    $user = (int) ($_GET['user'] ?? 0);
    if ($user > 0) {
      $where[] = 'runs.user_id = ?';
      $args[] = $user;
    }
    $baseArgs = $args;
    $ending = (string) ($_GET['ending'] ?? '');
    $endWhere = $where;
    if ($ending !== '') {
      $endWhere[] = 'runs.ending = ?';
      $args[] = $ending;
    }
    $limit = max(1, min(LIST_MAX, (int) ($_GET['limit'] ?? LIST_DEFAULT)));
    $offset = max(0, (int) ($_GET['offset'] ?? 0));
    $w = implode(' AND ', $endWhere);
    $q = $pdo->prepare('SELECT ' . RUN_COLS . " FROM runs JOIN users ON users.id = runs.user_id WHERE $w ORDER BY runs.id DESC LIMIT $limit OFFSET $offset");
    $q->execute($args);
    $items = array_map(fn ($r) => run_out($r, $me, false), $q->fetchAll());
    $q = $pdo->prepare("SELECT COUNT(*) FROM runs WHERE $w");
    $q->execute($args);
    $total = (int) $q->fetchColumn();
    // 結末ごとの件数（結末での絞り込みの前の条件で）
    $q = $pdo->prepare('SELECT ending, COUNT(*) AS n FROM runs WHERE ' . implode(' AND ', $where) . ' GROUP BY ending');
    $q->execute($baseArgs);
    $counts = [];
    foreach ($q->fetchAll() as $r) $counts[$r['ending']] = (int) $r['n'];
    $q = $pdo->query('SELECT scenario_id, COUNT(*) AS n, MAX(summary) AS s FROM runs WHERE hidden = 0 GROUP BY scenario_id ORDER BY n DESC LIMIT 100');
    $scenarios = [];
    $titles = scenario_titles();
    foreach ($q->fetchAll() as $r) {
      $t = $titles[$r['scenario_id']] ?? ((json_decode((string) $r['s'], true) ?: [])['scenarioTitle'] ?? $r['scenario_id']);
      $scenarios[] = ['id' => $r['scenario_id'], 'title' => $t, 'n' => (int) $r['n']];
    }
    respond(200, ['items' => $items, 'total' => $total, 'counts' => $counts, 'scenarios' => $scenarios]);
  }

  if ($method === 'GET' && $a === 'stats') {
    // シナリオごとの集計（載せた記録だけ。隠した記録は数えない）。scenario を付けるとそのシナリオだけ
    $scenario = (string) ($_GET['scenario'] ?? '');
    $where = 'hidden = 0' . ($scenario !== '' ? ' AND scenario_id = ?' : '');
    $args = $scenario !== '' ? [$scenario] : [];
    $by = [];
    $q = $pdo->prepare("SELECT scenario_id, ending, COUNT(*) AS n FROM runs WHERE $where GROUP BY scenario_id, ending");
    $q->execute($args);
    foreach ($q->fetchAll() as $r) {
      $id = (string) $r['scenario_id'];
      if (!isset($by[$id])) $by[$id] = ['id' => $id, 'title' => $id, 'n' => 0, 'players' => 0, 'counts' => [], 'deathsAny' => 0];
      $by[$id]['counts'][(string) $r['ending']] = (int) $r['n'];
      $by[$id]['n'] += (int) $r['n'];
    }
    $q = $pdo->prepare("SELECT scenario_id, COUNT(DISTINCT user_id) AS p FROM runs WHERE $where GROUP BY scenario_id");
    $q->execute($args);
    foreach ($q->fetchAll() as $r) if (isset($by[$r['scenario_id']])) $by[$r['scenario_id']]['players'] = (int) $r['p'];
    // 亡くなった人が出た記録（要約の deaths）。SQLite に JSON の関数がなければ、PHP で要約を読む
    try {
      $q = $pdo->prepare("SELECT scenario_id, COUNT(*) AS d FROM runs WHERE $where AND CAST(json_extract(summary, '$.deaths') AS INTEGER) > 0 GROUP BY scenario_id");
      $q->execute($args);
      foreach ($q->fetchAll() as $r) if (isset($by[$r['scenario_id']])) $by[$r['scenario_id']]['deathsAny'] = (int) $r['d'];
    } catch (PDOException $e) {
      $q = $pdo->prepare("SELECT scenario_id, summary FROM runs WHERE $where");
      $q->execute($args);
      foreach ($q->fetchAll() as $r) {
        $s = json_decode((string) $r['summary'], true);
        if (isset($by[$r['scenario_id']]) && is_array($s) && (int) ($s['deaths'] ?? 0) > 0) $by[$r['scenario_id']]['deathsAny'] += 1;
      }
    }
    $titles = scenario_titles();
    foreach ($by as $id => $v) if (isset($titles[$id])) $by[$id]['title'] = $titles[$id];
    $out = array_values($by);
    usort($out, fn ($x, $y) => $y['n'] <=> $x['n']);
    respond(200, ['scenarios' => array_slice($out, 0, 100)]);
  }

  if ($method === 'GET' && $a === 'run') {
    $me = current_user();
    $q = $pdo->prepare('SELECT ' . RUN_COLS . ', runs.record, runs.hidden FROM runs JOIN users ON users.id = runs.user_id WHERE runs.id = ?');
    $q->execute([(int) ($_GET['id'] ?? 0)]);
    $r = $q->fetch();
    if ($r === false || ((int) $r['hidden'] === 1 && ($me === null || (int) $me['id'] !== (int) $r['user_id']))) fail(404, 'notFound');
    respond(200, ['run' => run_out($r, $me, true)]);
  }

  if ($method === 'GET' && $a === 'me') {
    respond(200, ['user' => public_user(require_user())]);
  }

  if ($method === 'GET' && $a === 'avatar') {
    // アップロードしたアイコンの画像。URL の v（版）が変わるので長く覚えさせてよい
    $q = $pdo->prepare('SELECT portrait FROM users WHERE id = ?');
    $q->execute([(int) ($_GET['u'] ?? 0)]);
    $portrait = $q->fetchColumn();
    $f = is_string($portrait) && str_starts_with($portrait, 'img:') ? avatar_file((int) ($_GET['u'] ?? 0)) : null;
    if ($f === null) fail(404, 'notFound');
    http_response_code(200);
    header('Content-Type: ' . (str_ends_with($f, '.webp') ? 'image/webp' : 'image/png'));
    header('Cache-Control: public, max-age=604800');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'");
    header('Content-Length: ' . filesize($f));
    readfile($f);
    exit;
  }

  if ($method === 'POST' && $a === 'register') {
    $p = profile_input(body(), null);
    rate_limit('reg', 5, 3600);
    $token = new_token();
    $t = now_iso();
    $pdo->prepare('INSERT INTO users (token_hash, nickname, sex, age, portrait, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      ->execute([token_hash($token), $p['nickname'], $p['sex'], $p['age'], $p['portrait'], $p['color'], $t, $t]);
    // ID は INSERT の直後に取る（hit() も hits に INSERT するので、あとで取るとそちらの番号になる）
    $p['id'] = (int) $pdo->lastInsertId();
    hit('reg');
    respond(200, ['user' => $p, 'token' => $token]);
  }

  if ($method === 'POST' && $a === 'profile') {
    $u = require_user();
    $p = profile_input(body(), $u);
    rate_limit('prof', 20, 3600);
    // 画像のアイコンをやめたら、画像を消す
    if (str_starts_with((string) $u['portrait'], 'img:') && !str_starts_with($p['portrait'], 'img:')) delete_avatar((int) $u['id']);
    $pdo->prepare('UPDATE users SET nickname = ?, sex = ?, age = ?, portrait = ?, color = ?, updated_at = ? WHERE id = ?')
      ->execute([$p['nickname'], $p['sex'], $p['age'], $p['portrait'], $p['color'], now_iso(), $u['id']]);
    hit('prof');
    $p['id'] = (int) $u['id'];
    respond(200, ['user' => $p]);
  }

  if ($method === 'POST' && $a === 'avatar') {
    // アイコンの画像を置く（端末で正方形に縮めたもの）。置いたらアイコンは画像になる
    $u = require_user();
    $b = body();
    rate_limit('avatar', 10, 3600);
    $v = store_avatar((int) $u['id'], (string) ($b['image'] ?? ''));
    hit('avatar');
    $pdo->prepare('UPDATE users SET portrait = ?, updated_at = ? WHERE id = ?')->execute(['img:' . $v, now_iso(), $u['id']]);
    $u['portrait'] = 'img:' . $v;
    respond(200, ['user' => public_user($u)]);
  }

  if ($method === 'POST' && $a === 'post') {
    $u = require_user();
    $b = body();
    $summary = summary_input(is_array($b['summary'] ?? null) ? $b['summary'] : []);
    $comment = check_text((string) ($b['comment'] ?? ''), COMMENT_MAX, COMMENT_MAX_LINES, true);
    $record = (string) ($b['record'] ?? '');
    if (strlen($record) > RECORD_MAX_BYTES) fail(413, 'tooLarge');
    $bin = base64_decode($record, true);
    // gzip の先頭（1f 8b）であること
    if ($bin === false || strlen($bin) < 18 || substr($bin, 0, 2) !== "\x1f\x8b") fail(400, 'invalid');
    rate_limit('post', 1, 60);
    rate_limit('postday', 30, 86400);
    $pdo->prepare('INSERT INTO runs (user_id, scenario_id, ending, summary, comment, record, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      ->execute([$u['id'], $summary['scenarioId'], $summary['ending'], json_encode($summary, JSON_UNESCAPED_UNICODE), $comment, $record, now_iso(), ip_hash()]);
    // ID は INSERT の直後に取る（hit() も hits に INSERT するので、あとで取るとそちらの番号になり、投稿直後の「載せた記録を見る」が見つからなかった）
    $id = (int) $pdo->lastInsertId();
    hit('post');
    hit('postday');
    respond(200, ['id' => $id]);
  }

  if ($method === 'POST' && $a === 'delete') {
    $u = require_user();
    $id = (int) (body()['id'] ?? 0);
    $q = $pdo->prepare('DELETE FROM runs WHERE id = ? AND user_id = ?');
    $q->execute([$id, $u['id']]);
    if ($q->rowCount() === 0) fail(404, 'notFound');
    respond(200, ['ok' => true]);
  }

  if ($method === 'POST' && $a === 'forget') {
    // 自分のプロフィールと記録をすべて消す（runs は ON DELETE CASCADE。念のため先に消す）
    $u = require_user();
    body();
    $pdo->prepare('DELETE FROM runs WHERE user_id = ?')->execute([$u['id']]);
    $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$u['id']]);
    delete_avatar((int) $u['id']);
    respond(200, ['ok' => true]);
  }

  // 共有の短い URL を作る（ユーザーの指定: 場面の長い URL では X などでカードが出ない）。
  // target は遊ぶ画面の URL の ? から後ろ（scenario=… か brief=…）。同じ target には同じ鍵を返す。開くのは s.php?k=…
  if ($method === 'POST' && $a === 'share') {
    $b = body();
    rate_limit('share', 120, 3600);
    $target = (string) ($b['target'] ?? '');
    if (strlen($target) > SHARE_TARGET_MAX || !preg_match('/^\?[A-Za-z0-9_=&%.~-]+$/', $target)) fail(400, 'invalid');
    parse_str(substr($target, 1), $qs);
    $sid = (string) ($qs['scenario'] ?? $qs['brief'] ?? '');
    if (!preg_match('/^[a-z0-9_]{1,64}$/', $sid)) fail(400, 'invalid');
    $idx = scenario_index();
    if ($idx !== [] && !isset($idx[$sid])) fail(400, 'invalid');
    $text = share_text((string) ($b['text'] ?? ''));
    $pdo = db();
    $q = $pdo->prepare('SELECT k FROM shares WHERE target = ?');
    $q->execute([$target]);
    $k = $q->fetchColumn();
    if ($k === false) {
      hit('share');
      for ($i = 0; $i < 5 && $k === false; $i++) {
        $try = share_key();
        try {
          $pdo->prepare('INSERT INTO shares (k, target, scenario_id, text, created_at) VALUES (?, ?, ?, ?, ?)')->execute([$try, $target, $sid, $text, now_iso()]);
          $k = $try;
        } catch (PDOException $e) {
          $k = false;
        }
      }
      if ($k === false) fail(500, 'server');
    } elseif ($text !== '') {
      // 同じ場面をまた共有した: 説明文は新しいものにする
      $pdo->prepare('UPDATE shares SET text = ? WHERE k = ?')->execute([$text, $k]);
    }
    // 場面リンクのカードの画像（ユーザーの指定: 題・メンバー・状況を描いたサムネイル）。置けなくても共有は止めない
    $img = (string) ($b['image'] ?? '');
    if ($img !== '') {
      rate_limit('shareimg', 60, 3600);
      if (store_share_image((string) $k, $img)) hit('shareimg');
    }
    respond(200, ['k' => (string) $k]);
  }

  if ($method === 'POST' && $a === 'report') {
    $id = (int) (body()['id'] ?? 0);
    rate_limit('rep', 30, 86400);
    $q = $pdo->prepare('INSERT OR IGNORE INTO reports (run_id, ip_hash, created_at) SELECT id, ?, ? FROM runs WHERE id = ?');
    $q->execute([ip_hash(), now_iso(), $id]);
    if ($q->rowCount() > 0) {
      hit('rep');
      $pdo->prepare('UPDATE runs SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?')->execute([REPORT_HIDE, $id]);
    }
    respond(200, ['ok' => true]);
  }

  fail(404, 'notFound');
} catch (Throwable $e) {
  error_log('sounan api: ' . $e->getMessage());
  fail(500, 'server');
}
