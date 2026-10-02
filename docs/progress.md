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

Correction (2026-09-30): the tower is the WHOLE outline (13.4 m on Ilica, 26 m
deep, 18 storeys, 67.6 m), measured by projecting the outline through Google 3D
views from the north and west and a Street View pano on Ilica. The beige
block with the cross portal and Mocca Pizza is the neighbour w375381225 (1932),
not a podium: the 6.4 m part `w9000000001` and the beige `podium_*` pictures are
gone. All four faces are the procedural curtain wall; the Ilica face keeps the
real glazed lobby and mezzanine cut from the old montage (`tower_n`); the other
three sides are `res` 0.25. A pale roof box stands for the plant rooms. Left:
w375381225's Ilica front still carries the historicist `allianz_white_corner`
picture (5 storeys); the real front is the beige 7-8 storey block.

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

### Cutting the map (2026-09-30)

- South cut at z = -300 (tool frame; Zrinjevac's far end): 552 buildings instead of 592, 8 feature walls skipped.
- The Gornji Grad hill (x < -140, z > 60; 125 walls, all plain) is now `blockedAreas`: visible plain scenery,
  fenced off for the car (ray-tested), left out of the coverage work list. East and south-west edges kept:
  they hold generated facades.
- Coverage now 537 of 714 street walls (8007 of 10519 m).

### Round 5: Đorđićeva, Palmotićeva, Masarykova + city-wide filler

- Đorđićeva 16 facades (15 real, 1 invented), Palmotićeva 9 (mostly real, 1 partly invented), Masarykova 9
  (8 real, 1 invented). Every remaining street wall >= 4 m in the drivable area got a neighbour-crop filler
  (`data/hero/fill.json`, 232 walls, 2438 m; `.art/streetview/fill/mk_fill.py` is now incremental and city-wide).
- Coverage 710 of 714 street walls (10492 of 10519 m). Left plain: `r10165667_e13/e14/e15` and
  `r20144619_e8` (inner-ring edges: `spansFor` cannot paint them).

### Dolac on its plateau (2026-09-30)

- `data/levels.json` + `tool/src/levels.dart`: hand-shaped ground where the 30 m terrain grid smeared real
  steps into a slope. Dolac's upper market is flat at 7.3 m (Pod zidom ~2.2), Kerempuh square and Opatovina
  at 9.1 m up to z = 300, ramps blend Skalinska down towards Tkalčićeva, Opatovina's north end and the
  square's east arm into the Kaptol lane. Retaining walls wherever the ground jumps, a parapet along
  Kerempuh's edge over Dolac.
- Four stairways: west (by Kumica Barica) and east from Pod zidom, the two wooden flights up to Opatovina and
  Kerempuh. Drawn as steps (`steps` meshes, no collider) over a straight invisible ramp (`ramp` meshes,
  collider only); the car drives up and down all four.
- The market hall (OSM `layer=-1`) is no longer extruded over the plateau (underground buildings are
  skipped); the roof-only part over the passage to the wooden steps is a canopy on posts.
- 152 market stalls (`data/markets.json`), 64 under red umbrellas: loose trestle tables the car scatters
  like the café furniture (`stall` kind in `furniture.ts`, city.json `stalls`).
- Round 2: the two market pavilions at Dolac's north end are single storey (hero eave from `storeys: 1`), one
  gen-image facade from Street View (`data/hero/dolac.json`, `dolac_pavilion`) reused on all four walls of both,
  with the overhanging roof slab as box features. St Mary's bell tower (OSM `man_made=tower` w735337369, now a
  `building:part=tower` via data/buildings.json): a procedural shaft picture on all four sides
  (`tool/make_dolac_tower.py`, 9 storeys, ~34 m) under two stacked onion domes and a spire (dome features, new
  `drumColor`). Level walls are two-sided: the see-through slits beside the wooden steps were back faces.

### The Bajs cargo bike (2026-09-30)

