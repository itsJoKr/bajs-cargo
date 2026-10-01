#!/usr/bin/env python3
"""Draws the street walls of Ban centar (OSM w101186069), the white
concrete-and-glass block on Europski trg / Ulica Augusta Cesarca / Kurelčeva
(the "EU building", Google 3D 2026-10-01): a pale concrete frame of 3.45 m
bays with a dark tinted window band in every bay on every storey, a glazed
shopfront ground floor and a recessed, fully glazed top storey under a white
parapet. Straight-on pictures at a true aspect: 40 px/m.

    .venv/bin/python tool/make_ban_centar.py

Writes .art/facades/bc_{e16..e19}/{photo,raw}.png and
.art/streetview/bc_todo.json (wall lengths for tool/prepare_facades.py).
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PPM, STOREY, STOREYS = 40, 3.7, 7
H_M = STOREYS * STOREY + 1.0          # 26.9 m, as prepare_facades sizes the wall
GF = 4.7                               # ground floor
BAY = 3.45
WALLS = {"bc_e16": ("w101186069_e16", 29.04), "bc_e17": ("w101186069_e17", 26.57),
         "bc_e18": ("w101186069_e18", 30.44), "bc_e19": ("w101186069_e19", 33.69)}

CONCRETE = np.array([206, 208, 208], np.float32)
FRAME_SHADE = np.array([170, 172, 174], np.float32)
GLASS = np.array([92, 112, 140], np.float32)
GLASS_HI = np.array([150, 172, 198], np.float32)
MULL = np.array([150, 154, 158], np.float32)


def draw(width_m: float, seed: int) -> Image.Image:
    rng = np.random.default_rng(seed)
    W, H = round(width_m * PPM), round(H_M * PPM)
    img = np.zeros((H, W, 3), np.float32)
    img[:] = CONCRETE
    y_m = H_M - (np.arange(H) + .5) / PPM          # metres above the pavement
    x_m = (np.arange(W) + .5) / PPM
    nb = max(1, round(width_m / BAY))
    bay = width_m / nb
    col = np.minimum((x_m / bay).astype(int), nb - 1)
    xin = x_m - col * bay                          # metres inside the bay

    def rect(ys, xs, colour_fn):
        """Fills the rows ys (bool) x cols xs (bool) with colour_fn(sub_y, sub_x)."""
        iy, ix = np.where(ys)[0], np.where(xs)[0]
        if len(iy) and len(ix):
            img[np.ix_(iy, ix)] = colour_fn(iy, ix)

    def pane(tone, lit):
        def f(iy, ix):
            t = (y_m[iy][:, None] * 0)[..., None]
            # sky reflection: lighter near the top of each pane
            g = np.clip((y_m[iy] - y_m[iy].min()) / max(1e-3, np.ptp(y_m[iy])), 0, 1)[:, None, None]
            c = GLASS + tone + (GLASS_HI - GLASS) * 0.45 * g * (0.5 + 0.5 * np.sin(x_m[ix] / 2.1))[None, :, None]
            if lit:
                c = c * 0.35 + np.array([170, 168, 150], np.float32) * 0.65
            return c + t
        return f

    pier = 0.55                                    # concrete pier between windows
    # Upper storeys 1..5: window band 0.85..3.0 m above the floor, three panes a bay.
    for s in range(1, STOREYS - 1):
        y0 = GF + (s - 1) * STOREY
        for c in range(nb):
            tone = rng.normal(0, 5)
            lit = rng.random() < .10
            ys = (y_m >= y0 + 0.85) & (y_m < y0 + 3.0)
            xs = (col == c) & (xin >= pier / 2) & (xin < bay - pier / 2)
            rect(ys, xs, pane(tone, lit))
        # spandrel shading under the window band
        sp = (y_m >= y0 + 0.30) & (y_m < y0 + 0.85)
        img[sp] = img[sp] * 0.0 + FRAME_SHADE
    # three panes: slim mullions inside every window
    for k in (1, 2):
        mx = np.abs(xin - (pier / 2 + (bay - pier) * k / 3)) < 0.03
        for s in range(1, STOREYS - 1):
            y0 = GF + (s - 1) * STOREY
            ys = (y_m >= y0 + 0.85) & (y_m < y0 + 3.0)
            img[np.ix_(np.where(ys)[0], np.where(mx)[0])] = MULL
    # Floor slabs: a darker joint line at every floor level.
    for s in range(1, STOREYS):
        y = GF + (s - 1) * STOREY
        img[np.abs(y_m - y) < 0.07] = FRAME_SHADE
    # Ground floor: tall shopfront glass in 3.45 m bays, dark frames, door-height transom.
    gf = y_m < GF
    glass_rows = gf & (y_m > 0.35) & (y_m < GF - 0.55)
    for c in range(nb):
        tone = rng.normal(0, 6)
        lit = rng.random() < .35                    # a shop window lit from inside
        xs = (col == c) & (xin >= 0.12) & (xin < bay - 0.12)
        rect(glass_rows, xs, pane(tone, lit))
    img[gf & (y_m <= 0.35)] = np.array([96, 98, 100], np.float32)       # plinth
    img[gf & (y_m >= GF - 0.55)] = np.array([226, 227, 226], np.float32)  # fascia band
    mullion = gf & glass_rows
    edge = (xin < 0.12) | (xin > bay - 0.12)
    img[np.ix_(np.where(mullion)[0], np.where(edge)[0])] = np.array([70, 74, 80], np.float32)
    img[gf & (np.abs(y_m - 2.6) < 0.04)] = np.array([70, 74, 80], np.float32)   # transom
    # Top storey: recessed, fully glazed, dark band between thin posts, under a white parapet.
    top0 = GF + (STOREYS - 2) * STOREY
    top = (y_m >= top0 + 0.15) & (y_m < H_M - 0.65)
    img[top] = (GLASS * 0.8)[None, :]
    for c in range(nb * 2):
        tone = rng.normal(0, 4)
        w2 = bay / 2
        xs = (np.minimum((x_m / w2).astype(int), nb * 2 - 1) == c) & (((x_m / w2) % 1) > .04) & (((x_m / w2) % 1) < .96)
        rect(top, xs, pane(tone, rng.random() < .06))
    img[(y_m >= H_M - 0.65)] = CONCRETE + 12                            # white parapet
    img[(y_m >= H_M - 0.7) & (y_m < H_M - 0.65)] = FRAME_SHADE
    # Weather: faint vertical streaks and grain.
    streak = rng.normal(0, 1, W)
    streak = np.convolve(streak, np.ones(9) / 9, mode="same") * 7
    pale = (img.mean(axis=2) > 190)
    img[pale] += streak[np.where(pale)[1]][:, None]
    img += rng.normal(0, 1.8, img.shape)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def main() -> None:
    todo = []
    for k, (name, (wall, length)) in enumerate(WALLS.items()):
        d = ROOT / ".art" / "facades" / name
        d.mkdir(parents=True, exist_ok=True)
        im = draw(length, 31 + k)
        im.save(d / "raw.png")
        im.save(d / "photo.png")
        todo.append({"id": wall, "length": length})
    (ROOT / ".art" / "streetview" / "bc_todo.json").write_text(json.dumps(todo, indent=1))
    print("drew", ", ".join(WALLS))


if __name__ == "__main__":
    main()
