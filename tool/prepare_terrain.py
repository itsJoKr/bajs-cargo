#!/usr/bin/env python3
"""Turns Copernicus GLO-30 into the city's ground and a far horizon.

    .venv/bin/python tool/prepare_terrain.py

Reads .art/dem/N45_E015.tif and N45_E016.tif (Copernicus DSM COG, 1",
PixelIsPoint, fetched from the copernicus-dem-30m open-data bucket) and the
OSM snapshot. GLO-30 is a *surface* model: it includes rooftops and tree
crowns, and at 21 x 31 m per pixel a narrow street is mostly roof. So:

1. rasterise the OSM building footprints (with their heights) and tree
   crowns at 1 m; each DEM pixel's ground estimate is its surface minus the
   mean building height over it, weighted by the square of its open share;
2. drop what still stands more than 5 m above its 3 x 3 neighbourhood's
   minimum (canopy and roofs the snapshot missed);
3. a normalised Gaussian (sigma 25 m) over the weighted estimates, which
   also smooths the 1 m radar noise;
4. resample onto a 10 m grid in local metres, relative to the ground at the
   Ban Jelačić statue;
5. hand corrections (`FILLS`): hollows that step 1 dug under dense blocks
   are filled smoothly from the grid round them.

Writes data/terrain/ground.json (the full box plus a margin, 10 m cells)
and data/terrain/far.json (a 200 m grid, 24 x 24 km, DSM minimum-filtered and smoothed, for
the horizon: Medvednica to the north). Both use the pipeline frame: x east,
z NORTH, row-major with z rising.
"""
import json, math, os
import numpy as np
import tifffile
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
lat0, lon0 = 45.81303, 15.97713
phi = math.radians(lat0)
mlat = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
mlon = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
STEP = 1 / 3600


def to_local(lat, lon):
    return (lon - lon0) * mlon, (lat - lat0) * mlat


# --- The DEM mosaic over a window around the city ---------------------------
def window(lat_a, lat_b, lon_a, lon_b):
    """Rows north->south, columns west->east, with pixel-centre lat/lon."""
    tiles = {}
    for lon_t in (15, 16):
        tiles[lon_t] = tifffile.imread(os.path.join(ROOT, '.art', 'dem', f'N45_E0{lon_t}.tif'))
    r0, r1 = int(math.floor((46 - lat_b) / STEP)), int(math.ceil((46 - lat_a) / STEP))
    cols = []
    lons = []
    c = int(math.floor((lon_a - 15) / STEP))
    while 15 + c * STEP <= lon_b:
        lon_t = 15 + c // 3600
        cols.append(tiles[lon_t][r0:r1 + 1, c % 3600])
        lons.append(15 + c * STEP)
        c += 1
    z = np.stack(cols, axis=1).astype(np.float64)
    lats = np.array([46 - r * STEP for r in range(r0, r1 + 1)])
    return z, lats, np.array(lons)


def gaussian(a, sigma_px_y, sigma_px_x):
    def kernel(s):
        r = max(1, int(3 * s))
        k = np.exp(-0.5 * (np.arange(-r, r + 1) / s) ** 2)
        return k / k.sum()
    out = a.copy()
    ky, kx = kernel(sigma_px_y), kernel(sigma_px_x)
    out = np.apply_along_axis(lambda v: np.convolve(v, ky, mode='same'), 0, out)
    out = np.apply_along_axis(lambda v: np.convolve(v, kx, mode='same'), 1, out)
    return out


def bilinear(z, lats, lons, lat, lon):
    fr = (lats[0] - lat) / STEP
    fc = (lon - lons[0]) / STEP
    r = np.clip(np.floor(fr).astype(int), 0, len(lats) - 2)
    c = np.clip(np.floor(fc).astype(int), 0, len(lons) - 2)
    tr, tc = np.clip(fr - r, 0, 1), np.clip(fc - c, 0, 1)
    return (z[r, c] * (1 - tr) * (1 - tc) + z[r + 1, c] * tr * (1 - tc)
            + z[r, c + 1] * (1 - tr) * tc + z[r + 1, c + 1] * tr * tc)


