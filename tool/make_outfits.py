"""The rider's wardrobe atlas: web3d/public/models/outfits.jpg, one row of 128 px greyscale cells.

Cells (outfit.ts `FABRICS` / `HAIR_CELL` index them): melton, tweed, herringbone, houndstooth,
glen check, corduroy, hair. The game tints them with the chosen colour, so they are neutral grey
with a mean LINEAR value of MEAN (outfit.ts divides the colour by the same number). The woven ones
are colour-and-weave drafts in a 2/2 twill, periodic on the tile by construction; every cloth wears
the felt of the gen-image coat (.art/bike/coat.png) and the hair is .art/bike/hair.png, both made
seamless as in prepare_bike.py.  .venv/bin/python tool/make_outfits.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / '.art' / 'bike'
DST = ROOT / 'web3d' / 'public' / 'models' / 'outfits.jpg'
N = 128
MEAN = 0.5

y, x = np.mgrid[0:N, 0:N].astype(np.float64)


def seamless(a: np.ndarray) -> np.ndarray:
    h, w = a.shape[:2]
    shifted = np.roll(a, (h // 2, w // 2), axis=(0, 1))
    yy = 1 - np.abs(np.linspace(-1, 1, h))[:, None]
    xx = 1 - np.abs(np.linspace(-1, 1, w))[None, :]
    m = np.clip(np.minimum(yy, xx) * 3, 0, 1)[..., None]
    return a * m + shifted * (1 - m)


def lin(v):
    v = np.asarray(v, dtype=np.float64)
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def srgb(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055)


def raw_lum(name: str) -> np.ndarray:
    """A gen-image raw as linear luminance, seamless, N px."""
    a = np.asarray(Image.open(SRC / f'{name}.png').convert('RGB')).astype(np.float64)
    a = seamless(a)
    small = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).resize((N, N), Image.LANCZOS)
    rgb = lin(np.asarray(small).astype(np.float64) / 255)
    return rgb @ np.array([0.2126, 0.7152, 0.0722])


def noise(seed: int, lo: float, hi: float) -> np.ndarray:
    """Band-limited noise (lo..hi cycles a tile), periodic on the tile, unit deviation."""
    rng = np.random.default_rng(seed)
    f = np.fft.fft2(rng.standard_normal((N, N)))
    r = np.hypot(np.fft.fftfreq(N)[:, None], np.fft.fftfreq(N)[None, :]) * N
    a = np.fft.ifft2(f * ((r >= lo) & (r <= hi))).real
    return a / a.std()


def weave(warp, weft, t: int, flip=None):
    """A 2/2 twill of threads [t] px wide: warp thread i runs down the columns, weft j along the rows,
    each with the reflectance its list gives (cycled). [flip]: per warp thread, reverses the twill
    (herringbone). Each float gets a soft round relief across its thread."""
    i = (x // t).astype(int)
    j = (y // t).astype(int)
    s = np.ones_like(i) if flip is None else np.asarray(flip)[i % len(flip)]
    up = ((i + s * j) % 4) < 2
    warp, weft = np.asarray(warp, dtype=np.float64), np.asarray(weft, dtype=np.float64)
    c = np.where(up, warp[i % len(warp)], weft[j % len(weft)])
    across = np.where(up, (x % t + 0.5) / t, (y % t + 0.5) / t)
    return c * (0.8 + 0.2 * np.sin(np.pi * across))


felt = raw_lum('coat')
felt = felt / felt.mean()
fibre = 1 + 0.06 * noise(7, 20, 64)
L, D = 0.9, 0.16  # light and dark yarn

cells = {}
cells['melton'] = felt * (1 + 0.04 * noise(1, 2, 10))
rng = np.random.default_rng(3)
heather = lambda n: 0.45 + 0.4 * rng.random(n)  # noqa: E731 (a heathered yarn per thread)
tweed = weave(heather(64), heather(64), 2)
flecks = rng.random((N, N))
tweed = np.where(flecks > 0.985, 1.0, np.where(flecks < 0.012, 0.1, tweed))
cells['tweed'] = tweed * (1 + 0.08 * noise(4, 3, 12))
cells['herringbone'] = weave([D], [L], 2, flip=[1] * 8 + [-1] * 8)
cells['houndstooth'] = weave([D] * 4 + [L] * 4, [D] * 4 + [L] * 4, 4)
glen = ([D] * 4 + [L] * 4) * 2 + ([D] * 2 + [L] * 2) * 4
cells['glencheck'] = weave(glen, glen, 2)
wale = (x % 8 + 0.5) / 8
cells['corduroy'] = (0.3 + 0.65 * np.sin(np.pi * wale) ** 0.7) * (1 + 0.05 * noise(5, 8, 40))

out = []
for name, c in cells.items():
    c = c * fibre * (felt ** 0.5 if name != 'melton' else 1)
    out.append(c * (MEAN / c.mean()))
    print(f'{name:12s} max {out[-1].max():.2f} clipped {(out[-1] > 1).mean() * 100:.1f}%')

# Hair: the strands, their contrast eased (the tint brightens a blond's highlights twice over).
hair = raw_lum('hair')
hair = (hair / hair.mean()) ** 0.7
out.append(hair * (MEAN / hair.mean()))
print(f'hair         max {out[-1].max():.2f}, deviation {out[-1].std():.3f}')

atlas = np.concatenate(out, axis=1)
img = Image.fromarray((srgb(atlas) * 255 + 0.5).astype(np.uint8), 'L')
img.save(DST, quality=88)
print(f'{DST.relative_to(ROOT)}: {img.width}x{img.height}, {DST.stat().st_size // 1024} KB')
