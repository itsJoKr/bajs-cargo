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

## Hero atlas pages and ring 1 (2026-09-29)

**Pages.** `prepare_facades.py pack` writes `hero_atlas_<n>.png` (<= 4096x4096,
5 shelves of 768 px per page) and a `page` per facade in `atlas.json`; the
exporter writes UV1.x = -1 - page and `heroPages` in `city.json`; the web
material takes one sampler per page (`web3d/src/city.ts`); `sync-assets.mjs`
copies all pages. With the 17 old facades alone the export was byte-identical
(`zagreb.glb`) to the pre-split one. Tested multi-page for real: forced
`HERO_PAGE_H=1600` (3 pages) and, with the 4 new facades, 2 pages
(3880 + 776 px): all facades render right.

**New facades (4, coverage 20 -> 24 of 859 walls, 534 of 12548 m):**
`feller_stern_south` (Jurišićeva side of Kuća Feller-Stern, awnings as
features, roof flat), `varteks_pink_red` (the Müller / Varteks front on the
square, Aug 2011 imagery, roof slate), `praska_portico` and
`praska_generalturist` (the two east-side walls of Praška, made with the new
rectifier). Reviewed by sub-agents (all keep).

**New tools:** `tool/sv_rectify.py` (several frames from one panorama ->
straight-on elevation, exact rotation model), `sv_shots.py`,
`sv_street_url.py`, `sv_url.py`, `sv_url_batch.py`; `prepare_facades.py`
accepts `"photo"` in an entry; `sv_project.py` camera model corrected (URL `y`
is the vertical fov). See the skill, section 2b.

**Not done / skipped, and why** (most of the listed "todo" sides of the
17 hero buildings face courtyards, passages or scaffolding, not streets):
`w105486195_e6`, `w105487407_e4`, `w584464569_e2`: Maps snaps to indoor
photospheres (toilet, dentist, club), no street panorama sees them.
Praška west side (`w97235397_e1/e2`, Kuća Shell, `r20144619`): scaffolding
with an A1 banner, and a mirror-glass hotel front. Jurišićeva (Stern, Spitzer,
Berić, HPB) and Ilica (Nama, w97089771...): the only pano is on the pavement
1-3 m from the wall. Not started: Bakačeva/Dolac, most of Ilica.

### Ring 1 continuation (same day): coverage 24 -> 73 of 859 walls (1360 of 12548 m)

62 hero facades on 3 atlas pages. Real Street View facades (oblique frames
montaged or rectified): Praška west (salmon house x2, MET hotel glass front,
Shell house), Jurišićeva (Palača Stern, HPB), Petrinjska (SOL / Tori Kaya row,
HPB side), Ilica (Nama, passage house, two south-side houses, Neboder, brown
houses), Bakačeva (gallery row, Kuća Folnegović, flags palace), Varteks east
side (Dec 2016 night frame). Invented (no usable view, style taken from the
building's known front or a neighbour, no signs): 23 back / side walls of the
square's corner buildings, Jurišićeva (Spitzer, Berić), Petrinjska, Bakačeva,
Dolac. Sub-agent review found invented text, missing storeys and leaked map pins
in 7 facades: regenerated with corrections; `ilica_neboder` still has a white
gap above its lower block. Roofs set in `data/buildings.json` for the new
buildings (from aerial view / impression); features (signs, awnings) only for
Feller-Stern. Not done: Dolac, most of Ilica west, Jurišićeva east.

Follow-up: `ilica_neboder`'s white gap above the lower block was filled with
the block's render colour (`raw.png` edited; original kept as `raw_original.png`,
regenerating overwrites the fix). Features added: awnings (Stern Rodea x2,
Bakačeva gallery x2 and Folnegović, Petrinjska Tori Kaya, Shell house x6), the
HPB Petrinjska terrace, and a 3D `nama` sign on the Nama store (a duplicate
over the passage was dropped: the redrawn texture already carries it).

### Ilica west (2026-09-29, later): coverage 73 -> 87 of 859 walls (1577 of 12548 m)

