#!/usr/bin/env python3
"""Maps pano URLs from the STREET in front of a todo wall: the point on the
nearest named-street centreline on the wall's outward side, so the snap
lands on the street's own panorama, not on a courtyard or shop photosphere.

    python3 tool/sv_street_url.py TODO.json INDEX_OR_WALL_ID [FOV=90] [PITCH=15]

Prints candidate streets (name, distance from the wall) and one URL each.
"""
import json, math, sys

lat0, lon0 = 45.81303, 15.97713
phi = math.radians(lat0)
mlat = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
mlon = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)

todo = json.load(open(sys.argv[1]))
key = sys.argv[2]
wall = todo[int(key)] if key.isdigit() else next(t for t in todo if t["id"] == key)
fov = sys.argv[3] if len(sys.argv) > 3 else "90"
pitch = sys.argv[4] if len(sys.argv) > 4 else "15"
osm = json.load(open("data/osm/zagreb_centre.json"))
els = osm["elements"] if isinstance(osm, dict) else osm
nodes = {e["id"]: (((e["lon"] - lon0) * mlon), ((e["lat"] - lat0) * mlat)) for e in els if e["type"] == "node"}
a, b = wall["a"], wall["b"]
mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
h = math.radians(wall["heading"])
out = (-math.sin(h), -math.cos(h))  # outward normal: away from the wall towards the viewer
best = {}
for e in els:
    t = e.get("tags", {})
    if e["type"] != "way" or "highway" not in t or "name" not in t:
        continue
    pts = [nodes[i] for i in e["nodes"] if i in nodes]
    for p, q in zip(pts, pts[1:]):
        dx, dz = q[0] - p[0], q[1] - p[1]
        L2 = dx * dx + dz * dz
        if L2 == 0:
            continue
        u = max(0, min(1, ((mid[0] - p[0]) * dx + (mid[1] - p[1]) * dz) / L2))
        c = (p[0] + u * dx, p[1] + u * dz)
        vx, vz = c[0] - mid[0], c[1] - mid[1]
        d = math.hypot(vx, vz)
        if d < 2 or d > 45 or vx * out[0] + vz * out[1] < 0.3 * d:
            continue
        if t["name"] not in best or d < best[t["name"]][0]:
            best[t["name"]] = (d, c)
for name, (d, c) in sorted(best.items(), key=lambda kv: kv[1][0]):
    az = math.degrees(math.atan2(mid[0] - c[0], mid[1] - c[1])) % 360
    print(f"{name}: {d:.0f} m from the wall")
    print(f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={c[1] / mlat + lat0:.7f},"
          f"{c[0] / mlon + lon0:.7f}&heading={az:.1f}&pitch={pitch}&fov={fov}")
