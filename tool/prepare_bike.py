"""Bike and rider textures: .art/bike/<name>.png (gen-image raws) -> web3d/public/models/bike_<name>.jpg.

Each raw is made seamless (cross-faded with a copy shifted by half its size, so the seams fall in
the copy's middle) and downscaled.  .venv/bin/python tool/prepare_bike.py
The coat and hair raws go into the outfit atlas instead (tool/make_outfits.py).
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / '.art' / 'bike'
DST = ROOT / 'web3d' / 'public' / 'models'
SIZE = {'plastic': 512, 'frame': 256, 'wool': 512, 'tyre': 256}


def seamless(a: np.ndarray) -> np.ndarray:
    h, w = a.shape[:2]
    shifted = np.roll(a, (h // 2, w // 2), axis=(0, 1))
    # Weight of the original: 1 in the middle, 0 at the edges (where its seams are).
    y = 1 - np.abs(np.linspace(-1, 1, h))[:, None]
    x = 1 - np.abs(np.linspace(-1, 1, w))[None, :]
    m = np.clip(np.minimum(y, x) * 3, 0, 1)[..., None]
    return a * m + shifted * (1 - m)


for name, size in SIZE.items():
    a = np.asarray(Image.open(SRC / f'{name}.png').convert('RGB')).astype(np.float32)
    out = Image.fromarray(np.clip(seamless(a), 0, 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    out.save(DST / f'bike_{name}.jpg', quality=88)
    print(f'bike_{name}.jpg {size}px')
