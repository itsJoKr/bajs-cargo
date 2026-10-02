#!/usr/bin/env python3
"""Moves generic wall pictures out of the hero atlas onto shared facade-atlas tiles (download size).

    .venv/bin/python tool/shared_walls.py [--dry]

- Plaster firewalls: every `fw_` picture of `data/hero/firewall.json` drawn as procedural weathered
  plaster (tool/make_firewalls.py) becomes an entry of `data/plaster_walls.json` {"walls": {wall: [r, g, b]}}:
  the wall wears facade-atlas tile 49 (the seamless plaster of data/rear_walls.json) tinted so its mean
  colour is the picture's (the shader multiplies the tile's linear colour by the vertex tint).
- Fillers: every `fill_` picture of `data/hero/fill.json` (crops of a neighbour's facade,
  .art/streetview/fill/mk_fill.py) and every `fw_` corner strip cut from one becomes an entry of
  `data/generic_walls.json` {"walls": {wall: style}}: the wall is laid out in rows of a generic style
  (tool/prepare_textures.py GENERIC, data/facade_styles.json) in its building's paint. One style per
  building, chosen by its storeys; a building next to one with the same style takes the alternative.

The moved entries are appended to `.art/hero_moved/{firewall,fill}.json` (never a backup in data/hero/:
prepare_facades.py reads every file there). Rerunnable: it adds walls (later make_firewalls.py or
mk_fill.py output) and drops walls that have a hero picture again.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
HERO = ROOT / "data" / "hero"
MOVED = ROOT / ".art" / "hero_moved"
PLASTER_TILE, CELL, PAD = 49, 256, 16
# Storeys -> (style, alternative). Styles: tool/prepare_textures.py GENERIC.
BANDS = {
    1: ("gen_cottage", "gen_cottage"),
    2: ("gen_shutters", "gen_arched"),
    3: ("gen_arched", "gen_shutters"),
    4: ("gen_tenement", "gen_yellow"),
    5: ("gen_yellow", "gen_tenement"),
    6: ("gen_tall", "gen_yellow"),
}


def lin(a: np.ndarray) -> np.ndarray:
    a = a / 255.0
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def plaster_mean(rgb: np.ndarray) -> np.ndarray:
    """Mean linear colour of the plaster: pixels within 15% of the median brightness (no windows,
    downpipes or deep stains)."""
    px = lin(rgb.reshape(-1, 3).astype(np.float64))
    lum = px @ np.array([0.2126, 0.7152, 0.0722])
    med = np.median(lum)
    keep = np.abs(lum - med) < 0.15 * med
    return px[keep].mean(axis=0)


def tile_mean() -> np.ndarray:
    atlas = np.asarray(Image.open(ROOT / "assets" / "textures" / "facade_atlas.png").convert("RGB"))
    y, x = (PLASTER_TILE // 8) * CELL + PAD, (PLASTER_TILE % 8) * CELL + PAD
    return plaster_mean(atlas[y : y + CELL - 2 * PAD, x : x + CELL - 2 * PAD])


def load(path: Path, key: str) -> dict | list:
    return json.loads(path.read_text())[key] if path.exists() else ({} if key == "walls" else [])


def main() -> None:
    dry = "--dry" in sys.argv
    walls_all = {w["wall"]: w for w in json.loads((ROOT / ".art" / "walls_all.json").read_text())}
    fw = load(HERO / "firewall.json", "facades")
    fill = load(HERO / "fill.json", "facades")
    plaster = load(ROOT / "data" / "plaster_walls.json", "walls")
    generic = load(ROOT / "data" / "generic_walls.json", "walls")

    # Plaster firewalls.
    tile = tile_mean()
    moved_fw, keep_fw = [], []
    for f in fw:
        if "procedural weathered plaster" not in f["source"]:
            keep_fw.append(f)
            continue
        raw = np.asarray(Image.open(ROOT / ".art" / "facades" / f["name"] / "raw.png").convert("RGB"))
        tint = plaster_mean(raw) / tile
        plaster[f["edges"][0]] = [round(float(v), 3) for v in tint]
        moved_fw.append(f)

    # Fillers and the corner strips cut from them: one style per building.
    filler_walls = {f["edges"][0]: f["storeys"] for f in fill}
    strips = [f for f in keep_fw if "strip of fill_" in f["source"]]
    keep_fw = [f for f in keep_fw if f not in strips]
    building = lambda wall: wall.rsplit("_e", 1)[0]
    storeys: dict[str, int] = {}
    for wall, st in filler_walls.items():
        storeys[building(wall)] = max(storeys.get(building(wall), 0), st)
    for f in strips:
        storeys.setdefault(building(f["edges"][0]), f["storeys"])
    # Building corners (every edge end, from the dump), for neighbours.
    corners: dict[str, list[tuple[float, float]]] = {}
    for w in walls_all.values():
        (mx, mz), (nx, nz), half = w["mid"], w["n"], w["len"] / 2
        corners.setdefault(building(w["wall"]), []).extend([(mx + nz * half, mz - nx * half), (mx - nz * half, mz + nx * half)])

    def neighbours(b: str) -> set[str]:
        mine = corners.get(b, [])
        return {o for o, pts in corners.items() if o != b and any(math.dist(p, q) < 1.5 for p in mine for q in pts)}

    style_of = {building(w): s for w, s in generic.items()}
    for b in sorted(storeys):
        if b in style_of:
            continue
        first, alt = BANDS[min(6, max(1, storeys[b]))]
        taken = {style_of.get(o) for o in neighbours(b)}
        style_of[b] = alt if first in taken and alt not in taken else first
    for wall in filler_walls:
        generic[wall] = style_of[building(wall)]
    for f in strips:
        generic[f["edges"][0]] = style_of[building(f["edges"][0])]
    # The short street edges (corners, kinks) of a building with no picture of its own take its style too
    # (make_firewalls.py draws corner strips only from a real facade of the same building).
    framed = {e for path in HERO.glob("*.json") if path.stem not in ("atlas", "coverage", "firewall", "fill")
              for f in json.loads(path.read_text()).get("facades", []) for e in f["edges"]}
    taken = framed | {e for f in keep_fw for e in f["edges"]} | set(plaster)
    for w in walls_all.values():
        b = building(w["wall"])
        if (b in style_of and w["kind"] == "street" and 0.3 <= w["len"] < 6 and w["wall"] not in generic
                and w["wall"] not in taken and not any(building(e) == b for e in framed)):
            generic[w["wall"]] = style_of[b]

    # A wall that has a hero picture again (a delivery's facade, a new photo) leaves both lists.
    leaving = {f["name"] for f in moved_fw + strips + fill}
    pictured = {e for path in HERO.glob("*.json") if path.stem not in ("atlas", "coverage")
                for f in json.loads(path.read_text()).get("facades", []) if f["name"] not in leaving for e in f["edges"]}
    dropped = sorted((set(generic) | set(plaster)) & pictured)
    for wall in dropped:
        generic.pop(wall, None)
        plaster.pop(wall, None)
    if dropped:
        print("pictured again, dropped:", " ".join(dropped))
    print(f"plaster walls: {len(moved_fw)} moved, {len(plaster)} in data/plaster_walls.json")
    print(f"generic walls: {len(fill)} fillers + {len(strips)} corner strips, {len(generic)} in data/generic_walls.json, "
          f"{len(set(map(building, generic)))} buildings")
    counts: dict[str, int] = {}
    for s in generic.values():
        counts[s] = counts.get(s, 0) + 1
    print("styles:", dict(sorted(counts.items())))
    if dry:
        return
    MOVED.mkdir(parents=True, exist_ok=True)
    for name, items in (("firewall", moved_fw + strips), ("fill", fill)):
        backup = MOVED / f"{name}.json"
        old = load(backup, "facades")
        seen = {f["name"] for f in items}
        backup.write_text(json.dumps({"facades": [f for f in old if f["name"] not in seen] + items},
                                     indent=1, ensure_ascii=False) + "\n")
    (ROOT / "data" / "plaster_walls.json").write_text(json.dumps(
        {"note": "Walls that wear facade-atlas tile 49 (weathered plaster) in this linear tint instead of a "
                 "hero picture. tool/shared_walls.py", "walls": dict(sorted(plaster.items()))}, indent=1) + "\n")
    (ROOT / "data" / "generic_walls.json").write_text(json.dumps(
        {"note": "Walls laid out in a generic style (data/facade_styles.json gen_*) in their building's paint "
                 "instead of a hero picture. tool/shared_walls.py", "walls": dict(sorted(generic.items()))}, indent=1) + "\n")
    (HERO / "firewall.json").write_text(json.dumps({"facades": keep_fw}, indent=1, ensure_ascii=False))
    (HERO / "fill.json").write_text(json.dumps({"facades": []}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
