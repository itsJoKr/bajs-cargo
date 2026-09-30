#!/usr/bin/env python3
"""browser_batch actions that photograph one wall from ONE panorama at
enough headings / pitches to rectify it with tool/sv_rectify.py.

    python3 tool/sv_shots.py TODO.json WALL_ID LAT LNG PANO [TYPE=0] [HEIGHT] TAB

LAT LNG PANO come from the Maps URL after a `sv_url.py` snap landed on the
street panorama (`@lat,lng,...!1s<PANO>!2e0`); TYPE is the last digit(s) of
`!2e..` (0 = car, 10 = photosphere). Prints the batch JSON and writes the
matching shot list to .art/streetview/shots/<wall>.json (files are added by
`sv_shots.py file WALL_ID`).
"""
import glob, json, math, os, shutil, sys

lat0, lon0 = 45.81303, 15.97713
phi = math.radians(lat0)
mlat = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
mlon = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
FOV = 90


def spread(lo, hi, w):
    """Centres of windows `w` degrees wide (overlapping) covering [lo, hi]."""
    if hi - lo <= w:
        return [(lo + hi) / 2]
    n = math.ceil((hi - lo - w) / (w * 0.7)) + 1
    first, last = lo + w / 2, hi - w / 2
    return [first + (last - first) * i / (n - 1) for i in range(n)]


if sys.argv[1] == "file":
    wall = sys.argv[2]
    plan = json.load(open(f".art/streetview/shots/{wall}.json"))
    dirs = glob.glob("/var/folders/*/*/T/claude-chrome-screenshots-*")
    files = sorted((f for d in dirs for f in glob.glob(d + "/*.jpg")), key=os.path.getmtime)[-len(plan["shots"]):]
    os.makedirs(f".art/streetview/shots/{wall}", exist_ok=True)
    for i, (shot, f) in enumerate(zip(plan["shots"], files)):
        dst = f".art/streetview/shots/{wall}/{i}.jpg"
        shutil.copy(f, dst)
        shot["file"] = dst
    json.dump(plan, open(f".art/streetview/shots/{wall}.json", "w"), indent=1)
    print("filed", len(plan["shots"]), "shots")
    sys.exit()

todo = json.load(open(sys.argv[1]))
wall = next(t for t in todo if t["id"] == sys.argv[2])
lat, lng, pano = float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
typ = sys.argv[6] if len(sys.argv) > 6 else "0"
height = float(sys.argv[7]) if len(sys.argv) > 7 else wall["eave"] + 6
tab = int(sys.argv[8]) if len(sys.argv) > 8 else 0
cx, cz = (lng - lon0) * mlon, (lat - lat0) * mlat
pts = []
for i in range(0, 11):
    t = i / 10
    px = wall["a"][0] + (wall["b"][0] - wall["a"][0]) * t
    pz = wall["a"][1] + (wall["b"][1] - wall["a"][1]) * t
    pts.append((px - cx, pz - cz))
az = [math.degrees(math.atan2(dx, dz)) for dx, dz in pts]
# Unwrap around the wall's mid bearing.
mid = az[5]
az = [((a - mid + 180) % 360) - 180 + mid for a in az]
dist = [math.hypot(dx, dz) for dx, dz in pts]
lo_el = math.degrees(math.atan2(-2.5, min(dist)))
hi_el = math.degrees(math.atan2(height - 2.5, min(dist)))
lo_el = max(lo_el, -30)
heads = spread(min(az) - 4, max(az) + 4, 100)
pitches = spread(lo_el - 3, hi_el + 3, 60)
shots = []
actions = []
for p in pitches:
    for h in heads:
        h = round(h % 360, 1)
        tilt = round(90 + max(-30, min(80, p)), 1)
        url = (f"https://www.google.com/maps/@{lat},{lng},3a,{FOV}y,{h}h,{tilt}t/data=!3m4!1e1!3m2!1s{pano}!2e{typ}")
        shots.append({"heading": h, "tilt": tilt, "fov": FOV})
        actions += [
            {"name": "navigate", "input": {"url": url, "tabId": tab}},
            {"name": "computer", "input": {"action": "wait", "duration": 9, "tabId": tab}},
            {"name": "computer", "input": {"action": "screenshot", "tabId": tab, "save_to_disk": True, "scale": 1}},
        ]
os.makedirs(".art/streetview/shots", exist_ok=True)
json.dump({"wall": wall["id"], "cam": [lat, lng], "pano": pano, "shots": shots, "height": height},
          open(f".art/streetview/shots/{wall['id']}.json", "w"), indent=1)
print(json.dumps(actions))
