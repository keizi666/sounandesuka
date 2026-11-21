/**
 * 場面リンクのカードの画像（ユーザーの指定: カードのサムネイルに、シナリオの題・メンバー・状況を入れる）。
 * いまの 3D の画面（UI なし）を背景に、題・日時・いまの状況・一人ひとりの様子を描いた 1200×630 の JPEG を作る。
 * 共有の短い URL を作るときにサーバーへ送り、s.php がカードの画像にする
 */
import { formatDateTime } from '../i18n/format';
import { JA } from '../i18n/ja';
import type { ScenarioDef, World } from '../sim/types';

const W = 1200;
const H = 630;
const FONT = `'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic UI', 'Yu Gothic', 'Meiryo', sans-serif`;

export interface CardInput {
  /** いまの 3D の画面（UI なし） */
  frame: CanvasImageSource & { width: number; height: number };
  scenario: ScenarioDef;
  world: World;
  /** いまの状況（ログのいちばん新しい大きな出来事・選んだこと） */
  situation: string[];
}

/** はみ出す文を「…」で詰める */
function fit(g: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (g.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

export function composeShareCard(o: CardInput): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // 背景: 3D の画面を切り抜いて敷く（足りなければ暗い色）
  g.fillStyle = '#15181d';
  g.fillRect(0, 0, W, H);
  const fw = o.frame.width;
  const fh = o.frame.height;
  if (fw > 0 && fh > 0) {
    const s = Math.max(W / fw, H / fh);
    const dw = fw * s;
    const dh = fh * s;
    g.drawImage(o.frame, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  // 文字が読めるよう、左と下を暗くする
  const lg = g.createLinearGradient(0, 0, W * 0.75, 0);
  lg.addColorStop(0, 'rgba(10, 12, 16, 0.86)');
  lg.addColorStop(0.55, 'rgba(10, 12, 16, 0.55)');
  lg.addColorStop(1, 'rgba(10, 12, 16, 0)');
  g.fillStyle = lg;
  g.fillRect(0, 0, W, H);
  const bg = g.createLinearGradient(0, H * 0.45, 0, H);
  bg.addColorStop(0, 'rgba(10, 12, 16, 0)');
  bg.addColorStop(1, 'rgba(10, 12, 16, 0.82)');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const x = 56;
  const maxW = W - x * 2;
  g.textBaseline = 'alphabetic';
  // サービス名の札
  g.font = `700 22px ${FONT}`;
  const tag = JA.app.title;
  const tw = g.measureText(tag).width;
  g.fillStyle = 'rgba(200, 160, 80, 0.95)';
  g.beginPath();
  g.roundRect(x, 40, tw + 28, 38, 19);
  g.fill();
  g.fillStyle = '#1d1a12';
  g.fillText(tag, x + 14, 67);
  // 題と日時
  g.fillStyle = '#ffffff';
  g.shadowColor = 'rgba(0, 0, 0, 0.6)';
  g.shadowBlur = 12;
  g.font = `800 64px ${FONT}`;
  g.fillText(fit(g, o.scenario.title, maxW), x, 156);
  g.shadowBlur = 6;
  g.font = `600 28px ${FONT}`;
  g.fillStyle = '#f1d9a4';
  g.fillText(fit(g, `${formatDateTime(o.scenario, o.world.tMin)} ${JA.shareCard.at}${o.scenario.subtitle ? `　${o.scenario.subtitle}` : ''}`, maxW), x, 204);
  // いまの状況（新しいものから 2 行まで）
  g.font = `600 30px ${FONT}`;
  g.fillStyle = '#ffffff';
  let y = 268;
  for (const line of o.situation.slice(-2)) {
    g.fillText(fit(g, line, maxW), x, y);
    y += 44;
  }
  // 一人ひとりの様子（色の丸・名前・状態）。多いときは 2 列、入りきらなければ「ほか n 人」
  g.shadowBlur = 4;
  const people = o.world.climbers;
  const cols = people.length > 4 ? 2 : 1;
  const colW = maxW / cols;
  const rowH = 40;
  const top = Math.max(y + 12, H - 40 - rowH * Math.ceil(Math.min(people.length, 8) / cols));
  const shown = people.slice(0, 8);
  shown.forEach((p, i) => {
    const cx = x + (i % cols) * colW;
    const cy = top + Math.floor(i / cols) * rowH;
    g.fillStyle = p.def.color;
    g.beginPath();
    g.arc(cx + 11, cy - 9, 11, 0, Math.PI * 2);
    g.fill();
    g.font = `700 26px ${FONT}`;
    g.fillStyle = p.body.alive ? '#ffffff' : '#9aa3ad';
    g.fillText(p.def.name, cx + 32, cy);
    const nw = g.measureText(p.def.name).width;
    g.font = `500 22px ${FONT}`;
    g.fillStyle = p.body.alive ? '#d6dbe1' : '#9aa3ad';
    const st = JA.labels.state[p.state] ?? p.state;
    g.fillText(fit(g, p.offMap ? `${st}・${p.offMap}` : st, colW - nw - 52), cx + 44 + nw, cy);
  });
  if (people.length > shown.length) {
    g.font = `500 22px ${FONT}`;
    g.fillStyle = '#d6dbe1';
    g.fillText(`${JA.shareCard.more.replace('{n}', String(people.length - shown.length))}`, x, H - 14);
  }
  return c;
}

/** カードの画像を JPEG の base64（data: の後ろ）にする */
export function cardBase64(c: HTMLCanvasElement): string {
  return c.toDataURL('image/jpeg', 0.84).replace(/^data:image\/jpeg;base64,/, '');
}

/** カードの説明文（OGP の description。140 字まで） */
export function cardText(o: Omit<CardInput, 'frame'>): string {
  const ppl = o.world.climbers.map((p) => `${p.def.name}: ${JA.labels.state[p.state] ?? p.state}`).join('／');
  const s = `${formatDateTime(o.scenario, o.world.tMin)} ${o.situation.slice(-1)[0] ?? ''}　${ppl}`;
  return s.length > 140 ? `${s.slice(0, 139)}…` : s;
}
