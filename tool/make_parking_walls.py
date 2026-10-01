"""Low-res weathered plaster for the walls round the Hotel Dubrovnik car park (Praška ulica 6).

The lot behind the Praška frontage is open to the street, so its enclosing walls are seen from the
street and from inside it, but nobody photographed them: they are INVENTED procedural courtyard plaster
(windows in rows, from `make_firewalls.plaster`), packed low-res (`res` 0.25 for walls facing the lot,
0.1 for the rest of the block). Needs `.art/walls_all.json` (`export_web.dart --dump-walls`). Writes
data/hero/parking.json, the raws under .art/facades/pk_<wall>/ and .art/streetview/parking_todo.json.

    .venv/bin/python tool/make_parking_walls.py
    .venv/bin/python tool/prepare_facades.py pack && tool/export_locked.sh
"""

import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_firewalls as fw  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BOX = (30.0, 96.0, -172.0, -99.0)  # x0, x1, z0, z1 (tool frame)
MIN_LEN = 1.5
fw.H = 192  # low-res anyway: the pack squeezes it to 192 px (res 0.25) or 77 px (0.1)


def lot() -> list[tuple[float, float]]:
    park = json.loads((ROOT / "data" / "park.json").read_text())
    return [tuple(p) for p in park["asphalt"][0]]


def inside(poly: list[tuple[float, float]], x: float, z: float) -> bool:
    c = False
    for (ax, az), (bx, bz) in zip(poly, poly[1:] + poly[:1]):
        if (az > z) != (bz > z) and x < ax + (z - az) / (bz - az) * (bx - ax):
            c = not c
    return c


def main() -> None:
    walls = json.loads((ROOT / ".art" / "walls_all.json").read_text())
    atlas = json.loads((ROOT / "data" / "hero" / "atlas.json").read_text())["facades"]
    covered = {e for n, f in atlas.items() if not n.startswith("pk_") for e in f["edges"]}
    poly = lot()
    facades, todo = [], []
    for w in sorted(walls, key=lambda w: w["wall"]):
        x, z = w["mid"]
        if not (BOX[0] < x < BOX[1] and BOX[2] < z < BOX[3]) or w["len"] < MIN_LEN or w["wall"] in covered:
            continue
        if not w.get("outer", True):
            continue
        nx, nz = w["n"]
        facing = inside(poly, x + nx * 2.5, z + nz * 2.5)
        res = 0.25 if facing else 0.1
        wall = w["wall"]
        st = max(1, round((w["eave"] - fw.GROUND_EXTRA) / fw.STOREY))
        height = st * fw.STOREY + fw.GROUND_EXTRA
        width = min(2600, max(120, round(fw.H * w["len"] / height)))
        seed = int(hashlib.md5(wall.encode()).hexdigest()[:8], 16)
        rng = np.random.default_rng(seed)
        stucco = np.array([fw.lin(236), fw.lin(230), fw.lin(220)])
        base = np.array([fw.srgb(c * k) for c, k in zip(w["paint"], stucco)]) * rng.uniform(0.86, 0.95)
        base = np.clip(base + rng.normal(0, 3, 3), 0, 255)
        mix = (0.30, 0.34) if w["kind"] == "party" else (0.06, 0.80)
        img = fw.plaster(width, w["len"], height, base, seed, w["other"] or 0, mix)
        name = "pk_" + wall
        d = ROOT / ".art" / "facades" / name
        d.mkdir(parents=True, exist_ok=True)
        img.save(d / "raw.png")
        img.save(d / "photo.png")
        facades.append(dict(
            name=name, photo=f".art/facades/{name}/photo.png", edges=[wall], bays=max(1, round(w["len"] / 3)),
            storeys=st, res=res, place="Praška ulica",
            source=f"INVENTED, low-res: procedural courtyard plaster ({w['len']:.0f} m {w['kind']} wall) round the Hotel Dubrovnik car park",
            look="INVENTED low-res wall drawn procedurally",
        ))
        todo.append(dict(id=wall, length=round(w["len"], 2), eave=w["eave"]))
        print(f"{wall}: {w['len']:.1f} m, {st} storeys, {w['kind']}, res {res}")
    (ROOT / "data" / "hero" / "parking.json").write_text(json.dumps({"facades": facades}, indent=1, ensure_ascii=False) + "\n")
    (ROOT / ".art" / "streetview" / "parking_todo.json").write_text(json.dumps({"section": "parking", "facades": todo}, indent=1))
    print(len(facades), "pictures,", round(sum(t["length"] for t in todo)), "m")


if __name__ == "__main__":
    main()
