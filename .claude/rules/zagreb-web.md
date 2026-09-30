# Zagreb Drive rules

Hard-won gotchas. Keep entries to one or two lines, and add a new one
whenever a session learns something a future session would waste time
rediscovering. `AGENTS.md` holds the setup; this file holds the traps.
(Flutter / flutter_scene traps went with the app to the `flutter-archive`
branch.)

## City pipeline (tool/)

- The `clipper2` Dart port's `Clipper.rectClip` can throw a RangeError on
  real city paths; intersect with a rectangle path instead. A union whose
  subject is empty returns empty, not the clip.
- Moving vertices by `a + (b - a) * 1.0` instead of using `b` changes the
  last bit of a float; keep exact endpoints when subdividing, or reruns and
  comparisons drift.
- Prove a before/after comparison is not hollow: `cmp` the export against a
  copy taken before the change, and perturb something on purpose once to
  see it go red.

- Raised ground is `data/raised.json` (nested terrace levels, `Ground.liftAt`;
  `terrain()` in `export_web.dart` includes the lift, `emitGround` gets the bare
  grid). The car (chassis 0.30 m off the ground, nose 0.9 m ahead of the front
  wheels) stops dead at a vertical 0.18 m riser and at two steps closer than
  ~1 m: keep steps sloped (`run`) and `tread` >= 1.2 m.

## gen-image and Street View

- `codex exec` fails with "'gpt-6-astra' requires a newer version of Codex"
  (the default model in `~/.codex/config.toml`, CLI 0.144.6): pass `-m gpt-5.5`.
- `codex exec` for gen-image: put `-i photo.png` AFTER the prompt (`-i`
  takes any number of files and swallows the prompt otherwise) and close
  stdin (`stdin=DEVNULL` / `< /dev/null`), or it waits forever for more
  prompt input.
- Street View via Maps URLs: `pano=<id>` only resolves official panoramas;
  a user photosphere needs the `@lat,lng,3a,<fov>y,<h>h,<t>t/data=!3m4!1e1
  !3m2!1s<id>!2e10` form. Screenshots saved by the Chrome extension land in
  a per-session `claude-chrome-screenshots-*` directory; name it explicitly.
- The first facade prompt removed shop signs and lettering; the user wants
  faithful copies. Never prompt a facade "clean".

## three.js and Rapier

- GLTFLoader sanitizes node names (`/`, `.`, `:`, `[`, `]` are dropped), so
  `chunk_e0_n0/facade` arrives as `chunk_e0_n0facade`. Identify exported
  meshes by their glTF material name instead.
- The Chrome extension froze on the game page twice (screenshots and
  `Runtime.evaluate` timed out, then the tab group vanished). Use
  `web3d/tools/shot.mjs` (its own headless Chrome over CDP) for stills and
  console output instead.
- Alpha-tested leaf cards turn into solid pale discs at a distance (plain mips
  average the gaps away): `trees.ts` builds coverage-preserving mips itself.
  Its source is JPEG colour + PNG alpha, since a canvas premultiplies alpha.
- Rapier's `DynamicRayCastVehicleController` applies the brake only to a
  wheel with zero engine force, has no rolling resistance by default (a
  coasting car rolls forever), and `setIndexForwardAxis` is a setter
  property, not a method (`controller.setIndexForwardAxis = 2`).
- A "holds on a slope with the brake" check is vacuous when the brake pedal
  reverses at a standstill: the car drives away backwards and `speed < 0`
  passes. Hold with the handbrake and measure the drift.
- A Rapier body created asleep (`setSleeping(true)`), or moved while asleep,
  never gets its collider bounds into the query structures:
  `intersectionsWithShape` misses it (Node sims did not reproduce it). Create
  awake, `world.step()` once, then `sleep()` (`Furniture.settle`).
- A car covering ~0.4 m a step swallows a chair deeper than it is tall; the
  contact normal turns vertical and presses it into the ground (soft CCD on the
  resting body does nothing). `furniture.ts` launches pieces from a query of the
  car's box swept one step ahead; the solver only handles slow pushes.
