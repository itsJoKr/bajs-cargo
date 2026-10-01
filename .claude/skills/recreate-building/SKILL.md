---
name: recreate-building
description: Faithfully recreate real Zagreb buildings in Zagreb Drive's web city (web3d/) from Google Street View - every street side of the building, its roof, and everything on or in front of it (shop signs, rooftop signs, awnings, terraces, scaffolding, domes, extra models). Use whenever the user asks to recreate, photograph, redo or fix a building or a street, to add real facades, to fix a roof, or to add signs/props to a building; or invokes /recreate-building.
---

# Recreate a building faithfully

The standard is **the building as it is today, copied, not invented**: every
street-facing side, every shop name and sign spelled letter for letter, ads,
plaques, awnings, cracks, stains, graffiti, the real roof covering and
shape, and the 3D things on or in front of it. Walls without a real facade
render as plain light stucco on purpose: plain means "not done yet".

Work **per building, all of its sides**. A corner building is seen from two
or more streets; each side is its own picture. One picture may only span
consecutive walls of one straight run (OSM often splits a straight facade
into several edges); never wrap one picture around a corner.

## Where things live

| What | File |
|---|---|
| Work list, done vs todo, all 859 core street walls | `data/hero/coverage.json` (written by every export) |
| Facade entries (photo, crop, walls, bays, storeys, description) | `data/hero/<section>.json` (committed, hand-written) |
| Street View screenshots | `.art/streetview/frames/fNN.jpg`, `.art/streetview/shots/<wall>.jpg` (git-ignored) |
| Photo crop, gen-image output, prompt, verdicts | `.art/facades/<name>/{photo,raw,prompt}.*`, `.art/facades/manifest.json` |
| Packed facades | `assets/textures/hero_atlas_<n>.png` pages + `data/hero/atlas.json` |
| Roof coverings (the set to choose from) | `data/roofs.json`, `assets/textures/roof_atlas.png` |
| Per-building corrections and 3D features | `data/buildings.json` (committed, hand-written) |
| Feature images (signs, logos) | `web3d/public/features/<name>.png` (committed) |

Ids: a building is `w<way>` / `r<relation>` (`_<n>` for the n-th part of a
multipolygon); a wall is `<building>_e<edge>`, `edge` indexing
`Polygon.edges` of the OSM outline. `coverage.json` lists each wall with its
length, name and midpoint (x east, z north, metres from the statue).

## 1. Pick the building and list all its sides

Start from `data/hero/coverage.json` `walls.todo` (grow outward from what is
done: whole blocks, whole streets). Then list every street wall of the
building(s):

```sh
fvm dart tool/list_hero_facades.dart --building w105487407,w97235393 \
  | python3 -c "import json,sys; json.dump(json.load(sys.stdin)['facades'], open('.art/streetview/<name>_todo.json','w'), indent=1)"
```

Each entry has `id` (the wall), `a`/`b` (ends), `aGeo`/`bGeo`, a suggested
viewpoint `view` with `heading`, `eave` and `length`. Walls under 4 m are
skipped. Check the list against the map: a side hidden by a neighbour is
still listed if OSM calls it a street wall; drop it only if it truly cannot
be seen from any street.

## 2. Photograph every side in Street View (the user's Chrome)

Use claude-in-chrome (load the `claude-in-chrome` skill first). Chrome is
for Street View only; never point it at the game page (it froze there, use
`web3d/tools/shot.mjs` for the game).

1. Open Google Maps at each `view` point, enter Street View and note the
   panoramas that see the building: official car panoramas (type `0`, most
   reliable position and north) first, photospheres (type `10`) only when
   nothing else sees a side. Add them to `.art/streetview/panos.json`
   (`{"id", "lat", "lng", "type", "bonus"}`). A photosphere needs the
   `@lat,lng,3a,<fov>y,<h>h,<t>t/data=!3m4!1e1!3m2!1s<id>!2e10` URL form;
   `pano=<id>` only resolves official ones.
2. `python3 tool/sv_plan.py .art/streetview/<name>_todo.json .art/streetview/panos.json`
   picks a panorama and aim per wall (18-60 m, facing it squarely) and writes
   the Maps URL into each entry's `shot`.
3. `SV_TODO=.art/streetview/<name>_todo.json python3 tool/sv_batch.py emit <tabId> 0 1 2`
   prints `browser_batch` actions (navigate, wait 10 s, screenshot); run
   them, then `SV_TODO=... python3 tool/sv_batch.py file 0 1 2` files the
   screenshots as `.art/streetview/shots/<wall>.jpg`. The URL fov is over a
   900 px reference: `f = 450 / tan(fov/2)` px in the 1568 x 718 view.
