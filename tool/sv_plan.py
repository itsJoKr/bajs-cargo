#!/usr/bin/env python3
"""Picks, for every facade in a work list, the Street View panorama that sees
it best, and writes the framed Maps URL for it.

    python3 tool/sv_plan.py .art/streetview/square_todo.json .art/streetview/panos.json

panos.json: [{"id", "lat", "lng", "type": 0 (official) | 10 (photosphere)}],
found by probing viewpoints in the browser. A panorama scores well when the
facade faces it squarely, from 18-60 m; official ones get a small bonus
(their position and north are reliable). Writes the choice back into the
work list as `shot` = {pano, heading, pitch, fov, url}.
"""
import json, math, sys

lat0, lon0 = 45.81303, 15.97713
phi = math.radians(lat0)
mlat = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
mlon = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)

todo_path, pano_path = sys.argv[1], sys.argv[2]
todo = json.load(open(todo_path))
panos = json.load(open(pano_path))


def aim(f, p):
    cx, cz = (p["lng"] - lon0) * mlon, (p["lat"] - lat0) * mlat
    a, b = f["a"], f["b"]
    ha = math.degrees(math.atan2(a[0] - cx, a[1] - cz))
    hb = math.degrees(math.atan2(b[0] - cx, b[1] - cz))
    span = abs((hb - ha + 540) % 360 - 180)
    heading = (ha + ((hb - ha + 540) % 360 - 180) / 2) % 360
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    dist = math.hypot(mid[0] - cx, mid[1] - cz)
    L = f["length"]
    n = ((b[1] - a[1]) / L, -(b[0] - a[0]) / L)
    facing = (n[0] * (cx - mid[0]) + n[1] * (cz - mid[1])) / max(dist, 1e-6)
    # Frame from the pavement to a little above the eave (roof line), with
    # 12% margin. The Maps URL FOV is defined over a 900 px wide view; the
    # 1568 x 718 viewport shows +-atan(784/f) by +-atan(359/f), f in px.
    top = f["eave"] * 1.4 + 7
    lo, hi = math.atan2(-2.5, dist), math.atan2(top - 2.5, dist)
    pitch = math.degrees((lo + hi) / 2)
    half_v = (hi - lo) / 2 * 1.12
    half_h = math.radians(span) / 2 * 1.12
    focal = min(359 / math.tan(half_v), 784 / math.tan(half_h))
    fov = max(12, min(100, math.degrees(2 * math.atan(450 / focal))))
    score = facing - abs(dist - 38) / 80 + p.get("bonus", 0)
    if facing < 0.35 or dist < 12 or dist > 95:
        score = -9
    return score, heading, pitch, fov, dist, facing


for f in todo:
    best = max(panos, key=lambda p: aim(f, p)[0])
    score, heading, pitch, fov, dist, facing = aim(f, best)
    if score < -5:
        f.pop("shot", None)
        print(f"   {f['id']:18s} no usable panorama")
        continue
    url = (f"https://www.google.com/maps/@{best['lat']},{best['lng']},3a,{fov:.0f}y,"
           f"{heading:.1f}h,{90 + pitch:.1f}t/data=!3m4!1e1!3m2!1s{best['id']}!2e{best['type']}")
    f["shot"] = {"pano": best["id"], "heading": heading, "pitch": pitch,
                 "fov": fov, "distance": dist, "facing": facing, "url": url}
    print(f"{todo.index(f):2d} {f['id']:18s} pano={best['id'][:10]} d={dist:4.0f} "
          f"facing={facing:.2f} fov={fov:4.0f}")
json.dump(todo, open(todo_path, "w"), indent=1)
