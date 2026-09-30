#!/usr/bin/env python3
"""Rectifies one wall from several Street View screenshots taken from the
SAME panorama (only heading / pitch differ) into a straight-on elevation.

For narrow streets a facade never fits one frame; this stitches a few.
Every output pixel is a point on the wall plane (s metres along it, y metres
above the pavement); its ray from the camera picks the screenshot that sees
it closest to the centre. Needs the panorama's position (the lat,lng in the
Maps URL after it loaded) and the wall (a,b) from a list_hero_facades todo.

    python3 tool/sv_rectify.py SPEC.json

SPEC.json:
  {"todo": ".art/streetview/ring2_todo.json", "wall": "w105489667_e7",
   "cam": [45.8121159, 15.9775642], "cam_h": 2.5,
   "height": 16.0,              # metres up the wall to draw
   "s0": 0, "s1": null,         # optional: only the wall from s0 to s1 metres
   "ppm": 90,                   # output pixels per metre
   "out_m": 0.0,                # plane offset towards the street (columns, bays)
   "shots": [{"file": "...jpg", "heading": 97.7, "tilt": 105, "fov": 90,
              "cam": [lat, lng]   # optional: another panorama}, ...],
   "out": ".art/facades/<name>/photo.png"}

Camera model (calibrated on a 1568 x 652 Chrome window, 2026-09-29): the
URL's y is the vertical FOV, f = (H/2) / tan(y/2) px, tilt 90 = level,
pitch = tilt - 90 (up positive), camera height 2.5 m.
"""
import json, math, sys
import numpy as np
from PIL import Image

lat0, lon0 = 45.81303, 15.97713
phi = math.radians(lat0)
mlat = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
mlon = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)


def basis(heading, tilt):
    yaw, pitch = math.radians(heading), math.radians(tilt - 90)
    fw = np.array([math.sin(yaw) * math.cos(pitch), math.sin(pitch), math.cos(yaw) * math.cos(pitch)])
    rt = np.array([math.cos(yaw), 0.0, -math.sin(yaw)])
    up = np.cross(rt, fw)  # x east, y up, z north: right x forward = up
    if up[1] < 0:
        up = -up
    return fw, rt, up


def sample(img, x, y):
    """Bilinear sample of img (h, w, 3) at float pixel coordinates."""
    h, w = img.shape[:2]
    x0 = np.clip(np.floor(x).astype(int), 0, w - 2)
    y0 = np.clip(np.floor(y).astype(int), 0, h - 2)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    a = img[y0, x0] * (1 - fx) + img[y0, x0 + 1] * fx
    b = img[y0 + 1, x0] * (1 - fx) + img[y0 + 1, x0 + 1] * fx
    return a * (1 - fy) + b * fy


import os
MINRES = float(os.environ.get('MINRES', 0.35))

def main() -> None:
    spec = json.load(open(sys.argv[1]))
    todo = json.load(open(spec["todo"]))
    wall = next(t for t in todo if t["id"] == spec["wall"])
    lat, lng = spec["cam"]
    cam = np.array([(lng - lon0) * mlon, spec.get("cam_h", 2.5), (lat - lat0) * mlat])
    a, b = np.array(wall["a"]), np.array(wall["b"])
    # Left-to-right as the viewer facing the wall sees it.
    hd = math.radians(wall["heading"])
    right = np.array([math.cos(hd), -math.sin(hd)])
    if np.dot(b - a, right) < 0:
        a, b = b, a
    length = float(np.linalg.norm(b - a))
    tdir = (b - a) / length
    s0, s1 = spec.get("s0", 0.0), spec.get("s1") or length
    height, ppm = spec["height"], spec.get("ppm", 90)
    W, H = int(round((s1 - s0) * ppm)), int(round(height * ppm))
    ss = s0 + (np.arange(W) + 0.5) / ppm
    yy = height - (np.arange(H) + 0.5) / ppm
    S, Y = np.meshgrid(ss, yy)
    # Plane offset toward the street (metres): a portico's columns stand
    # proud of the wall, and only the plane you pick comes out straight.
    out_m = spec.get("out_m", 0.0)
    nrm = np.array([-tdir[1], tdir[0]])
    if np.dot(nrm, right) > 0:  # the outward normal points against `right`'s look direction
        nrm = -nrm
    nrm = -nrm if np.dot(nrm, -np.array([math.sin(hd), math.cos(hd)])) < 0 else nrm
    P = np.stack([a[0] + tdir[0] * S + nrm[0] * out_m, Y, a[1] + tdir[1] * S + nrm[1] * out_m], axis=-1)
    def local(c):
        return np.array([(c[1] - lon0) * mlon, spec.get("cam_h", 2.5), (c[0] - lat0) * mlat])

    out = np.full((H, W, 3), 140.0)
    best = np.full((H, W), -2.0)
    for shot in spec["shots"]:
        # A shot may come from another panorama: {"cam": [lat, lng]}.
        c = local(shot["cam"]) if "cam" in shot else cam
        ray = P - c
        ray /= np.linalg.norm(ray, axis=-1, keepdims=True)
        im = np.asarray(Image.open(shot["file"]).convert("RGB"), dtype=np.float64)
        ih, iw = im.shape[:2]
        f = (ih / 2) / math.tan(math.radians(shot["fov"]) / 2)
        fw, rt, up = basis(shot["heading"], shot["tilt"])
        z = ray @ fw
        with np.errstate(divide="ignore", invalid="ignore"):
            px = iw / 2 + f * (ray @ rt) / z
            py = ih / 2 - f * (ray @ up) / z
        # Score = how central; keep a margin so the UI overlay corners drop out.
        cxn = np.abs(px - iw / 2) / (iw / 2)
        cyn = np.abs(py - ih / 2) / (ih / 2)
        ok = (z > 0.05) & (cxn < 0.97) & (cyn < 0.97)
        sx = np.hypot(np.gradient(px, axis=1), np.gradient(py, axis=1)); sy = np.hypot(np.gradient(px, axis=0), np.gradient(py, axis=0))
        ok &= (sx > MINRES) & (sy > MINRES)
        score = np.where(ok, 1.0 - np.maximum(cxn, cyn), -1.0)
        take = (score > best) & ok
        if take.any():
            px = np.where(take, px, 0)
            py = np.where(take, py, 0)
            out[take] = sample(im, px, py)[take]
            best[take] = score[take]
    covered = best > -1.5
    print(f"{spec['wall']}: {W}x{H}px, {100 * covered.mean():.0f}% covered")
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(spec["out"])


if __name__ == "__main__":
    main()
