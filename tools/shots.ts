// npm run shots -- <ラベル> [--quality high|mid|low] [--headed] [--url http://localhost:5281]
// 固定視点 3 つのスクリーンショットと FPS を取り、shots/<ラベル>/ に保存する（docs/19 §8）。
// 開発サーバー（npm run dev）が動いていること。ブラウザは手元の Chrome を使う（playwright-core。ブラウザ本体はダウンロードしない）。
// 2 つのラベルを比べるページ: npm run shots -- --compare <前> <後> → shots/compare-<前>-<後>.html
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from './lib/maps';

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? '') : null;
};
const PRESETS = ['overview', 'forest', 'ridge', 'stream'] as const;
const outRoot = resolve(ROOT, 'shots');

if (args[0] === '--compare') {
  const a = args[1];
  const b = args[2];
  if (!a || !b) throw new Error('使い方: npm run shots -- --compare <前のラベル> <後のラベル>');
  const fps = (l: string): string => (existsSync(resolve(outRoot, l, 'result.json')) ? readFileSync(resolve(outRoot, l, 'result.json'), 'utf8') : '{}');
  const rows = PRESETS.map((p) => `<h2>${p}</h2><div class="row"><figure><img src="${a}/${p}.jpg"><figcaption>${a}</figcaption></figure><figure><img src="${b}/${p}.jpg"><figcaption>${b}</figcaption></figure></div>`).join('\n');
  const html = `<!doctype html><meta charset="utf-8"><title>${a} → ${b}</title>
<style>body{background:#16181c;color:#ddd;font-family:system-ui;margin:16px}.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}img{width:100%;display:block}figure{margin:0}pre{white-space:pre-wrap;font-size:12px}</style>
<h1>${a} → ${b}</h1>${rows}<h2>計測</h2><div class="row"><pre>${fps(a)}</pre><pre>${fps(b)}</pre></div>`;
  const out = resolve(outRoot, `compare-${a}-${b}.html`);
  writeFileSync(out, html);
  console.log(out);
  process.exit(0);
}

const label = args[0] && !args[0].startsWith('--') ? args[0] : 'latest';
const quality = flag('quality') ?? 'high';
const base = flag('url') ?? 'http://localhost:5281';
const headed = args.includes('--headed');
const W = 1600;
const H = 900;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: !headed,
  // ヘッドレスでも実機の GPU を使う（ソフトウェア描画では FPS が参考にならない）
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', `--window-size=${W},${H}`],
});
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const logs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') logs.push(m.text());
  });
  page.on('pageerror', (e) => logs.push(String(e)));
  await page.goto(`${base}/shots.html?quality=${quality}`);
  await page.waitForFunction('window.__shots && (window.__shots.ready || window.__shots.error)', undefined, { timeout: 120000 });
  const err = await page.evaluate('window.__shots.error');
  if (err) throw new Error(`shots.html: ${String(err)}`);
  const dir = resolve(outRoot, label);
  mkdirSync(dir, { recursive: true });
  const result: Record<string, unknown> = { label, at: new Date().toISOString(), info: await page.evaluate('window.__shots.info()') };
  for (const p of PRESETS) {
    await page.evaluate(`window.__shots.setPreset('${p}')`);
    await page.waitForTimeout(150);
    await page.evaluate(`window.__shots.setPreset('${p}')`);
    await page.screenshot({ path: resolve(dir, `${p}.jpg`), type: 'jpeg', quality: 88 });
    result[p] = await page.evaluate('window.__shots.measure(90)');
  }
  if (logs.length > 0) result['errors'] = logs.slice(0, 10);
  writeFileSync(resolve(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
