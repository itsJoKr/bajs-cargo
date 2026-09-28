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
3. pack     assets/textures/hero_atlas.png + data/hero/atlas.json
            every facade scaled to 512 px tall at its real aspect (32 px/m
            at the square's 16 m eaves), shelf packed 2048 wide with a
            4 px edge-replicated gutter so mips never bleed a neighbour
            in; the height is the next power of two. atlas.json maps
            name -> rect [u0, v0, u1, v1] in texture coordinates (v down)

`.art/facades/manifest.json` records a verdict per facade
(cropped / generated / packed / rejected + reason).

The gen-image prompt (Codex CLI with the photo attached via -i):

    The attached photo is a Google Street View picture of one real building
    facade on Ban Jelačić Square in Zagreb, Croatia: {look}. Produce a
    texture of exactly this building's facade for a 3D city model: a
    perfectly orthographic, straight-on front elevation (no perspective, no
    vanishing lines, all verticals vertical and all floors level), evenly
    lit by soft overcast daylight with no cast shadows. Keep the real
    architecture exactly as in the photo: {bays} window bays across and
    {storeys} storeys from the pavement up to the main cornice, the same
    window shapes and surrounds, ornament, balconies, colours and
    materials, and the same ground-floor openings. Show only this one
    building, from the pavement at the bottom edge to the top of its eaves
    cornice at the top edge, filling the whole image edge to edge; include
    no roof above the cornice, no sky, no street, no neighbouring
    buildings. Remove everything that is not the building: people, cars,
    trams, lamp posts, poles, statues, flags, trees, café awnings and
    umbrellas, advertising banners, shop signs, lettering and any map
    interface overlay; where they hid the facade, continue the
    architecture consistently. Photorealistic, sharp, {width}x{height}.

gen-image output is saved unprocessed; this script only resizes it.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / ".art" / "streetview" / "frames"
WORK = ROOT / ".art" / "facades"
MANIFEST = WORK / "manifest.json"
SECTIONS = ["square"]
ROW, ATLAS, GUTTER = 512, 2048, 4
STOREY, GROUND_EXTRA = 3.7, 1.0

PROMPT = """The attached photo is a Google Street View picture of one real building \
facade on Ban Jelačić Square in Zagreb, Croatia: {look}. Produce a texture of exactly \
this building's facade for a 3D city model: a perfectly orthographic, straight-on front \
elevation (no perspective, no vanishing lines, all verticals vertical and all floors \
level), evenly lit by soft overcast daylight with no cast shadows. Keep the real \
architecture exactly as in the photo: {bays} window bays across and {storeys} storeys \
from the pavement up to the main cornice, the same window shapes and surrounds, \
ornament, balconies, colours and materials, and the same ground-floor openings. Show \
only this one building, from the pavement at the bottom edge to the top of its eaves \
cornice at the top edge, filling the whole image edge to edge; include no roof above \
the cornice, no sky, no street, no neighbouring buildings. Remove everything that is \
not the building: people, cars, trams, lamp posts, poles, statues, flags, trees, café \
awnings and umbrellas, advertising banners, shop signs, lettering and any map interface \
overlay; where they hid the facade, continue the architecture consistently. \
Photorealistic, sharp, {width}x{height}."""


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
        for f in json.loads(path.read_text()):
            lengths[f["id"]] = f["length"]
    return lengths


def size_for(f: dict) -> tuple[float, float]:
    """The facade's real width and height in metres."""
    lengths = edge_lengths()
    width = sum(lengths.get(e, 15.0) for e in f["edges"])
    height = f["storeys"] * STOREY + GROUND_EXTRA
    return width, height


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
    prompt = PROMPT.format(look=f["look"], bays=f["bays"], storeys=f["storeys"],
                           width=w, height=h)
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


def pack() -> None:
    import numpy as np

    items = []
    for f in facades():
        raw = WORK / f["name"] / "raw.png"
        if not raw.exists():
            verdict(f["name"], "rejected", reason="no generated facade")
            continue
        width, height = size_for(f)
        w = min(ATLAS - 2 * GUTTER, max(64, int(round(ROW * width / height))))
        items.append((f, raw, w))
    # First fit, widest first: each facade goes on the first shelf with
    # room for it.
    cells = []
    shelves: list[int] = []  # used width per shelf
    stride = ROW + 2 * GUTTER
    for f, raw, w in sorted(items, key=lambda it: (-it[2], it[0]["name"])):
        need = w + 2 * GUTTER
        row = next((i for i, used in enumerate(shelves) if used + need <= ATLAS), None)
        if row is None:
            row = len(shelves)
            shelves.append(0)
        cells.append((f, raw, w, shelves[row] + GUTTER, row * stride + GUTTER))
        shelves[row] += need
    height = 1 << (len(shelves) * stride - 1).bit_length()
    atlas = np.full((height, ATLAS, 3), 128, np.uint8)
    rects = {}
    for f, raw, w, x, y in cells:
        im = Image.open(raw).convert("RGB").resize((w, ROW), Image.Resampling.LANCZOS)
        padded = np.pad(np.asarray(im), ((GUTTER, GUTTER), (GUTTER, GUTTER), (0, 0)), mode="edge")
        atlas[y - GUTTER:y + ROW + GUTTER, x - GUTTER:x + w + GUTTER] = padded
        rects[f["name"]] = [x / ATLAS, y / height, (x + w) / ATLAS, (y + ROW) / height]
        verdict(f["name"], "packed", rect=rects[f["name"]])
    out = ROOT / "assets" / "textures" / "hero_atlas.png"
    Image.fromarray(atlas).save(out, optimize=True)
    entries = {
        f["name"]: {"rect": rects[f["name"]], "edges": f["edges"],
                    "storeys": f["storeys"], "source": f.get("source")}
        for f in facades() if f["name"] in rects
    }
    (ROOT / "data" / "hero" / "atlas.json").write_text(json.dumps(
        {"width": ATLAS, "height": height, "storey": STOREY,
         "groundExtra": GROUND_EXTRA, "facades": entries},
        indent=2, sort_keys=True) + "\n")
    print(f"packed {len(rects)} facades into {out.relative_to(ROOT)} ({ATLAS}x{height})")


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
