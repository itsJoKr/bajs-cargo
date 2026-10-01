#!/usr/bin/env python3
"""Draws the glass curtain wall of the Ilica 1 Neboder tower (Street
View Jul 2024: mid steel-blue reflecting panes, pale grey-blue spandrel band per storey, thin
mullions) as straight-on pictures at a true aspect: 40 px/m.

The tower is the whole OSM outline w97165331 (13.4 m on Ilica, 26 m deep:
Google 3D and Street View, 2026-09-30); the beige block with the cross
portal and Mocca Pizza west of it is the neighbour w375381225. The Ilica
face keeps its real glazed lobby and mezzanine (cut from the redrawn
Street View montage .art/facades/ilica_neboder/raw.png).

    .venv/bin/python tool/make_glass_tower.py

Writes .art/facades/tower_{n,e,s,w}/{photo,raw}.png and
.art/streetview/nbt_todo.json (wall lengths for tool/prepare_facades.py).
"""
import json, math
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PPM, STOREY, STOREYS = 40, 3.7, 18
H_M = STOREYS * STOREY + 1.0
BAY = 1.25
# Edges of w97165331's cleaned ring, left to right as seen from outside.
WALLS = {"tower_n": (["w97165331_e0", "w97165331_e1"], [9.1, 4.4]),
         "tower_w": (["w97165331_e2", "w97165331_e3", "w97165331_e4"], [1.4, 5.3, 19.7]),
         "tower_s": (["w97165331_e5", "w97165331_e6", "w97165331_e7"], [5.5, 6.9, 1.3]),
         "tower_e": (["w97165331_e8", "w97165331_e9", "w97165331_e10"], [15.4, 3.5, 7.8])}
BASE_M = 4.7 + STOREY          # ground floor + glazed mezzanine under the curtain wall


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
    base = np.array([86, 112, 142], np.float32)        # steel-blue pane (Street View Jul 2024)
    for s in range(STOREYS + 1):
        rows = storey == s
        if not rows.any():
            continue
        for c in range(nb):
            cols = col == c
            tone = rng.normal(0, 4)
            lit = rng.random() < .09                    # a lit office / curtain
            colr = base + tone * 1.6 + (np.array([50, 50, 40]) if lit else 0)
            img[np.ix_(rows, cols)] = colr
    # Spandrel band across the lower 1.0 m of every storey above the ground.
    span = (storey > 0) & (within < 1.0)
    img[span] = np.array([132, 146, 158], np.float32)
    # Ground floor: taller panes, spandrel only under 0.5 m.
    img[(storey == 0) & (within < .5)] = np.array([96, 108, 120], np.float32)
    # Sky reflection: a bright sweep that fades down the tower.
    sweep = np.clip((y_m - 10) / 60, 0, 1)[:, None, None]
    img += sweep * np.array([24, 28, 30], np.float32) * (0.6 + 0.4 * np.sin(x_m / 3.0))[None, :, None]
    # Mullions every bay (dark, 6 cm) and a slim transom under each pane.
    edge = np.abs(((x_m / bay) % 1.0) - .5) > .5 - .06 / bay
    img[:, edge] = np.array([58, 70, 84], np.float32)
    trans = np.abs(within - 1.0) < .035
    img[trans] = np.array([58, 70, 84], np.float32)
    img += rng.normal(0, 1.5, img.shape)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def ilica_base(width_m: float) -> Image.Image:
    """The tower's Ilica ground floor and mezzanine from the redrawn photo
    (74 px/m, 1000 x 2267 for 13.5 x 30.6 m): the glazed lobby with its door
    (cols 0-412) and the glazed bank front right of the cross portal (cols
    745-1000, standing in for the Erste front hidden by an advert), pieced
    to the wall's width and scaled to BASE_M."""
    src = Image.open(ROOT / ".art/facades/ilica_neboder/raw.png").convert("RGB")
    rows = (1540, 2267)
    piece = lambda c0, c1: src.crop((c0, rows[0], c1, rows[1]))
    parts = [piece(0, 412), piece(255, 412), piece(745, 1000), piece(0, 160)]
    strip = Image.new("RGB", (sum(p.width for p in parts), rows[1] - rows[0]))
    x = 0
    for p in parts:
        strip.paste(p, (x, 0))
        x += p.width
    return strip.resize((round(width_m * PPM), round(BASE_M * PPM)), Image.LANCZOS)


def main() -> None:
    todo = []
    for k, (name, (walls, lengths)) in enumerate(WALLS.items()):
        d = ROOT / ".art" / "facades" / name
        d.mkdir(parents=True, exist_ok=True)
        im = draw(sum(lengths), 11 + k)
        if name == "tower_n":
            base = ilica_base(sum(lengths))
            im.paste(base, (0, im.height - base.height))
        im.save(d / "raw.png")
        im.save(d / "photo.png")
        todo += [{"id": w, "length": l} for w, l in zip(walls, lengths)]
    (ROOT / ".art" / "streetview" / "nbt_todo.json").write_text(json.dumps(todo, indent=1))
    print("drew", ", ".join(WALLS))


if __name__ == "__main__":
    main()
