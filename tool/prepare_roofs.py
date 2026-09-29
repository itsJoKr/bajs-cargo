#!/usr/bin/env python3
"""Packs the roof set into the web build's roof atlas.

    .venv/bin/python tool/prepare_roofs.py

Reads the gen-image raws `.art/gen/roof_*/roof_*.png` (prompts in
tool/gen_textures.sh) and writes:

- `assets/textures/roof_atlas.png`: 1536 x 1536, 3 x 3 cells of 512 px, each
  a 480 px seamless tile with 16 px of wrapped padding (the atlas material
  samples only the inner part, like the other atlases);
- `data/roofs.json`: per roof its cell and how many metres one tile covers
  (from the row or seam count its prompt fixed), which tool/src/roofs.dart
  reads to pick and scale each building's roof.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare_textures import seamless  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / ".art" / "gen"
CELL, PAD = 512, 16
INNER = CELL - 2 * PAD
COLUMNS = 3

# name -> metres one tile covers along the eave and down the slope.
# 12 beaver-tail rows at ~18 cm, 10 interlocking rows at ~33 cm, 8 seams at
# ~55 cm, and so on.
ROOFS = {
    "roof_biber_old": 2.2,
    "roof_clay_red": 3.3,
    "roof_clay_brown": 2.4,
    "roof_clay_pale": 2.3,
    "roof_slate_grey": 2.6,
    "roof_zinc_dark": 4.4,
    "roof_copper_green": 4.4,
    "roof_flat_gravel": 3.5,
}


def main() -> None:
    atlas = np.zeros((CELL * COLUMNS, CELL * COLUMNS, 4), np.float32)
    table = {}
    for i, (name, metres) in enumerate(ROOFS.items()):
        path = RAW / name / f"{name}.png"
        if not path.exists():
            print(f"missing {path}")
            continue
        img = Image.open(path).convert("RGB").resize((INNER, INNER), Image.Resampling.LANCZOS)
        tile = seamless(np.asarray(img).astype(np.float32))
        cell = np.pad(tile, ((PAD, PAD), (PAD, PAD), (0, 0)), mode="wrap")
        r, c = divmod(i, COLUMNS)
        atlas[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL, :3] = cell
        # Alpha 255: the vertex colour (a near-neutral per-building shade,
        # tool/src/roofs.dart) applies to the whole tile.
        atlas[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL, 3] = 255
        table[name.removeprefix("roof_")] = {"tile": i, "metres": metres}
        print(f"{i} {name}: {metres} m per tile")
    out = ROOT / "assets" / "textures" / "roof_atlas.png"
    Image.fromarray(np.clip(atlas, 0, 255).astype(np.uint8), "RGBA").save(out, optimize=True)
    (ROOT / "data" / "roofs.json").write_text(
        json.dumps({"columns": COLUMNS, "roofs": table}, indent=2) + "\n"
    )
    print(f"wrote {out.relative_to(ROOT)} and data/roofs.json")


if __name__ == "__main__":
    main()
