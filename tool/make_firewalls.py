"""Blank party walls (brandmauers) and corner strips for the hero atlas, drawn procedurally.

A party wall shows only above its lower neighbour, and in real Zagreb it is
weathered plaster: patched render, rain streaks, the ghosts of bricked-up
windows, a downpipe, now and then a small real window. They are INVENTED (no
photograph), so the source says so.

Reads `.art/walls_all.json` (`fvm dart tool/export_web.dart --dump-walls`), takes
every party wall near the square that has no hero picture yet and is visible
(taller than its neighbour), writes `.art/facades/fw_<wall>/{raw,photo}.png`,
`data/hero/firewall.json` and `.art/streetview/firewall_todo.json` (true lengths for
`prepare_facades.py pack`). Deterministic per wall; rerun freely, then `pack` and
export. Options: RADIUS=<m> (default 150), MINVIS=<m> (3), WALLS=<wall>[=<donor>|=plaster],... (extra
walls at any distance: a strip of the named donor picture, else of the building's own real facade, else of
its filler, else plaster; courtyard walls of an inner ring work too).
"""

import hashlib
import json
import math
import os
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
STOREY, GROUND_EXTRA = 3.7, 1.0
H = 768


def srgb(lin: float) -> float:
    lin = max(0.0, min(1.0, lin))
    return 255 * (12.92 * lin if lin <= 0.0031308 else 1.055 * lin ** (1 / 2.4) - 0.055)


