#!/usr/bin/env python3
"""Turns Street View photos of real buildings into straight-on facade
textures and packs them into the hero atlas.

    .venv/bin/python tool/prepare_facades.py [crop|generate|pack|all] [name ...]

Input: `data/hero/<section>.json` (committed): for each real facade, the
Street View frame it was photographed in (`.art/streetview/frames/`, taken
through the user's Chrome with tool/sv_plan.py / tool/sv_batch.py), a crop
box, the OSM footprint edges it covers, and what it looks like (bays,
storeys, a description written while looking at the photo).

Steps, each resumable (a step whose output exists is skipped; pass names to
redo just those facades):

1. crop     .art/facades/<name>/photo.png   the building cut out of the frame
2. generate .art/facades/<name>/raw.png     gen-image (Codex CLI, gpt-image-2)
            turns the photo into an orthographic, evenly lit, clean
            elevation with exactly the counted bays and storeys
3. pack     assets/textures/hero_atlas_<n>.png (pages) + data/hero/atlas.json
            every facade scaled to 512 px tall at its real aspect (32 px/m
            at the square's 16 m eaves), shelf packed 2048 wide with a
            4 px edge-replicated gutter so mips never bleed a neighbour
            in; the height is the next power of two. atlas.json maps
            name -> rect [u0, v0, u1, v1] in texture coordinates (v down)

`.art/facades/manifest.json` records a verdict per facade
(cropped / generated / packed / rejected + reason).

The gen-image prompt (Codex CLI with the photo attached via -i) is PROMPT
below. Since 2026-09-29 it asks for a faithful copy: shop names, signs,
ads, plaques, lettering, cracks and stains stay, spelled as photographed;
only what stands in front of the building goes. (The first 17 were drawn
with a prompt that removed signs and lettering; those raws are kept as
`raw_clean.png`.)

gen-image output is saved unprocessed; this script only resizes it.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / ".art" / "streetview" / "frames"
WORK = ROOT / ".art" / "facades"
MANIFEST = WORK / "manifest.json"
# Every data/hero/<section>.json (not atlas.json / coverage.json).
SECTIONS = sorted(
    p.stem for p in (ROOT / "data" / "hero").glob("*.json")
    if p.stem not in ("atlas", "coverage")
)
# 768 px per facade height (about 40 px/m) keeps shop lettering legible.
# The hero pages are one KTX2 array texture (block-compressed, one texture unit), so the
# page count is limited by GPU memory only: ~22 MB a 4096-px page. HERO_ROW is the knob.
ROW, ATLAS, GUTTER = int(os.environ.get("HERO_ROW", 768)), 4096, 4
PAGE_H = int(os.environ.get("HERO_PAGE_H", 4096))  # tests use a small one
STOREY, GROUND_EXTRA = 3.7, 1.0

PROMPT = """The attached photo is a Google Street View picture of one real building \
facade in {place}, Zagreb, Croatia: {look}. Produce a faithful texture of \
exactly this building's facade for a 3D city model: a perfectly orthographic, straight-on \
front elevation (no perspective, no vanishing lines, all verticals vertical and all \
floors level), evenly lit by soft overcast daylight with no cast shadows. Copy the real \
building exactly as it is in the photo, including everything on it: {bays} window bays \
across and {storeys} storeys from the pavement up to the main cornice, the same window \
shapes and surrounds, ornament, balconies, colours and materials, the same ground-floor \
openings and shop fronts. Keep every shop name, sign, logo, letter, number, plaque, \
poster and advertisement that is on the building, in the same place, size, colours and \
typeface, spelled letter for letter exactly as in the photo, and invent no text that is \
not there. Keep awnings and canopies fixed to the facade, window blinds and curtains, \
cables, air-conditioning units, satellite dishes, cracks, stains, weathering, peeling \
paint and graffiti as they are. Show only this one building, from the pavement at the \
bottom edge to the top of its eaves cornice at the top edge, filling the whole image \
edge to edge; include no roof above the cornice, no sky, no street, no neighbouring \
buildings. Remove only what stands in front of the building and is not attached to it: \
people, cars, trams, lamp posts, poles, traffic signs, statues, trees, free-standing \
café umbrellas and furniture, and any map interface overlay; where they hid the facade, \
continue what is visible around them. Photorealistic, sharp, {width}x{height}."""


