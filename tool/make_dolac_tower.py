#!/usr/bin/env python3
"""Draws St Mary's bell tower on Dolac (Zvonik sv. Marije, OSM w735337369): the
shaft elevation, one picture for all four sides, and the texture of its onion
domes. Procedural because the shaft is five times taller than wide, which no
gen-image picture comes at; proportions read off a Street View photo from the
market (clock under the cornice, an arched belfry opening, a stringcourse,
paired arched windows, white rusticated corner pilasters on yellow plaster).

    .venv/bin/python tool/make_dolac_tower.py

Writes .art/facades/dolac_tower*/raw.png (data/hero/dolac.json; then
prepare_facades.py pack) and web3d/public/features/tex/dolac_onion.jpg.
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
PX = 121                       # pixels per metre
W_M, H_M = 6.6, 9 * 3.7 + 1.0  # shaft width, pavement to cornice (9 storeys in the atlas)
W, H = round(W_M * PX), round(H_M * PX)
YELLOW, WHITE, SHADE, DARK = (226, 200, 126), (236, 232, 219), (184, 166, 110), (38, 36, 34)


def m(v):
    return round(v * PX)


def shaft():
    rnd = random.Random(7)
    im = Image.new('RGB', (W, H), YELLOW)
    d = ImageDraw.Draw(im)
    # Plaster mottle.
    for _ in range(9000):
        x, y = rnd.randrange(W), rnd.randrange(H)
        k = rnd.randint(-10, 8)
        d.point((x, y), fill=tuple(max(0, min(255, c + k)) for c in YELLOW))
    top = 0.0  # metres below the cornice
    def y(v):  # metres below the cornice -> pixel row
        return m(v)
    # Corner pilasters with alternating quoins.
    pil = 0.72
    for x0 in (0, W - m(pil)):
        d.rectangle([x0, 0, x0 + m(pil), H], fill=WHITE)
    k = 0
    v = 0.8
    while v < H_M - 1.2:
        long_ = k % 2 == 0
        wq = pil + (0.28 if long_ else 0.0)
        d.rectangle([0, y(v), m(wq), y(v + 0.42)], fill=WHITE, outline=SHADE)
        d.rectangle([W - m(wq), y(v), W, y(v + 0.42)], fill=WHITE, outline=SHADE)
        v += 0.5
        k += 1
    # Cornice.
    d.rectangle([0, 0, W, y(0.55)], fill=WHITE)
    d.line([0, y(0.55), W, y(0.55)], fill=SHADE, width=6)
    d.line([0, y(0.25), W, y(0.25)], fill=SHADE, width=3)
    cx = W // 2
    # Clock.
    cy, r = y(2.0), m(1.12)
    d.ellipse([cx - r - m(.14), cy - r - m(.14), cx + r + m(.14), cy + r + m(.14)], fill=WHITE, outline=SHADE, width=4)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(242, 240, 232), outline=(60, 60, 60), width=5)
    for i in range(12):
        a = i / 12 * 2 * math.pi
        r0, r1 = r * .78, r * .93
        d.line([cx + r0 * math.sin(a), cy - r0 * math.cos(a), cx + r1 * math.sin(a), cy - r1 * math.cos(a)],
               fill=(30, 30, 30), width=10 if i % 3 == 0 else 6)
    d.line([cx, cy, cx + r * .55 * math.sin(4.2), cy - r * .55 * math.cos(4.2)], fill=(20, 20, 20), width=12)
    d.line([cx, cy, cx + r * .8 * math.sin(0.5), cy - r * .8 * math.cos(0.5)], fill=(20, 20, 20), width=8)
    d.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill=(20, 20, 20))

    def arch(x0, x1, t, b, frame=0.16, louvres=True):
        wf = m(frame)
        rad = (x1 - x0) // 2
        d.rectangle([x0 - wf, t + rad - wf // 2, x1 + wf, b + wf], fill=WHITE)
        d.pieslice([x0 - wf, t - wf, x1 + wf, t + 2 * rad + wf], 180, 360, fill=WHITE)
        d.rectangle([x0, t + rad, x1, b], fill=DARK)
        d.pieslice([x0, t, x1, t + 2 * rad], 180, 360, fill=DARK)
        if louvres:
            for yy in range(t + rad // 2, b, m(0.16)):
                d.line([x0 + 4, yy, x1 - 4, yy], fill=(70, 66, 60), width=4)
        d.line([x0 - wf, b + wf, x1 + wf, b + wf], fill=SHADE, width=5)

    # Belfry opening.
    arch(cx - m(.8), cx + m(.8), y(4.3), y(6.9))
    # Stringcourse.
    d.rectangle([0, y(8.0), W, y(8.35)], fill=WHITE)
    d.line([0, y(8.35), W, y(8.35)], fill=SHADE, width=5)
    # Paired arched windows in one white surround.
    d.rectangle([cx - m(1.05), y(9.4), cx + m(1.05), y(12.2)], fill=WHITE)
    for s in (-1, 1):
        x0 = cx + s * m(0.45) - m(0.32)
        arch(x0, x0 + m(0.64), y(9.65), y(11.95), frame=0.0, louvres=False)
    # Lower storeys: bands and a small window each, down to a grey plinth.
    v = 12.8
    while v < H_M - 4:
        d.rectangle([0, y(v), W, y(v + 0.3)], fill=WHITE)
        d.line([0, y(v + 0.3), W, y(v + 0.3)], fill=SHADE, width=4)
        d.rectangle([cx - m(.45), y(v + 2.0), cx + m(.45), y(v + 3.6)], fill=WHITE)
        d.rectangle([cx - m(.32), y(v + 2.15), cx + m(.32), y(v + 3.45)], fill=(60, 64, 66))
        v += 6.5
    d.rectangle([0, y(H_M - 1.4), W, H], fill=(168, 162, 150))
    d.line([0, y(H_M - 1.4), W, y(H_M - 1.4)], fill=(120, 116, 108), width=5)
    # Weathering: soft grime from the cornice and window sills.
    grime = Image.new('L', (W, H), 0)
    g = ImageDraw.Draw(grime)
    for _ in range(40):
        x = rnd.randrange(W)
        y0 = rnd.randrange(H)
        g.line([x, y0, x + rnd.randint(-6, 6), y0 + rnd.randint(80, 400)], fill=rnd.randint(10, 30), width=rnd.randint(8, 30))
    grime = grime.filter(ImageFilter.GaussianBlur(12))
    im = Image.composite(Image.new('RGB', (W, H), (120, 110, 90)), im, grime)
    return im


def onion():
    """Dark green copper with gold scrollwork; tiles every 4 m round the dome."""
    rnd = random.Random(3)
    S = 512
    im = Image.new('RGB', (S, S), (40, 70, 52))
    d = ImageDraw.Draw(im)
    for _ in range(4000):
        x, y = rnd.randrange(S), rnd.randrange(S)
        k = rnd.randint(-12, 12)
        d.point((x, y), fill=(40 + k, 70 + k, 52 + k))
    gold = (196, 160, 70)
    # A C-scroll pair per tile and a band along the foot.
    for sx in (-1, 1):
        cx = S // 2 + sx * 110
        d.arc([cx - 80, 180, cx + 80, 340], 200 if sx < 0 else -20, 340 if sx < 0 else 160, fill=gold, width=14)
        d.ellipse([cx - 16, 250, cx + 16, 282], outline=gold, width=8)
    d.polygon([(S // 2, 120), (S // 2 - 30, 200), (S // 2 + 30, 200)], outline=gold, width=8)
    d.rectangle([0, S - 70, S, S - 44], fill=gold)
    d.rectangle([0, 30, S, 44], fill=gold)
    return im.filter(ImageFilter.GaussianBlur(0.8))


if __name__ == '__main__':
    face = shaft()
    for name in ('dolac_tower', 'dolac_tower_east', 'dolac_tower_north', 'dolac_tower_west'):
        out = ROOT / '.art' / 'facades' / name / 'raw.png'
        out.parent.mkdir(parents=True, exist_ok=True)
        face.save(out)
    onion().save(ROOT / 'web3d' / 'public' / 'features' / 'tex' / 'dolac_onion.jpg', quality=90)
    print(f'shaft {W}x{H} px ({W_M} x {H_M:.1f} m), onion texture')