4. Also capture, as extra frames: close-ups of every shop front and sign
   that is small in the wall shot (zoom in with a narrower fov), the roof
   line and anything on the roof (signs, domes, towers, dormers), and the
   roof from above (Maps satellite / 3D view) for its shape and covering.
   Copy the screenshots you use into `.art/streetview/frames/fNN.jpg`
   (next free number) - facade entries reference frames by that name.
5. `python3 tool/sv_project.py <todo> LAT LNG HEADING FOV TILT [cam_h]`
   projects each wall's corners into a screenshot: use it to find the crop
   box of a facade in its frame.

Look at every frame yourself. Note the capture date (it is in the frame's
panel); prefer the newest imagery that shows the side clearly.

## 2b. Narrow streets and long walls: rectify several frames (tool/sv_rectify.py)

When a wall does not fit one frame (a 30 m facade on a 9 m street, or a
tall one seen from 5 m), photograph it from ONE panorama at several
headings / pitches and let `tool/sv_rectify.py` turn them into a straight-on
elevation (exact, no feature matching: a pure-rotation camera model).

1. Snap to the street panorama: `python3 tool/sv_street_url.py TODO WALL`
   prints the named street(s) in front of the wall and a Maps pano URL on
   its centreline (`sv_url.py` puts the eye D metres out along the wall's
   heading instead). Maps snaps to the nearest panorama, **indoor
   photospheres included** (shop interiors, a toilet, a dentist): check the
   title in the screenshot. On pedestrian streets the nearest pano is often
   on the pavement at the wall (1-3 m): too close to be useful.
2. The tab URL after it loaded gives `@lat,lng,...!1s<PANO>!2e<0|10>`.
   `python3 tool/sv_shots.py TODO WALL LAT LNG PANO 0 HEIGHT TAB` prints the
   browser_batch actions (pano URL with 90y fov, headings and tilts 93-130
   covering the wall). Batches of 2 shots, waits of 10 + 6-8 s: longer
   batches time out, a black frame means wait 10 s more.