- B swaps the Ferrari for the Bajs e-cargo bike (and back) where you are; `?ride=bike` starts on it,
  `zg.ride('bike')` from scripts. Black tub with the white "zBajsom na špicu" panel, Grad Zagreb crest and
  "Bajs powered by nextbike" tag on both sides, DOLLY moulded below, 20" front / 26" rear wheels with discs,
  mid motor, frame number 87155, a briefcase in the box. The rider (suit, white shirt, burgundy tie) pedals
  with IK legs, holds the steering bars, leans the bike into turns and puts a foot down when stopped.
- Handling from the car: steering lock narrowing with speed, S brakes then backs up, Space locks the rear
  wheel into a skid. W holds the e-assist; tapping W fast pedals harder (HUD bar shows the cadence).
- `tools/sim.ts` gained 6 bike checks (hold vs tap to 25 km/h, full lock stays up, skid, kerb, 12% ramp hold).
- Round 2: the bike replaces the car as the default ride (`?ride=car` / B for the Ferrari). gen-image
  textures on the box, frame, tyres, suit and coat; the rider rebuilt smooth (`rider.ts`) in a camel
  overcoat, pinstripe trousers, gloves and black oxfords. Top speed 33 km/h holding, tapping past it to
  ~44 km/h; sim checks now 29 (tapping pushes past the held top speed, full lock at 40 km/h stays up).
- Round 3: 3D hair (combed locks from a side part, a quiff, sideburns) with a small gen-image hair texture;
  tapping W now pushes the bike to ~67-72 km/h (holding: ~33 km/h).
- Round 4: bike tops out at 68 km/h holding W and ~100 km/h tapping, with much quicker acceleration;
  "Press R to reset" appears on screen when the bike or car ends up on its side or roof.
- Round 5: fixed the unrecoverable slide at high speed (traction control, rider balance assist, grippier tyres,
  softer suspension, lower centre of mass); it also flips far less. 30 sim checks.

## Trg bana Jelačića, the main square (2026-09-30)

- **Life:** ~260 pedestrians (one instanced mesh, walk cycle in the vertex shader, ~700 triangles each) walking
  a 1 m grid of open ground (`city.json` `walk`), in pairs, stopping to talk, getting out of the way of the bike,
  car and trams; ~250 café guests sitting on the terrace chairs (they stand up when the chair is knocked);
  84 pigeons in flocks of 5-10 that peck, and burst into the air when the bike comes or a walker passes.
- **Walls:** `tool/plain_scan.py` ray-casts through the rendered meshes from a grid over the square and matches
  hits on plain stucco to OSM edges: 3499 plain hits down to 371 (3 walls, one hit each). 230 walls got a picture
  (`data/hero/firewall.json`): weathered plaster with rain streaks, ghosts of bricked-up windows, a downpipe for party
  walls; a strip of the building's own facade for the short edges of rounded corners (Kuća Popović's tower now
  has its balconies all round). Atlas: 36 pages, 118 MB.
- **Street Furniture (Street View survey, `.art/streetview/square2/survey.md`, 52 measured items):**
  8 white candelabra on granite blocks + 15 smaller ornate lamps, 4 flagpoles with waving flags, 4 Litfass ad
  columns with posters, the four-face square clock, LED info posts and backlit poster cases at the stops, 33 bins,
  Manduševac as a stepped oval basin with a ring of chain posts, planter troughs with hedge and geraniums, kiosk
  banners, a signpost, an info board, a Panorama cart (`data/props.json`, `web3d/src/squareprops.ts`).
- **Tram zone:** dark setts and clinker across the square (`Surface.setts`, `Surface.clinker`), open glass canopies
  at the stops, dark-green newsstands; overhead line: 3.7 km of contact wire, 31 masts, span wires with hanging
  globes and speed plates (`web3d/src/catenary.ts`). Statue pedestal in dark granite with bronze plaques; the
  Neboder glass steel-blue (Street View), not black.
- **Also:** loading bar; `zg.pick`, `zg.plainHits`, `zg.wallHits` debug rays; `tool/export_locked.sh`.
- **Left:** the A1 scaffold banner and roof letters, red-parasol terrace colours, paving slab bands, road-name
  decals on the setts, masts' stickers, faces (people are blank-faced at arm's length).

