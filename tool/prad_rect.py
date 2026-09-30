#!/usr/bin/env python3
"""Rectify Preradovicheva walls from hand-picked frames (throwaway helper).
usage: prad_rect.py WALL [frame:tilt ...]   frame = s1_h270 etc, optional @s0-s1 metres"""
import json, subprocess, sys, os
P = ".art/streetview/prad/"
S = {"s1": [45.8115074, 15.9743085], "s2": [45.8103618, 15.9745411], "s3": [45.8105698, 15.9743338], "s4": [45.811076, 15.9742769]}
T = {0: 110, 45: 115, 90: 125, 135: 115, 180: 110, 225: 115, 270: 125, 315: 115}
wall = sys.argv[1]
shots = []
s0 = s1 = None
for a in sys.argv[2:]:
    if a.startswith("@"):
        s0, s1 = [float(x) for x in a[1:].split("-")]; continue
    s, h = a.split("_h"); h = int(h)
    shots.append({"file": f"{P}{s}_h{h}.jpg", "heading": h, "tilt": T[h], "fov": 90, "cam": S[s]})
todo = json.load(open(".art/streetview/prad_todo.json"))
w = next(t for t in todo if t["id"] == wall)
spec = {"todo": ".art/streetview/prad_todo.json", "wall": wall, "cam": S["s1"], "cam_h": 2.5,
        "height": float(os.environ.get("H", w["eave"] + 2)), "ppm": 70, "shots": shots, "out": f"{P}r_{wall}.png"}
if s0 is not None: spec["s0"], spec["s1"] = s0, s1
json.dump(spec, open(P + "spec.json", "w"))
subprocess.run([".venv/bin/python", "tool/sv_rectify.py", P + "spec.json"])
