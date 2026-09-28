#!/usr/bin/env python3
"""Projects facade corners into a Street View screenshot.

    python3 tool/sv_project.py todo.json LAT LNG HEADING FOV TILT [camera_height]

Screen 1568 x 718 (the Chrome viewport), pinhole camera, FOV horizontal in
degrees (the Maps URL's `y`), tilt the URL's `t` (90 = level). Prints each
facade's four corners (ground/eave at both ends) in screen pixels.
"""
import json, math, sys

W, H = 1568, 718
lat0, lon0 = 45.81303, 15.97713
phi = math.radians(lat0)
mlat = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
mlon = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)


def project(todo, lat, lng, heading, fov, tilt, cam_h=2.5, ids=None):
    cx, cz = (lng - lon0) * mlon, (lat - lat0) * mlat
    yaw = math.radians(heading)
    pitch = math.radians(tilt - 90)
    # Maps defines the URL FOV over a 900 px wide view (its thumbnail
    # width), whatever the viewport; measured against known facades.
    f = 450 / math.tan(math.radians(fov) / 2)
    # Camera basis: forward, right, up (x east, y up, z north).
    fw = (math.sin(yaw) * math.cos(pitch), math.sin(pitch), math.cos(yaw) * math.cos(pitch))
    rt = (math.cos(yaw), 0.0, -math.sin(yaw))
    up = (fw[1] * rt[2] - fw[2] * rt[1], fw[2] * rt[0] - fw[0] * rt[2], fw[0] * rt[1] - fw[1] * rt[0])
    up = tuple(-u for u in up) if up[1] < 0 else up
    out = {}
    for i, fa in enumerate(todo):
        if ids is not None and i not in ids:
            continue
        pts = []
        for (px, pz) in (fa["a"], fa["b"]):
            for y in (0.15, fa["eave"]):
                d = (px - cx, y - cam_h, pz - cz)
                z = sum(a * b for a, b in zip(d, fw))
                if z <= 0.5:
                    pts = None
                    break
                x = W / 2 + f * sum(a * b for a, b in zip(d, rt)) / z
                yy = H / 2 - f * sum(a * b for a, b in zip(d, up)) / z
                pts.append((round(x), round(yy)))
            if pts is None:
                break
        if pts:
            out[i] = pts
    return out


if __name__ == "__main__":
    todo = json.load(open(sys.argv[1]))
    lat, lng, heading, fov, tilt = map(float, sys.argv[2:7])
    cam = float(sys.argv[7]) if len(sys.argv) > 7 else 2.5
    for i, pts in project(todo, lat, lng, heading, fov, tilt, cam).items():
        xs = [p[0] for p in pts]
        if max(xs) < 0 or min(xs) > W:
            continue
        print(i, todo[i]["id"], todo[i]["name"], pts)
