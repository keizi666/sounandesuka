# 登山者の顔アイコンを作る。
#   python tools/make-portraits.py [assets-src/hikers-cells-v5] [--debug]
# 入力: ユーザーが用意した、1 人 1 枚に切り分けたイラスト（区分ごとのフォルダ。子供・男 … 高齢・女、各 01.png〜）。
#   マスの大きさは少しずつ違い、端に枠線が入っているものもある。
# 処理: 頭の位置を画像から求め、そこを中心にした正方形（マスの短い辺の 84%、上寄り）を切り出す（マスの中で顔が左右に寄っていることがある）。
#   端に入った枠線は背景の色で消す。丸く表示するので四隅は見えない。
# 出力: public/portraits/<区分>.webp（1 人 128px を 4 列に並べた 1 枚）と public/portraits/index.json（列数・人数）。src/ui/avatar.ts が使う。
import json
import os
import sys

import numpy as np
from PIL import Image

SRC = next((a for a in sys.argv[1:] if not a.startswith('--')), 'assets-src/hikers-cells-v5')
OUT = 128
COLS = 4
GROUPS = {'子供': 'child', '若者': 'young', '中年': 'mid', '高齢': 'senior'}
SEXES = {'男': 'm', '女': 'f'}

def crop_face(im):
    """1 人分のマスから、頭を中心にした正方形を切り出す。
    マスの中で顔が左右に寄っていることがあるので、マスの中央ではなく頭の位置（上半分の、背景でない画素の中央）で切る。
    端に入った枠線（縁の近くの、上から下まで続く細い線）は背景の色で塗りつぶしてから切る。"""
    a = np.asarray(im).astype(np.int16).copy()
    h, w = a.shape[:2]
    # 背景の色: 上端の数行の中央値（イラストの外側は生成りの無地）
    bg = np.median(a[2:8, int(w * 0.2):int(w * 0.8)].reshape(-1, 3), axis=0)
    ink = np.abs(a - bg).sum(axis=2) > 60
    # 枠線: 左右の縁から 15% 以内で、高さの 60% 以上にわたって続く列
    edge = int(w * 0.15)
    for x in list(range(edge)) + list(range(w - edge, w)):
        if ink[:, x].mean() > 0.6:
            a[:, x] = bg
            ink[:, x] = False
    # 縁のごく近く（6% 以内）で、上半分を縦に貫く線は、上 60% だけ消す（下は服が縁まで届くので残す）
    edge2 = max(3, int(w * 0.06))
    upper = int(h * 0.6)
    for x in list(range(edge2)) + list(range(w - edge2, w)):
        if ink[: int(h * 0.55), x].mean() > 0.5:
            a[:upper, x] = bg
            ink[:upper, x] = False
    # 上の縁の横線（下の縁は服が端まで届くので触らない）
    for y in range(int(h * 0.12)):
        if ink[y, :].mean() > 0.6:
            a[y, :] = bg
            ink[y, :] = False
    # 頭の中心（上から 4%〜50% の帯で、背景でない画素の x の中央値）
    band = ink[int(h * 0.04):int(h * 0.5), :]
    ys, xs = np.nonzero(band)
    cx = int(np.median(xs)) if len(xs) > 50 else w // 2
    # 正方形はマスの内側に収める（マスの外は描かれていないので、はみ出すと服の切れ目が見える）。
    # 頭が端に寄っていて収まらないときは、少し小さくし、それでも収まらなければ中心を内側へ寄せる
    side = int(min(min(w, h) * 0.84, 2 * cx, 2 * (w - cx)))
    side = max(side, int(min(w, h) * 0.74))
    cx = min(max(cx, side // 2), w - side // 2)
    left = cx - side // 2
    top = int(h * 0.02)
    # 上下にはみ出す分（ほぼない）は背景の色で埋める
    canvas = Image.new('RGB', (side, side), tuple(int(c) for c in bg))
    src = Image.fromarray(a.astype(np.uint8))
    sx0, sx1 = max(0, left), min(w, left + side)
    sy0, sy1 = max(0, top), min(h, top + side)
    canvas.paste(src.crop((sx0, sy0, sx1, sy1)), (sx0 - left, sy0 - top))
    return canvas.resize((OUT, OUT), Image.LANCZOS)


os.makedirs('public/portraits', exist_ok=True)
counts = {}
debug = []
for folder in sorted(os.listdir(SRC)):
    path = os.path.join(SRC, folder)
    if not os.path.isdir(path):
        continue
    age = next((v for k, v in GROUPS.items() if k in folder), None)
    sex = next((v for k, v in SEXES.items() if k in folder), None)
    if not age or not sex:
        print('skip', folder)
        continue
    name = f'{age}_{sex}'
    files = sorted(f for f in os.listdir(path) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')))
    faces = []
    for f in files:
        faces.append(crop_face(Image.open(os.path.join(path, f)).convert('RGB')))
    rows = (len(faces) + COLS - 1) // COLS
    sheet = Image.new('RGB', (OUT * COLS, OUT * max(1, rows)), (246, 242, 234))
    for i, face in enumerate(faces):
        sheet.paste(face, ((i % COLS) * OUT, (i // COLS) * OUT))
    sheet.save(f'public/portraits/{name}.webp', quality=86, method=6)
    counts[name] = len(faces)
    debug.append(sheet)
    print(name, len(faces))

with open('public/portraits/index.json', 'w', encoding='utf-8') as fp:
    json.dump({'cols': COLS, 'cell': OUT, 'counts': counts}, fp)

if '--debug' in sys.argv and debug:
    # 丸く切り抜いた見え方の確認用
    from PIL import ImageDraw
    W = max(s.width for s in debug)
    out = Image.new('RGB', (W, sum(s.height for s in debug)), (40, 44, 52))
    y = 0
    for s in debug:
        mask = Image.new('L', s.size, 0)
        d = ImageDraw.Draw(mask)
        for r in range(s.height // OUT):
            for c in range(COLS):
                d.ellipse((c * OUT + 2, r * OUT + 2, c * OUT + OUT - 3, r * OUT + OUT - 3), fill=255)
        out.paste(s, (0, y), mask)
        y += s.height
    out.save('.scratch/portraits-debug.jpg', quality=85)
    print('.scratch/portraits-debug.jpg')
