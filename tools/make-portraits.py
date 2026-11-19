# 登山者の顔アイコンを作る。
#   python tools/make-portraits.py [assets-src/hikers-cells-v5] [--debug]
# 入力: ユーザーが用意した、1 人 1 枚に切り分けたイラスト（区分ごとのフォルダ。子供・男 … 高齢・女、各 01.png〜）。
#   マスの大きさは少しずつ違い、端に枠線が入っているものもある。
# 処理: 顔を中心にした正方形（マスの短い辺の 84%、上寄り）を切り出す。端の枠線はこの範囲に入らない。丸く表示するので四隅は見えない。
# 出力: public/portraits/<区分>.webp（1 人 128px を 4 列に並べた 1 枚）と public/portraits/index.json（列数・人数）。src/ui/avatar.ts が使う。
import json
import os
import sys

from PIL import Image

SRC = next((a for a in sys.argv[1:] if not a.startswith('--')), 'assets-src/hikers-cells-v5')
OUT = 128
COLS = 4
GROUPS = {'子供': 'child', '若者': 'young', '中年': 'mid', '高齢': 'senior'}
SEXES = {'男': 'm', '女': 'f'}

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
        im = Image.open(os.path.join(path, f)).convert('RGB')
        w, h = im.size
        side = int(min(w, h) * 0.84)
        left = (w - side) // 2
        top = int(h * 0.02)
        faces.append(im.crop((left, top, left + side, top + side)).resize((OUT, OUT), Image.LANCZOS))
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