- A dynamic cylinder or cone against the city trimesh costs ~0.3 ms a body a
  step (30 flying chairs: 12 ms); cuboids cost a tenth. Give loose props boxes.
- Collision groups collide when EACH membership meets the other's filter: a
  membership bit shared by table and parasol defeated their exclusion.
- Thin cylinders (a few cm) sink into the ground trimesh and stay awake; give
  bodies resting on the ground box feet.
- `zg.teleport` onto the square can land on a tram's path: a tram shoved the car
  off its line mid-test. Check the kinematic bodies before blaming the physics.
- Copernicus GLO-30 is a surface model: in dense old towns nearly every
  pixel is mostly roof. Dropping covered pixels fills a hilltop from the
  valley; subtract the building heights instead (`tool/prepare_terrain.py`).

## Street View capture

- `.art/streetview/panos.json` once held `CIHM0ogKEICAgIDE3tjDCw` (45.8129997,
  15.9759693): "Zagreb 360 observation deck" (Apr 2016), an elevated
  photosphere, not street level. Screenshot every new pano once before
  trusting it; a black frame after 10 s just means "wait 8 s more".
- The Chrome window is 1568x652 here, not 1568x718: re-check crop boxes
  against the actual screenshot size.
- Hero atlas pages: `hero_atlas_<n>.png` (max 4096x4096), UV1.x = -1 - page,
  GLSL samplers `heroAtlas<n>` come from `city.json` `heroPages`. Pages 0-2 render
  correctly (62 facades, 2026-09-29).
- `sv_url.py` / Maps `map_action=pano&viewpoint=` snaps to the NEAREST pano:
  often an indoor photosphere (shop, toilet, clinic) or a pavement pano 1-3 m
  from the wall. Read the title in the screenshot; put the viewpoint on the
  street centreline (`sv_street_url.py`).
- The Maps URL `y` fov is the VERTICAL fov (f = (H/2)/tan(y/2), 326 px at 90
  on a 652 px window); the old "900 px reference" was wrong. Tilt max ~130.
- zsh does not word-split `set -- $var`; use `bash -c` for loops over
  "wall lat lng pano" lines. macOS `sed -i` needs `-i ''`.
- `browser_batch` with more than ~3 screenshots times out (screenshots are
  lost, only the files that were already saved survive); 2 per batch.
- Two hero facades of one building must use the same `storeys` (the eave is
  the max), and an OSM wall may include parts of a neighbour: rectify the wall's
  own extent.
- The dev server dies when the Bash call that started it ends (also with
  `nohup`/`setsid` on macOS): start it with `run_in_background: true`, and
  `curl -s http://localhost:5180/` before every `shot.mjs` run (its error,
  `Cannot read properties of null (reading 'style')`, means no server).
- One hero facade may only span walls of ONE building (`spansFor` splits its
  picture by that building's own edges); make one facade per building.
- `pack` squeezes every `raw.png` to the wall's TRUE width:height (768 px tall);
  a 2:3 gen-image of a 13.5 x 64 m tower ended 6x too narrow. Give tall or
  wide walls a raw at their real aspect (crop / stretch it, or draw it).
- A hero facade's `edges` index the CLEANED ring (collinear points merged:
  the Neboder has 11 edges, OSM 12), and spansFor wraps `(i+k) % n`: an id
  past the end silently paints e0. Print the real edges before writing them.
- Looking at a north-facing wall (viewer looks south) EAST is on the photo's
  LEFT; the web frame is z south, so `zg.look` z = -z of `tool/`. A tower
  "on the left of the front" is the east part.
- Awnings placed at a guessed `y` 2.7 sat 1-2 m under the awning painted on the
  facade. Measure the painted one on `raw.png` (rows = pavement..eave) and set `y`/`drop`.
