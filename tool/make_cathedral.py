#!/usr/bin/env python3
"""Textures of the hand-built Zagreb Cathedral (web3d/src/cathedral.ts).

    .venv/bin/python tool/make_cathedral.py

Reads the gen-image redrawings in .art/cathedral/ and writes web3d/public/models/cathedral/:

  front.jpg   the west front's lower 20 m, 36.9 m wide, at full resolution: a redrawing of the
              rectified Street View front (Jul 2024, pano 2 Kaptol), scaffolding and site clutter
              removed. It is what the player looks at from the square.
  front_high.jpg  the whole front (pavement to 54.4 m, the gable's cross), SUPER low-res (3.5 px/m):
              used above 20 m, too high up to be seen closely.
  tower.jpg   one face of a tower's upper stage (gallery to the top cornice, 11.3 x 24.6 m), used on
              all four faces of both towers, the belfry and clock stage as the 2024 tarps and a 2018
              photosphere show them. Super low-res (3.5 px/m): high up.
  side.png    three bays of the long side walls with their gables (22.2 m wide, ground to the gable
              tips 31.9 m), alpha-keyed. DELIBERATELY low resolution (about 3 px/m): the sides are
              fenced off and only ever seen from afar.
  stone.jpg, roof.jpg, spire.png   procedural: ashlar for buttresses and backs, the copper-green
              roof, the openwork tracery of the octagonal spires (alpha). Low resolution too.
"""
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / ".art" / "cathedral"
OUT = ROOT / "web3d" / "public" / "models" / "cathedral"

# Low-res budget (px per metre) for what the player cannot reach, and for anything high up.
SIDE_PPM = 3.2
HIGH_PPM = 3.5
# The front texture: 54.4 m tall; full resolution below FRONT_SPLIT only.
FRONT_TEX_H, FRONT_SPLIT = 54.4, 20.0


def keyed(im: Image.Image) -> Image.Image:
    """#00FF00 green screen -> alpha (soft edge, green spill removed)."""
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    green = np.clip((g - np.maximum(r, b) - 40) / 60, 0, 1)
    alpha = (1 - green) * 255
    a[..., 1] = np.minimum(g, np.maximum(r, b) + 10)
    return Image.fromarray(np.dstack([a, alpha]).astype(np.uint8), "RGBA")


def front() -> None:
    """front.jpg: the lower 20 m (portal, side doors, rose window's foot) at full resolution;
    front_high.jpg: the whole front, tiny, for everything above 20 m (too high to see closely)."""
    raw = Image.open(ART / "front" / "raw.png").convert("RGB").resize((1024, 1536), Image.Resampling.LANCZOS)
    rows = round(FRONT_SPLIT / FRONT_TEX_H * 1536)
    raw.crop((0, 1536 - rows, 1024, 1536)).save(OUT / "front.jpg", quality=90)
    w = round(36.9 * HIGH_PPM)
    raw.resize((w, round(w * 1536 / 1024)), Image.Resampling.BOX).save(OUT / "front_high.jpg", quality=90)


def tower() -> None:
    path = ART / "tower" / "raw.png"
    if not path.exists():
        print("no tower raw yet")
        return
    im = keyed(Image.open(path))
    a = np.asarray(im)[..., 3]
    cols = np.where(a.mean(axis=0) > 128)[0]
    x0, x1 = int(cols[0]), int(cols[-1]) + 1
    face = im.crop((x0, 0, x1, im.height)).convert("RGB")
    face.resize((round(11.3 * HIGH_PPM), round(24.6 * HIGH_PPM)), Image.Resampling.BOX).save(OUT / "tower.jpg", quality=90)
    print(f"tower face: columns {x0}..{x1} of {im.width}")


def side() -> None:
    im = keyed(Image.open(ART / "bay" / "raw.png"))
    w, h = round(22.2 * SIDE_PPM), round(31.9 * SIDE_PPM)
    # Premultiply before shrinking so the keyed edges do not turn green or dark.
    a = np.asarray(im).astype(np.float32) / 255
    pre = Image.fromarray((np.dstack([a[..., :3] * a[..., 3:], a[..., 3:]]) * 255).astype(np.uint8), "RGBA")
    small = np.asarray(pre.resize((w, h), Image.Resampling.BOX)).astype(np.float32) / 255
    rgb = small[..., :3] / np.maximum(small[..., 3:], 1e-3)
    out = np.dstack([np.clip(rgb, 0, 1), small[..., 3:]])
    Image.fromarray((out * 255).astype(np.uint8), "RGBA").save(OUT / "side.png")


