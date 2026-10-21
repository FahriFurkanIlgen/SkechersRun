"""Frames raw simulator screenshots (1206x2622, iPhone 17 Pro) for the App Store.

Usage: python3 scripts/store-screenshots.py <raw dir> <out dir>
Each output: 1206x2622 RGB PNG (no alpha), a short caption on brand blue and
the real app screen below it. Captions live in SHOTS; keep them short and
complementary to the screen (APP_STORE_ASSET_GUIDELINES.md).
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1206, 2622
BLUE_TOP = (31, 79, 209)  # brand primary #1F4FD1
BLUE_BOTTOM = (20, 47, 138)
WHITE = (250, 250, 247)
SOFT = (214, 224, 255)

ROOT = Path(__file__).resolve().parent.parent
FONT_TITLE = ROOT / 'node_modules/@expo-google-fonts/archivo-narrow/700Bold/ArchivoNarrow_700Bold.ttf'
FONT_SUB = ROOT / 'node_modules/@expo-google-fonts/instrument-sans/500Medium/InstrumentSans_500Medium.ttf'

SHOTS = [
    ('01-map', 'Geçtiğin sokaklar senin.', 'Yürü, koş, pedal çevir; şehri hücre hücre kazan.'),
    ('02-route', 'En çok hücreyi kazandıran tur.', 'Süreni seç, sokakları izleyen rotayı al.'),
    ('03-districts', 'Mahallen için yarış.', 'İlçe takımına katıl, haftalık savaşı kazan.'),
    ('05-record', 'Her adım haritaya işlenir.', 'Canlı rota, tempo ve kazandığın alan.'),
    ('04-season', 'Her ay yeni bir sezon.', 'Kaleleri al, Çaylak’tan Efsane’ye yüksel.'),
    ('06-start', 'Herkes için, her tempoda.', 'Yürüyüş, koşu, bisiklet ve tekerlekli sandalye.'),
]


def gradient() -> Image.Image:
    img = Image.new('RGB', (W, H))
    px = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        px.line([(0, y), (W, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(BLUE_TOP, BLUE_BOTTOM)))
    return img


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines, line = [], ''
    for word in text.split():
        trial = f'{line} {word}'.strip()
        if draw.textlength(trial, font=font) <= width:
            line = trial
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def frame(raw: Path, title: str, sub: str) -> Image.Image:
    canvas = gradient()
    draw = ImageDraw.Draw(canvas)
    title_font = ImageFont.truetype(str(FONT_TITLE), 112)
    sub_font = ImageFont.truetype(str(FONT_SUB), 46)

    y = 190
    for line in wrap(draw, title, title_font, W - 160):
        draw.text((W / 2, y), line, font=title_font, fill=WHITE, anchor='ma')
        y += 124
    y += 18
    for line in wrap(draw, sub, sub_font, W - 200):
        draw.text((W / 2, y), line, font=sub_font, fill=SOFT, anchor='ma')
        y += 62

    # The whole real screen below the caption, rounded, with a soft shadow.
    shot = Image.open(raw).convert('RGB')
    top = max(y + 56, 600)
    scale = (H - top - 80) / H
    sw, sh = round(W * scale), round(H * scale)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    left = (W - sw) // 2
    radius = 64
    mask = Image.new('L', (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, sw - 1, sh - 1], radius=radius, fill=255)

    shadow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle([left, top + 24, left + sw, top + sh + 24], radius=radius, fill=110)
    shadow = shadow.filter(ImageFilter.GaussianBlur(40))
    canvas.paste(Image.new('RGB', (W, H), (8, 20, 64)), (0, 0), shadow)

    border = Image.new('RGB', (sw + 16, sh + 16), (14, 17, 19))
    bmask = Image.new('L', (sw + 16, sh + 16), 0)
    ImageDraw.Draw(bmask).rounded_rectangle([0, 0, sw + 15, sh + 15], radius=radius + 8, fill=255)
    canvas.paste(border, (left - 8, top - 8), bmask)
    canvas.paste(shot, (left, top), mask)
    return canvas


def main() -> None:
    raw_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, (name, title, sub) in enumerate(SHOTS, start=1):
        src = raw_dir / f'{name}.png'
        if not src.exists():
            print(f'skip {name} (no raw screenshot)')
            continue
        img = frame(src, title, sub)
        assert img.size == (W, H) and img.mode == 'RGB'
        dst = out_dir / f'{i:02d}-{name[3:]}.png'
        img.save(dst, optimize=True)
        print(dst)


if __name__ == '__main__':
    main()