## Zagreb Cathedral and Kaptol square (2026-09-30)

- **Cathedral rebuilt by hand** (`web3d/src/cathedral.ts`): the OSM outline and its 31 floating parts are left out
  (`omit`); the model follows the OSM plan and a rectified Street View front (Jul 2024): front block with its gallery
  at 37.4 m, the portal porch 2.7 m proud, the gable to 47.5 m, square towers to 62 m with corner pinnacles, gablets
  and see-through octagonal spires to 105 m (as before 2020; in 2024 both tops are in scaffolding), the hall with a
  single steep copper-green roof, bay gables, buttresses with pinnacles, the chancel and apse, the sacristy.
- **Textures** (`tool/make_cathedral.py`): the front is a gen-image redrawing of the rectified photo (scaffolding and
  the site clutter removed), sharp only in its lower 20 m; the upper front, the tower stages (belfry and clock, redrawn
  from the 2024 tarps and a 2018 photosphere) and the spires are ~3.5 px/m; the fenced sides and apse ~3 px/m.
- **Fences** (`data/fences.json`, `web3d/src/fences.ts`): mesh site panels between the north tower and the Kaptol
  wall, a white tarp fence between the south tower and the palace; the bike and car stop at them.
- **Round towers and walls:** Domitrovićeva kula (rubble stone, now taller than the wall, red cone), the Kaptol wall,
  Kula Nebojan (white plaster over a stone plinth, red cone; palace roof now hipped), the Stepinac museum's two fronts,
  the palace nook, and the round tower behind the wall (dark pyramid). 11 new hero pictures (`data/hero/kaptol_trg.json`),
  the fenced-off wall at 1/10 resolution (`res` lanes in the atlas packer). Atlas: 36 pages.
- **Left:** the museum's green copper roof (it shares the palace roof), the lean-to by the north fence (plain), the
  palace's courtyard walls behind the fence.

## Passages: Marićev prolaz and the Oktogon (2026-09-30)

- **Marićev prolaz** (Gajeva 5 to Praška 6, 80 m): travertine walls with posters and graffiti, a dark ceiling with
  fluorescent strips, a terrazzo floor with its black grid. Gajeva's filler facade was replaced by a real one from the
  user's photo (`gajeva_maricev`, doorway with the MARIĆEV PROLAZ letters; a lintel painted in at 3.6 m); on Praška the
  real box sign (cropped from the user's photo) hangs over the doorway on the 5 m wall south of Kuća Shell's front.
- **Oktogon** (Ilica 3 to the corner of Bogovićeva and Margaretska, 98 m): the doorway under Ilica 3's painted carriage
  arch, a glass-vaulted arcade with shop fronts and lanterns, the eight-sided hall (6.1 m apothem, 10.5 m to the dome)
  with arched shop windows, sconces and the stained-glass dome, and the second arm out through an invented corner turret
  facade (`oktogon_corner`, replacing a filler and the plain 2.7 m face beside it).
- The crowd may walk through both (walk grid), and the HUD names them.
- **Kuća Popović** (Trg bana Jelačića / Splavnica corner, `w288838575`): the front picture had the round corner tower
  painted flat on it, and the tower's nine short curved edges carried strips of it (the tower repeated round the
  corner). Now three pictures: `kuca_popovic_front` (e17-e18, the old redraw with the tower cut off),
  `kuca_popovic_tower` (e8-e16, the tower unrolled: shoe shop, curved balconies, reliefs, curved top window band) and
  `popovic_splavnica` (e7, rectified from the Jul 2025 Splavnica pano, replacing the invented side).

## Delivery game (2026-09-30)

Package jobs: `web3d/src/deliveries.ts`, HUD `#job`, `data/deliveries.json` (134 businesses: every name lettered on a
hero facade plus Calliope, Farmacia, Müller, Oktogon, Cathedral, Nadbiskupija, Mondiš). Pale yellow pads sit on the
floor at each entrance, the current job's pulses; the business name shows at once and its street after 5 s. Doors were
measured on the facade pictures (`.art/facades/*/raw.png`) by parallel workers and spot-checked in the game; ten
entries are guesses (see `docs/MISSING_BUSINESSES.md`).