# --- Ground ------------------------------------------------------------------
LAT_A, LAT_B, LON_A, LON_B = 45.7995, 45.8215, 15.9575, 15.9925
z, lats, lons = window(LAT_A - .003, LAT_B + .003, LON_A - .004, LON_B + .004)

osm = json.load(open(os.path.join(ROOT, 'data', 'osm', 'zagreb_centre.json')))
elements = osm['elements'] if isinstance(osm, dict) else osm
nodes = {e['id']: e for e in elements if e['type'] == 'node'}
ways = {e['id']: e for e in elements if e['type'] == 'way'}

# A 1 m raster of what is not ground, in the DEM window.
wx0, wz1 = to_local(lats[0], lons[0])
wx1, wz0 = to_local(lats[-1], lons[-1])
W, H = int(wx1 - wx0) + 1, int(wz1 - wz0) + 1
mask = Image.new('L', (W, H), 0)
draw = ImageDraw.Draw(mask)
# Each building's height in decimetres (a coarse copy of
# tool/src/buildings.dart's rules), so a roof pixel can be taken back down
# to the ground.
height_img = Image.new('I', (W, H), 0)
hdraw = ImageDraw.Draw(height_img)


def building_height(t, x, zz):
    try:
        if 'height' in t:
            return float(t['height'].split()[0])
        if 'building:levels' in t:
            return float(t['building:levels'].split(';')[0]) * 3.4 + 1.2
    except ValueError:
        pass
    if t.get('building') in ('kiosk', 'roof', 'shed', 'garage', 'garages'):
        return 3.2
    # Gornji grad and Kaptol are lower than Donji grad's perimeter blocks.
    upper = (x < -120 and zz > 120) or (x > 120 and zz > 60)
    return 9.5 if upper else 15.4


def px(lat, lon):
    x, zz = to_local(lat, lon)
    return (x - wx0, wz1 - zz)


def ring(way_nodes):
    return [px(nodes[n]['lat'], nodes[n]['lon']) for n in way_nodes if n in nodes]


blocked = 0
for e in elements:
    t = e.get('tags', {})
    if e['type'] == 'way' and ('building' in t or 'building:part' in t):
        pts = ring(e['nodes'])
        if len(pts) >= 3:
            draw.polygon(pts, fill=255, outline=255, width=3)
            mx = sum(p[0] for p in pts) / len(pts) + wx0
            mz = wz1 - sum(p[1] for p in pts) / len(pts)
            # A tall building:part (a spire) is a sliver of its pixel: clamp it.
            bh = building_height(t, mx, mz)
            if 'building:part' in t:
                bh = min(bh, 25)
            hdraw.polygon(pts, fill=int(bh * 10))
            blocked += 1
    elif e['type'] == 'relation' and 'building' in t:
        for m in e.get('members', []):
            if m['type'] == 'way' and m.get('role') == 'outer' and m['ref'] in ways:
                pts = ring(ways[m['ref']]['nodes'])
                if len(pts) >= 3:
                    draw.polygon(pts, fill=255, outline=255, width=3)
                    mx = sum(p[0] for p in pts) / len(pts) + wx0
                    mz = wz1 - sum(p[1] for p in pts) / len(pts)
                    hdraw.polygon(pts, fill=int(min(25, building_height(t, mx, mz)) * 10))
    elif e['type'] == 'node' and t.get('natural') == 'tree':
        x, y = px(e['lat'], e['lon'])
        draw.ellipse([x - 6, y - 6, x + 6, y + 6], fill=255)
    elif e['type'] == 'way' and (t.get('natural') == 'tree_row' or t.get('natural') == 'wood'
                                 or t.get('landuse') == 'forest'):
        pts = ring(e['nodes'])
        if t.get('natural') == 'tree_row':
            draw.line(pts, fill=255, width=12)
        elif len(pts) >= 3:
            draw.polygon(pts, fill=255)