def facades() -> list[dict]:
    out = []
    for section in SECTIONS:
        data = json.loads((ROOT / "data" / "hero" / f"{section}.json").read_text())
        out += data["facades"]
    return out


def edge_lengths() -> dict[str, float]:
    """OSM edge id -> length, from the facade work lists."""
    lengths = {}
    for path in (ROOT / ".art" / "streetview").glob("*_todo.json"):
        data = json.loads(path.read_text())
        # list_hero_facades writes {"section", "facades": [...]}; older files a bare list.
        for f in data["facades"] if isinstance(data, dict) else data:
            lengths[f["id"]] = f["length"]
    return lengths


def size_for(f: dict) -> tuple[float, float]:
    """The facade's real width and height in metres."""
    lengths = edge_lengths()
    width = sum(lengths.get(e, 15.0) for e in f["edges"])
    height = f["storeys"] * STOREY + GROUND_EXTRA
    return width, height


CORNER = """ This picture is of a street CORNER: the building's cut, rounded or angled \
corner face is in the exact centre of the image and takes the middle {pct}% of the \
width; the two adjoining street faces continue flat to its left and right. Draw it as \
ONE continuous straight-on elevation in which the corner face is unrolled flat (its \
windows, pilasters, sign boards, shop fronts and cornice continue across it at the same \
storey heights); {corner}"""


def corner_frac(f: dict) -> float:
    """Share of a 2:3 picture's width that the corner takes when the picture is drawn at
    the wall's real scale: width / (height * 2/3)."""
    width, height = size_for(f)
    return min(1.0, width / (height * 2 / 3))


def load_manifest() -> dict:
    return json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}


def verdict(name: str, status: str, **extra) -> None:
    m = load_manifest()
    m[name] = {**m.get(name, {}), "status": status, **extra}
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(m, indent=2, sort_keys=True) + "\n")


def crop(f: dict, force: bool) -> None:
    out = WORK / f["name"] / "photo.png"
    if out.exists() and not force:
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    if "photo" in f:
        # A straight-on elevation made by tool/sv_rectify.py: no crop.
        im = Image.open(ROOT / f["photo"]).convert("RGB")
        if max(im.size) > 2400:
            k = 2400 / max(im.size)
            im = im.resize((round(im.width * k), round(im.height * k)), Image.Resampling.LANCZOS)
        im.save(out)
        verdict(f["name"], "cropped", photo=f["photo"], source=f.get("source"))
        return
    im = Image.open(FRAMES / f"{f['frame']}.jpg").convert("RGB").crop(tuple(f["crop"]))
    # A little larger so the model sees detail; it is a reference, not a
    # texture.
    im = im.resize((im.width * 2, im.height * 2), Image.Resampling.LANCZOS)
    im.save(out)
    verdict(f["name"], "cropped", frame=f["frame"], source=f.get("source"))


def generate(f: dict, force: bool) -> subprocess.Popen | None:
    work = WORK / f["name"]
    out = work / "raw.png"
    if out.exists() and not force:
        return None
    width, height = size_for(f)
    aspect = width / height
    w, h = (1536, 1024) if aspect > 1.25 else (1024, 1536) if aspect < 0.8 else (1024, 1024)
    if f.get("corner"):
        w, h = 1024, 1536
    prompt = PROMPT.format(look=f["look"], place=f.get("place", "the historic centre"),
                           bays=f["bays"], storeys=f["storeys"],
                           width=w, height=h)
    if f.get("corner"):
        prompt += CORNER.format(pct=round(100 * corner_frac(f)), corner=f["corner"])
    (work / "prompt.txt").write_text(prompt + "\n")
    if out.exists():
        out.unlink()
    return subprocess.Popen(
        [
            "codex", "exec", "-m", "gpt-5.5", "--sandbox", "workspace-write",
            "--skip-git-repo-check",
            f"Generate an image: {prompt} Save the generated image exactly as "
            "produced (no post-processing, cropping, resizing or filtering) as "
            "raw.png in the current directory $imagegen",
            # After the prompt: -i takes any number of files.
            "-i", "photo.png",
        ],
        cwd=work,
        # codex exec reads extra prompt input from stdin until EOF.
        stdin=subprocess.DEVNULL,
        stdout=open(work / "codex.log", "w"),
        stderr=subprocess.STDOUT,
    )