75 facades on 4 atlas pages. Real (montaged oblique frames from the official
Jul 2024 pano `tp5IPl...` at 45.813107,15.9740467 and `U2I_tl...` at
45.8131589,15.9734526): Ilica 12 / Prahir, the Mode row, the long south
building (Jo Malone, Pandora, Optotim, canopy left out), Ilica 11 (Calliope,
farmacia), the Franchi house, the Terranova block. Invented: 7 walls (side and
back walls of small Ilica houses). Not reviewed by sub-agents yet; roofs set
from impression. The south side has a long steel canopy across the
pavement that hides the ground floors from most frames.

Ilica west features: projecting `foto_copy.png` blade sign (Ilica 12), green
`pharmacy_cross.png` (farmacia, Ilica 11), and the 3 m steel canopy over the
south pavement (`r1397601_e2`, dark awning at 3.4 m). Other shop signs stay in
the wall textures. From the north wall the canopy hides the ground floor: as in
the real street.

### Ilica 1 Neboder, all sides (2026-09-29)

The Neboder was one 70 m OSM box with a 2:3 picture squeezed onto 13.5 x 64 m
(162 x 768 px in the atlas) and plain grey sides. Now two volumes: the OSM
outline is the ~8-level beige podium (30.6 m) with the real front picture at
its true aspect (glass column, Mocca Pizza, the cross portal), and a new
hand-made part `w9000000001` (`buildings.json` `part` polygon, see
`OsmData._addParts`) is the 68 m tower over the EAST half of the front (looking
south, east is on the left: the photo's glass column). Tower walls: procedural
dark glass curtain wall (`tool/make_glass_tower.py`, 40 px/m, storey bands,
lit panes); podium west/south/east walls: beige render with white-framed
windows. No gen-image and no sub-agent review: procedural. The tower's depth
(26 m) and width (6.4 m) are estimated from the satellite view and photos.

### Bogovićeva, both sides (2026-09-29): coverage 90 -> 106 of 860 walls (1864 of 12554 m)

98 facades on 5 atlas pages. Real (Jul 2025 official panos `bXPC2z...` at
45.8122507,15.9756242 and `qUyXcb...` at 45.8122318,15.9761503, plus the Aug
2019 photosphere `CIHM0og...Ua`): yellow neo-baroque palace and the beige
1960s block (south, rectified), the SW palace (south, w435116999), the Q Store /
Zlatarna block (north, `w375381009`, front and lane side), the Bulldog corner
building (`w290551252`, front and lane side), the two north blocks at the east
end (`w375381008` partly invented, `w375375951`), the round-cornered Napretkova
zadruga and the scaffolded Adidas building (drawn with its scaffold: no clean
view exists). Invented (style guide from the building's own front): the passage
sides of Napretkova, Adidas, `w375375951`, and two lane walls (`w375381223_e7`,
`w375381224_e9`). Features: café terraces (beige block, Bulldog), 3D scaffold
on Adidas; roofs set for all. Not done: `w579294793_e2` (closing west wall),
tiny walls < 7 m, the cross lane north of Bogovićeva beyond Bulldog/Q Store.
Not reviewed by sub-agents (I compared each raw to its photo myself).
The street is 14 m wide and 7-storey walls 25 m tall: only a pano on the
opposite pavement sees a north wall, and there is none, so the north side comes
from oblique frames straightened by gen-image. Dolac / Pod zidom (north of the
square) was scouted and skipped: 2011 imagery, parked cars, sharp angles.

### Cut and curved corners (2026-09-29): 9 corner faces redone

OSM draws a chamfered / rounded corner as several SHORT edges (< 4 m are skipped
by `list_hero_facades`), and I had photographed only the long walls on either
side, so every corner rendered as a plain grey face (Bulldog, both faces of HPB
at Jurišićeva / Petrinjska, ...). Found them with a scan of every hero
building's ring (uncovered edges next to a covered one), then added
`data/hero/corners.json`: one facade per corner cluster (`corner_bulldog`,
`corner_hpb`, `corner_praska`, `corner_napretkova` (5 edges of the round tower),
`corner_n951`, `corner_koncar` (4 edges), `corner_ilica_s`, `corner_inv_a`,
`corner_inv_b`). A `"corner": "<what it looks like>"` entry makes
`prepare_facades.py` draw a normal 2:3 elevation with the corner in the middle and
the neighbouring faces flowing either side, then pack only the centre slice at the
corner's true width. Photos: HPB and Napretkova Jul 2025, Bulldog Aug 2019, Praška
and Končar Aug 2011; `corner_n951`, `corner_ilica_s` and the two `inv` ones are
invented from the neighbouring wall. The Bulldog front and lane pictures were
redrawn as flat faces (they had drawn the corner and its sign too).
Not done: small bevels under ~2 m, and rear / courtyard corners.

### Loose café furniture (2026-09-29)

Café tables, chairs and parasols are physics bodies: the car sends them flying
and keeps its speed (`web3d/src/furniture.ts`; 375 tables, 1500 bodies). Lamps,
kiosks, shelters, statues and benches stay fixed. `tools/sim.ts` has 4 new checks
(20 in all): furniture stands still when woken, a 70 km/h car scatters a table
(every piece rises past 0.8 m and lands 20+ m away), the car keeps its speed, a
table beside the road stays put. `zg.furniture.reset()` puts everything back.

Performance pass: box colliders only, launched pieces ignore other furniture, and
past 4 flying a hit piece may vanish (30%; all past 24). 60 launched pieces cost
~1 ms a step instead of ~17. Two new sim checks (22): a row of ten terraces thins
out (16 of 40 vanished, at most 24 flying, the car keeps accelerating) and reset
brings every piece back.


### Stepped terrace on Trg bana Jelačića (2026-09-29)

The north frontage (Harmica to the Gradska štedionica end) stands two steps
(0.18 m each, 0.36 m in all) above the square, with the planter strips on the
top level, as in Street View (Oct 2020). `data/raised.json` lists nested
terrace levels; `tool/src/ground.dart` cuts them from the carriageways, fills
the treads and inclines the risers (`run` 0.4 m) so the Ferrari can climb them.
Lamps, café tables and facade bases follow via `Ground.liftAt`.

## Preradovićeva ulica (Cvjetni trg to Berislavićeva), both sides

- 41 street walls on 21 buildings listed (`.art/streetview/prad_todo.json`). The street
  is pedestrian, so the map snap kept landing on indoor photospheres; four official
  panos were usable (see `.art/streetview/prad/panos.txt`): 3 Preradovićeva (Jul 2025),
  7 Preradovićeva at Nikole Tesle (Mar 2023), 14 Preradovićeva (Mar 2023), and the
  south end (Jul 2024). Eight headings per pano.
- Walls seen squarely were rectified with `tool/prad_rect.py` (hand-picked frames per
  wall; letting `sv_rectify.py` choose from all frames gave smears) and redrawn:
  Burgeraj house, Karlovačka banka house (east and south fronts), Martin Arbanas
  house, the ovals house, Alcatraz bay house, the yellow Secession row, the cream
  neo-baroque palace, the KIC klub / library front, the palace at the Tesle crossing,
  plus the rounded stone corner (5 short edges) in `data/hero/corners.json`.
- Walls with no view (Ilica end, south-east row, Tesle sides) were invented from their
  neighbours and are marked "INVENTED" in their `source`.
- `data/hero/prad.json`; real facades 107 -> see the export line for the current count.
- Preradovićeva 3D touches (`data/buildings.json`): scaffolding on the salmon house,
  two awnings on Martin Arbanas, cone turrets on the Tesle corner palace and the
  Berislavićeva corner house, an Alcatraz terrace, roof coverings on four houses,
  projecting cornices on the cream palace and Burgeraj house, four balcony slabs on the
  yellow house. Multi-street plan: `docs/multi-street-prompt.md`.

## Gajeva, Petrinjska, Tkalčićeva (2026-09-29, three parallel workers)

- Feature textures: `awning`, `box`, `dome` (cap) and `scaffolding` (net) take `texture`
  (`web3d/public/features/tex/`) and `repeat` (m per tile); tiling is baked into the UVs.
- Real facades 135 -> 177 of 860 street walls (2403 -> 3074 m); 171 facades on 8 atlas pages.
- Petrinjska 20 facades + the art'otel corner (19 of 22 walls; skola 62.6 m stitched from two
  panos), Gajeva 9 facades (~207 of 465 m), Tkalčićeva 8 facades (~87 of 636 m: no official pano
  between z 140 and 235 or north of 288). Rest stays plain, listed in `data/hero/coverage.json`.
- 3D touches in `data/buildings.json` (merged from `data/patches/<slug>_buildings.json`):
  Petrinjska 30 features, Gajeva 25, Tkalčićeva 11, each with its own gen-image texture
  (`<slug>_*.jpg`) and blade signs; one roof covering per building (many guessed).
- Storeys in `petrinjska.json` are the worker's counts, some above the OSM eave: cornices are
  anchored with `aboveEave`, not `y`.

### Round 2 (Gajeva, Tkalčićeva; Maps place photos, then invented)

- Real facades 177 -> 221 of 860 (3742 of 12554 m); 214 facades on 10 atlas pages; 118 features.
- Gajeva +15 facades (`gajeva_b_*`, ~255 m): most from the same blurry grazing frames (used as
  colour/rhythm reference, crisp redraws), three INVENTED (uriho_s, boban_s, courtyard wall),
  Hotel Dubrovnik front (46 m) with a `znanje` sign. One 4.4 m kiosk wall plain.
- Tkalčićeva +28 facades (`tkalciceva_b_*`, all 29 walls >= 8 m): 6 real (~92 m: photospheres,
  official panos rectified), 22 INVENTED (~370 m, neighbour-style, flat colour swatch as `photo`).
  27 walls < 8 m (mostly chamfers) stay plain. Google Maps place photos gave almost nothing
  usable on either street.

### Round 3: six streets nearest the centre (Pod zidom, Kaptol, Nikole Tesle, Pavla Radića, Skalinska, Stube)

- Real facades 221 -> 348 of 860 street walls (3742 -> 5736 m); 328 facades; 138 features.
- Pavla Radića 31 facades (23 from Street View crops, 8 invented), Nikole Tesle 18 (15 Street View,
  many only 30-70 % covered so the rest is redrawn as grey = unknown, 3 invented), Kaptol 26 (6 real,
  20 invented: Dolac market walls, canonry interiors), Pod zidom 16 (4 real, 12 invented), Skalinska
  15 and Stube 8 (all invented: no official Street View on either).
- The atlas hit 17 pages (16 fragment texture units: "texture image units count exceeds
  MAX_TEXTURE_IMAGE_UNITS" and no city). `tool/prepare_facades.py pack` now takes `HERO_ROW`
  (px per facade height, default 768): packed with `HERO_ROW=576` = 10 pages (~30 px/m). Pack with
  the same value every time until the hero atlas moves to a texture array.

### Filler pass (all nine streets)

- `data/hero/fill.json` (generated by `.art/streetview/fill/mk_fill.py`): 74 remaining plain walls >= 4 m
  on Gajeva, Petrinjska, Tkalčićeva, Pod zidom, Kaptol, Nikole Tesle, Pavla Radića, Skalinska, Stube get
  a crop of the nearest finished facade with the same storeys (invented ones preferred: no lettering),
  marked "INVENTED filler" in `source`. Real facades 348 -> 419 of 860 (6159 m), still 10 atlas pages.
- Left plain: `r10165667_e13/e14/e15` (Skalinska, inner-ring edges: `spansFor` wraps by the outer ring
  length so an edge past it paints e0), and every wall < 4 m.

### Round 4: six more streets + KTX2 hero atlas

- Trg Nikole Zrinskog, Vlaška, Berislavićeva, Jurišićeva (east), Milana Amruša, Opatovina (workers, then
  fillers for walls < 8 m). Real facades 419 -> 565 of 860 (8471 of 12554 m), 533 facades, 193 features.
  Amruša 16 buildings from Street View (partial), Berislavićeva 12 real / 9 invented, Jurišićeva 8 real +
  Pošta (weak) + 2 invented, Zrinski 5 real / 8 invented, Vlaška 1 real / 19 invented, Opatovina all invented.
- The hero atlas is now block-compressed KTX2 pages (`assets/textures/hero_atlas_<n>.ktx2`, ETC1S, 83 MB for 25
  pages) merged into one array texture at load: no 16-texture-unit limit, ~1 byte a pixel on the GPU, `HERO_ROW`
  back to 768. `pack` is incremental (stable placement + per-page encode cache): ~1 min per changed facade.
- `tool/sv_rectify.py` ignores invalid pixels (no more grazing streaks).
- `data/hero/fill.json` (`.art/streetview/fill/mk_fill.py`) fills the remaining walls >= 4 m on all 15 streets.