m = np.asarray(mask, dtype=np.float64) / 255
hm = np.asarray(height_img, dtype=np.float64) / 10

# Coverage of each DEM pixel's cell (dx x dy metres around its centre).
dx, dy = STEP * mlon, STEP * mlat
LON_G, LAT_G = np.meshgrid(lons, lats)
cx, cz = to_local(LAT_G, LON_G)
cover = np.zeros_like(z)
roof = np.zeros_like(z)
integral = np.pad(m.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
h_integral = np.pad(hm.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
for (r, c), _ in np.ndenumerate(z):
    x0 = int(np.clip(cx[r, c] - wx0 - dx / 2, 0, W)); x1 = int(np.clip(cx[r, c] - wx0 + dx / 2, 0, W))
    y0 = int(np.clip(wz1 - cz[r, c] - dy / 2, 0, H)); y1 = int(np.clip(wz1 - cz[r, c] + dy / 2, 0, H))
    area = max(1, (x1 - x0) * (y1 - y0))
    cover[r, c] = (integral[y1, x1] - integral[y0, x1] - integral[y1, x0] + integral[y0, x0]) / area
    # Mean building height over the pixel (0 on open ground).
    roof[r, c] = (h_integral[y1, x1] - h_integral[y0, x1] - h_integral[y1, x0] + h_integral[y0, x0]) / area
# Every pixel gives a ground estimate: the surface minus the buildings on
# it, weighted by how much of it is open. In Gornji grad nearly every pixel
# is mostly roof, and dropping them would fill the plateau from the lower
# town (the escarpment came out 150 m too far north that way).
# Only ~65% of the height comes off: the radar surface sits below the roofs
# in dense blocks.
est = z - roof * 0.65
weight = np.clip(1 - cover, 0.05, 1) ** 2
# Outside the snapshot the rasters are empty: there only the local-minimum
# test below guards against roofs and canopy. A 3 x 3 window, not wider: on
# the Gornji grad escarpment (30 m over ~70 m) a wider minimum reaches down
# the hill and rejects real ground.
pad = np.pad(est, 1, mode='edge')
local_min = np.min([pad[i:i + z.shape[0], j:j + z.shape[1]] for i in range(3) for j in range(3)], axis=0)
weight = np.where(est < local_min + 5, weight, 0)
print(f'DEM window {z.shape}, {blocked} building outlines, mean weight {weight.mean():.2f}')

sig = 25
num = gaussian(est * weight, sig / dy, sig / dx)
den = gaussian(weight, sig / dy, sig / dx)
ground = num / np.maximum(den, 1e-9)

origin = float(bilinear(ground, lats, lons, np.array([lat0]), np.array([lon0]))[0])
print(f'ground at the statue: {origin:.1f} m')

CELL = 10.0
gx0, gz0 = to_local(LAT_A, LON_A)
gx1, gz1 = to_local(LAT_B, LON_B)
gx0, gz0 = math.floor(gx0 / CELL) * CELL, math.floor(gz0 / CELL) * CELL
cols = int(math.ceil((gx1 - gx0) / CELL)) + 1
rows = int(math.ceil((gz1 - gz0) / CELL)) + 1
GX, GZ = np.meshgrid(gx0 + np.arange(cols) * CELL, gz0 + np.arange(rows) * CELL)
g_lon = lon0 + GX / mlon
g_lat = lat0 + GZ / mlat
heights = bilinear(ground, lats, lons, g_lat, g_lon) - origin

# Hand corrections: closed hollows that step 1 digs under dense, tall blocks
# (it takes too much roof off where the radar saw less of it). Inside each
# polygon (local metres, x east, z north) the grid is replaced by the
# harmonic fill of the grid round it: the smoothest surface that meets its
# surroundings. Rerunning is idempotent, the fill only reads cells outside.
FILLS = {
    # Ilica 4-14 and the blocks either side of it: the grid fell 6 m in the
    # 50 m west of the square (20% in front of Nama, Ilica 4) into a 3.5 m pit
    # under the north blocks; Street View (Jul 2024) shows a gentle fall, two or
    # three steps under Nama's arcade. Ilica now falls about 3% from the square.
    'Ilica west of the square': [(-95, -48), (-95, 98), (-305, 98), (-305, -48)],
}


def inside(x, zz, poly):
    odd = np.zeros_like(x, dtype=bool)
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        if az == bz:
            continue
        cross = (az > zz) != (bz > zz)
        odd ^= cross & (x < ax + (zz - az) / (bz - az) * (bx - ax))
    return odd


for name, poly in FILLS.items():
    mask = inside(GX, GZ, poly)
    for _ in range(4000):
        pad = np.pad(heights, 1, mode='edge')
        mean = (pad[:-2, 1:-1] + pad[2:, 1:-1] + pad[1:-1, :-2] + pad[1:-1, 2:]) / 4
        heights = np.where(mask, mean, heights)
    print(f'  filled {name}: {int(mask.sum())} cells')

known = {
    'Trg bana Jelačića': (45.8131, 15.9772),
    'Zrinjevac': (45.8105, 15.9776),
    'Dolac': (45.8143, 15.9772),
    'Kaptol (cathedral square)': (45.8143, 15.9800),
    'Markov trg': (45.8163, 15.9737),
    'Strossmayerovo šetalište': (45.8145, 15.9731),
    'Glavni kolodvor': (45.8045, 15.9780),
}
for name, (la, lo) in known.items():
    v = bilinear(ground, lats, lons, np.array([la]), np.array([lo]))[0]
    print(f'  {name:28s} {v:6.1f} m ({v - origin:+.1f})')

out_dir = os.path.join(ROOT, 'data', 'terrain')
os.makedirs(out_dir, exist_ok=True)
json.dump({
    'source': 'Copernicus GLO-30 DSM (N45 E015, N45 E016), filtered to ground by tool/prepare_terrain.py',
    'frame': 'x east, z north, metres from the Ban Jelacic statue; heights relative to the ground there',
    'originElevation': round(origin, 2),
    'cell': CELL, 'x0': gx0, 'z0': gz0, 'columns': cols, 'rows': rows,
    'heights': [round(float(v), 2) for v in heights.ravel()],
}, open(os.path.join(out_dir, 'ground.json'), 'w'), separators=(',', ':'))
print(f'ground grid {cols} x {rows}, {heights.min():.1f}..{heights.max():.1f} m')

# --- Far horizon -------------------------------------------------------------
FAR, FCELL = 12000.0, 200.0
fz_raw, flats, flons = window(lat0 - FAR / mlat - .01, lat0 + FAR / mlat + .01,
                              lon0 - FAR / mlon - .01, lon0 + FAR / mlon + .01)
# A 5 x 5 minimum first (about 110 x 150 m): it takes the city blocks and
# forest canopy off while keeping the hills, then smooth.
pad = np.pad(fz_raw, 2, mode='edge')
fz_min = np.min([pad[i:i + fz_raw.shape[0], j:j + fz_raw.shape[1]] for i in range(5) for j in range(5)], axis=0)
fz = gaussian(fz_min, 120 / dy, 120 / dx)
n = int(2 * FAR / FCELL) + 1
FX, FZ = np.meshgrid(-FAR + np.arange(n) * FCELL, -FAR + np.arange(n) * FCELL)
far = bilinear(fz, flats, flons, lat0 + FZ / mlat, lon0 + FX / mlon) - origin
json.dump({
    'source': 'Copernicus GLO-30 DSM, 5x5 minimum then smoothed (sigma 120 m)',
    'cell': FCELL, 'x0': -FAR, 'z0': -FAR, 'columns': n, 'rows': n,
    'heights': [round(float(v), 1) for v in far.ravel()],
}, open(os.path.join(out_dir, 'far.json'), 'w'), separators=(',', ':'))
print(f'far grid {n} x {n}, {far.min():.0f}..{far.max():.0f} m')
