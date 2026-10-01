"""Which plain (un-pictured) walls can actually be seen from the open ground of the square?

Runs web3d/tools/shot.mjs (headless Chrome, the dev server must be up) and casts
rays through the RENDERED meshes from a grid of standpoints over the square; every
hit on a vertical face with the plain stucco tile (48) is matched to its OSM wall
edge in `.art/walls_all.json` (`fvm dart tool/export_web.dart --dump-walls`).
Writes `.art/plain_visible.json`: [{wall, hits, kind, len, eave, y0, y1}] most-hit
first. Takes about two minutes. `tool/make_firewalls.py` reads it.

    .venv/bin/python tool/plain_scan.py [x0 x1 dx z0 z1 dz]   # web-frame standpoints
    PTS="x,z;x,z;..." .venv/bin/python tool/plain_scan.py     # TOOL-frame standpoints along a path (z north)
"""

import collections
import json
import math
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

JS = """(()=>{
const dirs=[];
for(let a=0;a<360;a+=3){ for(const el of [3,14,28,44]){ const e=el*Math.PI/180, r=a*Math.PI/180; dirs.push(Math.sin(r)*Math.cos(e), Math.sin(e), Math.cos(r)*Math.cos(e)); } }
const all=[];
for(let x=%(x0)s;x<=%(x1)s;x+=%(dx)s){ for(let z=%(z0)s;z<=%(z1)s;z+=%(dz)s){
  const h=zg.groundAt(x,z);
  const r=zg.plainHits(x,h+2,z,dirs,170);
  for(let i=0;i<r.length;i+=6) all.push([r[i].toFixed(1),r[i+1].toFixed(1),r[i+2].toFixed(1),r[i+3].toFixed(2),r[i+4].toFixed(2),r[i+5]].join(','));
}}
window._plain=all; return all.length;
})()"""

JS_PTS = """(()=>{
const dirs=[];
for(let a=0;a<360;a+=3){ for(const el of [3,14,28,44]){ const e=el*Math.PI/180, r=a*Math.PI/180; dirs.push(Math.sin(r)*Math.cos(e), Math.sin(e), Math.cos(r)*Math.cos(e)); } }
const all=[];
for(const [x,z] of %(pts)s){
  const h=zg.groundAt(x,z);
  const r=zg.plainHits(x,h+2,z,dirs,170);
  for(let i=0;i<r.length;i+=6) all.push([r[i].toFixed(1),r[i+1].toFixed(1),r[i+2].toFixed(1),r[i+3].toFixed(2),r[i+4].toFixed(2),r[i+5]].join(','));
}
window._plain=all; return all.length;
})()"""


def segdist(p, a, b):
    (px, pz), (ax, az), (bx, bz) = p, a, b
    vx, vz = bx - ax, bz - az
    l2 = vx * vx + vz * vz or 1e-9
    t = max(0, min(1, ((px - ax) * vx + (pz - az) * vz) / l2))
    return math.hypot(px - ax - t * vx, pz - az - t * vz)


def main() -> None:
    a = [float(v) for v in sys.argv[1:7]] or [-60, 90, 30, -35, 40, 25]
    if len(a) < 6:
        a = [-60, 90, 30, -35, 40, 25]
    if os.environ.get("PTS"):
        pts = [[float(v) for v in q.split(",")] for q in os.environ["PTS"].split(";")]
        js = JS_PTS % dict(pts=json.dumps([[x, -z] for x, z in pts]))  # tool frame -> web frame
    else:
        js = JS % dict(x0=a[0], x1=a[1], dx=a[2], z0=a[3], z1=a[4], dz=a[5])
    out = subprocess.run(
        ["node", "tools/shot.mjs", "--wait-ready", "120", "--sleep", "2500", "--url", "http://localhost:5180/?people=0&nopigeons",
         "--eval", js, "--eval", "JSON.stringify(window._plain)"],
        cwd=ROOT / "web3d", capture_output=True, text=True, timeout=900,
    ).stdout.splitlines()
    line = [l for l in out if l.startswith("[eval]")][-1]
    hits = json.loads(json.loads(line[len("[eval] "):]))
    walls = json.loads((ROOT / ".art" / "walls_all.json").read_text())
    edges = []
    for w in walls:
        mx, mz = w["mid"]
        nx, nz = w["n"]
        half = w["len"] / 2
        edges.append((w, (mx + nz * half, mz - nx * half), (mx - nz * half, mz + nx * half)))
    hits_by, ys = collections.Counter(), collections.defaultdict(list)
    for h in hits:
        x, y, z, nx, nz, tile = (float(v) for v in h.split(","))
        if tile != 48:
            continue
        p, n = (x, -z), (nx, -nz)
        best, bd = None, 1.2
        for w, s, e in edges:
            if abs(w["mid"][0] - p[0]) > w["len"] / 2 + 2 or abs(w["mid"][1] - p[1]) > w["len"] / 2 + 2:
                continue
            d = segdist(p, s, e)
            if d < bd and w["n"][0] * n[0] + w["n"][1] * n[1] > 0.4:
                bd, best = d, w
        if best:
            hits_by[best["wall"]] += 1
            ys[best["wall"]].append(y)
    by = {w["wall"]: w for w, _, _ in edges}
    rows = [
        {"wall": k, "hits": c, "kind": by[k]["kind"], "len": by[k]["len"], "eave": by[k]["eave"], "hero": by[k]["hero"],
         "y0": round(min(ys[k])), "y1": round(max(ys[k]))}
        for k, c in hits_by.most_common()
    ]
    (ROOT / ".art" / "plain_visible.json").write_text(json.dumps(rows, indent=1))
    plain = [r for r in rows if not r["hero"]]
    print(len(hits), "plain hits;", len(plain), "plain walls seen; top:")
    for r in plain[:15]:
        print(" ", r["hits"], r["wall"], r["kind"], "len", r["len"], "y", r["y0"], "-", r["y1"])


if __name__ == "__main__":
    main()
