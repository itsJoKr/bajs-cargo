#!/usr/bin/env python3
"""Cuts a gen-image feature drawing (a sign, a logo) out of its solid
#00FF00 background and trims it, for web3d/public/features/.

    .venv/bin/python tool/key_feature.py .art/features/<name>/sign.png <name>.png [max_width]

Green-screen keying: alpha falls off with how green a pixel is compared to
its red and blue, and the green spill on the edges is pulled back.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
src, name = Path(sys.argv[1]), sys.argv[2]
max_width = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
a = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
greenness = g - np.maximum(r, b)
alpha = np.clip(1 - (greenness - 40) / 80, 0, 1)
# Despill: green no brighter than the brighter of red and blue.
a[..., 1] = np.minimum(g, np.maximum(r, b) + 10)
rgba = np.dstack([a, alpha * 255]).astype(np.uint8)
im = Image.fromarray(rgba, "RGBA")
box = im.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox()
if box:
    pad = 8
    im = im.crop((max(0, box[0] - pad), max(0, box[1] - pad),
                  min(im.width, box[2] + pad), min(im.height, box[3] + pad)))
if im.width > max_width:
    im = im.resize((max_width, round(im.height * max_width / im.width)), Image.Resampling.LANCZOS)
out = ROOT / "web3d" / "public" / "features" / name
out.parent.mkdir(parents=True, exist_ok=True)
im.save(out, optimize=True)
print(f"{out.relative_to(ROOT)}: {im.width}x{im.height}, aspect {im.width / im.height:.2f}")