3. Copy the screenshots into `.art/streetview/<x>/`, write a spec (see the
   docstring: cam, shots with heading/tilt/fov, `height`, `ppm` 50,
   `out_m` to put the plane at a portico's columns) and run
   `.venv/bin/python tool/sv_rectify.py spec.json`. Shots from a second
   pano may be added with their own `cam`.
4. A facade entry then says `"photo": ".art/streetview/rect/<name>.png"`
   instead of frame + crop. The picture may include neighbours if the OSM
   wall does (OSM and Google are often 5-10 m apart along a narrow street:
   check that the elevation covers the wall's extent, not the real
   building's).
5. Camera model (calibrated 2026-09-29 on the 1568 x 652 window): URL `y` is
   the VERTICAL fov, f = (H/2)/tan(y/2) px; tilt 90 = level, pitch = tilt-90
   (up positive, useful range 70-130); camera height 2.5 m. `sv_project.py`
   uses the same model.

## 3. Describe each facade (data/hero/<section>.json)

One entry per straight run of wall, in the section file for the area
(`square.json` is Trg bana Jelačića; start a new `<street>.json` for new
areas - `tool/prepare_facades.py` reads every section file):

```json
{"name": "gradska_stedionica_side", "frame": "f33", "crop": [x0, y0, x1, y1],
 "edges": ["w105487407_e4"], "bays": 9, "storeys": 6,
 "place": "Praška ulica",
 "source": "Street View Jul 2024",
 "look": "..."}
```

- `crop`: the facade only, pavement to main cornice, in the 1568 x 718
  frame; include all of it even if the corners are foreshortened.
- `edges`: the walls this picture covers, consecutive and collinear, left
  to right as seen from the street.
- `bays`: window axes across; `storeys`: floors from the pavement up to the
  **main cornice** (mezzanines and the ground floor count; attic floors in
  the roof do not). The wall's eave becomes `storeys * 3.7 + 1.0` m so the
  picture is never stretched - count carefully.
- `res` (optional, 0.5 / 0.25 / 0.1): walls the player cannot reach (behind a fence in
  `data/fences.json`) get a low-res picture packed into a fraction of an atlas row. Anything
  high up or unreachable is deliberately low-res; only street level deserves full resolution.
- `look`: a precise description the image model reads next to the photo:
  style and period, colours, window shapes, balconies, ornament, **and
  every piece of text verbatim** ("red 'SINGER' letters over both corner
  shops, a white 'Addiko Bank' sign over the middle arch, 'ZAKS' in black
  on the shop fascia").

## 4. Redraw, review, pack

```sh
.venv/bin/python tool/prepare_facades.py crop <name> ...
.venv/bin/python tool/prepare_facades.py generate <name> ...   # gen-image, 4 at a time
```

The prompt (`PROMPT` in `tool/prepare_facades.py`) asks for a faithful,
orthographic, evenly lit elevation that keeps everything attached to the
building and removes only what stands in front of it. **Review every
`raw.png` beside its `photo.png` before packing** - build a side-by-side
sheet and look at it:

- every sign present and spelled exactly (zoom in); no invented text;
- bays and storeys match the entry; the cornice at the top edge, pavement
  at the bottom;
- colours and materials match; nothing from a neighbour included.

Rerun `generate <name>` for a bad one (optionally sharpen `look` first).
Record rejections in `.art/facades/manifest.json` via the script's
verdicts. Then:

```sh
.venv/bin/python tool/prepare_facades.py pack   # hero_atlas_<n>.png + data/hero/atlas.json
```

The atlas is 768 px per facade height, 4096 wide, in pages of at most
4096 x 4096 (`hero_atlas_<n>.png`; the exporter, the web material and
`sync-assets.mjs` handle any number of pages). Do not lower the resolution,
the lettering needs it. A building's hero facades must agree on `storeys`
(its eave comes from the tallest).

## 5. The roof

Look at the roof from above and from the street. Correct it in
`data/buildings.json` under the building id:

```json
"w105487407": {
  "name": "Gradska štedionica",
  "roof": "slate_grey",
  "tags": {"roof:shape": "hipped", "roof:height": "6"}
}
```

- `roof`: one covering of `data/roofs.json` - `biber_old`, `clay_red`,
  `clay_brown`, `clay_pale`, `slate_grey`, `zinc_dark`, `copper_green`,
  `flat_gravel`. Need a new one (a real covering none of these match)? Add
  it to `tool/gen_textures.sh` (ROOF_RULES, fix the row/seam count), run it,
  add it with its metres-per-tile to `ROOFS` in `tool/prepare_roofs.py`,
  run that.
- `tags`: OSM tag overrides the generator reads - `roof:shape` (`flat`,
  `gabled`, `hipped`, `pyramidal`, `mansard`...), `roof:height`, `height`,
  `building:levels`, `roof:material`, `roof:colour`, `min_height`. Mapped
  `roof:height` is honoured as given.
- Street walls always meet the roof at the eave (the roof slopes down to
  every street wall); a gable end facing the street needs
  `roof:shape: gabled` with the ridge across it.
- An L, T or U-shaped building gets one roof over its whole minimum-area
  box, which fits none of its wings (a plateau with stucco bands on the
  walls): give it `"roofWings": [{"name": ..., "corners": [[x, z] x4]}]`,
  one rectangle per wing (tool frame) with its sides on the wing's wall
  lines and overlapping where wings meet. The roof is the highest wing;
  what no wing covers (a round corner tower) is flat at the eave and
  takes a cone `dome` feature (the archbishop's palace, `w101185039`).
- Domes, towers, rooftop signs and other things on the roof are
  **features** (next step).

## 6. Features: everything on or in front of the building

Add them to the building's `features` list in `data/buildings.json`. Every
feature names a `wall`; positions along it are fractions `at` / `from`..`to`
(0 = the wall's left end as seen from the street, its first vertex);
heights are `y` metres above the sidewalk or `aboveEave` above the eave;
`out` is metres in front of the wall (negative = behind it, onto the roof).
Record where it came from in a `source` field.

| type | fields | for |
|---|---|---|
| `sign` | `image`, `width` (m), `height` (default from the image), `at`, `y`/`aboveEave`, `mount`: `wall` (flat on it), `projecting` (blade sign), `roof` (standing on the roof on posts), `out`, `glow` | shop names, blade signs, rooftop brand signs, clocks |
| `awning` | `from`, `to`, `y` (front bar, above the valance), `drop` (wall to front bar, default 0.7), `depth`, `color` | shop awnings with real depth over the flat one in the picture: measure the painted awning on `raw.png` (pavement to eave), `drop` + `y` = its top, `y` - 0.28 = its bottom |
| `terrace` | `from`, `to`, `depth`, `color` (parasols) | a café's tables, chairs, parasols in front of it (loose physics bodies the car scatters, `web3d/src/furniture.ts`) |
| `scaffolding` | `from`, `to`, `height` or `aboveEave`, `depth`, `net` (colour) | scaffolds and netting |
| `dome` | `at` (1 = right corner), `radius`, `height` (drum), `aboveEave`, `out`, `shape`: `dome`/`onion`/`cone`, `color` | corner domes, turrets, tower caps |
| `box` | `at`, `out`, `width`, `depth`, `height`, `y`, `color` | dormers, chimneys, kiosk-like blocks, planters, anything boxy |
| `model` | `url` (GLB under `web3d/public/`), `at`, `out`, `y`, `yaw` (deg), `scale` | anything else: statues, benches, vehicles, special structures |
| `oriel` | `at`, `width` (at the wall), `out` (depth), `y` (bottom), `aboveEave` (top), `corbel` (m), `image` (strip wrapped round the face), `texture`/`repeat`/`color` (corbel and cap) | a rounded bay window standing out of the wall (Nama's over its gate; strip cut from the facade raw by `tool/make_nama.py`) |

**Textures on decorations.** `awning`, `box`, `dome` (its cap) and `scaffolding`
(its net) also take `texture` (file under `web3d/public/features/tex/`, jpg, or
png when it needs alpha) and `repeat` (metres per tile, default 1); `color`
then tints the texture (white when omitted). Without `texture` they are flat
colour as before. `terrace` and `sign` do not use them (signs have `image`).
A tile is `repeat` m square on every face, so make the texture seamless and
give a name-carrying awning a `repeat` equal to its span.

Sign images: crop the sign from the sharpest frame, redraw it flat with
gen-image on a green screen, key it out:

```sh
mkdir -p .art/features/<name> && crop -> .art/features/<name>/photo.png (upscaled)
cd .art/features/<name> && codex exec -m gpt-5.5 --sandbox workspace-write --skip-git-repo-check \
  "Generate an image: The attached photo shows <the sign>. Redraw exactly this sign as a flat, perfectly straight-on front view, the same letters, spelling, typeface, colours and logo, on a SOLID PLAIN #00FF00 green background with nothing else in the image. Sharp, 1536x512. Save the generated image exactly as produced as sign.png in the current directory \$imagegen" \
  -i photo.png < /dev/null
.venv/bin/python tool/key_feature.py .art/features/<name>/sign.png <name>.png
```

(`-i` goes after the prompt and stdin must be closed, or codex waits for
more input.) Check the spelling in the result against the photo; rerun if
wrong. A new 3D model: prefer an existing CC0/CC-BY model (note the licence
in `web3d/ATTRIBUTION.md`), or build it from `box`/`dome` features.

**Arcades.** An open arcade or colonnade is `data/arcades.json`: `edges` lift whole walls, `spans` open part of
one, `arches` cut round arches into one edge (openings t0..t1 and the crown measured on `raw.png`, in the picture's
metres). The wall then starts at its HIGHEST sidewalk so the arches stay level, and each bay of the walkway gets a
floor one riser above its own pavement. The back of the walkway is a hand-made `part` (a U whose arms close the ends)
with its own pictures; see Nama (w97089760, w9000000050).

## 7. Export and verify in the game

```sh
fvm dart tool/export_web.dart        # prints "Real facades: N of 859 street walls" and "Features: N"
cd web3d && npm run dev              # if not running
node tools/shot.mjs --sleep 2500 \
  --eval "document.getElementById('hud').style.display='none'; zg.lookAtWall('w105487407_e5', 30, 2.5)" \
  --sleep 800 --shot ../artifacts/web/<name>.png
../.venv/bin/python tools/compare_sv.py --todo .art/streetview/<name>_todo.json   # render from each Street View camera, under the photo
```

Look at every side, and at the roof from a high `zg.look([...],[...])`.
Compare against the photos: facade proportions and position, sign
placement, roof covering and shape, features. The export fails loudly on a
wall id that does not exist. Iterate until it matches.

## 8. Close out

- `data/hero/coverage.json` is regenerated by the export: the done count
  went up by every wall you did. Mention the new count to the user.
- Add a line to `docs/progress.md` (buildings, walls, anything notable),
  and to `.claude/rules/zagreb-web.md` if something cost time.
- Show the user before/after screenshots of each side.

## Gotchas

- Facade pictures are AI redrawings of Google imagery: fine for this
  personal project; check Google's terms before anything is published.
- A frame that sees a wall at a steep angle redraws badly; find a pano that
  faces it (sv_plan's `facing` > 0.6) or a narrow-fov shot from farther.
- The model sometimes "improves" text or adds a sign from a neighbour; the
  review step is not optional.
- Do not edit baked outputs (`hero_atlas_<n>.png`, `atlas.json`,
  `coverage.json`, `web3d/public/city/*`); change the inputs and rerun.