## Last plain walls near the square (2026-09-30)

- The 10 street walls left in `coverage.json` todo, and every plain street edge under 4 m within 160 m of the statue
  (21 corner pieces round Dolac, Kaptol, Tkalčićeva and the Stube), got pictures through `tool/make_firewalls.py`
  (`WALLS=` list, 31 `fw_` entries): strips of the same building's facade (its real picture, else its filler; the
  small blocks on the Dolac plateau take their neighbour's filler), the Dolac market hall's plateau side a strip of its
  invented Pod zidom front, and Kuća Miletić's 8 x 4 m courtyard weathered plaster.
- Three of the ten were courtyard edges of multipolygon inner rings, which could not take a picture: `spansFor`
  (tool/src/hero.dart) now wraps a picture's chain within its own ring. The export was byte-identical before any new
  picture (cmp).
- `list_hero_facades.dart --min <m>` lists short walls too.

## Serbian Orthodox cathedral and the Kaptol outer walls (2026-09-30)

- **Saborna crkva Preobraženja Gospodnjeg** (Trg Petra Preradovića, `w97165324`): real pictures for the south front (four Street View
  frames of Jul 2025 rectified with `sv_rectify.py`), the west front (Jun 2018 photosphere crop), the mirrored north side and the
  invented apse (`data/hero/church.json`); copper-green gabled roof, a half-cone over the apse (`dome` feature, `church_roof.jpg`),
  a belfry part `w9000000010` (hand-drawn picture, turquoise cone). The old `fill_` pictures on its three walls were removed
  (a filler wins over a real picture on the same edge).
- **Kaptol outer walls** (`data/hero/cathwalls.json`, 26 pictures): the palace's south front, pavilion and east range, the two
  round towers, the glasshouse and the north-east rubble wall, redrawn from Google Maps 3D views (no street-level imagery on the
  south side); faces inside the fence are `res` 0.25 / 0.1. Packed with `HERO_DEV=1` (scratch pages): run a normal `pack` once.
- **Left:** 1.5-2 m jog walls on the palace (`e52`, `e54`...) are still plain: `make_firewalls.py` after a `--dump-walls` export.

## The roads round the Cathedral walls, Ribnjak, the rear entrance (2026-09-30)

- **Open**: the roadblock fence on Kaptol north of the Cathedral is gone. The private service roads (OSM `access=no/private`) run
  from the Kaptol roundabout along the outside of the north wall (gate by Domitrovićeva kula, `data/gates.json`), through the
  fringe of Ribnjak park, round the east side and down to Ulica Jurja Branjuga; a second gate stands between the south-east
  tower and the glasshouse. Gates are open iron leaves on stone posts (`web3d/src/gates.ts`, colliders). Both ends drive through.
- **Ribnjak hollow**: new level kind `dip` in `data/levels.json` (`tool/src/levels.dart`): the park sinks 3.4 m (west) to 2.0 m
  (east) under the terrace and eases out over 20 m, so the wall, the path and the precinct stand above the lawns as in Google Maps
  3D. The bare terrain grid sinks with it (`city.json` `dips`, `sinkGrid` in `terrain.ts`). Low-res garden walls `kwall_ne_1/2` now full-res.
- **Delivery** `nadbiskupija_straznji_ulaz` (Nadbiskupija – stražnji ulaz): the pad is at the palace's rear door on the east front
  (a door drawn with `box` features on `w101185039_e53`), 280 m from the square by the north road.

### The big south gate, its walls, back walls on the private road (2026-10-01)

- **Big gate** at the start of the private road by the Pod zidom roundabout (`data/gates.json`, first entry): wrought-iron double gate
  (arched leaves, open) between cream posts with lanterns, a narrow open people's gate beside it, from the user's Street View frame and the
  Apr 2019 photosphere. Beside it a **rubble garden wall** (east, along the forecourt edge to the Vlaška houses) and a **white plaster
  wall** with coping (west, round the lawn along Ulica Tome Bakača): `walls` in gates.json -> city.json `stoneWalls`, procedural canvas
  textures in `web3d/src/gates.ts`. The inner gate near the south-east tower stays. A pure-pursuit bike drive (see the rules file) rode the south gate -> south road -> east gate -> east and north roads to the Kaptol end.
