# 登山者の顔アイコンを作る。
#   python tools/make-portraits.py [assets-src/hikers-cells-v5] [--debug]
# 入力: ユーザーが用意した、1 人 1 枚に切り分けたイラスト（区分ごとのフォルダ。子供・男 … 高齢・女、各 01.png〜）。
#   マスの大きさは少しずつ違い、端に枠線が入っているものもある。
# 処理: 頭の位置を画像から求め、そこを中心にした正方形（マスの短い辺の 84%、上寄り）を切り出す（マスの中で顔が左右に寄っていることがある）。
#   マスに入っている枠線（二重線や、縁から少し内側の線もある）の位置を求め、その内側だけから切り出す。丸く表示するので四隅は見えない。
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

def thin_lines(cov, limit, inner_step):
    """cov: 列（または行）ごとの、線らしさの割合。縁から limit 以内で、ほぼ途切れず続き（0.9 以上）、
    幅が細く（6px 以下）、すぐ内側が空いている（0.6 未満）まとまりを線とみなし、いちばん内側の位置を返す（なければ None）"""
    idx = [k for k in range(limit) if cov[k] >= 0.9]
    groups = []
    for k in idx:
        if groups and k - groups[-1][-1] <= 1:
            groups[-1].append(k)
        else:
            groups.append([k])
    inner = None
    for g in groups:
        nxt = g[-1] + inner_step
        if len(g) <= 6 and 0 <= nxt < len(cov) and cov[nxt] < 0.6:
            inner = g[-1]
    return inner


def frame_bounds(ink, h, w):
    """マスの中の枠線（二重線や、縁から少し内側にある線も）を探し、線より内側の範囲 (left, top, right) を返す。
    縦線は上 3%〜55% の帯でほぼ途切れず続く細い列、横線は上の縁近くで幅のほぼ全体に続く細い行。
    髪や帽子は幅が広い・途中で途切れるので、線とはみなさない。下の縁は服が端まで届くので見ない。"""
    band = ink[int(h * 0.03):int(h * 0.55)]
    col = band.mean(axis=0)
    m = int(w * 0.12)
    l = thin_lines(col, m, 3)
    r = thin_lines(col[::-1], m, 3)
    row = ink[:, int(w * 0.1):int(w * 0.9)].mean(axis=1)
    t = thin_lines(row, int(h * 0.12), 3)
    pad = 3
    left = l + 1 + pad if l is not None else 0
    right = w - (r + 1 + pad) if r is not None else w
    top = t + 1 + pad if t is not None else 0
    return left, top, right


def crop_face(im):
    """1 人分のマスから、頭を中心にした正方形を切り出す。
    - マスの中で顔が左右に寄っていることがあるので、マスの中央ではなく頭の位置（上半分の、背景でない画素の中央）で切る
    - 枠線は塗りつぶさない（色の違う段差が残る）。線の位置を求めて、その内側だけから切り出す"""
    a = np.asarray(im).astype(np.int16)
    h, w = a.shape[:2]
    # 背景の色: マスの中でいちばん明るい 25% の画素の中央値（無地の紙の色。上の方の中央は帽子や髪のことがある）
    flat = a.reshape(-1, 3)
    lum = flat.mean(axis=1)
    bg = np.median(flat[lum >= np.percentile(lum, 75)], axis=0)
    ink = np.abs(a - bg).sum(axis=2) > 60
    left, top_line, right = frame_bounds(ink, h, w)
    # 頭の中心（線の内側で、上から 4%〜50% の帯にある背景でない画素の x の中央値）
    band = ink[int(h * 0.04):int(h * 0.5), left:right]
    ys, xs = np.nonzero(band)
    cx = left + int(np.median(xs)) if len(xs) > 50 else (left + right) // 2
    # 正方形は線の内側に収める（収まらなければ少し小さく、それでも無理なら中心を内側へ）
    top = max(int(h * 0.02), top_line)
    side = int(min(min(w, h) * 0.84, 2 * (cx - left), 2 * (right - cx), h - top))
    side = max(side, int(min(right - left, h - top) * 0.7))
    side = min(side, right - left, h - top)
    cx = min(max(cx, left + side // 2), right - side // 2)
    x0 = cx - side // 2
    return im.crop((x0, top, x0 + side, top + side)).resize((OUT, OUT), Image.LANCZOS)


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
