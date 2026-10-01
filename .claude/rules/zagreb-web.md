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
- Trams deadlocked where tracks merge or cross (both noses in, each stopping for the other's body): junctions
  (`junctions()` in trams.ts, routes closer than 2 m) now take a claim, and a tram yields to fouling holders AND
  to fouling trams already queued (without the queue rule one route starved). Routes must take every branch
  (`chains`): one-way-per-route chaining ended a route mid-square, parking the tram on the merge.
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
- Edges of a multipolygon's INNER ring (`r..._e13` past the outer ring length) take hero pictures since 2026-09-30:
  `spansFor` wraps a chain within the ring of its edges (it used to wrap `% outer.length` and paint e0).
  A small courtyard 12 m from a street counts as `street` (city.dart's classifier): give it `make_firewalls.py` plaster.
- The hero atlas is `assets/textures/hero_atlas_<n>.ktx2`, one block-compressed page per file, merged by
  `loadHeroAtlas` (city.ts) into ONE `sampler2DArray heroAtlas` (layer = page): no texture-unit limit, ~1 byte
  a pixel on the GPU (`basisu`: `brew install basis_universal`). `pack` is INCREMENTAL: unchanged facades keep
  their place (`key` hash in atlas.json), each page is encoded only when its content key changes (cache
  `assets/textures/.hero_cache`, gitignored), so one changed facade = ~1 minute, no change = 6 s; the first run
  or `HERO_REPACK=1` (needed after changing `HERO_ROW`) re-encodes all pages (~18 min for 25). `HERO_CODEC=uastc`
  is crisper and faster to encode but 5x larger. Removed facades leave holes until a `HERO_REPACK=1`. Run `pack`,
  then `export_web.dart` (UVs come from atlas.json) and `sync-assets.mjs`.
- The playable city is `coreExtent` (tool/src/city.dart, now cut at z = -300 in the south) minus `blockedAreas`
  (the Gornji Grad hill, x < -140 and z > 60): blocked areas stay in the model as plain scenery, the web build
  fences them with invisible cuboids (`blocked` in city.json, `loadCity`), and their walls are left out of
  `data/hero/coverage.json`. Buildings outside the extent are dropped, and `data/buildings.json` features on them
  are skipped by the export ("Features skipped"), so cutting more of the map needs no data edits.
- Filler pass (`.art/streetview/fill/mk_fill.py`): run it AFTER an export (it reads `coverage.json` todo and
  `city.json` walls), it only adds fillers for walls not yet in `data/hero/fill.json`; then `pack` + export, and
  drop any filler whose wall is still in the todo list. Do not empty `fill.json` before a pack: the pages holding fillers
  re-encode (that cost ~25 min once).
- Real steps in the ground (Dolac's plateau, stairs) go in `data/levels.json`, not the terrain grid (it smooths
  them away). A stair ramp collider must meet both floors with no lip: 6 cm at the foot of a 31% flight stopped
  the car (0.30 m clearance, 0.9 m overhang: ~18 deg approach). Keep flights under ~17 deg.
- `zg.teleport` drops the car on the first static surface under (x, z) from 300 m: under a canopy it lands on
  the roof. Teleport clear of roofs when testing (the Dolac canopy by the wooden steps is at z 160-170).
- Level walls (tool/src/levels.dart) have no thickness: where a plateau wall meets a stair side one of them is seen
  from behind and you look into the hollow under the plateau (a green slit: the grid mesh far below). Walls are
  emitted two-sided; keep it that way.
- Twin hero facades (same picture on several walls): copy `raw.png` + `photo.png` into each twin's `.art/facades/<name>/`
  before `pack` (generate skips an existing raw). Walls missing from every `.art/streetview/*_todo.json` pack as 15 m
  wide; add a small `<section>_todo.json` with their true lengths.
- `shot.mjs --eval` runs each expression in the page's global scope: a `const p` in two evals throws "Identifier
  'p' has already been declared" and that step silently does nothing. Wrap evals in `(()=>{ ... })()`.
- Level walls are cut where they cross another region's outline (`_cutPieces`) and reach down to the bare grid
  (`foot`): a 1 m piece judged by its midpoint, or a wall starting at the tread, left slits at stair corners.
- A `texture.clone()` shares the image but keeps the clone-time `version`: clones made before the image loads
  never upload (black/untextured). Flag every clone `needsUpdate` in the loader's onLoad (`bikeModel.ts` `tex`).
- A raycast vehicle's drive scales with FORWARD speed (`1 - v/top`): in a slide v drops, power comes back in
  full and spins the rear further. Keep the drive under the rear tyres' grip (`tractionShare`), or a light,
  powerful vehicle (the bike) cannot recover from any slide. Narrow ray tracks roll over at g * halfTrack / comHeight.
- Frame time is per pixel (fill rate), not draw calls: benchmark with `zg.bench` at `shot.mjs --size 2560x1440 --dpr 2`,
  not the default 1280x720@1. A post-processing composer (half-float MSAA target) cost 2x at 4K; keep rendering direct.
- "Failed to start: WebAssembly.instantiate(): Out of memory" (bar empty, at `RAPIER.init`) came from a long-lived dev
  tab reloaded many times by exports; a fresh tab starts fine (2026-09-30). Open a new tab before debugging the code.

## The square round (people, pigeons, plain walls, props)

- People and pigeons (`web3d/src/people.ts`, `birds.ts`) are ONE InstancedMesh each, posed in the vertex
  shader (limb ids per vertex, per-instance phase/amplitude/colours). WebGL2 allows 16 vertex attributes: with
  `instanceMatrix` (4) they need packed attributes (`aInfo` = part/limb/opt, `iAnim` = phase/amp/seat/worn bits);
  17 gave "Too many attributes". The depth material for shadows needs the same pose code (`customDepthMaterial`)
  or the shadows do not walk. `vColor` is a vec4 in this three: assign `vColor.rgb`.
- `city.json` `walk` (tool/src/walk.dart) is a 1 m bit grid of open ground (no buildings, carriageways, blocked
  areas, dips, trees, lamps); `Crowd` floods it from the square and probes each cell once against Rapier
  (static only) for ground height and props. The probe only accepts ground within -0.6..+1 m of the bare terrain grid,
  so cells on levels (the Dolac plateau stands up to 4 m over the grid) carry their height in `walk.levels`; both sides of a
  retaining wall are walkable, and `Crowd.stepTo` (no step over `STEP` 0.5 m) is what keeps walkers off the drop. People are not bodies: they flee the bike/car/trams
  (`Trams.hazards`). Café guests sit on `Furniture.seats()` chairs and stand up when the chair is disturbed.
- `erasableSyntaxOnly` is on: no `const enum`, no constructor parameter properties (`constructor(private x)`).
- Setting `obj.rotation.order` recomputes `obj.quaternion` in the new order (three's Euler setter fires onChange): people.ts
  reset it to 'XYZ' after a 'YXZ' tumble and fliers swung 1.8 m round their pivot ("teleporting"). Compose instance matrices
  from a private Euler/Quaternion (`Crowd.place`). A flying pedestrian is a rod that lands on its ends (`Crowd.land`).
- Rapier ray casts pass through ROOFS (roofs have no colliders) and hit interior party walls; to ask what is
  visible use Three's `Raycaster` on `city.root` (`zg.plainHits`, `zg.pick(px, py)`), not `world.castRay`.
- `tool/plain_scan.py` finds the plain (tile 48) walls actually seen from the square (needs
  `export_web.dart --dump-walls` -> `.art/walls_all.json`, and the dev server); `tool/make_firewalls.py` then draws
  weathered plaster for party/courtyard walls and strips of the building's own facade for short corner edges
  (`data/hero/firewall.json`, `fw_<wall>`), then `pack` + export. Edges under 1 m matter: a rounded corner is
  a dozen 0.5-2 m edges, and the dump used to skip them.
- PIL cannot filter mode `F` images (`GaussianBlur`): blur float arrays with numpy. `scipy` is not installed.
- A picture is chosen for one EDGE: party walls never appear in `coverage.json` (street walls only), so the
  "48 of 48 done" count says nothing about plain side walls.
- Parallel workers export through `tool/export_locked.sh` (mkdir lock, export, sync assets), never bare.
- Tram zone on paved squares: `Surface.setts` / `Surface.clinker` (the cobble tile tinted, `ground.dart`), a
  2.9 m / 1.5 m band round `tramLines` inside `paving`.
- `data/props.json` (tool frame, `items` with `type,x,z,heading`) -> city.json `props` (web frame, ground y);
  `web3d/src/squareprops.ts` builds them. A `candelabra*` / `lamp_*` item replaces the plain lantern within 1.6 m.
- The Jelačić statue stands at about (12, 18.5) tool x/z, not at the origin (the crowd's centre is `CENTRE`).
- Overhead line (`catenary.ts`): the tram model's pantograph tops out at 4.35 m, so the contact wire hangs at
  4.42 m, not the real ~5.5 m (`CONTACT_H`); wire ribbons keep a 1.5 px minimum width in the vertex shader (1 cm
  geometry breaks up at range). Only ~1.95 km of the 27 km of `trams` lies in the playable extent (31 masts).
  Track heights need `EXCLUDE_DYNAMIC | EXCLUDE_KINEMATIC` (else the ray lands on a tram roof).
- Props (`squareprops.ts`): `data/props.json` is generated by `.art/streetview/square2/mkdata.py` from the Street View
  survey (notes in `.art/streetview/square2/notes.md`); whites and pastel canvas colours wash out under this sun,
  so albedos are darkened (granite 0x9a9a9a); repeated things are instanced, every solid prop has a static
  collider. Survey positions can be ~4 m off the game's OSM footprints (kiosks): check against a render.
- `zg.look` eyes at pavement height can end up below the ground (Ilica end) or inside a tram-stop shelter or a
  tram: use `zg.groundAt(x, z) + 1.7`; its z is the web z (= -z of the tool frame). With workers running in
  parallel the machine is loaded and screenshots crawl: run them in the background and poll for the png.
- A rounded corner tower belongs in its OWN picture over the chain of short curved edges (spansFor splits one picture
  over consecutive edges, bends included). Kept in the front picture it gets painted flat there AND `make_firewalls.py`
  corner strips of that front repeat it round the curve (Kuća Popović); trim neighbours out of each raw at the real joins.
- Short corner edges anywhere: `WALLS=<wall>[=<donor>|=plaster],... tool/make_firewalls.py` (strip of the building's
  real facade, else its `fill_` filler, else plaster); `list_hero_facades.dart --building ... --min 0.3` lists them.
  A strip from ANOTHER building's donor (small Dolac blocks) is remembered through its `source` on reruns.
- `make_firewalls.py` is stateless about its own output: "covered" means a real or filler picture, never `fw_`; the
  set only grows (earlier `firewall.json` entries are kept). An earlier version dropped every wall it had already
  fixed on the next run (the dump's `hero` flag counted its own pictures).

## The Cathedral and Kaptol square

- Chrome extension `screenshot` with `save_to_disk` AND `scale < 1` saves the downscaled image (627x261): take
  frames you want to keep at scale 1. Pano-id URLs need the full `data=!3m6!1e1!3m4!1s<id>!2e0!7i16384!8i8192`
  form here (`!3m1!1e1!3m1` stayed black), and 10 + 9 s of waiting.
- gen-image keeps a facade's lower part isotropic but squashes what does not fit its 2:3 canvas (the Cathedral's
  towers came out 30% too short): measure key heights on the rectified photo, and draw tall parts separately.
- A building's picture starts at ITS ground (the lowest street point): the palace stands at 5.4 m, Kaptol square
  at ~11 m, so the lower 5-6 m of its square-side pictures are underground. Recompose those raws with a taller
  stone basement (`.art/cathedral/mk_kaptol_raws.py`), or windows get buried.
- Every hero page is full: any new facade opens a new 4096^2 page (~22 MB GPU). Low-res `res` lanes share rows'
  free tails, but a tail is at most a few hundred px; three tiny pictures once opened a nearly empty page 36.
  Check `pages` after a pack.
- `omit` in data/buildings.json drops an outline and every building:part whose centre is inside it (the
  Cathedral's 31 parts); a hand-built model then takes its place via `landmark` (city.json `landmarks`).
- A roof is one hipped/gabled box over the footprint's minimum-area box: on an L (the archbishop's palace, box 23 deg off
  both wings) it flattens into a 5.5 m plateau with stucco bands on every wall and runs through round towers' cones
  (Nebojan). Give such a building `roofWings` (data/buildings.json: one rectangle per wing, tool x/z, edges on the wall
  lines; the roof is the highest wing, footprint outside every wing is flat at the eave) and put a cone `dome` on each tower.
- `?people=N` (total walkers, default 117: 87 on the square, 30 in `AREAS`; the ~213 café guests on chairs come on top) threw `bodyPts[k] is not iterable` before the first tram step; `Trams.hazards` now skips trams without points (2026-09-30).

## Passages (data/passages.json, passages.ts)

- Rapier ray casts see colliders only after a `world.step()`: `passages.ts` steps once before dropping its floors onto
  the ground by ray (and before adding its own walls, so the rays never hit them). The baked ground's triangles differ
  from the terrain samples by several cm; a floor at the samples' height let the sidewalk show through.
- A panel coplanar with a facade (the corridor's end cap round a doorway) wins the depth fight across its whole shape and
  paints over the facade outside: keep it 8 cm inside.
- A centreline that crosses a facade exactly at a ring vertex is on neither edge: decide "facade or inner wall" by distance
  to the passage's entry point, not by edge crossing (Ilica 3 got a doorway on one edge and a full cut on the other).
- Cutting a doorway with one rectangle per straight leg leaves a wedge uncut at every bend: a party wall there stood
  in Marićev prolaz and stopped the bike. `openings` adds an octagon round each bend; ride the bike through after a change.
- OSM's octagon (Oktogon, w579294802) is irregular (faces 6.3-6.9 m from its centre): the hall's faces must stay inside
  the nearest one or a plain OSM wall covers a face.
- A doorway cut into a hero wall must match the opening painted in its picture: measure the black opening on `raw.png`
  and set `door`/`doorWidth` and the centreline to it (or paint a lintel into the raw, as for Gajeva).
- Corner turrets / short corner edges: no Street View on Trg Petra Preradovića's corner (every URL form is black); the
  Oktogon corner (`oktogon_corner`) is invented, drawn as a `corner` picture and shifted so its arch sits on the chamfer.
- A montage of oblique frames can merge two buildings into one OSM wall: the Neboder's picture put the
  neighbour's beige block beside a 6.4 m tower. Check widths by projecting the outline's corners into a
  frame (pano position + heading, f = (H/2)/tan(y/2)); Google 3D views (`@lat,lng,140a,35y,<h>h,55t/data=!3m1!1e3`,
  the camera at lat,lng) fit the same pinhole model with vertical fov y.

## Deliveries

- Trams stand in front of the Ilica shops and hide pads in screenshots: `zg.trams.root.visible=false` first. To check a
  pad, put the camera 7 m out along the wall normal (`walls[id]` n) at sidewalk + 4.5 m.
- A pad's `y` comes from a ray cast down from max(sidewalk, terrain) + 1.5 m (walls) or `probe` (x/z spots, absolute, default
  terrain + 3 m). Interiors and plateaus need `y` or a higher `probe` (Oktogon `y` -0.3), else the pad sinks into the floor.
- A wall's `sidewalk` can lie a metre under its door on a sloping street (YEZI, SPAR): a ray from sidewalk + 1.5 started under the
  pavement and buried the pad. Pads also drape vertex by vertex over the ground (a flat disc sank half into slopes and kerbs);
  check with the audit idea: cast down at the centroid of every pad triangle and compare.
- `zg.groundAt` on a fence line returns the top of its invisible `wall` (12 m up), not the ground: aim cameras off the line.
- Facade `at` = pixel x / picture width only for single-edge facades; multi-edge ones split the picture by edge length.

## Fences and the walls behind them

- `data/fences.json` `style: "roadblock"` adds red-white barrier boards, amber lamps and cones; `wall: 12` makes the collider a
  12 m invisible wall. Kaptol is closed just north of the Domitrovićeva kula gate (z 238, canons' house to the seminary palace);
  the private road outside the north wall is open. Rapier ray checks (`zg.world.castRay`, flags 6) confirm no gap; a seal needs a
  flood with bike-sized probes (8 horizontal rays of 0.45 m at 0.35/1.0 m, 0.5 m grid, |step| < 0.45) run from BOTH sides as controls.
- `tool/make_behind_fence.py` draws very low-res (`res` 0.1 / 0.25 / 0.5) random crops for the plain walls behind the fences
  (needs `--dump-walls`; also writes `.art/streetview/behind_todo.json` so `pack` knows the true lengths). Then `pack` + `export_locked.sh`.
- Inner-ring edges of a multipolygon (seminary palace `r2617686_e10`+) can take pictures now (see the hero atlas notes).


- Rider (`rider.ts`): the coat tail (`skirt`) hangs from the pelvis and the thigh's rear cap sits at the hip, so a too-shallow
  skirt (z scale 0.78) let a dark navy diamond of trouser show through the coat's back. Look from 1.3 m behind at y+0.5 to check.
- `HERO_DEV=1 .venv/bin/python tool/prepare_facades.py pack` is the development pack: new and changed facades go onto scratch
  pages after the last real page (atlas.json `dev: true`, fast low-quality ETC1S), real pages are not re-encoded. Scratch pages MUST
  stay ETC1S: a UASTC page transcodes to another GPU format and `loadHeroAtlas` dies with "RangeError: offset is out of bounds".
  A normal `pack` (no env) folds the scratch pictures into the real pages; do that once when a batch of tasks is done.


## Church and Kaptol walls

- A `fill_` picture on an edge beats a real picture of the same edge: drop the filler entries from `data/hero/fill.json` when you
  add a real facade to a filler-covered wall (the church showed a five-storey shop front until then).
- `prepare_facades.py crop $names` in zsh silently crops nothing (one argument): call it through `bash -c`.
- A user photosphere's lat/lng can be 8 m off: a camera placed at its coordinates in the game stood inside a building. Estimate the
  distance from a known width (the church front: 14.8 m = 450 px at f = 326 -> 10.7 m), not from the georeference.
- Google Maps 3D (`/@lat,lng,<alt>a,35y,<h>h,<t>t/data=!3m1!1e3`, camera AT lat,lng) is a usable photo source where no Street
  View exists; gen-image adds storeys to match `storeys`, so say "exactly two rows of windows" in `look` when `storeys` only sets the eave.
- A delivery `x`/`z` entry's `probe` is the ABSOLUTE ray start height, not an offset: a pad on a hill needs `probe` above the ground
  (14 for the palace's rear door, ground 5.5 m), else the pad lands at y = 0 underground.
- Private roads in OSM (`access=no/private`) are still drawn as roads; what closed them in the game was a fence, not the data. A
  bike drive test (`dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}))` from a `shot.mjs --eval` async IIFE, teleport
  first) proves a gate is passable; starting it inside a block (Pod zidom's courtyard) just sits still.
- `levels.json` kind `dip` lowers ground the grid has (no edge wall); the client's bare terrain grid must sink too (`dips` in
  city.json), or the grid pokes through the lawn.
- The big gate by the Pod zidom roundabout is the START of the private road (the first gate I built stood 120 m inside, at the south-east
  tower): when the user says "the path from before" they mean where the road leaves the public ground. Check OSM `access=private/no`
  service roads end to end, not just the part that is walled in. The Street View photosphere of Apr 2019 (lat 45.8139062, lng
  15.9788561, user "Zagreb") shows the gate 5 m away; its heading is off by ~20 degrees.
- To test a route with the bike, a pure-pursuit loop in a `shot.mjs --eval` async IIFE (KeyW held, KeyA/KeyD from the heading error
  to the next waypoint, `zg.vehicle.heading()` and `zg.vehicle.body.translation()`) works; sharp 90-degree corners need waypoints
  that cut inside the turn, or the bike overshoots into a wall and looks "stuck".
- `plain_scan.py` takes `PTS="x,z;x,z"` (tool frame) for standpoints along a path instead of a grid.

## Cesarca park, Ban centar

- A building that looks wrong may carry `fill_<wall>` fillers (`data/hero/fill.json`), and a filler beats nothing but also hides what you
  expect: look up the wall's picture (`grep w<id> data/hero/*.json`) before redrawing; Ban centar's "plain" walls were fillers.
- A pit in the ground = two `levels.json` regions (a `flat` landing and a `stairs` flight with `toLevel` below the grid): the exporter
  makes the retaining walls itself. The stairs mesh takes the lawn's green, so `parkprops.ts` lays its own stepped concrete 9 cm above the
  ramp line (heights by ray cast: floor/ramp colliders exist, the steps mesh has none). levels.json is untracked and its points are tool-frame.
- Extra trees and park props are `data/park.json` (read by `export_web.dart`), not `props.json` (generated by `.art/.../mkdata.py`).
- Garden walls (`gates.json` `walls`): end every wall INSIDE the building or tower it runs to (the corner point moved 1 m into the
  footprint; check with a point-in-polygon on the `--dump-walls` edges), and build one mitred ribbon, not one box per segment: per-segment
  quads open a wedge gap on the outside of every bend and between a wall and its gate post.
- A new facade-atlas tile (48 plain, 49 weathered plaster): `tool/prepare_textures.py --plaster-only` patches the committed
  `facade_atlas.png` without the gen-image raws; tile ids index `FacadeStyles` cells (8 per row). Procedural tiles must be periodic
  (tile the random grid 3x3, enlarge, crop the middle) or the 3 m repeat shows a seam.

## Hotel Dubrovnik car park

- OSM's lot outline stops 0.3-3 m short of the walls round it and the rest is raised sidewalk (0.15 m kerb): lay carpark asphalt from a
  hand polygon that runs into the walls (`data/park.json` `asphalt`), and keep the OSM `parking_aisle` stubs: they are the driveways
  that cross the street sidewalk. Bay frame for markings/cars is rotated 7.5 deg to the north wall (`parking.ts` U, V).
- OSM gaps between buildings that are no passage in reality (the bike rode through into a courtyard): give the building an
  `outline` in data/buildings.json (replaces its ring; counter-clockwise, `e0` = first point to second), ending 0.2 m INSIDE each
  neighbour so no slit is left. Edge ids change: re-point its hero pictures (rerun the picture script) and anything naming `<id>_e<n>`.
- Colonnade / open arch: lift the walls with `data/arcades.json` (`base` m above the sidewalk, `soffit` polygon) and add a separate
  `building:part` for a recessed ground floor; `zg:eave` in `tags` sets its wall height (a picture's `storeys` would stretch it).
  An arch has to be tested with `zg.wallHits` along the passage at 0.4 / 1.5 / 2.4 m before trusting the picture.
- The dev server dies when a Bash call ends: a `shot.mjs` run printing `Cannot read properties of null (reading 'style')` or `zg is not defined`
  means no server (or the page still loading: add `--wait-ready 120`). Restart with `run_in_background`.
- A 1254x1254 gen-image output ignores the 1024 request; `pack` only squeezes it to the wall's true aspect, so supply the aspect in `look`
  (a square picture for a 27.7 x 24 m wall is fine, a 4:1 one is not).

- Flicker on a facade = two coplanar walls. OSM can hold a second outline inside a building with the SAME street edge
  (Pošta r3890429 vs w583253648/9, 15.8 vs 19.5 m): find them in `.art/walls_all.json` by `mid`, and `omit: true` the inner one
  in `data/buildings.json` (no `landmark` needed).
- Props flicker the same way: a coloured strip built as a second `prism` inside a slab shares the slab's side plane (the tram platforms'
  rail edge). Emit bands side by side as quads (`emitPlatform`), never one box inside another.
- city.dart drops any building or part under 6 m² (`polygon.area < 6`): a thin hand-made part (a 0.8 m deep gateway) silently vanishes;
  make it at least 6 m², or the export shows one building fewer than expected.
- A part's ring is cleaned and reordered: print its edges (`--dump-walls`, `w<id>_e<n>` in `.art/walls_all.json`) before naming walls
  in features, arcades or hero entries.
- Before placing a hand-made part beside OSM buildings, find the exact neighbour corners (`list_hero_facades.dart --building`) and
  compare with the user's photo / Google 3D: the Vrutak gateway belongs IN the gap between two houses, not in front of one of them.
- `shot.mjs` runs started in parallel can hang (a stale PNG from an earlier run stays): check the PNG's mtime before reading it, and
  `pkill -f tools/shot.mjs` before the next batch.
- That `pkill -f tools/shot.mjs` also kills OTHER sessions' Bash shells whose command line contains the string (exit 144):
  with sessions in parallel, run shot.mjs through a symlink of another name (`ln -s .../tools/shot.mjs $SCRATCH/snap.mjs`).
- A colonnade has ENDS: the short walls across it (Addiko `e9`, part of `e6`) stay on the ground unless lifted too. Walls are one-sided, so
  from inside such a wall is invisible yet its collider stops you ("invisible wall"). Ride the bike through end to end after a change.
- The game pauses while the tab is hidden or the window has no focus (`checkAway` in main.ts). Headless Chrome never has focus:
  `shot.mjs` sends `Emulation.setFocusEmulationEnabled`; any other CDP driver must do the same, or it shoots a paused, blank game.
- `zg.groundAt` (and `/tmp/lk.sh` eyes) under a soffit lands ON the soffit (it is in the facade mesh, which collides): give `zg.look` a fixed y there.

## Ilica and Nama (arches, terrain fill)

- gen-image misreads a blurry sign as a famous name: Kuća Stanković's east shop came out "HOTEL DUBROVNIK" (the hotel is on Gajeva).
  Zoom every sign in a raw before packing; a wrong shop front can be repainted from a neighbouring bay of the same raw (`raw_*.png` kept).
- The grid can dig a closed hollow under dense, tall blocks (Ilica 4-14 fell 6 m in 50 m, 20%). Fix it in `tool/prepare_terrain.py`
  `FILLS` (harmonic fill from the cells round a polygon, idempotent), never by hand in `data/terrain/ground.json`; `cmp` the far grid.
- gen-image miscounts repeated openings (6 arches for 7, windows off the arches' rhythm) and paints ~1 m of pavement under the facade:
  count, re-space bays by cutting strips between pilaster centres, and crop the pavement band before measuring anything on the raw.
- `heightOf` in features.ts takes `aboveEave` over `y`: a feature with both (an oriel's bottom and top) must read `f.ground + f.y` itself.
- Hiding `zg.trams.root` hides the meshes only: the kinematic bodies still stand on the track. A bike test on the tracks that "sticks" hit a
  tram (`zg.trams.hazards` lists them); ride in the other direction or off the rails before blaming the ground.
- city.json `walls[id]` sidewalk is the LOWEST point along a wall; an arched wall's picture (and its features' `ground`) starts at the highest.

- Buildings are kept or dropped by their CENTROID against `coreExtent`: a street along the extent's edge (Tomićeva, x -317, extent -322) lost
  its whole far side. `extentExtras` in city.dart rescues a strip; check the other side of any street within ~25 m of the edge.
- `make_behind_fence.py` has two closures (Kaptol `LINE`, the Uspinjača street `USP`); a new roadblock needs a region there, or its walls stay plain.

## Build and deploy

- The game reads the facade/surface/roof atlases as KTX2, not PNG: after `prepare_textures.py` / `prepare_roofs.py`, run
  `node web3d/tools/sync-assets.mjs` (re-encodes the changed PNG, ~15 s, needs `basisu`) and commit the `.ktx2` + `atlas_ktx2.json`.
- `dist/city/zagreb.glb.gz` arrives either way: `vite preview` (and some hosts) send it with `Content-Encoding: gzip` and the browser
  unzips it, a plain file server (`python3 -m http.server`) sends raw gzip. `loadGlb` sniffs the 1f 8b magic; test both after a change.

## Frame rate

- On the M1 Pro the game is bound by CPU and draw calls, not pixels: a quarter of the pixels saves ~2 of ~6 GPU ms, and MSAA off,
  anisotropy 4 or a 2048 shadow map change nothing measurable (a tile GPU). Measure CPU wins with `--throttle`, not by guessing.
- Every Mesh is a draw call, two when it casts a shadow. Hand-built models of many primitives (bike, features) go through `merge.ts`;
  a mesh posed every frame must carry `userData.moves = true` or it gets merged into its still siblings.
- One material on both an InstancedMesh and a plain Mesh makes three rebuild the program parameters at every switch, every frame
  (`getParameters` in the profile): give the instanced use its own material (copy `onBeforeCompile`, `clone()` drops it).
- three draws a transparent DoubleSide material in two passes and sets `needsUpdate` at each, every frame. main.ts sets
  `forceSinglePass` on all of them at load; anything transparent and double-sided added later must set it itself.
- rapier3d-compat 0.21 `world.step()` sweeps every body and collider through JS after each step (`mapNewSoftBodies`): 1 ms a frame with
  the ~1,900 furniture bodies, three times the physics. The loop calls `stepWorld()` (the pipeline alone); keep `world.step()` for load-time.
- `zg.bench` wall times wander +-1.5 ms between runs (GPU clocks): compare A/B pairs interleaved, or GPU time with
  `EXT_disjoint_timer_query_webgl2` (headless Chrome has it; it counts the GPU idling while the CPU submits). Profile the CPU with CDP
  `Profiler.start/stop` and attribute samples to the innermost `src/` frame.
- A headless window under 500 px either way is a "phone" (`onMobile`): the game never loads (`zg is not defined`).