- **Back walls**: `data/rear_walls.json` (17 courtyard + 5 party walls of the Vlaška block, found with `PTS=... tool/plain_scan.py` from
  points along the private road) wear a seamless weathered-plaster tile, no windows (facade-atlas tile 49, made by
  `tool/prepare_textures.py --plaster-only`, ~75 px/m, 3 m a tile; `rearWalls` in `tool/src/buildings.dart`); the gable above takes the
  same tile. (A first version used the courtyard style's window rows; the user wanted plain wall.)
- **Walls joined** (2026-10-01, later): the west wall now runs straight from the gate to Kula Nebojan and ends inside its wall (the lawn
  with the flower bed stays outside), also in rubble; the east wall ends inside the corner of the Lacković-Žigrović house. Walls are one
  mitred ribbon (`wallGeometry` in `gates.ts`, buried 0.8 m, colliders overlap), so no gap opens at a bend or between pieces.

### Ulica Augusta Cesarca: the EU garden, the toilet stairwell and Ban centar (2026-10-01)

- **Ban centar** (OSM `w101186069`, the white concrete-and-glass "EU building" on Europski trg / Cesarca / Kurelčeva, 27 m): its four
  street walls (`e16`..`e19`) were invented fillers; `tool/make_ban_centar.py` now draws them (pale concrete frame, 3.45 m bays of tinted
  windows, glazed ground floor, recessed glazed top storey; `data/hero/bancentar.json`, filler entries removed from `fill.json`), flat
  gravel roof in `data/buildings.json`. Source: Google 3D, 2026-10-01. Packed with `HERO_DEV=1` (scratch pages): fold in with a normal `pack`.
- **Park međunarodnog priznanja Republike Hrvatske** (the lawn behind the Maketa grada Zagreba): `data/park.json` (extra `trees` behind the
  maketa, `props`) -> `web3d/src/parkprops.ts`: `eu_garden` (ring of twelve stars on a draped disc, two glass skylights, two plaques) and
  `wc_stairs` (closed underground toilet: a real pit from the two `WC stairwell` regions of `data/levels.json`, stepped concrete over the
  levels' ramp, landing with a WC door, railings, a gate with "ZATVORENO" and tape, the teal glass-and-steel lift; all solid: a bike ride
  at it stops at the lift / rails).

## Hotel Dubrovnik car park (Praška ulica 6)

- The lot behind the Praška frontage (OSM way 105489677) was a paved sliver with a looping service road and plain walls. Now: asphalt
  laid by hand to the walls (`data/park.json` `asphalt`, read by `tool/src/ground.dart`), bay markings, 28 parked cars with colliders
  and the blue "P" sign (`web3d/src/parking.ts`, item `parking_lot` in park.json), 28 low-res INVENTED courtyard-plaster walls
  (`tool/make_parking_walls.py` -> `data/hero/parking.json`, `res` 0.25 facing the lot, 0.1 beyond) and the delivery
  "Parking Hotel Dubrovnik", Praška ulica 6 (`parking_dubrovnik`). The layout (rows A / B1+B2 / C, ~44 bays) is estimated from the
  Google 3D aerial, not measured. Packed with `HERO_DEV=1`: run a normal `pack` once to fold the scratch pages in.
- East side closed (2026-10-01): OSM left a 4 m gap between the Praška corner building (`w105489667`) and the low courtyard
  building `w1134673365`, and a 2 m slot between that and Palača Buratti, both leading deep into the courtyards behind; there is
  no passage in reality. `w1134673365` is enlarged by a new `outline` entry in `data/buildings.json` (replaces the OSM ring,
  `tool/src/osm.dart`): its lot face now runs from one neighbour's corner to the other's (16 m, both ends 0.2 m inside them).
  Its pictures were redrawn at the new widths (`make_parking_walls.py`, edges renumbered: lot face `e8`), `HERO_DEV=1` pack.
  Rays at 0.35/1/2 m across both old openings all stop within 4 m; the bike ridden at them stops at the wall.

## Kaptol south (Vrutak wing) and the Addiko colonnade (2026-10-01)

- **Vrutak gateway** (fixed 2026-10-01, later): the round-arched gateway now fills the 4.4 m gap between the striped canonry house
  (`w138251852`) and the low Vrutak building (`w735337395`), as in the user's photo; a 1.6 m deep part `w9000000041` (parts under 6 m²
  are dropped by city.dart) with the arch picture (`vrutak_arch`, the archivolt 1.15x wider: a 2.16 m opening), its walls open below
  the springing (2.84 m, `data/arcades.json`, also the back wall) and two jamb boxes textured with crops of the same picture
  (`vrutak_jamb_l/r.jpg`). The bike rides through into the yard. `w735337395` is single-storey (`zg:eave` 4.7, flat) with the VRUTAK
  shopfront on its north face (`vrutak_shop`) and the ground floor of its old picture on the west face. The first attempt put the whole
  wing in front of the striped house: wrong.
  The houses near Kaptolska klet (`strezoj_e11`, `h735337403_e4`, `data/hero/kaptol2.json`) have invented neighbour-style pictures;
  the Kaptol block's back / side walls wear the plaster tile via `data/rear_walls.json`.