def stone() -> None:
    """Pale limestone ashlar, 2 m square, 64 px."""
    rnd = random.Random(3)
    n = 64
    im = Image.new("RGB", (n, n), (222, 211, 188))
    d = ImageDraw.Draw(im)
    course = n // 4
    for row in range(4):
        y = row * course
        off = (row % 2) * n // 4
        for k in range(-1, 3):
            x = off + k * n // 2
            t = rnd.randint(-14, 10)
            d.rectangle((x + 1, y + 1, x + n // 2 - 1, y + course - 1), fill=(222 + t, 211 + t, 188 + t))
        d.line((0, y, n, y), fill=(160, 152, 136))
    for row in range(4):
        off = (row % 2) * n // 4
        for k in range(-1, 3):
            x = off + k * n // 2
            d.line((x, row * course, x, row * course + course), fill=(160, 152, 136))
    px = np.asarray(im).astype(np.float32)
    px += np.random.default_rng(4).normal(0, 5, px.shape[:2])[..., None]
    Image.fromarray(np.clip(px, 0, 255).astype(np.uint8)).save(OUT / "stone.jpg", quality=85)


def roof() -> None:
    """Weathered copper-green roof with a faint diamond pattern (Street View / aerial), 4 m, 64 px."""
    n = 64
    rng = np.random.default_rng(9)
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    base = np.array([96, 112, 104], np.float32)
    diamond = (np.abs(((x + y) % 16) - 8) + np.abs(((x - y) % 16) - 8)) < 5
    px = np.broadcast_to(base, (n, n, 3)).copy()
    px[diamond] *= 0.88
    px[(y.astype(int) % 4) == 0] *= 0.9  # courses
    px += rng.normal(0, 6, (n, n))[..., None]
    streak = np.repeat(rng.normal(0, 6, (1, n)), n, axis=0)
    px += streak[..., None]
    Image.fromarray(np.clip(px, 0, 255).astype(np.uint8)).save(OUT / "roof.jpg", quality=85)


def spire() -> None:
    """One face of the octagonal openwork spire, base (bottom) to tip (top): stone edge ribs with
    crockets, horizontal bands, quatrefoil openings (alpha 0). u spans the face at every height."""
    w, h = 128, 1024
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    stone_c = (200, 190, 168, 255)
    shade = (150, 142, 124, 255)
    d.rectangle((0, 0, w, h), fill=stone_c)
    band = 64
    for k in range(h // band):
        y0 = k * band
        # Opening: a quatrefoil in each panel, alternating two sizes.
        cx, cy, r = w / 2, y0 + band / 2, 20 if k % 2 else 16
        for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            d.ellipse((cx + dx * r * 0.55 - r * 0.55, cy + dy * r * 0.55 - r * 0.55,
                       cx + dx * r * 0.55 + r * 0.55, cy + dy * r * 0.55 + r * 0.55), fill=(0, 0, 0, 0))
        d.rectangle((cx - r * 0.5, cy - r * 0.5, cx + r * 0.5, cy + r * 0.5), fill=(0, 0, 0, 0))
        d.line((0, y0, w, y0), fill=shade, width=3)
    # Edge ribs with crockets.
    for x in (0, w - 12):
        d.rectangle((x, 0, x + 12, h), fill=stone_c)
        d.line((x + (0 if x else 11), 0, x + (0 if x else 11), h), fill=shade, width=2)
    for y in range(8, h, 32):
        d.ellipse((-4, y, 12, y + 14), fill=shade)
        d.ellipse((w - 12, y, w + 4, y + 14), fill=shade)
    # High up: stored super low-res (the tracery reads only as a pattern from the ground).
    im.resize((16, 128), Image.Resampling.BOX).save(OUT / "spire.png")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    front()
    tower()
    side()
    stone()
    roof()
    spire()
    for p in sorted(OUT.iterdir()):
        print(p.name, Image.open(p).size, f"{p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
