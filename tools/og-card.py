from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
R = r"I:\keizi\Documents\C+ Factory\HakoniwaSounanSim"
W, H = 1200, 630
FONT = r"C:\Windows\Fonts\NotoSansJP-VF.ttf"
def font(size, weight):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f
# 背景: 箱庭岳のジオラマ（秋）を広げて暗く
bg = Image.open(R + r"\public\scenarios\thumbs\s01_cold_front.jpg").convert('RGB')
s = max(W / bg.width, H / bg.height)
bg = bg.resize((round(bg.width * s), round(bg.height * s)), Image.LANCZOS)
bg = bg.crop(((bg.width - W) // 2, (bg.height - H) // 2, (bg.width - W) // 2 + W, (bg.height - H) // 2 + H))
bg = ImageEnhance.Brightness(bg.filter(ImageFilter.GaussianBlur(4))).enhance(0.62)
card = bg.convert('RGBA')
# 左から右へ暗くなる帯（文字を読みやすく）
grad = Image.new('L', (W, 1))
for x in range(W):
    grad.putpixel((x, 0), int(30 + 170 * min(1, max(0, (x - 260) / 520))))
shade = Image.new('RGBA', (W, H), (12, 16, 26, 0))
shade.putalpha(grad.resize((W, H)))
card = Image.alpha_composite(card, shade)
# アイコン（角丸・影）
icon = Image.open(R + r"\assets-src\icon_1600.png").convert('RGBA').resize((300, 300), Image.LANCZOS)
mask = Image.new('L', (300, 300), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, 299, 299), radius=64, fill=255)
icon.putalpha(mask)
shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((72, 172, 72 + 300, 172 + 300), radius=64, fill=(0, 0, 0, 160))
shadow = shadow.filter(ImageFilter.GaussianBlur(18))
card = Image.alpha_composite(card, shadow)
card.alpha_composite(icon, (64, 160))
d = ImageDraw.Draw(card)
x = 420
d.text((x, 150), '遭難ですよ', font=font(118, 800), fill=(255, 255, 255))
d.text((x + 4, 318), '山岳遭難の推移を、3D の箱庭で見守る', font=font(40, 700), fill=(240, 228, 200))
d.text((x + 4, 378), '選ぶのは登山者の行動。結果は、気象・地形・', font=font(29, 500), fill=(214, 220, 228))
d.text((x + 4, 420), '体温や体力のモデルと確率が決める。', font=font(29, 500), fill=(214, 220, 228))
# 下: URL の帯
d.rounded_rectangle((x, 500, x + 380, 552), radius=26, fill=(212, 166, 74))
d.text((x + 24, 506), 'kzi.jp/sounandesuka', font=font(30, 700), fill=(28, 24, 18))
card.convert('RGB').save(R + r"\public\og-card.jpg", quality=88, optimize=True, progressive=True)
print('ok')
