# Progress

One entry per phase: what shipped, what was checked, what is open.

## Phase 0: skeleton (2026-09-28)

- Flutter 3.47.2 app (`zagreb_drive`, app id `com.joeitsolutions.zagrebdrive`),
  landscape and immersive, Flutter GPU enabled in the Android manifest and the
  macOS Info.plist. Fork dependency by path, build hook, Riverpod, the six
  flutter_scene skills under `.claude/skills/`.
- `DriveWorld`: physical sky as skybox and IBL, a shadow-casting sun from the
  south-west, ACES at exposure 0.5 (exposure 1 washed the physical sky's
  1.2-2.0 linear radiance to white), AO, light fog, grading, vignette.
- Static loading screen that awaits `Scene.warmUp`.
- Probe (`ext.zagrebdrive.*`) with `states`, `enterState`, `frame`,
  `renderStats`, `passes`, `nonFinite`, `readPixel` and a new `command`
  (`look`, `tune`). Parks `zagreb.square`, `zagreb.ilica`,
  `zagreb.cathedral`, live state `zagreb.driving`.
- Gates ported: analyze, unit-tests, scene-assets, generator-determinism,
  render-budget, render-nonfinite, frame-shots; `tool/ensure_device.sh`,
  `tool/reload.sh` (SIGUSR1/SIGUSR2 to `flutter run`).
- OSM snapshot of the full box fetched and committed (`data/osm/`).
- Checked on Slim_1 (OpenGLES): 10 draws total, 2 in `ScenePass`,
  `pipelineBuilds=0`. Screenshot: `artifacts/phase-0/overview.png`.
- The first Gradle build on this machine took 6.5 minutes (it installed
  build-tools 36), longer than `ensure_device.sh`'s old 5-minute wait, which
  is now 15 minutes.

## Phase 1: block-out of the core (2026-09-28)

- `tool/generate_zagreb.dart` reads `data/osm/zagreb_centre.json` and bakes
  the core box (x -322..341, z -337..330: the square, Ilica's first blocks,
  Praška, Zrinjevac, Dolac, Kaptol, the Cathedral) into 16 chunks of 200 m,
  one `.fscene` each, walls and roofs merged per material. 604 buildings,
  73.7k vertices, 1 MB, baked in about 0.6 s.
- Heights: `height`, else `building:levels` x 3.4 m + 1.2 m, else 4 storeys
  (15.4 m eave) in Donji grad, 8-11.5 m in Gornji grad/Kaptol, 3.2 m for
  sheds and kiosks, 4-7.5 m for courtyard buildings (no street within
  16 m). `building:part`s replace their outline (the Cathedral's spires come
  from its parts).
- Roofs: gabled/hipped/flat from `roof:shape`, gabled by default. Each roof
  is a set of planar regions over the building's box; footprint triangles
  are clipped into them, and walls are split where the roof kinks so they
  meet it exactly. Pitch 0.62; the rise caps at 5.5 m and deep blocks get a
  plateau. The ridge follows the longest street-facing edge (Ilica's deep
  plots put gables to the street before).
- Runtime: `ChunkStreamer` loads chunks within 540 m of the focus, shows
  them within 460 m, releases past 700 m; `CityMaterials` swaps every
  chunk's materials for one shared instance per name.
- Slim_1: `zagreb.square` 22 colour-pass draws / 100 total / 317k vertices,
  `pipelineBuilds=0`. Screenshots: `artifacts/phase-1/overview.png` (the
  perimeter blocks with their courtyards, the Cathedral spires behind),
  `square.png`, `ilica.png` (Ilica 1's tower at the end), `cathedral.png`
  (with the round Kaptol tower).

## Phase 2: streets (2026-09-28)

- `tool/src/ground.dart`: carriageways are every street centreline
  thickened to its width (`width`, else `lanes` x 3.3 m + parking, else a
  per-class default) and unioned with Clipper2, so junctions are single
  polygons. Tram corridors (3.2 m per track) join the road except inside
  pedestrian zones, where the rails lie flush in the paving.
- Surfaces: asphalt at terrain level; sidewalks, squares/pedestrian zones,
  park lawns and gravel park paths 15 cm up, with a kerb face along every
  road edge. Parks win over squares (Zrinjevac is tagged both).
- Tram rails: two 11 cm strips per track at standard gauge, on a separate
  `rails` material with `depthBias` 0.04 instead of a lift.
- UVs are world-planar relative to each chunk's origin, with periods (1, 2,
  2.5, 4 m) that divide the 200 m chunk.
