#!/usr/bin/env python3
"""Finds where to cut a generated facade elevation into atlas cells.

A facade raw (tool/gen_textures.sh) shows four identical window bays over a
ground floor, one or more storeys and a cornice. This finds:

- the bay period P and a cut column x0 in the wall between two windows
  (autocorrelation of the column darkness profile, P near width / 4);
- the window bands, from the row darkness profile of the upper part;
- from those, the storey period T, the top of the ground floor (yg), the
  top of the first floor (y1) and the bottom of the cornice (yc).

`cuts(path, override)` returns them; overrides (tool/facade_overrides.json)
replace any detected value that a look at the overlay shows is wrong.

    .venv/bin/python tool/facade_cuts.py      # writes overlays to .art/cuts/
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / ".art" / "gen"
OVERRIDES = ROOT / "tool" / "facade_overrides.json"


def darkness(img: np.ndarray) -> np.ndarray:
    lum = img[..., :3].astype(np.float32) @ np.array([0.299, 0.587, 0.114])
    return 1.0 - lum / 255.0


def smooth(v: np.ndarray, k: int) -> np.ndarray:
    kernel = np.ones(k) / k
    return np.convolve(np.pad(v, k, mode="edge"), kernel, mode="same")[k:-k]


def period(profile: np.ndarray, lo: int, hi: int) -> int:
    p = profile - profile.mean()
    best, best_lag = -1e9, lo
    for lag in range(lo, hi + 1):
        c = float(np.dot(p[:-lag], p[lag:])) / (len(p) - lag)
        if c > best:
            best, best_lag = c, lag
    return best_lag


def bands(profile: np.ndarray, threshold: float) -> list[tuple[int, int]]:
    above = profile > threshold
    out, start = [], None
    for i, a in enumerate(above):
        if a and start is None:
            start = i
        elif not a and start is not None:
            if i - start > 8:
                out.append((start, i))
            start = None
    if start is not None and len(profile) - start > 8:
        out.append((start, len(profile)))
    return out


def cuts(path: Path, override: dict | None = None) -> dict:
    img = np.asarray(Image.open(path).convert("RGB"))
    h, w = img.shape[:2]
    d = darkness(img)
    # Bays: columns through windows are darker than wall columns.
    cols = smooth(d[int(h * 0.12) : int(h * 0.7)].mean(axis=0), 5)
    p = period(cols, int(w * 0.2), int(w * 0.3))
    # Cut in the wall: the lightest column in the first period.
    x0 = int(np.argmin(cols[: p]))
    # Storeys: rows through the windows of the upper floors are darker.
    rows = smooth(d[:, :].mean(axis=1), 5)
    thr = float(np.percentile(rows, 55))
    found = bands(rows, thr)
    result = {"w": w, "h": h, "P": p, "x0": x0, "bands": found}
    # Window bands above the ground floor (the ground floor band is the one
    # reaching into the bottom fifth).
    upper = [b for b in found if b[1] < h * 0.8 and b[0] > h * 0.03]
    if len(upper) >= 2:
        centres = [(a + b) / 2 for a, b in upper]
        T = float(np.median(np.diff(centres)))
        first = upper[-1]
        gap_below = None
        ground_bands = [b for b in found if b[0] >= first[1]]
        if ground_bands:
            gap_below = (first[1] + ground_bands[0][0]) / 2
        yg = int(gap_below if gap_below else first[1] + T * 0.25)
        y1 = int(yg - T)
        yc = int(upper[0][0] - (T - (upper[0][1] - upper[0][0])) / 2)
        result.update({"T": int(round(T)), "yg": yg, "y1": y1, "yc": max(yc, 8)})
    if override:
        result.update(override)
    return result


def overlay(path: Path, c: dict, out: Path) -> None:
    im = Image.open(path).convert("RGB")
    dr = ImageDraw.Draw(im)
    w, h = im.size
    for x in range(c["x0"], w, c["P"]):
        dr.line([(x, 0), (x, h)], fill=(255, 0, 0), width=3)
    for key, colour in (("yc", (0, 160, 255)), ("y1", (0, 200, 0)), ("yg", (255, 0, 255))):
        if key in c:
            dr.line([(0, c[key]), (w, c[key])], fill=colour, width=4)
    if "y1" in c and "T" in c:
        y = c["y1"] - c["T"]
        while y > c.get("yc", 0):
            dr.line([(0, y), (w, y)], fill=(255, 200, 0), width=2)
            y -= c["T"]
    im.resize((w // 2, h // 2)).save(out)


def main() -> None:
    overrides = json.loads(OVERRIDES.read_text()) if OVERRIDES.exists() else {}
    out_dir = ROOT / ".art" / "cuts"
    out_dir.mkdir(parents=True, exist_ok=True)
    for path in sorted(RAW.glob("facade_*/facade_*.png")):
        name = path.stem
        c = cuts(path, overrides.get(name))
        overlay(path, c, out_dir / f"{name}.png")
        print(name, {k: v for k, v in c.items() if k != "bands"})


if __name__ == "__main__":
    sys.exit(main())
