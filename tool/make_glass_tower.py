#!/usr/bin/env python3
"""Draws the dark glass curtain wall of the Ilica 1 Neboder tower (Street
View: blue-black reflecting panes, dark spandrel band per storey, thin
mullions) as straight-on pictures at a true aspect: 40 px/m.

    python3 tool/make_glass_tower.py

Writes .art/facades/tower_{n,e,s,w}/{photo,raw}.png (sized to the walls of
data/buildings.json w9000000001) and .art/streetview/nbt_todo.json (wall
lengths for tool/prepare_facades.py).
"""
import json, math
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PPM, STOREY, STOREYS = 40, 3.7, 18
H_M = STOREYS * STOREY + 1.0
BAY = 1.25
WALLS = {"tower_n": (["w9000000001_e0"], [6.4]), "tower_w": (["w9000000001_e1"], [26.0]),
         "tower_s": (["w9000000001_e2"], [3.8]),
         "tower_e": (["w9000000001_e3", "w9000000001_e4", "w9000000001_e5"], [14.5, 3.6, 7.6])}


def draw(width_m: float, seed: int) -> Image.Image:
    rng = np.random.default_rng(seed)
    W, H = round(width_m * PPM), round(H_M * PPM)
    img = np.zeros((H, W, 3), np.float32)
    y_m = H_M - (np.arange(H) + .5) / PPM        # metres above the pavement
    x_m = (np.arange(W) + .5) / PPM
    nb = max(1, round(width_m / BAY))
    bay = width_m / nb
    col = np.minimum((x_m / bay).astype(int), nb - 1)
    # Storey 0 is the ground floor (4.7 m); the rest are 3.7 m.
    storey = np.where(y_m < 4.7, 0, 1 + ((y_m - 4.7) // STOREY)).astype(int)
    within = np.where(y_m < 4.7, y_m, (y_m - 4.7) % STOREY)
    base = np.array([26, 40, 62], np.float32)          # blue-black pane
    for s in range(STOREYS + 1):
        rows = storey == s
        if not rows.any():
            continue
        for c in range(nb):
            cols = col == c
            tone = rng.normal(0, 4)
            lit = rng.random() < .09                    # a lit office / curtain
            colr = base + tone + (np.array([46, 52, 58]) if lit else 0)
            img[np.ix_(rows, cols)] = colr
    # Spandrel band across the lower 1.0 m of every storey above the ground.
    span = (storey > 0) & (within < 1.0)
    img[span] = np.array([15, 20, 30], np.float32)
    # Ground floor: taller panes, spandrel only under 0.5 m.
    img[(storey == 0) & (within < .5)] = np.array([15, 20, 30], np.float32)
    # Sky reflection: a bright sweep that fades down the tower.
    sweep = np.clip((y_m - 10) / 60, 0, 1)[:, None, None]
    img += sweep * np.array([16, 20, 24], np.float32) * (0.6 + 0.4 * np.sin(x_m / 3.0))[None, :, None]
    # Mullions every bay (dark, 6 cm) and a slim transom under each pane.
    edge = np.abs(((x_m / bay) % 1.0) - .5) > .5 - .06 / bay
    img[:, edge] = np.array([9, 11, 15], np.float32)
    trans = np.abs(within - 1.0) < .035
    img[trans] = np.array([9, 11, 15], np.float32)
    img += rng.normal(0, 1.5, img.shape)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


PODIUM = {"podium_w": (["w97165331_e3", "w97165331_e4"], 25.0),
          "podium_s": (["w97165331_e5", "w97165331_e6", "w97165331_e7"], 13.7),
          "podium_e": (["w97165331_e8", "w97165331_e9", "w97165331_e10"], 26.7)}
P_STOREYS = 8


def draw_podium(width_m: float, seed: int) -> Image.Image:
    """The beige rendered podium (8 levels): a dark glazed ground floor and
    mezzanine, then six rows of white-framed window groups."""
    rng = np.random.default_rng(seed)
    h_m = P_STOREYS * STOREY + 1.0
    W, H = round(width_m * PPM), round(h_m * PPM)
    img = np.empty((H, W, 3), np.float32)
    img[:] = np.array([176, 168, 150], np.float32)
    img += rng.normal(0, 2.0, (H, W, 1))
    y_m = h_m - (np.arange(H) + .5) / PPM
    x_m = (np.arange(W) + .5) / PPM
    # dark glazed base, ground + mezzanine (0 .. 8.4 m)
    base = y_m < 8.4
    img[base] = np.array([34, 40, 50], np.float32)
    img[np.abs(y_m - 4.7) < .25] = np.array([20, 22, 26], np.float32)
    # window groups: 2.4 m wide, 1.5 m tall, one per 3.2 m bay, on each floor
    nb = max(1, round(width_m / 3.2))
    bay = width_m / nb
    for r in range(6):
        y0 = 8.4 + r * STOREY + 1.0
        rows = (y_m > y0) & (y_m < y0 + 1.5)
        for c in range(nb):
            cx = (c + .5) * bay
            cols = np.abs(x_m - cx) < 1.2
            frame = np.ix_(rows, cols)
            img[frame] = np.array([236, 236, 230], np.float32)
            inner_r = (y_m > y0 + .07) & (y_m < y0 + 1.43)
            inner_c = np.abs(x_m - cx) < 1.13
            tone = rng.normal(0, 5)
            img[np.ix_(inner_r, inner_c)] = np.array([96, 118, 150], np.float32) + tone
            for m in (-.38, .38):  # two mullions
                mc = np.abs(x_m - cx - m) < .03
                img[np.ix_(inner_r, mc)] = np.array([236, 236, 230], np.float32)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def main() -> None:
    todo = []
    for k, (name, (walls, length)) in enumerate(PODIUM.items()):
        d = ROOT / ".art" / "facades" / name
        d.mkdir(parents=True, exist_ok=True)
        im = draw_podium(length, 31 + k)
        im.save(d / "raw.png")
        im.save(d / "photo.png")
        for w, l in zip(walls, {"podium_w": [5.3, 19.7], "podium_s": [5.5, 6.9, 1.3],
                                "podium_e": [15.4, 3.5, 7.8]}[name]):
            todo.append({"id": w, "length": l})
    for k, (name, (walls, lengths)) in enumerate(WALLS.items()):
        d = ROOT / ".art" / "facades" / name
        d.mkdir(parents=True, exist_ok=True)
        im = draw(sum(lengths), 11 + k)
        im.save(d / "raw.png")
        im.save(d / "photo.png")
        todo += [{"id": w, "length": l} for w, l in zip(walls, lengths)]
    (ROOT / ".art" / "streetview" / "nbt_todo.json").write_text(json.dumps(todo, indent=1))
    print("drew", ", ".join(WALLS))


if __name__ == "__main__":
    main()
