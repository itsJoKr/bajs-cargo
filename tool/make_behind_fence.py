"""Low-resolution invented pictures for the plain walls behind the road closure.

Everything north of the road closure in data/fences.json (the Cathedral's north tower across Kaptol
to the tourist board building) is out of bounds, so its walls only need a plausible, very low-res
picture (`res` 0.1, or 0.25 within 45 m of the closure). Each picture is a random crop of a donor:
the rubble wall's own photo for the Kaptol wall, the invented `fill_*` facades of the same storey
count nearest to it for the rest. Writes data/hero/behind_fence.json, the raws under
.art/facades/behind_<wall>/ and .art/streetview/behind_todo.json (true wall lengths for `pack`).
Needs `.art/walls_all.json` (`fvm dart tool/export_web.dart --dump-walls`). Incremental: walls that
already have a picture (atlas.json, another section, an earlier run) are left alone.

    .venv/bin/python tool/make_behind_fence.py
    .venv/bin/python tool/prepare_facades.py pack && tool/export_locked.sh
"""

import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
STOREY, GE = 3.7, 1.0

# The road closure in data/fences.json: everything north (tool z up) of this line is out of bounds.
LINE = [(172.0, 197.0), (130.0, 197.0), (104.0, 197.0), (86.4, 209.8)]
MARGIN = 1.0
MIN_X = -140.0  # west of it is the blocked Gornji Grad hill
# Buildings whose walls are rubble stone (the Kaptol wall): the wall's own photo, 2 storeys.
STONE = {"w735346958"}
MIN_LEN = 1.5


def line_z(x: float) -> float:
    """The closure's z at x (its ends run on level)."""
    pts = sorted(LINE)
    if x <= pts[0][0]:
        return pts[0][1]
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        if x <= bx:
            return az + (bz - az) * (x - ax) / (bx - ax)
    return pts[-1][1]


# The second closure: the roadblock across Ulica Josipa Eugena Tomića (the Uspinjača street) at z = 26.
USP = (-345.0, 295.0, 20.0, 130.0)  # x0, -x1 (x1 = -295), z0, z1 in tool metres


def in_usp(x: float, z: float) -> bool:
    return USP[0] < x < -USP[1] and USP[2] < z < USP[3]


def res_for(wall: dict) -> float:
    """1/4 within 45 m of the closure (seen from the street), 1/10 beyond."""
    x, z = wall["mid"]
    if in_usp(x, z):
        return 0.5 if z < 27 else 0.25 if z < 75 else 0.1
    return 0.25 if z - line_z(x) < 45 else 0.1


def main() -> None:
    walls = {w["wall"]: w for w in json.loads((ROOT / ".art" / "walls_all.json").read_text())}
    atlas = json.loads((ROOT / "data/hero/atlas.json").read_text())["facades"]
    have = {e for f in atlas.values() for e in f["edges"]}
    out_path = ROOT / "data/hero/behind_fence.json"
    out = json.loads(out_path.read_text())["facades"] if out_path.exists() else []
    have |= {e for f in out for e in f["edges"]}

    # Donors: invented fillers (true aspect, one storey count each) and the rubble-wall photo.
    fill = json.loads((ROOT / "data/hero/fill.json").read_text())["facades"]
    donors = []
    for f in fill:
        raw = ROOT / ".art" / "facades" / f["name"] / "raw.png"
        w = walls.get(f["edges"][0])
        if raw.exists() and w:
            donors.append(dict(name=f["name"], st=f["storeys"], mid=w["mid"], raw=raw, width=w["len"]))
    stone_raw = ROOT / ".art" / "facades" / "kaptol_wall_e" / "raw.png"

    todo = []
    cache: dict[Path, Image.Image] = {}
    for wid, w in sorted(walls.items()):
        x, z = w["mid"]
        b = wid.split("_")[0]
        if not w.get("outer", True) or w["len"] < MIN_LEN or wid in have:
            continue
        if not (in_usp(x, z) or (x >= MIN_X and z >= line_z(x) + MARGIN)):
            continue
        stone = b in STONE
        st = 2 if stone else max(1, round((w["eave"] - GE) / STOREY))
        hd = st * STOREY + GE
        name = f"behind_{wid}"
        if stone:
            dn_name, src, src_w, dn_st = "kaptol_wall_e", stone_raw, 19.5, 2
        else:
            cands = [d for d in donors if d["st"] == st] or sorted(donors, key=lambda d: abs(d["st"] - st))[:20]
            dn = min(cands, key=lambda d: math.dist(d["mid"], w["mid"]))
            dn_name, src, src_w, dn_st = dn["name"], dn["raw"], dn["width"], dn["st"]
        if src not in cache:
            cache[src] = Image.open(src).convert("RGB")
        im = cache[src]
        # The donor at its true aspect, tiled with mirrors when the target is wider.
        im = im.resize((round(im.height * src_w / (dn_st * STOREY + GE)), im.height), Image.Resampling.LANCZOS)
        need = round(im.height * w["len"] / hd)
        strip = im
        while strip.width < need + im.width:
            strip = Image.fromarray(np.concatenate([np.asarray(strip), np.asarray(im.transpose(Image.FLIP_LEFT_RIGHT))], axis=1))
        off = int(hashlib.md5(name.encode()).hexdigest(), 16) % max(1, strip.width - need)
        crop = strip.crop((off, 0, off + need, im.height)).resize((max(16, need // 2), im.height // 2), Image.Resampling.LANCZOS)
        d = ROOT / ".art" / "facades" / name
        d.mkdir(parents=True, exist_ok=True)
        crop.save(d / "raw.png")
        crop.save(d / "photo.png")
        out.append(dict(
            name=name, photo=f".art/facades/{name}/photo.png", edges=[wid], bays=max(1, round(w["len"] / 3)),
            storeys=st, res=res_for(w), place="Ulica Josipa Eugena Tomića" if in_usp(*w["mid"]) else "Kaptol",
            source=f"INVENTED, very low-res: random crop of {dn_name} for a wall behind a road closure (Kaptol, or the Uspinjača street)",
            look=f"INVENTED low-res crop of {dn_name}",
        ))
        todo.append(dict(id=wid, building=b, length=round(w["len"], 2), eave=w["eave"]))
        print(f"{wid}: {w['len']:.1f} m, {st} storeys, res {res_for(w)}, donor {dn_name}")

    out_path.write_text(json.dumps({"facades": out}, indent=1, ensure_ascii=False) + "\n")
    tp = ROOT / ".art" / "streetview" / "behind_todo.json"
    old = json.loads(tp.read_text())["facades"] if tp.exists() else []
    known = {f["id"] for f in old}
    tp.write_text(json.dumps({"section": "behind", "facades": old + [t for t in todo if t["id"] not in known]}, indent=1))
    print(len(out), "pictures,", round(sum(walls[f["edges"][0]]["len"] for f in out)), "m")


if __name__ == "__main__":
    main()