- **Addiko corner block** (Trg bana Jelačića, `w105484833`): the east side stands on eight granite piers (0.6 m, the corner and end ones 0.75 m,
  flush with the facade line, 3.86 m apart; box features with the new `bank_granite.jpg` texture) over a recessed dark glazed ground floor (`w9000000030`, procedural picture `colonnade_core_front`), under a
  ledge slab with the white railing; the upper floors are the user's Street View photo redrawn (`inv_w105484833_e8`, 6.5 m lift). New
  `data/arcades.json` + `Arcade` (walls start above the ground, dark soffit). A row of Dolac-style benches with red umbrellas stands in front
  (`data/markets.json`). `zg:eave` tag overrides a part's wall height.
  Later the same day: the colonnade is open at both ends. The north end wall (`e9`, a filler shopfront) went to the ground; seen from
  inside it was invisible but still collided. It is now lifted like `e7`/`e8`, the last 0.95 m of the square side (`e6`) opens through the new
  arcade `spans` (part of an edge, cut like a passage doorway). The recessed floor's corners run to those openings, with a granite end
  pier at each end and beams over both openings. The bike rides the whole colonnade both ways.

## Kaptol locked north of the gate, the Cathedral's north side, draped delivery pads (2026-10-01)

- **Roadblock** across Kaptol just north of the Domitrovićeva kula gate: from the canons' house (w290024543) to the seminary palace's
  west face at z 238 (`data/fences.json`, style `roadblock`, 12 m invisible wall). The gate and the private road behind it stay open; the
  roundabout keeps its south half. **North side of the Cathedral** fenced like the south side (tarp site fence from the north tower's
  corner to the north wall), so the precinct inside the walls behind the Cathedral is closed. Bike-sized flood fills (rays at 0.35/1.0 m,
  0.45 m reach, 0.5-0.6 m grid): the precinct reaches nothing outside; from the square the fill reaches the rear door, both gates, the north
  road and Ribnjak, but not the precinct or Kaptol north of the roadblock; from north of the roadblock it never gets south of z 238.
- **Deliveries**: the two Nadbiskupija entries are one, `nadbiskupija` ("Kaptol, behind the Cathedral walls") at the rear door
  outside the walls; the old pad in the lane behind the apse is gone. Pads drape over the ground (`deliveries.ts`): every vertex of
  a 6-ring disc is cast down, and lifted to a neighbour up to 0.3 m higher so a kerb under a pad is bridged, not cut in a jagged line.
  Wall pads cast from max(sidewalk, terrain) + 1.5 m (YEZI and SPAR were 1 m underground), static ground only. Audit: no pad triangle
  centroid or edge midpoint lies under the ground (137 pads); about 80 ms of ray casts at load.

