# 写真から、継ぎ目のない地面・岩のテクスチャを作る（docs/19 フェーズ 4）。
#   python tools/make-photo-textures.py
# 元の写真は作者が撮影したもの（J:\登山\2014_06_03槍ヶ岳）。人物の写っていない部分だけを切り出し、
# メタデータは書き出さない。出力は public/textures/*.jpg（512×512）。
from PIL import Image, ImageOps, ImageFilter, ImageChops, ImageStat
import math

SRC = 'J:/登山/2014_06_03槍ヶ岳/'
# (出力名, 元ファイル, 切り出し左上 x, y, 一辺)
CROPS = [
    ('rock', 'IMG_0660.JPG', 60, 1750, 1100),     # 花崗岩の岩肌（地衣類つき）
    ('gravel', 'IMG_0593.JPG', 1950, 1450, 950),  # 河原の丸石
    ('soil', 'IMG_0573.JPG', 1300, 1740, 680),    # 踏み固められた土の道
]
N = 512

def seamless(im):
    """端と端がつながるようにする: 半分ずらした写しと、中心からの距離で混ぜる"""
    w, h = im.size
    off = ImageChops.offset(im, w // 2, h // 2)
    mask = Image.new('L', (w, h))
    px = mask.load()
    for y in range(h):
        for x in range(w):
            dx = abs(x - w / 2) / (w / 2)
            dy = abs(y - h / 2) / (h / 2)
            d = max(dx, dy)
            px[x, y] = int(255 * min(1, max(0, (d - 0.55) / 0.35)))
    mask = mask.filter(ImageFilter.GaussianBlur(6))
    return Image.composite(off, im, mask)

def flatten(im):
    """大きな明暗のむら（日なたと木陰など）を消して、細かな模様だけ残す"""
    blur = im.filter(ImageFilter.GaussianBlur(40))
    mean = ImageStat.Stat(im).mean
    grey = Image.new('RGB', im.size, tuple(int(m) for m in mean))
    return ImageChops.add(ImageChops.subtract(im, blur, scale=1, offset=128), grey, scale=1, offset=-128)

for name, f, x, y, s in CROPS:
    im = ImageOps.exif_transpose(Image.open(SRC + f)).convert('RGB').crop((x, y, x + s, y + s)).resize((N, N), Image.LANCZOS)
    im = seamless(flatten(im))
    im.save(f'public/textures/{name}.jpg', quality=82, optimize=True)
    print(name, ImageStat.Stat(im).mean)
