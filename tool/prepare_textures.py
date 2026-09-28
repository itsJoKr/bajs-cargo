#!/usr/bin/env python3
"""Builds the style-kit atlases from the gen-image raws.

    .venv/bin/python tool/prepare_textures.py

Reads the git-ignored raws in `.art/gen/<name>/<name>.png` (made by
`tool/gen_textures.sh`, whose header lists every prompt) and writes:

- `assets/textures/facade_atlas.png`: 2048 x 2048, 8 x 8 cells of 256 px.
  Style k (in STYLES order) owns cells 4k..4k+3: ground floor, first floor,
  upper storey (repeats vertically), cornice. Cell 48 is plain stucco for
  gables and party walls.
- `assets/textures/surface_atlas.png`: 1024 x 1024, 4 x 4 cells (SURFACES).
- `data/facade_styles.json`: each style's tile ids and metre proportions,
  which `tool/generate_zagreb.dart` reads to lay bays and storeys out.

Every cell holds a 224 px tile with 16 px of padding: wrapped tile content
on axes the tile repeats along, clamped edge pixels on the others, so
filtering at a tile edge never reaches a neighbouring cell
(`assets/materials/city_atlas.fmat` samples only the inner 224 px).

Alpha is the tint mask the material multiplies vertex colour through:
255 on plain stucco (so each building gets its own paint colour), falling
to 0 on glass, frames, stone trims and ornament, which keep their colour.
Facades are also levelled so their stucco lands on the same light grey.

Facade cuts: the bay period and the cut column in the wall between two
windows are detected (tool/facade_cuts.py); the storey rows were read off
ruler overlays by eye and live in tool/facade_overrides.json.

Rerunning on the same raws reproduces the same PNGs (no randomness, the
procedural tiles use fixed seeds).
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from facade_cuts import cuts  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / ".art" / "gen"
CELL, PAD = 256, 16
INNER = CELL - 2 * PAD
STUCCO = np.array([230.0, 226.0, 218.0])

STYLES = [
    "historicist_a",
    "historicist_b",
    "historicist_plain",
    "secession_floral",
    "secession_late",
    "interwar",
    "postwar",
    "baroque_upper",
    "biedermeier",
    "arcade",
    "commercial",
    "courtyard",
]
PLAIN_TILE = 48

# Surface atlas tile ids; tool/src/ground.dart's Surface enum and the tree
# mesh use the same numbers.
SURFACES = {
    0: "surf_asphalt",
    1: "surf_sidewalk",
    2: "surf_square",
    3: "surf_grass",
    4: "surf_gravel",
    5: "surf_kerb",
    6: "surf_roof_clay",
    7: "surf_roof_flat",
    8: "surf_roof_copper",
    9: "@rails",
    10: "@foliage",
    11: "@bark",
    12: "surf_cobbles",
    13: "surf_stucco",
    14: "@stone",
    15: "@water",
}


def load(name: str) -> np.ndarray:
    return np.asarray(Image.open(RAW / name / f"{name}.png").convert("RGB")).astype(
        np.float32
    )


def resize(a: np.ndarray, w: int, h: int) -> np.ndarray:
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return np.asarray(im.resize((w, h), Image.Resampling.LANCZOS)).astype(np.float32)


def seam_blend_x(img: np.ndarray, x0: int, p: int, band: int = 14) -> np.ndarray:
    """One period [x0, x0 + p) whose right edge runs on into its left edge."""
    tile = img[:, x0 : x0 + p].copy()
    for t in range(band):
        w = (t + 0.5) / band
        s = w * w * (3 - 2 * w)
        nxt = img[:, (x0 + p + t) % img.shape[1]]
        tile[:, t] = nxt * (1 - s) + tile[:, t] * s
    return tile


def seam_blend_y(img: np.ndarray, y0: int, y1: int, band: int = 10) -> np.ndarray:
    """Rows [y0, y1) whose top row runs on from the tile's own bottom row
    (the storey repeats upward)."""
    tile = img[y0:y1].copy()
    for t in range(band):
        w = (t + 0.5) / band
        s = w * w * (3 - 2 * w)
        below = img[min(y1 + t, img.shape[0] - 1)]
        tile[t] = below * (1 - s) + tile[t] * s
    return tile


def cell(tile: np.ndarray, wrap_x: bool, wrap_y: bool) -> np.ndarray:
    inner = resize(tile, INNER, INNER)
    mode_x = "wrap" if wrap_x else "edge"
    mode_y = "wrap" if wrap_y else "edge"
    out = np.pad(inner, ((PAD, PAD), (0, 0), (0, 0)), mode=mode_y)
    out = np.pad(out, ((0, 0), (PAD, PAD), (0, 0)), mode=mode_x)
    return out


def wall_colour(img: np.ndarray) -> np.ndarray:
    """The facade's stucco colour: the most common bright colour."""
    flat = img.reshape(-1, 3)
    bright = flat[flat.mean(axis=1) > 150]
    q = (bright // 6).astype(np.int32)
    keys = q[:, 0] * 10000 + q[:, 1] * 100 + q[:, 2]
    values, counts = np.unique(keys, return_counts=True)
    top = values[np.argmax(counts)]
    mask = keys == top
    return bright[mask].mean(axis=0)


def tint_mask(rgb: np.ndarray, wall: np.ndarray) -> np.ndarray:
    # Distance mostly in chroma and a little in brightness, so weathering
    # stains on stucco still count as stucco while glass and dark frames
    # do not. Softened, so the paint does not end in a hard pixel line.
    lum = rgb.mean(axis=-1, keepdims=True)
    wall_lum = wall.mean()
    chroma = np.sqrt((((rgb - lum) - (wall - wall_lum)) ** 2).sum(axis=-1))
    bright = np.abs(lum[..., 0] - wall_lum)
    d = chroma * 1.4 + bright * 0.55
    t = np.clip((d - 12.0) / (34.0 - 12.0), 0.0, 1.0)
    mask = 255.0 * (1.0 - t * t * (3 - 2 * t))
    im = Image.fromarray(mask.astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    return np.asarray(im).astype(np.float32)


def facade_cells(name: str, cut: dict) -> tuple[list[np.ndarray], dict]:
    img = load(name)
    wall = wall_colour(img)
    # Level the stucco to the shared light grey.
    img = np.clip(img * (STUCCO / wall), 0, 255)
    wall = STUCCO
    p, x0 = cut["P"], cut["x0"]
    c, u, f, g, h = cut["c"], cut["u"], cut["f"], cut["g"], cut["h"]
    column = seam_blend_x(img, x0, p)
    rows = {
        "ground": (column[g:h], False),
        "first": (column[f:g], False),
        "upper": (seam_blend_y(column, u, f), True),
        "cornice": (column[0:c], False),
    }
    cells = []
    for key in ("ground", "first", "upper", "cornice"):
        rgb, wrap_y = rows[key]
        rgb_cell = cell(rgb, True, wrap_y)
        alpha = tint_mask(rgb_cell, wall)
        cells.append(np.dstack([rgb_cell, alpha]))
    metres = cut["storey"] / (f - u)
    info = {
        "bay": round(p * metres, 3),
        "ground": round((h - g) * metres, 3),
        "first": round((g - f) * metres, 3),
        "upper": round(cut["storey"], 3),
        "cornice": round(c * metres, 3),
    }
    return cells, info


def seamless(tile: np.ndarray) -> np.ndarray:
    """Hides a tile's wrap seam when the raw is not seamless already: the
    edges are replaced, smoothly, by the half-offset copy, whose own seam
    sits where the original is kept."""
    h, w = tile.shape[:2]
    edge_x = np.abs(tile[:, 0] - tile[:, -1]).mean()
    step_x = np.abs(np.diff(tile, axis=1)).mean()
    edge_y = np.abs(tile[0] - tile[-1]).mean()
    step_y = np.abs(np.diff(tile, axis=0)).mean()
    if edge_x < step_x * 1.6 and edge_y < step_y * 1.6:
        return tile
    rolled = np.roll(np.roll(tile, h // 2, axis=0), w // 2, axis=1)
    yy, xx = np.mgrid[0:h, 0:w]
    dx = np.minimum(xx, w - 1 - xx) / (w * 0.12)
    dy = np.minimum(yy, h - 1 - yy) / (h * 0.12)
    m = np.clip(np.minimum(dx, dy), 0, 1)[..., None]
    m = m * m * (3 - 2 * m)
    return tile * m + rolled * (1 - m)


def procedural(kind: str) -> np.ndarray:
    rng = np.random.default_rng({"rails": 1, "foliage": 2, "bark": 3,
                                 "stone": 4, "water": 5}[kind])
    n = INNER

    def noise(scale: int, amp: float) -> np.ndarray:
        g = rng.random((scale, scale))
        im = Image.fromarray((g * 255).astype(np.uint8)).resize(
            (n, n), Image.Resampling.BICUBIC
        )
        return (np.asarray(im).astype(np.float32) / 255 - 0.5) * amp

    if kind == "rails":
        base = np.full((n, n, 3), [118.0, 112.0, 106.0])
        streak = noise(8, 30)[..., None] + noise(32, 14)[..., None]
        # Polished running band along the middle of the strip.
        xs = np.abs(np.linspace(-1, 1, n))[None, :, None]
        shine = np.clip(1 - xs * 1.6, 0, 1) * 55
        return np.clip(base + streak + shine, 0, 255)
    if kind == "foliage":
        base = np.array([88.0, 116.0, 58.0])
        leaves = noise(48, 90)[..., None] + noise(12, 40)[..., None]
        return np.clip(base + leaves * np.array([0.6, 1.0, 0.45]), 0, 255)
    if kind == "bark":
        base = np.array([96.0, 82.0, 70.0])
        grain = noise(6, 30)[..., None] + np.repeat(noise(64, 60)[:, :1], n, 1)[..., None]
        return np.clip(base + grain, 0, 255)
    if kind == "stone":
        base = np.array([196.0, 190.0, 178.0])
        return np.clip(base + noise(16, 22)[..., None] + noise(64, 14)[..., None], 0, 255)
    base = np.array([70.0, 104.0, 118.0])
    return np.clip(base + noise(8, 20)[..., None], 0, 255)


def surface_cell(tile_id: int, name: str) -> np.ndarray:
    if name.startswith("@"):
        rgb = procedural(name[1:])
    else:
        rgb = resize(seamless(load(name)), INNER, INNER)
    padded = np.pad(rgb, ((PAD, PAD), (PAD, PAD), (0, 0)), mode="wrap")
    return np.dstack([padded, np.full(padded.shape[:2], 255.0)])


def save(atlas: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(atlas, 0, 255).round().astype(np.uint8), "RGBA").save(
        path, optimize=True
    )


def main() -> None:
    overrides = json.loads((ROOT / "tool" / "facade_overrides.json").read_text())
    facade = np.zeros((8 * CELL, 8 * CELL, 4), dtype=np.float32)
    styles = {}
    for k, style in enumerate(STYLES):
        name = f"facade_{style}"
        cut = cuts(RAW / name / f"{name}.png", overrides[name])
        cut["h"] = cut["h"]
        cells, info = facade_cells(name, cut)
        for r, c in enumerate(cells):
            index = k * 4 + r
            y, x = (index // 8) * CELL, (index % 8) * CELL
            facade[y : y + CELL, x : x + CELL] = c
        info.update({"tiles": [k * 4 + r for r in range(4)]})
        styles[style] = info
        print(f"{style:18s} {info}")
    plain = surface_cell(PLAIN_TILE, "surf_stucco")
    y, x = (PLAIN_TILE // 8) * CELL, (PLAIN_TILE % 8) * CELL
    facade[y : y + CELL, x : x + CELL] = plain
    save(facade, ROOT / "assets" / "textures" / "facade_atlas.png")

    surface = np.zeros((4 * CELL, 4 * CELL, 4), dtype=np.float32)
    for tile_id, name in SURFACES.items():
        y, x = (tile_id // 4) * CELL, (tile_id % 4) * CELL
        surface[y : y + CELL, x : x + CELL] = surface_cell(tile_id, name)
    save(surface, ROOT / "assets" / "textures" / "surface_atlas.png")

    out = ROOT / "data" / "facade_styles.json"
    out.write_text(
        json.dumps(
            {"plainTile": PLAIN_TILE, "columns": 8, "styles": styles}, indent=2
        )
        + "\n"
    )
    print("wrote facade_atlas.png, surface_atlas.png, data/facade_styles.json")


if __name__ == "__main__":
    main()
