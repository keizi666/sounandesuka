# 登山者の顔アイコンを、イラストの一覧（1 枚の画像）から切り出す。
#   python tools/make-portraits.py <一覧の画像>
# 一覧の構成（ユーザー提供の画像）: 上段に「子供・男 / 子供・女 / 若者・男 / 若者・女」、下段に「中年・男 / 中年・女 / 高齢・男 / 高齢・女」。
# 各グループは 5 列 × 4 行のマス。マスの位置は画像の大きさに対する割合で持つ（--debug で切り出し位置を書いた確認用の画像を出す）。
# 出力: public/portraits/<区分>.webp（96px のマスを 5 列 × 4 行に並べた 480×384）。src/ui/avatar.ts が使う。
import sys
from PIL import Image, ImageDraw

if len(sys.argv) < 2:
    print(__doc__ or 'usage: python tools/make-portraits.py <image> [--debug]')
    sys.exit(1)
src = Image.open(sys.argv[1]).convert('RGB')
W, H = src.size
# 2000×1333 の画像で測った位置（左上の x・y、マスの間隔、マスの大きさ）
REF_W, REF_H = 2000, 1333
GROUP_X = [50, 538, 1025, 1508]
ROWS = [(283, 104.0), (823, 106.0)]  # (最初のマスの y, 縦の間隔)
STEP_X, CELL_W, CELL_H = 90.6, 84, 96
NAMES = [['child_m', 'child_f', 'young_m', 'young_f'], ['mid_m', 'mid_f', 'senior_m', 'senior_f']]
OUT = 96
dbg = src.copy()
d = ImageDraw.Draw(dbg)
for gy, (y0, step_y) in enumerate(ROWS):
    for gx, x0 in enumerate(GROUP_X):
        sheet = Image.new('RGB', (OUT * 5, OUT * 4), (244, 239, 230))
        for r in range(4):
            for c in range(5):
                # マスの中の、顔を中心にした正方形（枠線を避けて少し内側）
                cx = (x0 + c * STEP_X + CELL_W / 2) * W / REF_W
                top = (y0 + r * step_y + 4) * H / REF_H
                side = (CELL_W - 8) * W / REF_W
                box = (round(cx - side / 2), round(top), round(cx + side / 2), round(top + side))
                sheet.paste(src.crop(box).resize((OUT, OUT), Image.LANCZOS), (c * OUT, r * OUT))
                d.rectangle(box, outline=(255, 0, 0), width=2)
        sheet.save(f'public/portraits/{NAMES[gy][gx]}.webp', quality=86, method=6)
        print(NAMES[gy][gx])
if '--debug' in sys.argv:
    dbg.save('.scratch/portraits-debug.jpg', quality=85)
    print('.scratch/portraits-debug.jpg')
