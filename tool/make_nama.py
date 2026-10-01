#!/usr/bin/env python3
"""Pictures for Nama (Ilica 4) cut from its facade picture.

    .venv/bin/python tool/make_nama.py

Reads .art/facades/ilica_nama/raw.png (the Street View redraw, 1536 x 969 px
for the 33.4 x 19.5 m front: 46 px/m across, 49.7 px/m up) and writes

- web3d/public/features/nama_oriel.jpg: the curved bay over the gate, wrapped
  round the `oriel` feature (data/buildings.json). The 3D bay runs from its
  ledge (9.0 m) to 2 m over the eave, 12.5 m, so a band of window rows is
  repeated to make the strip that tall without stretching the panes;
- .art/facades/nama_arcade_back/raw.png and nama_arcade_end/raw.png: the
  back wall of the walkway behind the arches (part w9000000050) and its two
  short end walls: travertine courses from the front, a dark lintel band and
  the glass door of the seventh arch. Pack them with prepare_facades.py.
"""
import os

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
RAW = os.path.join(ROOT, '.art', 'facades', 'ilica_nama', 'raw.png')
PX_UP = 969 / 19.5  # picture px a metre, vertically

src = Image.open(RAW).convert('RGB')

# --- The oriel ---------------------------------------------------------------
bay = src.crop((1316, 0, 1483, 520))  # hood at the top .. the ledge
extra = round(12.5 * PX_UP) - bay.height  # rows to add for the 3D bay's height
band = bay.crop((0, 150, bay.width, 150 + extra))  # whole window rows
strip = Image.new('RGB', (bay.width, bay.height + extra))
strip.paste(bay.crop((0, 0, bay.width, 150)), (0, 0))
strip.paste(band, (0, 150))
strip.paste(bay.crop((0, 150, bay.width, bay.height)), (0, 150 + extra))
strip = strip.resize((256, round(256 * strip.height / strip.width)), Image.Resampling.LANCZOS)
out = os.path.join(ROOT, 'web3d', 'public', 'features', 'nama_oriel.jpg')
strip.save(out, quality=90)
print(f'{out}: {strip.size}')

# --- The walkway's back and end walls (part w9000000050) ----------------------
# Each picture runs from its wall's sidewalk to the part's eave (2.29 + 8.6 m),
# 46 px a metre; rows count down from that eave. The arcade's ceiling is at
# 9.92 m and the bay floors at 1.94..2.51 m (data/arcades.json; terrain after
# tool/prepare_terrain.py's Ilica fill), the dark lintel band on the arches'
# spring line (picture 5.0..5.6 m over the arcade's 2.76 m sidewalk).
PX = 46
EAVE = 2.288 + 8.6
BAND = (round((EAVE - 8.36) * PX), round((EAVE - 7.76) * PX))
WALK0 = 0.039 * 33.41  # the back wall starts at the walkway's west end (t 0.039 of the front)
gen = Image.open(os.path.join(ROOT, '.art', 'facades', 'ilica_nama', 'raw_gen7.png')).convert('RGB')
door = gen.crop((527, 718, 612, 912))  # the glass door, transom and frame of an arch
door = door.resize((round(door.width * PX / 46), round(door.height * PX / PX_UP)), Image.Resampling.LANCZOS)
course = src.crop((380, 550, 1040, 625))  # travertine courses over the arches, no signs
course = course.resize((course.width, round(course.height * PX / PX_UP)), Image.Resampling.LANCZOS)
tag = src.crop((1252, 800, 1322, 860))  # a graffiti tag on the pier by the gate
# Only its strokes (darker than the stone round them), so no patch edge shows.
tag_mask = tag.convert('L').point(lambda v: 255 if v < 105 else 0)


def wall(width_m, sidewalk, doors=(), tags=()):
    w, h = round(width_m * PX), round((EAVE - sidewalk) * PX)
    im = Image.new('RGB', (w, h))
    for y in range(0, h, course.height):
        for x in range(-(y // course.height * 173) % course.width - course.width, w, course.width):
            im.paste(course, (x, y))
    im = im.point(lambda v: int(v * 0.86))  # in the shade of the arcade
    draw = ImageDraw.Draw(im)
    draw.rectangle((0, BAND[0], w, BAND[1]), fill=(58, 53, 48))
    for s, floor in doors:
        x = round(s * PX) - door.width // 2
        im.paste(door, (x, round((EAVE - floor) * PX) - door.height))
    for s, y in tags:
        im.paste(tag.point(lambda v: int(v * 0.86)), (round(s * PX), round((EAVE - y) * PX)), tag_mask)
    return im


def save(name, im):
    path = os.path.join(ROOT, '.art', 'facades', name, 'raw.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
    print(f'{path}: {im.size}')


# Arch 2 (t 0.180) shows a shop window, arch 7 (t 0.640) the store's glass door.
save('nama_arcade_back', wall(21.64, 1.683 + .15,
                              doors=[(0.180 * 33.41 - WALK0, 2.037), (0.6403 * 33.41 - WALK0, 2.509)],
                              tags=[(1.2, 3.6), (8.3, 3.9), (12.6, 3.7), (16.9, 4.0)]))
save('nama_arcade_end_w', wall(2.3, 1.629 + .15, tags=[(0.4, 3.5)]))
save('nama_arcade_end_e', wall(2.3, 2.288 + .15))

# --- A travertine tile for the oriel's corbel and cap ---------------------------
# Courses from over the arches, stacked with a running offset into a square.
rows = src.crop((430, 552, 686, 624))
tile = Image.new('RGB', (256, 256))
for k, y in enumerate(range(0, 256, rows.height)):
    shift = (k * 97) % 256
    tile.paste(rows, (-shift, y))
    tile.paste(rows, (256 - shift, y))
out = os.path.join(ROOT, 'web3d', 'public', 'features', 'tex', 'nama_travertine.jpg')
tile.save(out, quality=90)
print(f'{out}: {tile.size}')