- Volumes OSM lacks (a tower over a podium): a `part` polygon (tool x, z) in
  `data/buildings.json` becomes a `building:part` overlay (`zg:overlay`) that
  does not replace the outline under it; put its walls in hero facades as
  `<id>_e<n>` (print the edges, the ring is reordered).
- A user photosphere's URL heading is NOT true north (Bogovićeva's was ~60 deg
  off); `sv_rectify.py` / `sv_project.py` fail on it. Identify buildings from
  an OFFICIAL pano (correct yaw) before assigning a photosphere frame to a
  wall, and check left/right: looking north, east is on the right.
- Maps window height varies (611 vs 652 px): `SV_H=611 python3 tool/sv_project.py`.
  A pano only 0.6-3 m from a wall sees it as a sliver: use one across the street.
- `tool/prepare_facades.py generate` for 5+ facades exceeds the 120 s Bash
  limit: run it in the background and poll for `raw.png`.
- A chamfered or rounded building corner is several SHORT OSM edges (< 4 m, not in
  any todo list) and stays plain stucco unless it has its own picture. After
  finishing a building, scan its ring for uncovered edges between two hero walls
  and add a `"corner"` entry in `data/hero/corners.json` (a 2:3 elevation with the
  corner in the centre, packed as the centre slice). Draw the neighbouring faces
  flat, without the corner's signs.
- `zg.lookAtWall` only knows wall ids of long walls; aim at short corner edges with
  `zg.look` (web z = -z of tool/).
- After `prepare_facades.py pack` + `export_web.dart`, run `node web3d/tools/sync-assets.mjs`
  (or restart dev): the running dev server keeps the OLD atlas pngs, and the new UVs then
  paint other buildings' facades (SINGER / Q STORE) on the new walls. It looks like a bug in
  the export; it is a stale copy.
- In zsh `N="a b c"; cmd $N` passes ONE argument: `prepare_facades.py crop $N` silently did
  only the first name. Put loops in a `bash` script.
- `sv_rectify.py` with every frame lets each pixel pick the "most central" shot and smears
  walls no frame faces; pass only the 1-3 frames that face the wall (`tool/prad_rect.py WALL
  s3_h45 s3_h90`). Walls 3 m from the pano (pedestrian streets) cannot be rectified; use
  a crop or invent.
- Compute a pano's tool x,z from its lat/lng (`(lat-45.81303)*111132`, `(lng-15.97713)*77620`)
  before deciding which walls it sees; eyeballing put one 60 m off.
- Street-level cameras in `zg.look` must sit at the street centre (a 12 m street): an eye at
  a wall's x is inside the building and renders other geometry.
- The Chrome extension drops out or a Street View tab freezes after ~15 frames: reopen the
  tab (`tabs_create_mcp`), use pano-id URLs `@lat,lng,3a,90y,<h>h,<t>t/data=!3m1!1e1!3m1!1s<id>!2e0`,
  wait 10 s, one screenshot per call.
- Parallel workers: every `*_todo.json` in `.art/streetview` and every `data/hero/*.json` is read
  by `prepare_facades.py` (a bad or half-written file breaks all workers); `edge_lengths` now
  takes the `{section, facades}` shape of `list_hero_facades` as well as a bare list.
- The Chrome extension's `claude-chrome-screenshots-*` directory is shared by all tabs: use the
  path each screenshot call returns, never "the newest"; `save_to_disk` with `scale < 1` saves the
  downscaled image; the first frame after a navigation is often blurry (wait 10 s more).
- A rectified photo puts things that project out (awnings, blades, balconies) too low on the wall
  plane; measure decorations on the gen-image `raw.png` (it ends at the cornice, the roof band of
  the photo is dropped) and sanity-check against 2.5-3.5 m.
- Cornice boxes placed with `y` from counted storeys floated 1.5 m over the OSM eave: use
  `aboveEave` (bottom edge; -0.55 for a 0.55 m cornice) so it follows the wall's real eave.