def _sha(*parts: bytes | str) -> str:
    h = hashlib.sha1()
    for part in parts:
        h.update(part if isinstance(part, bytes) else part.encode())
    return h.hexdigest()[:16]


def encode_page(png: Path, out: Path, codec: str) -> None:
    """One atlas page -> a Basis KTX2 texture with mips (`brew install basis_universal`). The GPU
    keeps it block-compressed (BC7/ASTC/ETC2, 1 byte a pixel, a quarter of RGBA8)."""
    # "etc1sfast" (the HERO_DEV scratch pages) is ETC1S too: it must transcode to the same GPU format
    # as the real pages, since loadHeroAtlas merges every page into one array texture.
    args = (["-uastc", "-uastc_level", "2"] if codec == "uastc"
            else ["-q", "64", "-comp_level", "0"] if codec == "etc1sfast" else ["-q", "255", "-comp_level", "3"])
    subprocess.run(
        ["basisu", "-ktx2", *args, "-mipmap", "-output_file", str(out), str(png)],
        check=True, stdout=subprocess.DEVNULL,
    )


def pack() -> None:
    """Pack every raw.png into the hero atlas pages `assets/textures/hero_atlas_<n>.ktx2`.

    Placement is STABLE: a facade whose picture, width and row height are unchanged keeps its
    page and position from the previous data/hero/atlas.json; new and changed facades go into
    free space (or a new page). Each page is encoded only when its content key changed
    (cache: assets/textures/.hero_cache), so one changed facade re-encodes one page, not all.
    HERO_REPACK=1 repacks from scratch; HERO_CODEC=etc1s (default, small) | uastc (crisper text,
    5x larger, faster to encode: good while iterating).
    HERO_DEV=1 is the development pack: new and changed facades go onto scratch pages AFTER the last
    real page (unoptimised, wasteful, fast low-quality ETC1S encode) and the real pages are left byte for byte
    alone (a changed facade keeps its old picture there as a ghost, so the page key and its cached
    encode stay valid). A normal `pack` later folds the scratch pictures back into the real pages."""
    import numpy as np

    codec = os.environ.get("HERO_CODEC", "etc1s")
    dev = bool(os.environ.get("HERO_DEV"))
    dev_codec = "etc1sfast"
    tex = ROOT / "assets" / "textures"
    cache = tex / ".hero_cache"
    cache.mkdir(parents=True, exist_ok=True)
    atlas_path = ROOT / "data" / "hero" / "atlas.json"
    stride = ROW + 2 * GUTTER
    per_page = PAGE_H // stride
    page_h = per_page * stride

    def lanes_for(res: float) -> tuple[int, int]:
        """(lanes per row, picture height): a low-res facade (`res` 0.5 / 0.25, for walls the player
        cannot reach) takes one of 2 / 4 lanes stacked in a row, each with its own gutters."""
        n = max(1, round(1 / res))
        return n, (ROW if n == 1 else stride // n - 2 * GUTTER)

    items = []
    for f in facades():
        raw = WORK / f["name"] / "raw.png"
        if not raw.exists():
            verdict(f["name"], "rejected", reason="no generated facade")
            continue
        width, height = size_for(f)
        n, h = lanes_for(f.get("res", 1.0))
        w = min(ATLAS - 2 * GUTTER, max(16 if n > 1 else 64, int(round(h * width / height))))
        if f.get("corner"):
            w = max(w, 24)
        frac = round(corner_frac(f), 4) if f.get("corner") else 0
        key = _sha(raw.read_bytes(), f"{w}:{ROW}:{frac}:{GUTTER}" + (f":lane{h}" if n > 1 else ""))
        items.append((f, raw, w, h, n, key))

    # Previous placement. A lane is (global row, lanes in that row, lane index). Low-res lanes share
    # rows with full-height facades: two pictures clash when their x ranges overlap, unless they sit
    # in different lanes of the same lane height.
    old = {}
    if atlas_path.exists() and not os.environ.get("HERO_REPACK"):
        prev = json.loads(atlas_path.read_text())
        if prev.get("row") == ROW and prev.get("width") == ATLAS and prev.get("pageHeight") == page_h:
            old = prev["facades"]
    # Real pages: those holding non-scratch pictures (scratch pictures are placed again by a normal pack).
    real_pages = 1 + max((e["page"] for e in old.values() if not e.get("dev")), default=-1)
    ghosts: list[tuple] = []  # dev: changed pictures' old cells, kept so their real page stays as encoded
    used: dict[int, list[tuple[int, int, int, int]]] = {}  # global row -> [(x0, x1, lanes, lane)]
    place: dict[str, tuple[int, tuple[int, int, int]]] = {}  # name -> (x, lane)

    def fits(row: int, n: int, k: int, x0: int, x1: int) -> bool:
        return all(x1 <= a or x0 >= b or (n > 1 and m == n and j != k) for a, b, m, j in used.get(row, []))

    todo = []
    for f, raw, w, h, n, key in items:
        e = old.get(f["name"])
        if e and e.get("key") == key and (dev or not e.get("dev")):
            x = round(e["rect"][0] * ATLAS)
            y = round(e["rect"][1] * page_h) - GUTTER
            row = e["page"] * per_page + y // stride
            lane = (row, n, (y % stride) // (h + 2 * GUTTER))
            place[f["name"]] = (x, lane)
            used.setdefault(row, []).append((x - GUTTER, x + w + GUTTER, n, lane[2]))
        else:
            todo.append((f, raw, w, h, n, key))
            if dev and e and not e.get("dev"):
                ox = round(e["rect"][0] * ATLAS)
                oy = round(e["rect"][1] * page_h)
                ow = round((e["rect"][2] - e["rect"][0]) * ATLAS)
                oh = round((e["rect"][3] - e["rect"][1]) * page_h)
                ghosts.append((f, raw, ow, oh, e["key"], ox, oy, e["page"]))
    # New and changed: first fit, widest first, into any free stretch of any row (dev: scratch pages only).
    for f, raw, w, h, n, key in sorted(todo, key=lambda it: (it[4], -it[2], it[0]["name"])):
        need = w + 2 * GUTTER
        found = None
        for row in range(real_pages * per_page if dev else 0, max(used, default=-1) + 2 + (real_pages * per_page if dev else 0)):
            for k in range(n):
                starts = sorted({0} | {b for a, b, _, _ in used.get(row, [])})
                x = next((x for x in starts if x + need <= ATLAS and fits(row, n, k, x, x + need)), None)
                if x is not None:
                    found = (x, (row, n, k))
                    break
            if found:
                break
        x, lane = found
        used.setdefault(lane[0], []).append((x, x + need, n, lane[2]))
        place[f["name"]] = (x + GUTTER, lane)
    n_pages = (max(used, default=0) + per_page) // per_page
    if dev:
        n_pages = max(n_pages, real_pages)

    # Page keys: what is on each page, where, and how it is encoded.
    by_page: dict[int, list] = {k: [] for k in range(n_pages)}
    for f, raw, w, h, n, key in items:
        x, (row, _, k) = place[f["name"]]
        y = (row % per_page) * stride + GUTTER + k * (h + 2 * GUTTER)
        by_page[row // per_page].append((f, raw, w, h, key, x, y))
    ghost_by_page: dict[int, list] = {}
    for f, raw, w, h, key, x, y, page in ghosts:
        ghost_by_page.setdefault(page, []).append((f, raw, w, h, key, x, y))
    page_codec = {k: (dev_codec if dev and k >= real_pages else codec) for k in by_page}
    page_key = {
        k: _sha(page_codec[k], str(page_h), *sorted(
            f"{f['name']}:{key}:{x}:{y}" for f, _, _, _, key, x, y in cells + ghost_by_page.get(k, [])))
        for k, cells in by_page.items()
    }
    rects, pages, keys = {}, {}, {}
    for k, cells in by_page.items():
        for f, raw, w, h, key, x, y in cells:
            rects[f["name"]] = [x / ATLAS, y / page_h, (x + w) / ATLAS, (y + h) / page_h]
            pages[f["name"]] = k
            keys[f["name"]] = key
    # Encode the pages whose key has no cached KTX2 yet.
    for k, cells in by_page.items():
        pc = page_codec[k]
        out = cache / f"{pc}_{page_key[k]}.ktx2"
        if out.exists():
            continue
        atlas = np.full((page_h, ATLAS, 3), 128, np.uint8)
        for f, raw, w, h, key, x, y in cells + ghost_by_page.get(k, []):
            im = Image.open(raw).convert("RGB")
            if f.get("corner"):
                # Keep only the middle slice: the corner face at its real width.
                x0 = round(im.width * (1 - corner_frac(f)) / 2)
                im = im.crop((x0, 0, im.width - x0, im.height))
            im = im.resize((w, h), Image.Resampling.LANCZOS if h == ROW else Image.Resampling.BOX)
            padded = np.pad(np.asarray(im), ((GUTTER, GUTTER), (GUTTER, GUTTER), (0, 0)), mode="edge")
            atlas[y - GUTTER:y + h + GUTTER, x - GUTTER:x + w + GUTTER] = padded
        png = cache / f"page_{k}.png"
        Image.fromarray(atlas).save(png, compress_level=1)
        print(f"encoding page {k} ({pc}, {len(cells)} facades)", flush=True)
        encode_page(png, out.with_suffix(".tmp"), pc)
        out.with_suffix(".tmp").rename(out)
        png.unlink()
    # Publish: hero_atlas_<k>.ktx2, drop stale pages, PNG pages of the old scheme and old cache entries.
    for stale in list(tex.glob("hero_atlas*.png")) + list(tex.glob("hero_atlas*.ktx2")):
        stale.unlink()
    live = set()
    for k in range(n_pages):
        src = cache / f"{page_codec[k]}_{page_key[k]}.ktx2"
        live.add(src.name)
        shutil.copyfile(src, tex / f"hero_atlas_{k}.ktx2")
    for old_file in cache.glob("*.ktx2"):
        if old_file.name not in live and old_file.name.split("_")[0] in (codec, dev_codec, "uastc"):
            old_file.unlink()
    for name in rects:
        verdict(name, "packed", rect=rects[name], page=pages[name])
    entries = {
        f["name"]: {"rect": rects[f["name"]], "page": pages[f["name"]], "edges": f["edges"],
                    "storeys": f["storeys"], "source": f.get("source"), "key": keys[f["name"]],
                    **({"dev": True} if dev and pages[f["name"]] >= real_pages else {})}
        for f in facades() if f["name"] in rects
    }
    atlas_path.write_text(json.dumps(
        {"width": ATLAS, "row": ROW, "pageHeight": page_h, "pages": [page_h] * n_pages,
         "storey": STOREY, "groundExtra": GROUND_EXTRA, "facades": entries},
        indent=2, sort_keys=True) + "\n")
    total = sum(p.stat().st_size for p in tex.glob("hero_atlas_*.ktx2")) / 1e6
    print(f"packed {len(rects)} facades ({len(todo)} new or changed) into {n_pages} page(s), {total:.0f} MB {codec}"
          + (f" (dev: {n_pages - real_pages} scratch page(s) after {real_pages} real)" if dev else ""))


def main() -> None:
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    names = set(sys.argv[2:])
    chosen = [f for f in facades() if not names or f["name"] in names]
    if step in ("crop", "all"):
        for f in chosen:
            crop(f, force=bool(names))
    if step in ("generate", "all"):
        running = []
        for f in chosen:
            p = generate(f, force=bool(names))
            if p:
                running.append((f, p))
            if len(running) >= 4:
                for rf, rp in running:
                    rp.wait()
                    ok = (WORK / rf["name"] / "raw.png").exists()
                    verdict(rf["name"], "generated" if ok else "rejected",
                            **({} if ok else {"reason": "gen-image produced no file"}))
                    print(("generated " if ok else "FAILED    ") + rf["name"])
                running = []
        for rf, rp in running:
            rp.wait()
            ok = (WORK / rf["name"] / "raw.png").exists()
            verdict(rf["name"], "generated" if ok else "rejected",
                    **({} if ok else {"reason": "gen-image produced no file"}))
            print(("generated " if ok else "FAILED    ") + rf["name"])
    if step in ("pack", "all"):
        pack()


if __name__ == "__main__":
    main()
