# Bajs Cargo project guide (formerly Zagreb Drive)

Bajs Cargo is a free-roam driving game set in a recognisable 3D model of
central Zagreb, built with three.js and Rapier in the browser (`web3d/`). A
personal pet project. This file is the next session's only memory: keep it
current. `docs/decisions.md` records why things are the way they are;
`docs/progress.md` records what each phase delivered.

The original Flutter / flutter_scene app was removed on 2026-09-29; the last
state with it is commit 6d27cdb. Its city
pipeline lives on here in `tool/` as a plain Dart CLI.

## Layout

- `web3d/` — the game: Vite + TypeScript + three.js + Rapier.
  - `src/vehicle.ts` (the Rapier raycast vehicle with the car's and the
    Bajs cargo bike's tunings, no three.js, runs under Node), `carModel.ts`
    (the Ferrari model posed from it), `bikeModel.ts` (the Bajs cargo bike,
    what you ride by default; B swaps to the car, `?ride=car` starts in it),
    `rider.ts` (its rider: overcoat over a suit, lathed body, IK legs and
    arms; `dress` sets the coat's colour and cloth and the hair's colour),
    `boot.ts` (the page's entry: opens the lobby at once and loads `main.ts` as
    its own chunk behind it), `lobby.ts` (the loading screen's "dress your
    rider": coat colour, fabric, hair on a turning preview of the bike with its
    own small WebGL context, then a Start button once the city is in; a driven
    browser (`navigator.webdriver`, shot.mjs and perf.mjs pass `--enable-automation`)
    or `?go` starts at once, `?lobby` waits for the button anyway), `outfit.ts`
    (the wardrobe: colours, cloths, the choice kept in localStorage; cloths and
    hair are one greyscale atlas `public/models/outfits.jpg` from
    `tool/make_outfits.py`, tinted in the material), `city.ts` (the
    exported glTF, the atlas material, props, colliders), `features.ts`
    (`data/buildings.json` features), `terrain.ts` (ground grid and far
    horizon), `trees.ts` (three instanced species built at load: plane,
    chestnut, linden; leaf cards on `public/models/tree_*`), `trams.ts`
    (ZET TMK 2200 trams on the real tracks, textured from
    `public/models/tram_atlas.png`; `tramLayout.ts` is generated),
    `furniture.ts` (café tables, chairs and parasols as loose Rapier bodies
    the car scatters; from city.json `terraces` and `terrace` features, plus
    market stalls from `stalls`),
    `people.ts` (the crowd: instanced pedestrians walking city.json `walk`, café guests on the chairs; the car/bike
    knocks them flying, `Crowd.onHit` -> sound, `Crowd.hits` counts them for the finish card; 87 walkers on and around the square plus 30 kept to `AREAS` further out
    (Dolac's plateau, Kaptol before the Cathedral, Praška, Vlaška, Tkalčićeva...), `?people=N` sets the total),
    `birds.ts` (pigeon flocks that scatter), `squareprops.ts` (hand-placed props from `data/props.json`:
    candelabra, flagpoles, ad columns, clock, bins, planters...), `catenary.ts` (tram overhead wires,
    masts, span wires),
    `cathedral.ts` (Zagreb Cathedral built by hand: the OSM outline is `omit`ted, city.json
    `landmarks` places it; textures from `tool/make_cathedral.py`), `fences.ts` (site fences from
    `data/fences.json` round what the player may not enter, with colliders),
    `passages.ts` (covered passages through the blocks from `data/passages.json`: Marićev
    prolaz and the Oktogon's glass-domed hall; walls, ceilings, lamps baked into vertex colours,
    colliders; the export cuts the doorways, `tool/src/passages.dart`),
    `gates.ts` (open iron gates with plaster posts and lanterns, plus rubble / plaster garden walls, from `data/gates.json`: the private road along the Kaptol walls),
    `parkprops.ts` (the EU star garden and the closed toilet's stairwell, gate and lift on the Cesarca lawn, from `data/park.json`,
    which also lists extra trees),
    `deliveries.ts` (the delivery game: a random business by name, its street 5 s later, an arrow to it before its name 15 s in (relative to the view, `COMPASS_DELAY`), pale yellow pads on
    the floor at every door from `data/deliveries.json`; drive onto the current pad to deliver),
    `audio.ts` (sound synthesised with Web Audio, except the pigeon recordings: freewheel ticks and tyre hiss, the car's
    engine, handbrake squeal, positional tram rumble/whine and a school-bell ring while a tram is held up
    (`Trams.audioSources()`, `blocked`), furniture crashes via `Furniture.onHit`, the delivery chime, the cathedral's low bell once a minute (a real CC0 recording, BigSoundBank s3446 `bell.mp3`, slowed to 0.45x; positional, `CATHEDRAL_BELL`, carries to the
    main square and fades out past it, `BELL_FULL`/`BELL_GONE`), a city murmur that swells over the square, a crunch on hard stops, pigeon wing flaps (real CC0 recordings from BigSoundBank "Flight of a Pigeon" s0840 / s0476 in
    `web3d/public/sounds/`; a scattering flock layers ~7 of them, nearby flocks flutter now and then) when a flock
    scatters; starts on the
    first key/click, M mutes; `zg.audio`),
    `chaseCamera.ts`,
    `merge.ts` (`mergeStatic`: static meshes under one parent with one material become one draw call, posed
    meshes flagged `userData.moves` stay; `shareMaterials`: colour-only material variants share one, tint in
    the vertices; used by the bike/rider and features),
    `input.ts` (keyboard, gamepad and touch: phones and tablets (`html.touch`, set by
    `boot.ts`; `?touch` forces it) get a steering pad, pedal / brake / skid buttons that press the
    same virtual keys (a tap is a pedal stroke), Reset and Base, and a drag on the game turns the
    view; no car on touch. They first get a "made for a laptop" dialog with "Play here anyway",
    `?desktop` skips it), `places.ts` (HUD place names),
    `main.ts` (`run(lobby)`: loop, sky, lighting, adaptive render resolution, HUD with fps, `window.zg` debug surface; pauses
    world, timer and sound while the tab is hidden or the window unfocused, carries on when the player is back;
    stops them for good after the 8th delivery (the finish card shows the time and pedestrians hit; "Copy score image" puts a 1200x630 PNG of the last frame under
    the score on the clipboard, or downloads it where the clipboard refuses, `scoreCard.ts`); 0 goes back to
    base and holds the rider there for 5 s while the clock runs, so it is no shortcut).
  - `tools/sim.ts` physics checks, `tools/tram_sim.ts` tram traffic (junction
    lockups, overlaps), `tools/shot.mjs` headless Chrome over CDP,
    `tools/compare_sv.py` renders from Street View cameras beside the photos,
    `tools/sync-assets.mjs` copies the atlases (hero pages
    `hero_atlas_<n>.ktx2`) and the Draco decoder into `public/` before
    `dev`/`build`; it encodes the facade/surface/roof PNG atlases to ETC1S
    KTX2 (`basisu`) when a PNG's hash differs from `assets/textures/atlas_ktx2.json`.
    `npm run build` ships `city/zagreb.glb.gz` (gzipped in `vite.config.ts`,
    unzipped by `city.ts`); dev serves the plain glb.
  - `public/city/` is generated by `tool/export_web.dart`; `public/features/`
    holds feature images; `public/models/` the car.
- `tool/` — the city pipeline (Dart CLI, `pubspec.yaml` at the root) and the
  Python texture / Street View tools. `tool/src/`: `osm.dart` parsing and
  multipolygons, `geo.dart` the geo->local conversion, `geom.dart`
  earcut/clipping/boxes, `clip.dart` Clipper2 shapes, `city.dart` the model,
  `buildings.dart` heights, walls and roofs, `ground.dart` streets, squares,
  kerbs, rails, trees, `hero.dart` the Street View facades, `roofs.dart` the
  roof set, `street_props.dart` kiosks, platforms, terraces, monuments,
  lamps, `props.dart` tree instances, `terrain_grid.dart`, `levels.dart`
  (hand-shaped plateaus, ramps, stairs, retaining walls), `passages.dart` (doorways cut
  for covered passages, city.json `passages`), `mesh_writer.dart`.
- `data/` — committed inputs: `osm/` (the OSM snapshot), `terrain/` (ground
  and far grids), `hero/` (facade entries per section, `atlas.json`,
  `coverage.json`), `buildings.json` (per-building corrections and
  features; `part` adds a hand-drawn volume, `outline` replaces an OSM way's ring), `roofs.json`, `facade_styles.json`, `levels.json` (flat
  plateaus, ramps, stairs and `dip` hollows that override the terrain grid: Dolac, its
  stairs, Kerempuh/Opatovina, Ribnjak park; pedestrians walk all but dips and `"crowd": false`), `markets.json` (market stall grids, loose
  furniture), `raised.json` (the square's stepped frontage), `streets.json` (carriageways laid by hand: a centreline +
  width, square ends, `replaces` drops OSM ways' own; Teslina's one narrow lane south of the café terraces), `fences.json`
  (fence lines closing off unreachable places, e.g. the Cathedral's sides and the roadblock on the Kaptol road; walls behind them: `tool/make_behind_fence.py`), `passages.json`
  (covered passages: centreline, width/height, doorway size, the Oktogon's hall), `arcades.json` (colonnades: walls lifted over an open ground floor plus a soffit, `spans` for part of an edge; `arches`: round arches cut into one edge with a stepped walkway behind them, Nama on Ilica; `Arcade`/`Arches` in `tool/src/buildings.dart`),
  `rear_walls.json` (wall ids that wear the
  seamless weathered-plaster tile 49 (no windows) instead of plain stucco: back walls seen from the private roads; found with `PTS="x,z;..." tool/plain_scan.py`),
  `plaster_walls.json` (firewalls on that tile 49 in their own linear tint) and `generic_walls.json` (walls without a picture of their
  own laid out in rows of a generic style `gen_*`, cells 0-23 of the facade atlas, in the building's paint): both written by
  `tool/shared_walls.py`, which moves plaster `fw_` and `fill_` pictures out of the hero atlas (download size); a hero picture on
  the same wall wins, and `coverage.json` counts them as `generic`.
- `data/deliveries.json` — delivery destinations: `wall` + `at` (0..1 along the wall, left to right as in its
  facade picture) + `out` (m, default 1.1), or tool-frame `x`,`z` (+`y`, `probe`) for interiors. Copied to
  `web3d/public/city/` by `sync-assets.mjs` (rerun it after an edit). `docs/MISSING_BUSINESSES.md` lists what lacks a sign;
  `docs/DELIVERY_LOCATIONS.md` (2026-10-02) is the keep/remove/add review: destinations must be places locals know
  by name (~1,000+ Google Maps reviews or a landmark), never a brand on a sign or a chain branch.
- `assets/textures/` — the atlases the web build samples (facade, surface,
  hero, roof). `docs/` — decisions and progress.

## Toolchain

- Node 26 + npm for `web3d/`. Dart through FVM (`.fvmrc` pins Flutter
  3.47.2, used only for its Dart SDK): `fvm dart ...`. Python tools run from
  the git-ignored `.venv/` (`numpy`, `Pillow`, `tifffile`, `imagecodecs`).
- `fvm dart analyze` only counts as passing when it prints the literal
  `No issues found!`.
- Secrets only in the git-ignored `.env`, never in source, logs or docs. Raw
  downloads and gen-image raws live in the git-ignored `.art/`; evidence
  (screenshots) in the git-ignored `artifacts/`.

## Everyday commands

```sh
cd web3d && npm install && npm run dev      # http://localhost:5180/
npm run check                               # typecheck
npm run build                               # production build (Cloudflare Pages runs it: https://bajs-cargo.pages.dev/)
tools/og-image.sh                           # the link preview public/og.jpg (dev server up); index.html's og: tags use absolute URLs
node tools/sim.ts                           # 32 physics checks (car, bike, furniture)
npm run perf                                # performance budgets + fps vs your baseline (dev server up; ~45 s)
node tools/tram_sim.ts 30 150               # 30 min of trams at 4x the game's density
fvm dart tool/export_web.dart               # rebake the city after any tool/src or data change
tool/export_locked.sh                       # the same under a lock + asset sync (use it when workers run in parallel)
fvm dart tool/export_web.dart --dump-walls  # also writes .art/walls_all.json (every wall edge; audits)
.venv/bin/python tool/plain_scan.py         # which plain walls are visible from the square (dev server up)
.venv/bin/python tool/make_firewalls.py     # weathered plaster / corner strips for those (data/hero/firewall.json)
.venv/bin/python tool/shared_walls.py       # then: plaster fw_ and fill_ pictures -> plaster_walls.json / generic_walls.json
.venv/bin/python tool/prepare_textures.py --generic-only   # recut the gen_* styles (GENERIC: donor bay and rows) into the facade atlas
.venv/bin/python tool/prepare_terrain.py    # rebuild data/terrain from .art/dem (Copernicus GLO-30); FILLS smooths hollows (Ilica)
.venv/bin/python tool/prepare_roofs.py      # repack the roof set
.venv/bin/python tool/prepare_facades.py crop|generate|pack [name...]   # HERO_DEV=1 pack: fast, unoptimised scratch pages while iterating
.venv/bin/python tool/prepare_tram.py      # .art/tram views -> tram atlas + tramLayout.ts
.venv/bin/python tool/prepare_trees.py     # .art/trees gen-image raws -> leaf atlas + barks
.venv/bin/python tool/prepare_bike.py      # .art/bike gen-image raws -> seamless public/models/bike_*.jpg
.venv/bin/python tool/make_outfits.py      # the rider's cloths + hair -> public/models/outfits.jpg (one row of 128 px cells)
.venv/bin/python tool/sv_rectify.py spec.json   # several Street View frames -> one straight-on wall photo
.venv/bin/python tool/make_glass_tower.py       # Neboder tower sides (procedural glass, real lobby on Ilica)
.venv/bin/python tool/make_ban_centar.py        # Ban centar (the EU building) facades, procedural
.venv/bin/python tool/make_cathedral.py         # Cathedral textures (.art/cathedral gen-image raws -> public/models/cathedral)
.venv/bin/python tool/make_nama.py              # Nama's oriel strip, travertine tile, arcade back walls (from its facade raw)
```

After `export_web.dart`, reload the page. The export prints the real-facade
coverage ("Real facades: N of 859 street walls").

## Texture budget

Full resolution only where the player looks closely: street level, the lower ~20 m of a facade.
Anything high up (towers, spires, upper stages) is super low-res (~3.5 px/m), and anything the
player cannot reach is very low-res and fenced off (`data/fences.json`). Hero facades of such
walls take `"res": 0.25` (or 0.1) and pack into quarter- (tenth-) height atlas lanes.

## Coordinates

Local metres in a tangent plane with the origin at the Ban Jelačić statue
(45.81303 N, 15.97713 E). `tool/` and `data/` use **x east, y up, z north**;
`tool/src/geo.dart` (`geoToLocal`, `localToGeo`) is the only conversion (the
Python tools repeat its constants). **The web frame is x east, y up, z SOUTH**
(north = -z, three.js being right-handed): the export mirrors z and rewinds
every triangle to agree with its normal. Headings are radians clockwise from
north (0 = north, pi/2 = east) in both.

## Recreating buildings

**Use the `recreate-building` project skill**
(`.claude/skills/recreate-building/SKILL.md`): every street side from Street
View through the user's Chrome, faithful facades (every sign spelled as
photographed), the roof (`data/buildings.json`, `data/roofs.json`) and 3D
features (signs, awnings, terraces, scaffolding, domes, boxes, models). Walls
without a real facade are plain stucco on purpose; `data/hero/coverage.json`
is the done/todo list.

## Checking the result

- Screenshots of the game: `node web3d/tools/shot.mjs --eval "..." --sleep 800
  --shot out.png` (its own headless Chrome over CDP; prints the page
  console; `--mobile` emulates a touch-only phone, which gets the desktop-only dialog unless the URL
  has `?desktop`; `--touch "x,y;x,y*8:ms"` holds fingers (a `*n` point is tapped n times meanwhile),
  `--swipe "x,y>x,y:ms"` drags one). Never drive the game page with the Chrome extension.
- `window.zg`: `look(eye, target, fov?)`, `lookAtWall(id, distance?,
  eyeHeight?)`, `drive()`, `teleport(x, z, heading)`, `groundAt(x, z)`, `ride('bike' | 'car')`,
  `vehicle`, `trams`, `deliveries`, `job(id)` (force the current job), `dress({ coat, fabric, hair })` (outfit.ts ids), `furniture` (`reset()`, `awake()`, `stats()`), `renderer`, `scene`, `camera`. URL: `?park=square`
  parks the camera, `?dpr=1.5` fixes the render pixel ratio (else it adapts to the frame rate), `?pause` stops before
  the loop. `zg.bench(n)` renders n frames waited out on the GPU (ms a frame, draw calls); `shot.mjs --dpr 2` emulates Retina.
- Frame rate: `shot.mjs --uncapped --eval "zg.fps(8)"` rides for 8 s at whatever the machine can draw (fps, p50/p95/p99 ms);
  add `--throttle 4` (a step, after the load) for a cheap laptop's CPU, `?dpr=1` to hold the resolution. Baseline 2026-10-01 on the
  M1 Pro, 1920x1080 `?dpr=1`: ~240 fps, ~75 fps at `--throttle 4`.
- Performance check: `npm run perf` (`tools/perf.mjs`) after any change that adds geometry, materials, textures or per-frame
  work. Budgets in `web3d/perf-budget.json` are the same on every machine (draw calls and triangles from six cameras, programs,
  meshes, GPU MB with compressed textures at 1 B/px, and two counts that must stay 0); over budget fails: merge or instance, or
  raise the number in the same change and say why (`--update-budget` rewrites it at +15%). Timings (fps riding, and with the CPU
  4x slower) compare with your own `web3d/.perf-baseline.json` (`--save`, gitignored): 15% slower fails, 20% for the slow CPU,
  which wanders +-10% run to run (rerun before believing it). `--no-timing` for budgets only, `--shots dir` saves the six views.
- `.claude/rules/zagreb-web.md` holds the traps; add to it whenever
  something costs time.