- Trees: 3,549 (tagged trees plus tree rows every 8 m), one baked tree mesh
  in `assets/city/props.fscene`, one `InstancedMesh` per chunk.
- `generate_zagreb.dart --preview map.ppm` draws a 1 px = 1 m map with a
  100 m grid (red lines through the statue); the way to pick viewpoints.
- Look: exposure 0.26, IBL 0.5 (asphalt read almost white at 0.5/0.85).
- Slim_1: `zagreb.square` 38 colour draws / 164 total / 1.09 M vertices
  (instanced trees and the shadow cascades), `pipelineBuilds=0`.
  Screenshots: `artifacts/phase-2/square.png` (rails across the square),
  `zrinjevac.png`, `zrinjevac_north.png` (kerbs), `map.png`.

## Phase 3: the car (2026-09-28)

- `lib/drive/domain/car.dart`: a bicycle model at a fixed 1/120 s step on
  the ground height field (terrain + 15 cm kerb off the carriageway, from
  `assets/data/terrain.bin` and `roadmask.bin`). Engine pull falls off to a
  28 m/s top speed, the brake reverses at a standstill, the steering lock
  narrows with speed and a grip limit makes it understeer. The body keeps
  Sky Drop's sprung pitch/roll/heave (kerbs thump the suspension) and each
  wheel's travel, steer and spin.
- Collision: three circles along the body against the building footprints
  (`assets/data/collision.bin`, grouped per chunk). Head-on stops the car; a
  glancing hit swings the nose along the wall and scrapes speed off.
- `ChaseCamera`: lags the heading, eases position, pulls in at once when a
  ray from the car to the eye crosses a footprint, eases back out.
- Controls: steering stick (left), BRAKE/GAS pedals (right), WASD/arrows;
  a speedometer. Engine loop pitched by speed via audioplayers' low-latency
  (SoundPool) mode.
- Car Concept model (CC BY, `assets/ATTRIBUTION.md`): loaded in metres (no
  45.9x scale, that belonged to Doomscrool's import), turned to face +z,
  stood on its tyres from its bounds. Its 97 mesh nodes are merged per
  material into five rigid groups (body + four wheels): colour draws at the
  square went 152 -> 80. Shadows come from three proxy shapes.
- Tests: accelerate/brake/reverse, steering sense, stopping at a wall,
  sliding along one, 36,000 random steps across the real city never inside
  a footprint, terrain continuity across chunk borders, camera pull-in,
  controls, pedals and stick.
- Screenshots: `artifacts/phase-3/spawn.png`, `driving_hud.png` (75 km/h in
  a left turn, with the controls), `square_park.png`.

## Phase 4: Zagreb style kit (2026-09-28)

- 12 facade styles and 11 surfaces generated with the gen-image skill
  (`tool/gen_textures.sh`, prompts in the script; raws in `.art/gen/`):
  historicist (three), Secession floral and late, interwar, post-war,
  Upper Town Baroque, Biedermeier, arcade, commercial, courtyard; asphalt,
  sidewalk slabs, square stone, grass, gravel, granite kerb, clay/flat/copper
  roofs, cobbles, stucco.
- `tool/prepare_textures.py` cuts each facade into ground floor, first floor
  (piano nobile), repeating upper storey and cornice cells (bay period
  detected, rows read off ruler overlays into `tool/facade_overrides.json`),
  makes them seamless, levels the stucco and writes a tint mask in alpha.
  Outputs `assets/textures/facade_atlas.png` (2048^2, 8x8 cells) and
  `surface_atlas.png` (1024^2, 4x4), plus `data/facade_styles.json`.
- `assets/materials/city_atlas.fmat`: one lit material; UV1 = (tile,
  roughness), UV0 counts repeats, `fract` inside padded cells with
  `textureGrad` on the unwrapped UVs. Facades, roofs, ground and rails all
  use it (rails a depth-biased instance).
- Generator: each wall gets a whole number of bays (never a window cut at a
  corner) and rows from sidewalk to eave; street walls wear the building's
  style, courtyard walls the courtyard style, party walls and gables plain
  stucco. Style from `start_date`, levels, district (Gornji grad/Kaptol get
  Baroque/Biedermeier) and a hash of the OSM id; paint from a palette of
  Zagreb facade colours, roof tint per building. Churches are plain stone
  until their Phase 5 models. Gornji grad streets are cobbled.
- Texture memory: both atlases are cooked to supercompressed `.fstex` and
  transcode to ETC2 on Slim_1 (ASTC/BC in Chrome): 2048^2 + 1024^2 at 1 byte
  per texel with mips = 5.6 + 1.4 = 7.0 MB of GPU memory (28 MB if they had
  stayed RGBA8).
- Slim_1: `zagreb.square` 80 colour draws / 246 total / 2.8 M vertices,
  `pipelineBuilds=0` (the facade bands roughly doubled the vertex count).
  Screenshots: `artifacts/phase-4/square.png`, `ilica.png`, `overview.png`.
- **Web**: added the web platform. `flutter build web` succeeds (after the
  probe stopped naming the native-only `rawExtendedRgba128` format) and the
  release build renders the same scene in Chrome through flutter_scene's
  WebGL2 backend. See docs/decisions.md.

## Phase 5a: the real Trg bana Jelačića (2026-09-28)

The user asked for the actual buildings instead of generic ones, starting
with a small section, using Street View in their own Chrome and gen-image.

- 17 facades (20 walls) around the square, each photographed in Street
  View through the user's Chrome (official Jul 2024 panorama, a Sep 2022
  photosphere, one Aug 2011 capture), cropped, and redrawn by gen-image as a
  straight-on elevation with the counted bays and storeys: Gradska
  štedionica, Harmica, Kuća Rado, Kuća Popović, Kuća Stanković, Kuća
  Živković, Kuća Čuk, the Končar block, the Allianz corner, the interwar
  north-west corner and the rest. Each was checked against its photo; all
  17 kept (Kuća Čuk's yellow is a little more saturated than the real
  ochre).
