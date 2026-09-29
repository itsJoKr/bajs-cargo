#!/usr/bin/env python3
"""Aims a Street View panorama at each facade of a work list.

    python3 tool/sv_aim.py .art/streetview/square_todo.json LAT LNG [max_distance]

Prints, per facade in reach, the heading/pitch/fov that frames it from the
panorama at (LAT, LNG), and the @-style Maps URL for it (append the pano's
own data suffix). Geometry matches tool/src/geo.dart.
"""
import json, math, sys

lat0, lon0 = 45.81303, 15.97713
phi = math.radians(lat0)
mlat = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
mlon = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)

todo = json.load(open(sys.argv[1]))
plat, plng = float(sys.argv[2]), float(sys.argv[3])
reach = float(sys.argv[4]) if len(sys.argv) > 4 else 90
cx, cz = (plng - lon0) * mlon, (plat - lat0) * mlat
for i, f in enumerate(todo):
    a, b = f["a"], f["b"]
    ha = math.degrees(math.atan2(a[0] - cx, a[1] - cz))
    hb = math.degrees(math.atan2(b[0] - cx, b[1] - cz))
    span = (hb - ha + 540) % 360 - 180
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    dist = math.hypot(mid[0] - cx, mid[1] - cz)
    # Facing test: the facade's outward normal must point at the camera.
    L = f["length"]
    n = ((b[1] - a[1]) / L, -(b[0] - a[0]) / L)
    facing = n[0] * (cx - mid[0]) + n[1] * (cz - mid[1])
    if dist > reach or facing <= 0:
        continue
    heading = (ha + span / 2) % 360
    top = f["eave"] + 3
    pitch = math.degrees(math.atan2(top / 2 - 2.5, dist))
    vspan = math.degrees(math.atan2(top - 2.5, dist) + math.atan2(2.5, dist))
    fov = max(30, min(100, max(abs(span) * 1.25, vspan * 1.25 * 2.1)))
    print(f"{i:2d} {f['id']:18s} d={dist:5.1f} span={abs(span):5.1f} "
          f"heading={heading:6.1f} pitch={pitch:4.1f} fov={fov:5.1f}")
