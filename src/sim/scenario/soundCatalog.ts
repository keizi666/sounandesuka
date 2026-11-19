/**
 * シナリオで鳴らせる効果音と音楽の一覧（public/audio/se/<id>.m4a・public/audio/bgm/<id>.m4a）。
 * 素材は作者のアプリ「シネマトグラフィカ」（ZatsuMovieEditor）の内蔵の効果音とオリジナル BGM（public/audio/CREDITS.md）。
 * 検証（validate）とエディターとプレイヤーが同じ一覧を使う。純粋なデータ（DOM なし）。
 */
export interface SoundItem {
  id: string;
  name: string;
  /** 効果音の分類、または曲の雰囲気 */
  note: string;
  /** 鳴らすときの基本の音量（素材ごとの大きさの差をならす） */
  gain: number;
}

export const SE_CATALOG: readonly SoundItem[] = [
  { id: 'phone', name: 'プルルル（電話の呼び出し）', note: '電話をかける・かかってくる', gain: 0.55 },
  { id: 'mil-radio', name: 'ピッ ザザッ（無線）', note: '救助隊・警察の無線', gain: 0.6 },
  { id: 'mil-helicopter', name: 'バタバタ（ヘリコプター）', note: '救助ヘリが近づく', gain: 0.7 },
  { id: 'heartbeat', name: 'ドクン（心臓の鼓動）', note: '急病・心停止の危険・強い不安', gain: 0.8 },
  { id: 'message', name: 'ポロン（知らせ）', note: '分岐点が来た・メッセージ', gain: 0.45 },
  { id: 'pon', name: 'ポン（軽いタップ）', note: '選んだ', gain: 0.4 },
  { id: 'bass-drop', name: 'ズーン（重い衝撃）', note: '転落・大きなけが', gain: 0.55 },
  { id: 'knock', name: 'コンコン（ノック）', note: '小屋の戸をたたく', gain: 0.6 },
  { id: 'water-drop', name: 'ポチャン（水滴）', note: '沢・水たまり・雨のしずく', gain: 0.5 },
  { id: 'chin', name: 'チーン（ベル）', note: 'バス・店の呼び鈴', gain: 0.4 },
  { id: 'footsteps', name: 'コツコツ（足音）', note: '人が近づく', gain: 0.5 },
  { id: 'mil-morse', name: 'トン・ツー（SOS）', note: '合図・SOS', gain: 0.45 },
];

export const BGM_CATALOG: readonly SoundItem[] = [
  { id: 'wilderness', name: '荒野をゆく', note: 'アンビエント・ギター（旅・風景・ひとり）。タイトル・一覧', gain: 0.8 },
  { id: 'ambient-mist-lake', name: '朝霧の湖', note: 'アンビエント・ハミング（朝・自然）。出発前', gain: 0.8 },
  { id: 'wilderness-c', name: '荒野をゆく（風だけの夜）', note: '静かな版。歩いている間', gain: 0.7 },
  { id: 'ambient-deep-breath', name: '深い呼吸', note: 'ガラスの響き（深い夜）。夜・ビバーク', gain: 0.7 },
  { id: 'drama-dive', name: '潜航', note: '静かな緊張。遭難のさなか', gain: 0.7 },
  { id: 'ambient-before-dawn', name: '夜明け前', note: '合唱のパッド（夜明け・希望）。無事の結末', gain: 0.8 },
  { id: 'drama-dusk', name: '夕暮れの街', note: 'ピアノと弦の孤独（回想・別れ）。救助・行方不明の結末', gain: 0.8 },
  { id: 'quiet-night-c', name: '静かな夜', note: 'ピアノと弦楽・しっとり。悲しい結末', gain: 0.8 },
];

export const SE_IDS: readonly string[] = SE_CATALOG.map((x) => x.id);
export const BGM_IDS: readonly string[] = BGM_CATALOG.map((x) => x.id);
