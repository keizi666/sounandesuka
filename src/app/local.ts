/**
 * 手元の開発環境か（シナリオの作成・編集は localhost だけで動かす。ユーザーの指定）。
 * 公開したサイトではエディターを開けず、タイトルからの入口も出さない。
 */
export function isLocalHost(host: string = location.hostname): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}
