#!/usr/bin/env python3
"""Maps pano URL that looks squarely at a todo wall from D metres out.
Maps snaps the viewpoint to the nearest panorama, indoor photospheres
included: look at the screenshot's title before trusting it.

    python3 tool/sv_url.py TODO.json INDEX [D=15] [FOV=70] [PITCH=8] [SHIFT=0]

SHIFT moves the eye sideways along the wall (metres, + = towards its end).
"""
import json, math, sys
todo = json.load(open(sys.argv[1]))
f = todo[int(sys.argv[2])]
d = float(sys.argv[3]) if len(sys.argv) > 3 else 15
fov = sys.argv[4] if len(sys.argv) > 4 else 70
pitch = sys.argv[5] if len(sys.argv) > 5 else 8
shift = float(sys.argv[6]) if len(sys.argv) > 6 else 0
(a_lat, a_lng), (b_lat, b_lng) = f["aGeo"], f["bGeo"]
k = math.cos(math.radians(a_lat))
ax, az = a_lng * 111190 * k, a_lat * 111190
bx, bz = b_lng * 111190 * k, b_lat * 111190
mx, mz = (ax + bx) / 2, (az + bz) / 2
h = math.radians(f["heading"])
# heading is where the camera looks (0 = north): the eye is behind it.
ex, ez = -math.sin(h), -math.cos(h)
L = math.hypot(bx - ax, bz - az)
tx, tz = (bx - ax) / L, (bz - az) / L
x, z = mx + ex * d + tx * shift, mz + ez * d + tz * shift
print(f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={z/111190:.7f},{x/(111190*k):.7f}"
      f"&heading={f['heading']}&pitch={pitch}&fov={fov}")