## Archbishop's palace roof (2026-10-01)

- **Kula Nebojan** (the Cathedral's south-west tower) had a broken cone: its round wall is part of the palace outline
  (`w101185039`), whose single hipped roof sat on the L's minimum-area box (23 deg off both wings), so it flattened into a
  5.5 m plateau with stucco bands on every wall, and the plateau's hips and bands cut through the cone.
- **Roof wings** (`roofWings` in `data/buildings.json`, `RoofModel` wings in `tool/src/buildings.dart`): one hipped roof per
  rectangle (south wing, the Stepinac museum pavilion, the south risalit, the east wing and its courtyard risalit), the roof
  being the highest wing; footprint outside every wing is flat at the eave. The wings slope down to their walls, so the palace
  lost its stucco bands, and the three round towers stand clear of the roof.
- **Cones** fitted to the towers' outlines: Nebojan's re-centred (it sat 0.55 m off and too small, leaving a ledge), and new red
  cones on the south-east tower (Google 3D) and the east tower (no photo, like its neighbours).

## Ilica falls gently; Nama recreated with its arcade; ZAKS on Kuća Stanković (2026-10-01)

- **ZAKS**: Kuća Stanković's picture (`kuca_stankovic`, the corner of the square and Ilica) had a "HOTEL DUBROVNIK" entrance at its east
  end, a gen-image misreading of a blurry sign. Repainted as a third ZAKS bay copied from the one beside it (raw.png hand-edited, the
  original kept as `raw_hotel_dubrovnik.png`).
- **Ilica's slope**: the terrain grid fell 6.4 m in the 50 m west of the square (20% in front of Nama) into a 3.5 m pit under the Ilica
  4-14 blocks, an artefact of the building-height subtraction. `tool/prepare_terrain.py` now fills such hollows smoothly from the grid
  round them (`FILLS`); 293 cells changed (x -100..-300, z -40..90, up to 4.85 m), the far grid and everything else byte-identical.
  Ilica now falls about 3% from the square (4.5% at its very edge) and the bike rides up it from Ilica 14 to the square without a stop.
- **Nama** (Ilica 4, w97089760): the old picture was an invented historicist front. The new one is the real interwar travertine
  store from Street View (Jul 2024, pano "1 Ilica") and the user's frame: seven round arches, the arched "140 godina s nama" window,
  the tall gate, eight tall windows (re-spaced onto the arches by hand, gen-image drew seven off the rhythm), the scalloped top.
  - **Arcade** (`data/arcades.json` `arches`, `Arches` in `tool/src/buildings.dart`): the arches are cut out of the wall and its
    picture along their curves, with stone reveals 0.7 m deep. The wall starts at its high (east) end, so the arches stay level as
    Ilica falls; every bay of the 3 m walkway has its own floor a step above the pavement in front of it, so each arch downhill stands
    a little higher over the street (0.15 m step at the east end, about 1 m of plinth at the west). Behind it a hand-made part
    (`w9000000050`, a U) with pictures composed by `tool/make_nama.py`: travertine, the dark lintel band, the store's glass door in the
    seventh arch and a shop window in the second.
  - **Oriel** over the gate: a new `oriel` feature (features.ts), a half-ellipse bay wearing the picture's own oriel strip, rising
    1.2 m over the cornice, on a carved corbel with a cornice cap (travertine tile from the picture).
  - The blue "nama" letters at their painted places, a glazed drum with a grey dome and "nama" at the west end of the roof
    (`zg:eave` 20.7: the picture's 19.5 m stand on the high end of the falling street).
  - Delivery `ilica_nama` is "Nama, Ilica 4", its pad on the pavement in front of the glass door.

## Walkers beyond the square: Dolac, Kaptol, Praška, Vlaška (2026-10-01)

- The square's crowd is 10% smaller (97 -> 87 walkers); 30 more keep to places further out (`AREAS` in `web3d/src/people.ts`, each
  a line with a reach and a share): 6 on Dolac's market plateau, 5 on Kaptol before the Cathedral, 4 each on Praška and Vlaška, 3 in
  Tkalčićeva, 2 each in Jurišićeva and Bogovićeva, 1 each in Gajeva, Ilica, Petrinjska and Opatovina. They spawn and pick their
  next goal inside their area. `?people=N` sets the total, shared out the same way.
- **Levels are walkable**: `tool/src/walk.dart` no longer cuts the Dolac plateau, its stairs and ramps out of the walk grid (only dips
  and regions marked `"crowd": false`, the fenced WC stairwell on the Cesarca lawn). It ships their ground heights (`walk.levels`,
  a byte a cell over the levels' box), since the crowd's probe only looks for ground near the bare terrain grid, 1-4 m under the
  plateau. Walkers never step more than 0.5 m up or down (`Crowd.stepTo`), so the retaining walls hold them and they use the stairs.
- Checked headless over 60 s: every group walks 50-80 m a minute, nobody stuck, no per-frame height jump over 9 cm; the Dolac
  walkers stay on the plateau at 7.45 m.

- 2026-10-01 Uspinjača street (Ulica Josipa Eugena Tomića): the west-side houses (w97079940, w97079935, w97079944, ...) stood across the
  extent's edge and were dropped, leaving bare hill; `extentExtras` (city.dart) keeps them. A roadblock closes the street 5 m in from Ilica
  (fences.json, z 26), walls behind it have very low-res invented pictures (`make_behind_fence.py`, second closure `USP`), the lower
  station w97092198 got a dark roof and `data/park.json` a `funicular` prop (parkprops.ts: two tracks following the ground, a cabin each,
  the upper station).

## Frame rate for weaker laptops (2026-10-01)

- Draw calls halved (chase view 847 -> 440, Ilica 1216 -> 520, overview 1372 -> 558): `merge.ts` merges the bike and rider's static
  parts (111 -> 56 meshes) and the features (484 -> 103: awnings, boxes and scaffold tubes shared a look but each had a material); the
  274 delivery pads are two merged meshes plus the pulsing current one.
- No program lookups per frame: the lamps and three square props had a material shared with a plain mesh, and every transparent
  double-sided material (signs, shelter glass, nets) was drawn in two passes with `needsUpdate` at each (`forceSinglePass`).
- Physics: the loop steps Rapier's pipeline without its per-step sweep of all bodies and colliders through JS (1.4 -> 0.45 ms a frame).
- The crowd's geometry is indexed: the posing vertex shader runs once a vertex, not three times a triangle (-0.6 to -1.3 ms GPU).
- Main-thread CPU a frame 7.6 -> 4.9 ms. Uncapped at 1920x1080: 190 -> 249 fps; with the CPU slowed 4x 33 -> 70 fps, 6x ~17 -> ~43.
  Before/after renders of the bike, awnings, cornice boxes, scaffolding, a dome, signs and pads match within animation noise.
- Adaptive resolution: a step down is sized by how far under 55 fps it is (one step from 21 fps instead of five: 60 fps after ~6 s
  instead of ~9 s on a simulated slow GPU), and a step that does not make it faster (the CPU is the limit) is undone and becomes the
  floor: a slow CPU kept 2592x1620 instead of sliding to 864x540 for nothing.
- Tooling: `shot.mjs --uncapped --throttle N`, `zg.fps(secs)`.

## Loading screen lobby (2026-10-02)

- The loading screen: logo at the top, "Ride the cargo bike and deliver 8 packages around central Zagreb, as fast as you can.",
  the lobby (dress your rider: 8 coat colours, 6 cloths, 6 hair colours, "Surprise me", a turning 3D preview you can drag), and
  progress, then a Start button (or Enter). The HUD no longer shows over it.
- `boot.ts` entry chunk 707 KB / 185 KB gzipped comes up first; the game chunk (4.6 MB / 1.77 MB gzipped) loads behind it.
- `models/outfits.jpg` (45 KB) replaces `bike_coat.jpg` and `bike_hair.jpg`; draw calls unchanged (perf budgets all ok).
