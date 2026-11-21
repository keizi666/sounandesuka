<?php
/**
 * 共有の短い URL（ユーザーの指定: 場面の長い URL では X などでリンクのカードが出ない）。s.php?k=<鍵>
 * X・Facebook などの取りに来たものには、シナリオの題・説明・サムネイルのカード（OGP）を返し、
 * 人はそのまま遊ぶ画面の元の URL（場面・説明の画面）へ移る。鍵は index.php の share で作る
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

/** 公開先のトップ（/sounandesuyo/）。この PHP は <base>/api/s.php */
$base = rtrim(str_replace('\\', '/', dirname(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/api/s.php')))), '/') . '/';
$host = preg_replace('/[^A-Za-z0-9.:-]/', '', (string) ($_SERVER['HTTP_HOST'] ?? 'localhost')) ?? 'localhost';
$https = ($_SERVER['HTTPS'] ?? '') === 'on' || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https' || !str_starts_with($host, 'localhost');
$origin = ($https ? 'https://' : 'http://') . $host;

$k = (string) ($_GET['k'] ?? '');
$row = null;
if (preg_match('/^[A-Za-z0-9]{4,16}$/', $k)) {
  $q = db()->prepare('SELECT * FROM shares WHERE k = ?');
  $q->execute([$k]);
  $row = $q->fetch() ?: null;
}
if ($row === null) {
  // 見つからない鍵はトップへ
  header('Location: ' . $base, true, 302);
  exit;
}
db()->prepare('UPDATE shares SET opened = opened + 1 WHERE k = ?')->execute([$k]);

$target = (string) $row['target'];
$sid = (string) $row['scenario_id'];
$e = scenario_index()[$sid] ?? null;
$title = is_array($e) ? (string) $e['title'] : '遭難ですよ';
$sub = is_array($e) ? (string) ($e['subtitle'] ?? '') : '';
$text = (string) $row['text'];
$isScene = str_contains($target, 'st=');
$desc = $text !== '' ? $text : ($isScene ? "「{$title}」のこの場面から、同じ選択で続きを見られます。" : ($sub !== '' ? $sub : '山岳遭難の推移を、3D の箱庭で見守るシミュレーション。'));
// サムネイル: シナリオのファイルと同じフォルダの thumbs/<ID>.jpg。なければサービスのカード
$img = $origin . $base . 'og-card.jpg';
$imgW = 1200;
$imgH = 630;
if (is_array($e)) {
  $file = (string) ($e['bundle'] ?? $e['file'] ?? '');
  $dir = dirname($file) === '.' ? '' : dirname($file) . '/';
  $rel = 'scenarios/' . $dir . 'thumbs/' . $sid . '.jpg';
  if (preg_match('/^[a-z0-9_\/.]+$/', $rel) && is_file(__DIR__ . '/../' . $rel)) {
    $img = $origin . $base . $rel;
    $imgW = 960;
    $imgH = 560;
  }
}
$to = $base . $target;
$self = $origin . $base . 'api/s.php?k=' . $k;
$h = fn (string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
$pageTitle = "{$title} — 遭難ですよ";

http_response_code(200);
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: public, max-age=300');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
?><!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title><?= $h($pageTitle) ?></title>
<meta name="description" content="<?= $h($desc) ?>" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="遭難ですよ" />
<meta property="og:title" content="<?= $h($pageTitle) ?>" />
<meta property="og:description" content="<?= $h($desc) ?>" />
<meta property="og:url" content="<?= $h($self) ?>" />
<meta property="og:image" content="<?= $h($img) ?>" />
<meta property="og:image:width" content="<?= $imgW ?>" />
<meta property="og:image:height" content="<?= $imgH ?>" />
<meta property="og:locale" content="ja_JP" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="<?= $h($pageTitle) ?>" />
<meta name="twitter:description" content="<?= $h($desc) ?>" />
<meta name="twitter:image" content="<?= $h($img) ?>" />
<meta http-equiv="refresh" content="0; url=<?= $h($to) ?>" />
<script>location.replace(<?= json_encode($to, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>);</script>
<style>body{background:#15181d;color:#e9ecf1;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}a{color:#f1d9a4}</style>
</head>
<body><p><a href="<?= $h($to) ?>"><?= $h($pageTitle) ?> を開く</a></p></body>
</html>
