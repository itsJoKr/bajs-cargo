"""Packs the ZET TMK 2200 tram views into the tram atlas and writes its layout.

Inputs (git-ignored, from gen-image): .art/tram/side.png (right side, cab at
the right), left.png (left side, cab at the left), front.png and rear.png,
all on a plain #ff00ff background. Outputs web3d/public/models/tram_atlas.png
and web3d/src/tramLayout.ts: where each view sits in the atlas, the module
and bellows boundaries measured from the side views (metres from the nose
tip), and the nose and tail profiles.

    .venv/bin/python tool/prepare_tram.py
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / '.art' / 'tram'
LENGTH = 32.0  # m, TMK 2200
ROOF_Y, FLOOR_Y = 3.05, 0.30  # the side views' roof line and body bottom
FRONT_TOP_Y = 3.15  # the front views' top edge
ATLAS = (4096, 2048)


def load(name):
    a = np.asarray(Image.open(SRC / f'{name}.png').convert('RGB')).astype(np.int32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # Magenta and the pink fringe around the tram.
    opaque = (np.minimum(r, b) - g) < 90
    # Eat one more pixel of fringe.
    o = opaque.copy()
    o[1:] &= opaque[:-1]; o[:-1] &= opaque[1:]; o[:, 1:] &= opaque[:, :-1]; o[:, :-1] &= opaque[:, 1:]
    return a, o


def bbox(o):
    cols, rows = np.where(o.mean(0) > 0.02)[0], np.where(o.mean(1) > 0.02)[0]
    return cols[0], cols[-1] + 1, rows[0], rows[-1] + 1


def body_rows(o, x0, x1):
    rows = np.where(o[:, x0:x1].mean(1) > 0.9)[0]
    return rows[0], rows[-1]


def bellows(a, o, top, bottom):
    band = a[top:bottom]
    grey = ((band.max(2) - band.min(2)) < 35) & (band.max(2) > 60) & o[top:bottom]
    g = grey.mean(0) > 0.6
    runs, i = [], 0
    while i < len(g):
        if g[i]:
            j = i
            while j < len(g) and g[j]:
                j += 1
            runs.append([i, j])
            i = j
        else:
            i += 1
    # Merge runs split by a stray column, keep the four widest.
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < 12:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    merged = sorted(sorted(merged, key=lambda r: r[1] - r[0])[-4:])
    assert len(merged) == 4, merged
    return merged


def main():
    views = {n: load(n) for n in ('side', 'left', 'front', 'rear')}
    atlas = np.zeros((ATLAS[1], ATLAS[0], 4), np.uint8)
    blue = None
    layout = {'atlas': ATLAS, 'length': LENGTH, 'roofY': ROOF_Y, 'floorY': FLOOR_Y, 'frontTopY': FRONT_TOP_Y}

    # Side views: knots in pixels, measured from the cab end.
    sides = {}
    ay = 0
    for name, cab_right in (('side', True), ('left', False)):
        a, o = views[name]
        x0, x1, y0, y1 = bbox(o)
        top, bottom = body_rows(o, x0, x1)
        bl = bellows(a, o, top + 20, bottom - 20)
        if cab_right:
            edges = [x1] + [c for r in reversed(bl) for c in (r[1], r[0])] + [x0]
        else:
            edges = [x0] + [c for r in bl for c in r] + [x1]
        dist = [abs(e - edges[0]) for e in edges]
        crop = np.dstack([a, o * 255]).astype(np.uint8)[y0:y1, x0:x1]
        h, w = crop.shape[:2]
        atlas[ay:ay + h, :w] = crop
        sides[name] = dict(a=a, o=o, x0=x0, x1=x1, top=top, bottom=bottom, cab_right=cab_right,
                           dist=dist, ay=ay, y0=y0)
        if blue is None:
            m = o[top:bottom, x0:x1]
            px = a[top:bottom, x0:x1][m]
            px = px[(px[:, 2] > 180) & (px[:, 0] < 90)]
            blue = np.median(px, 0)
        ay += h + 8

    # One set of d knots (metres from the nose tip), averaged over both sides.
    total = [s['dist'][-1] for s in sides.values()]
    knots = np.mean([np.array(s['dist']) / s['dist'][-1] for s in sides.values()], 0) * LENGTH
    layout['knots'] = [round(float(k), 3) for k in knots]

    for name, s in sides.items():
        edges = [s['x1'] if s['cab_right'] else s['x0']]
        sign = -1 if s['cab_right'] else 1
        cols = [edges[0] + sign * d for d in s['dist']]
        # Atlas x of every knot, and the atlas rows of the roof line and floor.
        layout[name] = {
            'knotX': [int(c - s['x0']) for c in cols],
            'roofRow': int(s['top'] - s['y0'] + s['ay']),
            'floorRow': int(s['bottom'] - s['y0'] + s['ay']),
        }

    # Nose and tail profiles: how far back from the tip each height is.
    def profile(end):
        ys = np.linspace(FLOOR_Y, ROOF_Y, 24)
        acc = np.zeros_like(ys)
        for s in sides.values():
            o = s['o']
            scale = LENGTH / s['dist'][-1]
            for k, y in enumerate(ys):
                row = int(round(s['top'] + (ROOF_Y - y) / (ROOF_Y - FLOOR_Y) * (s['bottom'] - s['top'])))
                row = min(max(row, s['top']), s['bottom'])
                c = np.where(o[row, s['x0']:s['x1']])[0] + s['x0']
                front_right = s['cab_right'] == (end == 'front')
                gap = (s['x1'] - 1 - c.max()) if front_right else (c.min() - s['x0'])
                acc[k] += gap * scale / 2
        return [[round(float(y), 3), round(float(d), 3)] for y, d in zip(ys, acc)]

    layout['noseProfile'] = profile('front')
    layout['tailProfile'] = profile('rear')

    # Front and rear, scaled to 70 %, right of and below the sides.
    for name, ax, ay in (('front', 3080, 0), ('rear', 3580, 0)):
        a, o = views[name]
        x0, x1, y0, y1 = bbox(o)
        img = Image.fromarray(np.dstack([a, o * 255]).astype(np.uint8)[y0:y1, x0:x1])
        w = 480
        h = round(img.height * w / img.width)
        img = img.resize((w, h), Image.LANCZOS)
        atlas[ay:ay + h, ax:ax + w] = np.asarray(img)
        # The bumper bottom: the lowest row that is still wide.
        rows = np.where(np.asarray(img)[..., 3].mean(1) > 255 * 0.8)[0]
        layout[name] = {'x0': ax, 'x1': ax + w, 'topRow': ay, 'floorRow': int(ay + rows[-1])}

    # A white patch for tinted parts, a dark one for the undercarriage, big
    # and apart so the small mip levels keep them clean.
    atlas[800:1056, 3100:3356] = [255, 255, 255, 255]
    atlas[800:1056, 3700:3956] = [40, 44, 50, 255]
    layout['white'] = [3228, 928]
    layout['dark'] = [3828, 928]
    layout['blue'] = '#%02x%02x%02x' % tuple(int(v) for v in blue)

    # Bleed the body blue into transparent pixels so mipmaps have no pink edge.
    t = atlas[..., 3] == 0
    atlas[t, :3] = blue.astype(np.uint8)
    out = ROOT / 'web3d' / 'public' / 'models' / 'tram_atlas.png'
    Image.fromarray(atlas).save(out, optimize=True)
    ts = ROOT / 'web3d' / 'src' / 'tramLayout.ts'
    ts.write_text('// Generated by tool/prepare_tram.py; do not edit.\n'
                  f'export const TRAM = {json.dumps(layout, indent=2)} as const;\n')
    print(out, total, layout['knots'], layout['blue'])


if __name__ == '__main__':
    main()
