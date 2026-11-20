<?php
/**
 * 「みんなの遭難記録」の管理ページ（docs/20_community.md §5）。
 * 管理トークン（deploy.config.json の api.adminToken。git に入れない）を入れると、新しい順の投稿・通報の数が見え、
 * 隠す・戻す・消すができる。トークンはブラウザに残さず、操作のたびに送る（フォームの隠し欄）。
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

function h(string $s): string
{
  return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

$cfg = config();
$token = (string) ($_POST['token'] ?? '');
$ok = false;
$msg = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  rate_limit('admfail', 10, 3600);
  $hash = (string) ($cfg['adminTokenHash'] ?? '');
  $ok = $hash !== '' && $token !== '' && hash_equals($hash, hash('sha256', $token));
  if (!$ok) {
    hit('admfail');
    $msg = 'トークンが違います';
  } else {
    $id = (int) ($_POST['id'] ?? 0);
    $op = (string) ($_POST['op'] ?? '');
    $pdo = db();
    if ($op === 'hide') $pdo->prepare('UPDATE runs SET hidden = 1 WHERE id = ?')->execute([$id]);
    if ($op === 'show') $pdo->prepare('UPDATE runs SET hidden = 0, reports = 0 WHERE id = ?')->execute([$id]);
    if ($op === 'show') $pdo->prepare('DELETE FROM reports WHERE run_id = ?')->execute([$id]);
    if ($op === 'delete') $pdo->prepare('DELETE FROM runs WHERE id = ?')->execute([$id]);
    if ($op === 'deluser') {
      $pdo->prepare('DELETE FROM runs WHERE user_id = ?')->execute([$id]);
      $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    }
    if ($op !== '' && $op !== 'list') $msg = "{$op} #{$id} を行いました";
  }
}
send_headers('text/html; charset=utf-8');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
$only = (string) ($_POST['only'] ?? '');
?>
<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>みんなの遭難記録 — 管理</title>
<style>
body { font-family: system-ui, sans-serif; background: #1d2127; color: #e8e6e1; margin: 0; padding: 16px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
td, th { border-bottom: 1px solid #3d444f; padding: 6px; text-align: left; vertical-align: top; }
tr.hidden td { opacity: 0.55; }
input, button, select { font: inherit; padding: 4px 8px; }
.msg { color: #facc15; }
form.inline { display: inline; }
</style></head>
<body>
<h1>みんなの遭難記録 — 管理</h1>
<?php if ($msg !== ''): ?><p class="msg"><?= h($msg) ?></p><?php endif; ?>
<?php if (!$ok): ?>
<form method="post"><input type="password" name="token" placeholder="管理トークン" autocomplete="off" required> <input type="hidden" name="op" value="list"><button>開く</button></form>
<?php else:
  $where = $only === 'reported' ? 'WHERE runs.reports > 0 OR runs.hidden = 1' : '';
  $rows = db()->query("SELECT runs.id, runs.user_id, runs.scenario_id, runs.ending, runs.comment, runs.created_at, runs.reports, runs.hidden, users.nickname FROM runs JOIN users ON users.id = runs.user_id $where ORDER BY runs.id DESC LIMIT 200")->fetchAll();
  $act = function (string $op, int $id, string $label) use ($token, $only): string {
    return '<form class="inline" method="post"><input type="hidden" name="token" value="' . h($token) . '"><input type="hidden" name="only" value="' . h($only) . '"><input type="hidden" name="op" value="' . h($op) . '"><input type="hidden" name="id" value="' . $id . '"><button>' . h($label) . '</button></form>';
  };
?>
<form method="post"><input type="hidden" name="token" value="<?= h($token) ?>"><input type="hidden" name="op" value="list">
<select name="only"><option value="">すべて（新しい 200 件）</option><option value="reported"<?= $only === 'reported' ? ' selected' : '' ?>>通報あり・隠したもの</option></select> <button>表示</button></form>
<table>
<tr><th>#</th><th>日時</th><th>利用者</th><th>シナリオ・結末</th><th>感想</th><th>通報</th><th>操作</th></tr>
<?php foreach ($rows as $r): ?>
<tr class="<?= (int) $r['hidden'] === 1 ? 'hidden' : '' ?>">
<td><?= (int) $r['id'] ?></td><td><?= h((string) $r['created_at']) ?></td>
<td><?= h((string) $r['nickname']) ?> (#<?= (int) $r['user_id'] ?>)</td>
<td><?= h((string) $r['scenario_id']) ?><br><?= h((string) $r['ending']) ?></td>
<td><?= nl2br(h((string) $r['comment'])) ?></td>
<td><?= (int) $r['reports'] ?><?= (int) $r['hidden'] === 1 ? '（隠している）' : '' ?></td>
<td><?= (int) $r['hidden'] === 1 ? $act('show', (int) $r['id'], '戻す') : $act('hide', (int) $r['id'], '隠す') ?> <?= $act('delete', (int) $r['id'], '消す') ?> <?= $act('deluser', (int) $r['user_id'], '利用者ごと消す') ?></td>
</tr>
<?php endforeach; ?>
</table>
<?php endif; ?>
</body>
</html>
