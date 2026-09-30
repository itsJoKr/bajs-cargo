"""Street tree textures: gen-image raws in .art/trees -> web3d/public/models.

    .venv/bin/python tool/prepare_trees.py

- leaves_plane.png, leaves_linden.png: leaf sprays on a #FF00FF screen,
  keyed to alpha and packed side by side (1024 x 512, plane left, linden
  right) into tree_leaves.jpg (colour) and tree_leaves_alpha.png.
  Transparent pixels take the colour of the nearest leaves so mipmaps and
  alpha-testing show no magenta fringe.
- bark_plane.png, bark_dark.png: bark, cropped of any vignette and made
  tileable, 512 x 512 JPEGs.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / ".art" / "trees"
OUT = ROOT / "web3d" / "public" / "models"
CELL = 512


def box_blur(a: np.ndarray, radius: int) -> np.ndarray:
    """Float box blur (edge-clamped), separable via cumulative sums."""
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (radius + 1, radius)
        c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis)
        n = a.shape[axis]
        hi = np.take(c, np.arange(2 * radius + 1, 2 * radius + 1 + n), axis=axis)
        lo = np.take(c, np.arange(0, n), axis=axis)
        a = (hi - lo) / (2 * radius + 1)
    return a


def key_leaves(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGB").resize((CELL, CELL), Image.Resampling.LANCZOS)
    r, g, b = np.moveaxis(np.asarray(im, np.float32), -1, 0)
    # Magenta-ness: how far red and blue both rise above green.
    m = np.minimum(r, b) - g
    alpha = np.clip(1 - (m - 20) / 60, 0, 1)
    # Round the spray off: leaves cut by the picture's border would draw
    # straight card edges into the crown's silhouette.
    # A lumpy outline (radius plus smooth noise), not a clean circle.
    yy, xx = np.mgrid[0:CELL, 0:CELL]
    radius = np.hypot(xx - CELL / 2, yy - CELL / 2) / (CELL / 2)
    noise = np.random.default_rng(len(path.stem)).random((6, 6)).astype(np.float32)
    lumps = np.asarray(Image.fromarray(noise * 255).convert("L").resize((CELL, CELL), Image.Resampling.BICUBIC), np.float32) / 255
    alpha = alpha * np.clip((0.92 - radius + 0.35 * (lumps - 0.5)) / 0.25, 0, 1)
    # Despill: pull the red and blue of edge pixels down towards green.
    # Leaves and twigs never have blue above green; magenta spill does.
    tainted = (b > g * 0.95) | ((r > g) & (b > g * 0.7))
    r = np.where(tainted, np.minimum(r, g), r)
    b = np.where(tainted, np.minimum(b, g * 0.75), b)
    rgb = np.stack([r, g, b], -1).clip(0, 255)
    # Bleed the leaf colours outward into the transparent area, widening.
    known = alpha > 0.97
    filled = np.where(known[..., None], rgb, 0)
    for radius in (2, 6, 16, 48, 128):
        w = box_blur(known.astype(np.float32), radius)
        acc = np.stack([box_blur(filled[..., k] * known, radius) for k in range(3)], -1)
        new = ~known & (w > 0.01)
        filled = np.where(new[..., None], acc / np.maximum(w[..., None], 1e-3), filled)
        known = known | new
    return Image.fromarray(np.dstack([filled, alpha * 255]).clip(0, 255).astype(np.uint8), "RGBA")


def make_tileable(path: Path, inset: float) -> Image.Image:
    """Offset by half (the picture's seamless middle becomes the wrapping
    edge), then cover the seam cross now in the middle with a feathered band
    of the unshifted picture, whose middle is seamless."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    im = im.crop((int(w * inset), int(h * inset), int(w * (1 - inset)), int(h * (1 - inset))))
    a = np.asarray(im.resize((CELL, CELL), Image.Resampling.LANCZOS), np.float32)
    rolled = np.roll(a, (CELL // 2, CELL // 2), (0, 1))
    t = np.abs(np.linspace(-1, 1, CELL))  # 0 on the middle lines, 1 at the edges
    near = np.clip(1.4 - t / 0.25, 0, 1)
    band = np.maximum(near[:, None], near[None, :])[..., None]
    out = rolled * (1 - band) + a * band
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    atlas = Image.new("RGBA", (2 * CELL, CELL))
    for i, name in enumerate(["leaves_plane", "leaves_linden"]):
        atlas.paste(key_leaves(RAW / f"{name}.png"), (i * CELL, 0))
    # Colour and alpha apart: a browser canvas premultiplies alpha and would
    # lose the bled colour that trees.ts needs for its mip levels.
    atlas.convert("RGB").save(OUT / "tree_leaves.jpg", quality=90)
    atlas.getchannel("A").save(OUT / "tree_leaves_alpha.png", optimize=True)
    (OUT / "tree_leaves.png").unlink(missing_ok=True)
    make_tileable(RAW / "bark_plane.png", 0.02).save(OUT / "tree_bark_plane.jpg", quality=85)
    make_tileable(RAW / "bark_dark.png", 0.12).save(OUT / "tree_bark_dark.jpg", quality=85)
    print("wrote", ", ".join(p.name for p in sorted(OUT.glob("tree_*"))))


if __name__ == "__main__":
    main()