- A green sign (pharmacy) cannot be keyed with `key_feature.py`; crop it from the raw, opaque.
  Blade-sign gen-image invents text from a blurry crop: crop from the redrawn raw and spell it.
- gen-image copies a Google map pin icon onto a facade cropped from a Maps window: say in
  `look` that the pin is an overlay and must not be drawn.
- A 4:1 wall (skola, 62 m) is drawn stretched 2.6x by gen-image and `pack` squeezes it back; stitch
  two rectified halves with a straight vertical seam (frames from different panos differ in plane).
- Low-tilt frames (95-100) are needed for ground floors when rectifying from a street 5-8 m wide;
  the 115-125 tilt frames cut the shopfronts off.

- macOS has no `timeout`; `timeout 500 codex exec ...` dies with "command not found". zsh does not
  word-split `for a in "x y z"`: use `while read` in bash. numpy exists only in `.venv`.
- The gen-image queue is shared: `generate` for 28 facades took 2+ h in batches of 4; `generate
  <name>` forces regeneration (do not rerun the list); parallelise with `xargs -P8`, one name per call.
- Invented facades: a flat colour swatch as `photo` plus a `look` starting "INVENTED ... ignore any
  wording about copying a photo" works; a crop that shows an already-done neighbour makes gen-image
  repeat its lettering (Meet & Eat); a curved building needs "flat rectangular elevation" in `look`.
- Google Maps place search often resolves to an unrelated place across town, and place photos
  rarely show street fronts on these streets; a photosphere's heading and position are unreliable.
- `tool/sv_rectify.py` used to take pixels flagged invalid (`score > best` with score -1 beating -2), which
  made horizontal grazing-angle streaks; it now masks them (`take & ok`, plus `MINRES`, default 0.35 px of
  source per output px) and fills uncovered areas flat grey (140): the facade `look` must say grey = unknown.
- Hero atlas pages each take one fragment texture unit (limit 16, about 10 fit): more than that fails
  to compile the city shader ("texture image units count exceeds MAX_TEXTURE_IMAGE_UNITS(16)"). Area
  goes with `HERO_ROW` squared: `HERO_ROW=576 .venv/bin/python tool/prepare_facades.py pack` (10 pages
  for 328 facades); check `pages` in `data/hero/atlas.json` and a `shot.mjs` console after every pack.
- A wall wider than ~1.6x its height cannot come from one 1536x1024 raw (it comes out 2x narrow or
  smeared): stitch two generated halves (say "no entrance here" in the second) or mirror-tile into
  a raw at the true aspect, and do NOT rerun `generate` on that name (it overwrites the stitch).
- Streets without official Street View (Skalinska, Stube footways): every probe snaps to an indoor
  photosphere; invent from the todo eave ((eave-1)/3.7 storeys) and OSM neighbours.
- Edges of a multipolygon's INNER ring (`r..._e13` past the outer ring length) cannot take a hero picture:
  `spansFor` wraps `(i+k) % outer.length`. The filler pass (`data/hero/fill.json`) skips them by leaving them plain.
- The hero atlas is `assets/textures/hero_atlas_<n>.ktx2`, one block-compressed page per file, merged by
  `loadHeroAtlas` (city.ts) into ONE `sampler2DArray heroAtlas` (layer = page): no texture-unit limit, ~1 byte
  a pixel on the GPU (`basisu`: `brew install basis_universal`). `pack` is INCREMENTAL: unchanged facades keep
  their place (`key` hash in atlas.json), each page is encoded only when its content key changes (cache
  `assets/textures/.hero_cache`, gitignored), so one changed facade = ~1 minute, no change = 6 s; the first run
  or `HERO_REPACK=1` (needed after changing `HERO_ROW`) re-encodes all pages (~18 min for 25). `HERO_CODEC=uastc`
  is crisper and faster to encode but 5x larger. Removed facades leave holes until a `HERO_REPACK=1`. Run `pack`,
  then `export_web.dart` (UVs come from atlas.json) and `sync-assets.mjs`.