- `tool/prepare_facades.py` packs them into `assets/textures/hero_atlas.png`
  (2048x4096, 512 px per facade height, gutters; half the height is free
  for the next section). The generator gives each hero wall one picture
  from the sidewalk to the eave and sets the eave to the picture's scale.
- Same draw as the kit facades: `zagreb.square` 80 colour draws / 246 total
  / 2.87 M vertices, `pipelineBuilds=0`. GPU memory +5.6 MB (ETC2 RGB)
  to +11.2 MB (ETC2 RGBA) with mips; the block format was not measured.
- Gates: all pass; `frame-shots` moved on `square` and `ilica` (the square
  is in Ilica's view), reviewed and re-baselined. Web release builds.
- Screenshots: `artifacts/phase-5/square.png`, `north_side.png`,
  `east_side.png`.
- Not yet: the statue, Manduševac and the other landmarks; roofs and
  gables above the hero walls are still generic; loading got slower on
  Slim_1 (the 8 M-texel atlas transcodes at start).

## Web 1: the three.js drive (2026-09-29)

`web3d/` (Vite + TypeScript + three.js r186 + Rapier 0.21). `cd web3d &&
npm install && npm run dev`, then http://localhost:5180/.

- Car: Rapier raycast vehicle + the three.js examples' Ferrari; keyboard,
  gamepad and touch; chase camera that pulls in at walls (Rapier ray).
- City: the core (591 buildings, hero facades) exported by
  `tool/export_web.dart`; on terrain from Copernicus GLO-30
  (`tool/prepare_terrain.py`, `data/terrain/`), with Medvednica on the
  horizon in a separate far pass.
- Props: 8 kiosks, 5 canopies, 2 tram platforms with shelters, 35 café
  terraces, 30 monuments (Ban Jelačić, Prizemljeno sunce, the Marian
  column, busts...), fountains (Manduševac, Gljiva), 95 street lamps.
- 11 ZET trams on the real tracks, articulated, stopping for the car.
- Look: physical sky + IBL, sun shadows following the car, GTAO, ACES.
- Checks: `node tools/sim.ts` (16 physics checks), `npm run build`,
  `node tools/shot.mjs` (headless Chrome screenshots over CDP).

## Web 2: real facades only, roofs, features, Flutter removed (2026-09-29)

- Walls without a Street View facade are plain stucco;
  `data/hero/coverage.json` tracks 20 of 859 street walls done.
- The 17 square facades redrawn faithfully (every sign kept), atlas at
  768 px per facade height.
- Roof set of eight coverings with real repeat sizes and weathering; roofs
  slope down to every street wall (no more vertical "gables" over fronts).
- `data/buildings.json`: per-building roof/tag overrides and 3D features
  (first one: the Allianz rooftop sign); `zg.lookAtWall`.
- The `recreate-building` skill.
- The Flutter app removed from `main` (archived on `flutter-archive`); the
  pipeline is a plain Dart CLI.