def lin(v: float) -> float:
    v /= 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def fbm(rng: np.random.Generator, h: int, w: int, cells=(3, 6, 12, 24, 48), gain=0.55) -> np.ndarray:
    """Smooth noise in about -1..1."""
    out = np.zeros((h, w), np.float32)
    amp = 1.0
    for c in cells:
        small = rng.standard_normal((max(2, h // c), max(2, w // c))).astype(np.float32)
        im = Image.fromarray(small, mode="F").resize((w, h), Image.Resampling.BICUBIC)
        out += np.asarray(im) * amp
        amp *= gain
    return out / (out.std() * 3 + 1e-6)


def blur(a: np.ndarray, r: float) -> np.ndarray:
    """Separable Gaussian blur of a float image (PIL cannot filter mode F)."""
    n = int(r * 3) + 1
    k = np.exp(-0.5 * (np.arange(-n, n + 1) / r) ** 2)
    k /= k.sum()
    a = np.pad(a.astype(np.float32), n, mode="edge")
    a = sum(k[i] * a[:, i : a.shape[1] - 2 * n + i] for i in range(2 * n + 1))
    a = sum(k[i] * a[i : a.shape[0] - 2 * n + i] for i in range(2 * n + 1))
    return a


def plaster(width: int, length_m: float, height_m: float, rgb: np.ndarray, seed: int, hidden_m: float,
            mix: tuple[float, float] = (0.30, 0.34)) -> Image.Image:
    """[hidden_m]: how much of the wall's foot a neighbour hides; windows and streaks start above it.
    [mix]: a window is a bricked-up ghost below mix[0], a small real window below mix[1] (a courtyard wall
    of a lived-in building has many)."""
    rng = np.random.default_rng(seed)
    px_m = width / length_m
    img = np.ones((H, width, 3), np.float32) * rgb
    # Mottling: broad and fine.
    lum = 1 + 0.075 * fbm(rng, H, width, (6, 12, 24, 48, 96)) + 0.03 * fbm(rng, H, width, (2, 3, 5))
    # Patches of repaired render: soft-edged blocks a little lighter or darker.
    patch = np.zeros((H, width), np.float32)
    for _ in range(int(6 + length_m / 4)):
        pw, ph = int(rng.uniform(1.5, 6) * px_m), int(rng.uniform(1.5, 5) * px_m)
        x0, y0 = int(rng.uniform(0, max(1, width - pw))), int(rng.uniform(0, max(1, H - ph)))
        patch[y0 : y0 + ph, x0 : x0 + pw] += rng.choice([-1, 1]) * rng.uniform(0.03, 0.08)
    lum += blur(patch, 5)
    # Rain streaks running down from the top and from ledges.
    streak = np.zeros((H, width), np.float32)
    for _ in range(int(length_m * 1.4)):
        x = int(rng.uniform(0, width))
        y0 = int(rng.choice([0, 0, rng.uniform(0, H * 0.7)]))
        ln = int(rng.uniform(0.15, 0.6) * H)
        wd = int(rng.uniform(2, 7))
        ramp = np.linspace(1, 0, min(ln, H - y0))[:, None] ** 0.8
        streak[y0 : y0 + ramp.shape[0], x : x + wd] += rng.uniform(0.05, 0.15) * ramp
    lum -= blur(streak, 2.2)
    # Rising damp at the foot, soot under the cornice.
    y = np.linspace(0, 1, H)[:, None]
    lum -= 0.10 * np.clip((y - 0.86) / 0.14, 0, 1) ** 1.5
    lum -= 0.05 * np.clip((0.05 - y) / 0.05, 0, 1)
    img *= lum[..., None]
    # Windows: a grid of bays at each storey above the neighbour.
    bay = 3.0
    cols = max(1, int(length_m // bay))
    off = (length_m - cols * bay) / 2
    storeys = max(1, round((height_m - GROUND_EXTRA) / STOREY))
    layer = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    from PIL import ImageDraw

    dr = ImageDraw.Draw(layer, "RGBA")
    for s in range(1, storeys):
        # Window sill height on the wall: ground extra + storey k * 3.7 + 0.9.
        base_m = GROUND_EXTRA + s * STOREY + 0.9
        if base_m < hidden_m + 0.6:
            continue
        for c in range(cols):
            cx = (off + (c + 0.5) * bay) * px_m
            wpx, hpx = 1.2 * px_m, 1.8 * px_m
            y1 = H - base_m / height_m * H
            y0 = y1 - hpx
            if y0 < 0.03 * H:
                continue
            roll = rng.random()
            box = [cx - wpx / 2, y0, cx + wpx / 2, y1]
            if roll < mix[0]:
                # A bricked-up window: a ghost, the filling a shade off and the frame darker.
                tone = rng.choice([-1, 1]) * rng.uniform(8, 16)
                dr.rectangle(box, fill=(int(128 + tone), int(128 + tone), int(128 + tone), 60), outline=(60, 55, 50, 90), width=2)
                dr.rectangle([box[0] - 3, y1, box[2] + 3, y1 + 4], fill=(235, 232, 225, 110))
            elif roll < mix[1]:
                # A small real window, dark glass in a pale frame.
                dr.rectangle([box[0] - 3, box[1] - 3, box[2] + 3, box[3] + 3], fill=(225, 222, 214, 255))
                dr.rectangle(box, fill=(52, 62, 72, 255))
                dr.line([(cx, box[1]), (cx, box[3])], fill=(225, 222, 214, 255), width=2)
                dr.rectangle([box[0], box[1], box[2], box[1] + hpx * 0.28], fill=(96, 112, 126, 200))
                dr.rectangle([box[0] - 4, y1 + 3, box[2] + 4, y1 + 7], fill=(200, 196, 188, 255))
    # A downpipe near one edge.
    dx = int(width * (0.03 if rng.random() < 0.5 else 0.97))
    dr.rectangle([dx - 3, int(H * 0.02), dx + 3, int(H * 0.9)], fill=(112, 114, 116, 255))
    out = np.asarray(layer).astype(np.float32)
    out += rng.standard_normal(out.shape).astype(np.float32) * 1.6
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def crop_from(raw_path: Path, donor_len: float, donor_st: int, need_len: float, st: int, at_end: bool) -> Image.Image:
    """A strip [need_len] m wide of a donor picture (the pavement-to-cornice raw of a real facade
    of the same building), taken from the end nearest the corner, at the donor's true scale."""
    im = Image.open(raw_path).convert("RGB")
    donor_h = donor_st * STOREY + GROUND_EXTRA
    im = im.resize((round(im.height * donor_len / donor_h), im.height), Image.Resampling.LANCZOS)
    need = max(8, round(im.height * need_len / (st * STOREY + GROUND_EXTRA)))
    strip = im
    while strip.width < need:
        strip = Image.fromarray(np.concatenate([np.asarray(strip), np.asarray(im.transpose(Image.FLIP_LEFT_RIGHT))], axis=1))
    x0 = strip.width - need if at_end else 0
    return strip.crop((x0, 0, x0 + need, im.height))


def main() -> None:
    radius = float(os.environ.get("RADIUS", 150))
    min_vis = float(os.environ.get("MINVIS", 3))
    walls = json.loads((ROOT / ".art" / "walls_all.json").read_text())
    by_id = {w["wall"]: w for w in walls}
    atlas = json.loads((ROOT / "data" / "hero" / "atlas.json").read_text())["facades"]
    storeys_of: dict[str, int] = {}
    donors: dict[str, list[tuple[str, dict]]] = {}
    fill_donors: dict[str, list[tuple[str, dict]]] = {}
    for name, f in atlas.items():
        if name.startswith("fw_") or not (ROOT / ".art" / "facades" / name / "raw.png").exists():
            continue
        if name.startswith("fill_"):
            fb = f["edges"][0].rsplit("_e", 1)[0]
            fill_donors.setdefault(fb, []).append((name, f))
            storeys_of[fb] = max(storeys_of.get(fb, 0), f["storeys"])
            continue
        for e in f["edges"]:
            b = e.rsplit("_e", 1)[0]
            storeys_of[b] = max(storeys_of.get(b, 0), f["storeys"])
        b = f["edges"][0].rsplit("_e", 1)[0]
        donors.setdefault(b, []).append((name, f))
    # What a real (or filler) picture already covers; our own fw_ pictures do not count, so a rerun
    # gives the same answer whatever an earlier run produced.
    covered = {e for name, f in atlas.items() if not name.startswith("fw_") for e in f["edges"]}
    # Candidates: (a) party walls above a lower neighbour near the square, (b) the short edges of a
    # rounded or chamfered corner of a building that has a real facade, (c) every plain wall the last
    # scan saw, (d) whatever an earlier run already gave a picture (kept, so the set only grows).
    picks: dict[str, str] = {}
    # A wall -> the donor picture it was told to take its strip from.
    forced: dict[str, str] = {}
    for w in walls:
        x, z = w["mid"]
        if w["wall"] in covered or math.hypot(x, z) > radius:
            continue
        b = w["wall"].rsplit("_e", 1)[0]
        if w["kind"] == "party" and w["eave"] - (w["other"] or 0) >= min_vis and w["len"] >= 5:
            picks[w["wall"]] = "plaster"
        elif w["kind"] == "street" and w["len"] < 6 and b in donors:
            picks[w["wall"]] = "crop"
    seen = ROOT / ".art" / "plain_visible.json"
    if seen.exists():
        for r in json.loads(seen.read_text()):
            w = by_id.get(r["wall"])
            if r["hits"] < 2 or w is None or w["wall"] in covered:
                continue
            picks[r["wall"]] = "crop" if w["kind"] == "street" and w["wall"].rsplit("_e", 1)[0] in donors else "plaster"
    earlier = ROOT / "data" / "hero" / "firewall.json"
    if earlier.exists():
        for f in json.loads(earlier.read_text())["facades"]:
            wall = f["edges"][0]
            w = by_id.get(wall)
            if w is not None and wall not in covered:
                picks.setdefault(wall, "crop" if "corner" in f["source"] else "plaster")
                # A donor of another building (given through WALLS) is only known from the source.
                donor = f["source"].split("strip of ", 1)[1].split(" ", 1)[0] if "strip of " in f["source"] else ""
                b = wall.rsplit("_e", 1)[0]
                own = {n for n, _ in donors.get(b, []) + fill_donors.get(b, [])}
                if donor in atlas and donor not in own and (ROOT / ".art" / "facades" / donor / "raw.png").exists():
                    forced.setdefault(wall, donor)
    for item in filter(None, os.environ.get("WALLS", "").split(",")):
        wall, _, donor = item.strip().partition("=")
        if wall not in by_id:
            raise SystemExit(f"unknown wall {wall} (rerun export_web.dart --dump-walls)")
        if wall in covered:
            continue
        b = wall.rsplit("_e", 1)[0]
        if donor == "plaster" or not (donor or b in donors or b in fill_donors):
            picks[wall] = "plaster"
            forced.pop(wall, None)
        else:
            picks[wall] = "crop"
            if donor:
                if donor not in atlas:
                    raise SystemExit(f"unknown donor {donor}")
                forced[wall] = donor
    facades, todo = [], []
    for wall, mode in sorted(picks.items()):
        w = by_id[wall]
        b = wall.rsplit("_e", 1)[0]
        st = storeys_of.get(b) or max(1, round((w["eave"] - GROUND_EXTRA) / STOREY))
        height = st * STOREY + GROUND_EXTRA
        width = min(2600, max(200, round(H * w["len"] / height)))
        seed = int(hashlib.md5(wall.encode()).hexdigest()[:8], 16)
        rng = np.random.default_rng(seed)
        img = None
        source = ""
        pool = [(forced[wall], atlas[forced[wall]])] if wall in forced else donors.get(b) or fill_donors.get(b)
        if mode == "crop" and pool:
            # The real facade of this building nearest to the wall (else its filler, else the donor it was
            # given); the strip comes from its near end.
            def dist(item):
                f = item[1]
                return min(math.dist(w["mid"], by_id[e]["mid"]) for e in f["edges"] if e in by_id)

            name, f = min(pool, key=dist)
            first, last = by_id[f["edges"][0]], by_id[f["edges"][-1]]
            at_end = math.dist(w["mid"], last["mid"]) < math.dist(w["mid"], first["mid"])
            dlen = sum(by_id[e]["len"] for e in f["edges"] if e in by_id)
            img = crop_from(ROOT / ".art" / "facades" / name / "raw.png", dlen, f["storeys"], w["len"], st, at_end)
            source = f"INVENTED corner: strip of {name} (the same building's facade continued round the corner)"
        if img is None:
            # The paint the plain wall would wear, weathered a little, with some spread.
            stucco = np.array([lin(230), lin(226), lin(218)])
            base = np.array([srgb(c * k) for c, k in zip(w["paint"], stucco)]) * rng.uniform(0.86, 0.95)
            base = np.clip(base + rng.normal(0, 3, 3), 0, 255)
            img = plaster(width, w["len"], height, base, seed, w["other"] or 0)
            source = f"INVENTED firewall: procedural weathered plaster ({w['len']:.0f} m {w['kind']} wall)"
        name = "fw_" + wall
        d = ROOT / ".art" / "facades" / name
        d.mkdir(parents=True, exist_ok=True)
        img.save(d / "raw.png")
        img.save(d / "photo.png")
        facades.append(
            {
                "name": name,
                "photo": f".art/facades/{name}/photo.png",
                "edges": [wall],
                "bays": max(1, round(w["len"] / 3)),
                "storeys": st,
                "place": "",
                "source": source,
                "look": "INVENTED wall drawn procedurally",
            }
        )
        todo.append({"id": wall, "length": w["len"]})
    (ROOT / "data" / "hero" / "firewall.json").write_text(json.dumps({"facades": facades}, indent=1, ensure_ascii=False))
    (ROOT / ".art" / "streetview" / "firewall_todo.json").write_text(json.dumps({"section": "firewall", "facades": todo}))
    print(len(facades), "walls,", round(sum(t["length"] for t in todo)), "m")


if __name__ == "__main__":
    main()
