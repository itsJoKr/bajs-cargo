# Decisions

Each entry: what was decided, and why. Newest last. Sensible defaults that
were chosen instead of asking live here, so the next session can see (and
overturn) them.

## Phase 0

- **Project lives in `/Users/jokr/Projects/zg_drive`**, not `zagreb_drive`.
  The brief named `zagreb_drive`, but the request was "in this project", and
  this repository already existed for it. The Dart package is still
  `zagreb_drive` and the app id `com.joeitsolutions.zagrebdrive`.
- **Android namespace stays `com.joeitsolutions.zagreb_drive`** (where
  `flutter create` put `MainActivity`); only `applicationId` is
  `com.joeitsolutions.zagrebdrive`. Renaming the Kotlin package buys nothing.
- **Axes: x east, y up, z north.** flutter_scene's world is left-handed: a
  camera looking along +z has +x on its right (Doomscrool's course runs down
  +z and steering toward +x moves the car right). Facing north with east on
  the right therefore needs z = north. `lib/drive/domain/geo.dart` holds the
  one geo->local function, pure Dart so the tools share it.
- **No Marionette.** Doomscrool registers its debug build with Marionette and
  falls back to the `flutter run --vmservice-out-file` file; Zagreb Drive only
  uses the file (`/tmp/flutter-zagrebdrive-vmservice.json`), written by
  `tool/ensure_device.sh`.
- **Tools run with plain `fvm dart tool/x.dart`, not `dart run`.** `dart run`
  runs the build hook first, which compiles every city chunk; the tools only
  need `package:scene` and the VM service.
- **Skills install to `.claude/skills/`.** `flutter_scene:skills` from the
  fork writes there (six skills, including `flutter_scene-kit`); Doomscrool's
  older copy used `.agents/skills/`.
- **The probe gained `command`** (`ext.zagrebdrive.command --name ...`) for
  free-form debug actions such as teleporting the camera, so looking at an
  arbitrary corner of the city does not need a new park.
- **Parks are the frame shots.** Doomscrool's `frame-shots` captured states
  named `*.shot`; here the gate lists the parks it captures
  (`zagreb.square`, `zagreb.ilica`, `zagreb.cathedral`).
- **The OSM snapshot covers the full phase-6 box from day one**
  (45.803–45.818 N, 15.962–15.988 E), so growing the city never needs a
  refetch. 3,364 buildings, 157 building parts, 7 MB of JSON, one element per
  line so it diffs.

## Phase 1

- **Generator-owned documents are written whole.** `SceneDocBuilder` mints
  ids from 70000 in a fixed order and derives each chunk's `documentId` from
  a seeded `Random` over its name, so reruns are byte-identical without
  Doomscrool's release-and-reclaim dance.
- **`generator-determinism` runs into an EMPTY scratch root**, not one
  seeded with the committed files, and also compares the file set. A
  generator that writes nothing fails as "missing". Perturbing one colour
  turned every payload red; reverting turned it green.
- **Roofs are planar regions over a box, not a straight skeleton.** Robust
  for any footprint (concave, courtyards): triangulate, clip each triangle
  into convex regions, height from the region's plane; walls split at the
  roof's kinks. Real L/U-shaped roofs are approximated by one ridge.
- **Courtyard buildings default to 1-2 storeys.** OSM rarely tags them and
  the 4-storey district default filled every courtyard.
- **Chunks: 200 m squares on a grid anchored at the origin, buildings by
  centroid** (a building never splits across chunks; its chunk's bounds just
  grow a little).
- **`.fscene` sources are not Flutter assets.** Only the build hook reads
  `assets/city/`; runtime data (`city_index.json`, later collision/terrain)
  lives in `assets/data/`, the one listed asset directory besides audio and
  the generated tree.
- **`tool/reload.sh`** hot-reloads/restarts through `flutter run`'s
  SIGUSR1/SIGUSR2, which (unlike Marionette's hot-restart in Doomscrool) did
  pick up source changes. New chunks still need a full relaunch.

## Phase 2

- **Clipper2 (pub `clipper2` 0.0.3) is a dev dependency for the tools.** Its
  `rectClip` throws a RangeError on some city paths in this port, so
  `Shape.clipRect` uses a general intersection; and a union with an empty
  subject returns nothing, so `Shape |` short-circuits.
- **One ground mesh per chunk for every surface kind.** Asphalt, sidewalk,
  paving, grass, gravel and kerbs share the `ground` material and differ by
  vertex colour and a tile id in UV1 (for the atlas material to come), so a
  chunk's ground is one draw. Only the rails, which stack, get a second.
- **Sidewalk is the default ground**, not a buffer around roads: in the
  centre everything between kerb and facade is paved, and courtyards are
  paved too. Building walls start 0.6 m below ground, hiding the seam.
- **Trees are instanced from one baked mesh** (loaded from `props.fscene`),
  positions and a position-hashed scale/yaw per chunk in the index. Their
  vertex count (about 500 each) dominates the vertex budget near
  Zrinjevac; halve it if vertices ever matter.
- **Squares are paved at sidewalk level with no kerb inside them**; a
  street that ends at a square gets a kerb where its asphalt stops.

## Phase 3

- **The car is a kinematic bicycle, not a tyre model.** It carries one
  signed speed along its heading; walls remove the into-wall component and
  swing the nose along the wall. Predictable, testable, and it feels like
  Sky Drop's arcade car.
- **Collision is 2D footprints only.** The car can drive anywhere else,
  pedestrian zones and parks included (the brief allows it); kerbs are a
  height step, not a wall. Bollards are not in the data yet.
- **Wall response aligns the heading.** The first version only removed the
  normal velocity; a 20 degree hit with the throttle held then ground to
  0.3 m/s against the wall. The slide test caught it.
- **Merging the car per material** at load (five rigid groups) instead of
  editing the model: the asset stays the unchanged Khronos file.
- **Engine pitch uses audioplayers' `PlayerMode.lowLatency`**: on Android
  that is a SoundPool stream, whose rate resamples (pitch follows); a
  MediaPlayer rate time-stretches at constant pitch.
- **Parks place the car 9 m in front of the eye** so the shots show it, and
  freeze the simulation.

## Phase 4

- **One atlas material for the whole city** (`CityAtlas.fmat`) instead of a
  material per style: a chunk stays one facade draw and one ground/roof
  draw however many styles it holds.
- **Tint mask in alpha**: generated facades are painted a neutral stucco
  and every building's paint comes from its vertex colour, masked so glass,
  frames and stone trims keep their own colour.
- **Storey cuts were read by eye** (ruler overlays) after autocorrelation
  proved unreliable on storeys; bays are detected. The overrides file is
  small and explicit.
- **Codex needs `-m gpt-5.5`**: the configured default model requires a
  newer Codex CLI than the installed 0.144.6. The prompts ask Codex to save
  images unprocessed (it otherwise post-processes them itself).
- **The web is a target too** (the user asked mid-phase 4). flutter_scene
  ships a WebGL2 backend, so the same code runs in a browser, touch
  controls included. What differs there: no VM service, so the probe gates
  stay on Android; the release bundle is about 100 MB (58 MB of assets,
  11.7 MB of it the car) and needs slimming for mobile data; audio can only
  start after a user gesture; the emulator's counts are the budget, a phone
  browser's frame rate is unmeasured.

## Phase 5: real facades (Trg bana Jelačića)

- **Real buildings over a style kit, one section first.** The user asked
  for the actual buildings, photographed in Street View and redrawn with
  gen-image, starting with a small area. The square's 17 street facades are
  done; everything else still wears the Phase 4 kit.
- **Street View through the user's Chrome, no API key.** The user asked
  for it. Frames are Maps URLs (`@lat,lng,3a,<fov>y,<heading>h,<tilt>t`
  with the panorama id) opened in their browser and screenshotted by the
  Chrome extension; `tool/sv_plan.py` picks the panorama and aim per
  facade, `tool/sv_batch.py` emits the navigate/wait/screenshot batches.
  Nothing is billed and no key exists in the repo. Raw frames and crops
  stay in the git-ignored `.art/`.
- **Official panoramas beat photospheres.** A user photosphere's position
  and heading can be metres and degrees off, so aiming by geometry missed.
  The square's sources are two panoramas (Jul 2024 official, Sep 2022
  photosphere) chosen for coverage, framed by eye where aim was off.
- **The URL fov is over a 900 px reference width**: the focal length in
  screen pixels is `450 / tan(fov/2)` whatever the viewport. Found by
  projecting known corners; the naive viewport-width model was 1.74x off.
- **gen-image redraws, it doesn't rectify.** A homography of the photo
  would keep the lamp posts, trams, awnings and the statue that stand in
  front of every facade. Codex (`-m gpt-5.5`, photo attached with `-i`
  AFTER the prompt, stdin closed) is asked for an orthographic, evenly lit
  elevation with the counted bays and storeys, pavement to cornice. Each
  result was compared with its photo before packing
  (`.art/facades/manifest.json`).
- **One quad per wall, no tiling.** A hero wall is one picture from the
  sidewalk to the eave (UV1.x = -1, UV0 = the atlas coordinate), split by
  length across a corner building's consecutive edges. The building's
  eave is set to `storeys * 3.7 + 1.0` m, the scale the picture was sized
  at, so it is never stretched vertically. Gables and roofs stay generic.
- **Hero atlas 2048 wide, 512 px per facade height** (32 px/m at a 16 m
  eave), first-fit shelves with a 4 px replicated gutter so mips don't
  bleed, height rounded to a power of two (2048x4096 for 17 facades, with
  room for the next section). It rides the same `CityAtlas` material and
  draw as the kit facades.
- **Licensing caveat.** The textures are AI redrawings of Google Street
  View imagery; fine for this personal project, but Google's terms need a
  look before anything is published. `assets/ATTRIBUTION.md` says so.

## Engine: ETC1S textures in the fork (2026-09-28)

The web build is heavy to download (the hero atlas alone is a 7.9 MB
`.fstex`), and the user asked for a proper engine feature rather than a
game workaround. The change is too large for the running fork branch, so
it lives on two stacked branches in a separate worktree,
`~/Projects/flutter_scene-etc1s`, based on upstream master. The game's
checkout (`codex/editor-static-resources-open-race`) is untouched.

- **`feat/etc1s-transcode`**: standard KTX2 ETC1S textures transcode
  straight to ETC1/ETC2 (lossless) or BC1/BC3 on the device instead of
  decoding to rgba8. Byte-exact against basisu 2.50, GPU-checked on Metal,
  Android GLES and headless Chrome.
- **`feat/etc1s-encoder`**: a pure-Dart ETC1S encoder behind
  `buildTextures(encoding: TextureEncoding.etc1s(quality: ...))`. Its
  files validate and decode identically in basisu's reference transcoder,
  and it is within about 0.3 dB of basisu at equal size (ahead at low
  rates). The facade atlas goes from 3.5 MB to 0.72 MB.
- **Not yet used by the game.** Switching the city atlases needs the game
  on these branches (or upstream once merged). The branches are not
  pushed: pushing and opening PRs waits for the user.

## The three.js version becomes the main line (2026-09-29)

The user asked for the game rebuilt in three.js inside this repo, with a
better car and better physics than the Flutter build, and said the Flutter
city is only a base: the web version should improve on it, and the Flutter
bake does not need to stay byte-identical.

- **Physics: Rapier's raycast vehicle** (`@dimforge/rapier3d-compat`,
  `DynamicRayCastVehicleController`, a Bullet `btRaycastVehicle` port).
  Suspension, weight transfer, grip limits and handbrake slides come out
  of the solver instead of the Flutter bicycle model's hand rules; kerbs,
  walls, trees, lamps, props and trams are real colliders. Tuned against
  `web3d/tools/sim.ts` (0-100 in 4.8 s, 185 km/h, 31 m from 100 km/h,
  ~1.35 g, climbs 12%, handbrake holds on it).
- **Car: the Ferrari 458 from the three.js examples** (CC BY), separate
  wheel nodes posed from the controller.
- **City: exported, not rewritten.** `tool/export_web.dart` runs the same
  generator (`City`, `Ground`, `emitBuilding`, hero atlas) and writes one
  GLB; the atlas material is ported to `onBeforeCompile`. Two builds from
  one model kept the Street View facades and roof work.
- **Web frame: x east, y up, z SOUTH.** three.js is right-handed, so the
  export mirrors z and rewinds every triangle to agree with its normal;
  the Flutter frame (z north) stays everywhere in `tool/` and `data/`.
- **Terrain from Copernicus GLO-30.** It is a surface model, and in
  Gornji grad nearly every 30 m pixel is mostly roof, so dropping covered
  pixels filled the plateau from the lower town (escarpment 150 m too far
  north). Instead each pixel's ground estimate is the surface minus 65% of
  the mean OSM building height over it (spires clamped), weighted by its
  open share squared, then a 25 m Gaussian. Result: Markov trg +36 m,
  Kaptol +5.5, Dolac +4.9, Zrinjevac -2 relative to the statue.
  Buildings stand at the lowest ground along their street walls; each
  wall starts its storeys at its own lowest sidewalk.
- **Street furniture as props, not buildings.** `building=kiosk|roof|
  gazebo|...` went through the building pass and came out as small
  stone palaces; they are now kiosks and canopies. Tram platforms,
  shelters, café terraces, statues, busts, fountains and lamps come from
  OSM too. Mapped `roof:height` is honoured (the Cathedral's 34 m spires).
- **`city_atlas.fmat` got a guard** for the web's surface-tile code on
  walls (UV1.x = -(100 + tile)), so a Flutter rebake shows plain stone,
  not a hero-atlas smear. The Flutter bake is otherwise not maintained.

## Only real facades; faithful copies; a roof set (2026-09-29)

- **The style kit is gone from the web build.** The first pass dressed
  every wall with invented facades that look plausible but are not the
  real buildings, which hid how much is actually done. Walls without a
  Street View facade are now plain light stucco (`plainWalls` in
  `emitBuilding`), and `tool/export_web.dart` writes
  `data/hero/coverage.json`: every street wall of 4 m or more, done or to
  do, the work list for the next pass. The HUD shows the count.
- **Hero facades are faithful copies.** The first prompt removed shop
  signs, lettering and ads; the user wants the building as it is: every
  shop name, sign, ad, plaque, crack and stain, spelled as photographed.
  Only what stands in front (people, cars, poles, trees, free-standing
  umbrellas) goes. The old raws stay as `raw_clean.png`. The hero atlas
  went to 768 px per facade height (from 512) so lettering stays legible,
  4096 wide, no power-of-two padding.
- **A roof set.** One clay tile, tinted per building and repeated every
  2 m in a 224 px cell, averaged to flat pink-beige from the street. Now
  eight gen-image coverings (old beaver-tail, red interlocking, dark
  brown, pale, grey fibre-cement, dark zinc, green copper, flat gravel) in
  `roof_atlas.png` (512 px cells), each with its real repeat size
  (`data/roofs.json`), picked per building from `roof:material` /
  `roof:colour`, else from style and a stable hash weighted toward old
  clay (`tool/src/roofs.dart`), plus a world-space weathering pattern in
  the shader so big roofs are not one stamped tile.

## Flutter removed; the web version is the project (2026-09-29)

The user asked to keep only the three.js version. The Flutter app, its
flutter_scene dependency, the Android/macOS/web shells, the `.fscene`
chunks, the device probe and the verification gates are gone from `main`;
the last state with all of it (including uncommitted Flutter edits from
before this session) is the `flutter-archive` branch, commit 6d27cdb. The
city pipeline stayed, as a plain Dart CLI package (`pubspec.yaml`:
`vector_math`, `clipper2`): `MeshWriter` moved to `tool/src/mesh_writer.dart`,
`geo.dart` to `tool/src/`. The export was byte-identical before and after
the split. Entries above that talk about the Flutter build, Slim_1, the
probe or `generate_zagreb.dart` describe history.

## Café furniture is loose; the car launches it (2026-09-29)

The user asked for chairs and parasols that fly when the car hits them; lamps
and the other props stay fixed. Terraces are no longer baked into the prop mesh:
`terraceTables` exports placements (`city.json` `terraces`, 351 tables from OSM
outdoor seating) and `terrace` features add theirs; `web3d/src/furniture.ts`
makes each table, chair and parasol a dynamic body (1500 in all, asleep until
touched, four instanced meshes). Tables go too: the parasol pole stands through
the table, and a table that stays while its chairs fly looks wrong. Pieces sit in
a lower dominance group, so they never slow or lift the car. A car at speed
cannot shove them through the solver (see the rules file), so a moving car
launches whatever its next step reaches: its speed plus some, a lift, a spray to
the side and a spin. That is arcade physics on purpose. Dropping the baked
furniture also shrank `zagreb.glb` from 29 MB to 16.5 MB.

Driving through a terrace tanked the frame rate: each flying piece added
~0.3-0.5 ms to every physics step (60 pieces: 1 -> 17 ms a step, and the loop
runs up to six steps a frame to catch up). Measured in the city, nearly all of it
was cylinder and cone colliders against the city trimeshes (CCD cost nothing
measurable), so every piece is boxes now (30 flying: 12 -> 2 ms). A launched piece
stops colliding with other furniture, so a spray no longer wakes the next terrace.
And the user's trick: with more than 4 pieces flying a hit piece vanishes with a
30% chance, and every one past 24 does (`zg.furniture.stats()`). Driving down
Bogovićeva's terraces now holds 60 fps with the step at its ~1 ms baseline.

## Hand-shaped levels over the terrain grid (2026-09-30)

The terrain grid is Copernicus GLO-30 filtered and smoothed at 25 m: it cannot hold a 5 m step like Dolac's
plateau over Pod zidom, so the market read as a gentle slope with the market hall extruded on top.
`data/levels.json` overrides the grid inside hand-drawn outlines (flat, ramp or stairs; later wins), and the
export cuts every ground surface along them, so no triangle straddles a step, and puts a retaining wall
wherever the ground jumps. Heights come from OSM step counts (24 + 20 steps up from Pod zidom, 16 wooden
ones to Opatovina), not from the DEM, which is too coarse and roof-polluted here.

Stairs are drawn as steps but driven as a straight ramp: steps would stop the car (a 0.18 m riser does), and
the car climbs even 45% from a standstill. The risers sit half a tread in from both ends, so the ramp runs
floor to floor through the middle of every riser: a first try that lifted the ramp half a riser above the
floor left a 6 cm lip that, on the 31% wooden flight, caught the car's nose.

## The Bajs cargo bike (2026-09-30)

A second ride next to the Ferrari: Zagreb's public e-cargo bike (nextbike's Bajs, a Dolly long john), ridden by
a man in a suit. It is the same `Vehicle` (Rapier raycast vehicle) with its own `VehicleTuning`, so steering,
brake-then-reverse and the handbrake slide work as in the car. Two rays would need an active balance
controller to stay up, so four rays sit close together (±0.2 m) under the real wheels and the body stays
upright; `bikeModel.ts` leans the picture into turns (atan(v·yaw rate / g), about the tyre line) instead.
Pedalling: holding the gas is the e-assist; each press also adds a pedal stroke that fades over 0.35 s
(`Controls`), and the stroke cadence adds up to 1.8x more drive, so tapping 7-8 times a second reaches
25 km/h in ~2.9 s against ~5.9 s holding, with the same ~28 km/h top. Letting go below 0.5 m/s holds the bike
(the rider's foot goes down), since a freewheeling bike otherwise creeps down every slope. The model is
built from primitives with the livery painted on a canvas at load, not a glTF: no model of this bike exists,
and it keeps the rider's IK (legs to the turning pedals, hands to the steering grips) simple.

Round 2 (same day): the bike is what you ride by default (the car stays on B). Holding the gas tops out at
~33 km/h; the tap cadence also raises the ceiling (`sprintTopSpeed`, 45 km/h at full cadence), so tapping
at full speed goes faster still (~44 km/h at 7 taps a second). The black plastic, frame paint, tyre tread,
suit wool and coat cloth are gen-image textures (`.art/bike`, made seamless by `tool/prepare_bike.py`), each
also its own bump map; the livery is painted over the plastic grain. The rider moved to `rider.ts`: lathed
torso and tapered limbs instead of capsules, a camel overcoat whose tails hang from the pelvis (not the
torso, so they stay down when he leans), gloves, and extruded oxfords with the ball of the foot on the pedal.

Round 3: tapping goes much faster still: `sprintTopSpeed` 20 m/s and `pedalBoost` 2.6, so 7 taps a second reach
~67 km/h (25 km/h in 1.7 s) while holding stays at ~33 km/h; full lock at 60 km/h still stays up. The rider's
hair is 3D: tapered, flattened tubes laid on the skull ellipsoid (`hairGeometry` in rider.ts, merged into one
mesh) sweeping from a left part, over a close cap, textured with a 128 px gen-image strand texture
(`bike_hair.jpg`; the locks use a copy turned 90 degrees, since a tube's u runs along it).

Round 4: arcade speeds. Holding the gas tops out at 68 km/h (`topSpeed` 19 m/s) and tapping at ~100 km/h
(`sprintTopSpeed` 28.9 m/s), with `engineForce` 800 N (0-25 km/h in 1.3 s holding, 0.8 s tapping), less drag
(0.2) and stronger brakes (7). The four rays keep it up in corners (full lock at 90 km/h tilts ~5 degrees), but a
hard hit or a kerb at speed can roll it; rather than a self-righting hack, the HUD says "Press R to reset" (also
a tap target) once the vehicle has been on its side or roof, nearly still, for 0.8 s. The car gets it too.

Round 5: the fast bike slid out and spun in turns at 90 km/h with no way back. Tapping asked the rear tyre for
up to 2240 N (800 N x 2.8) where it holds ~900 N, and since drive scales with FORWARD speed, a slide (forward
speed falling) brought back full power and spun it further; bumps at speed also lifted all four rays and the
landings kicked the yaw. Fixes in `bikeTuning`: traction control (`tractionShare` 0.75 of each rear ray's
suspension force x friction slip), a rider-balance `gripAssist` that bleeds off sideways velocity while a
wheel is down and the handbrake is not held, grippier arcade tyres (1.9 / 1.8, which keep the acceleration
under the traction cap), longer softer suspension (0.18 m rest, 0.14 m travel, stiffness 45), and the physics
centre of mass at 0.1 m: with four rays 0.4 m apart and the COM at 0.4 m it tipped at ~0.5 g, which is why it
flipped so easily. `sim.ts` kicks it sideways at 90 km/h and requires it to straighten up (the old tuning spun
round to -47 km/h).

## Frame rate: no post-processing, adaptive resolution (2026-09-30)

The frame cost is per pixel: full screen on a large Retina display (5120x2880 at pixel ratio 2) was ~7x
slower than a 1280x720 window with the same draw calls. Measured with `zg.bench` in headless Chrome (Metal):
the EffectComposer (half-float 4x MSAA target, OutputPass copy) cost 2-2.5x at 4K-5K (47 -> 23 ms, 82 -> 32 ms);
GTAO doubled it again. GTAO and the composer are gone: the far scene and the city render straight to the
canvas (its own MSAA, tone mapping in the materials; screenshots match). The pixel ratio starts under a
4.2 MP budget and follows the frame rate (down a 0.85 step after two seconds under 55 fps or one under 40, up after 4 s over 58,
never back to a step that dropped frames; 0.6 to min(devicePixelRatio, 2)); the HUD shows fps and the buffer
size. Sun shadows cost 1.5-3.5 ms at 720p-4K (4096 vs 2048 map: no difference) and stay. The hero atlas
(ETC1S, transcoded to ETC2 on Apple GPUs, 0.5 byte a pixel, mipmapped) is not a frame-rate cost.

## The Cathedral is modelled by hand; low-res where nobody looks (2026-09-30)

- OSM's building:parts gave floating tower blocks and no Gothic shape; the hero atlas gives every picture one fixed
  row height, so a 62 m tower front would get 12 px/m. The Cathedral is therefore a hand-built model with its own
  textures, the OSM outline left out of the export (`omit`), placed through city.json `landmarks`.
- Spires as before the 2020 earthquake (the user's reference and the city's silhouette), not the 2024 scaffolding.
- Texture budget (the user's rule): full resolution only at street level where the player can drive; anything high
  up super low-res; anything the player cannot reach very low-res and closed off with a visible fence, not an
  invisible wall. Hero facades got `res` (atlas lanes of 1/2, 1/4, 1/10 height) so such pictures cost little.

## Covered passages: doorways in the export, interiors in the game (2026-09-30)

- Buildings are hollow shells, so a passage is two things: `tool/src/passages.dart` cuts a doorway into every wall edge
  its corridor crosses (facades at the passage's ends get the doorway size from `data/passages.json`, inner party and
  courtyard walls are cut to the full corridor so no jambs stand in it), and `web3d/src/passages.ts` builds the inside
  from city.json `passages`: side walls, a flat ceiling or a glass barrel vault, a floor draped on the ground, lamps,
  colliders, and for the Oktogon the eight-sided hall and its stained-glass dome.
- No real lights: every three.js light costs every pixel of the city. The interiors are unlit materials with the lamps'
  light baked into vertex colours; lamps are small glowing meshes.
- Textures are low-res gen-image redrawings of the user's photos of the real interiors (`public/models/passages/`,
  256-512 px): the Oktogon's hall faces, its arch face, the dome seen from below (projected onto the dome), the corridor
  wall and the glass roof, and Marićev prolaz's travertine wall with posters. Floors are procedural canvases.
- The Oktogon's Ilica arm runs through a courtyard in the model; it has a glass roof in reality, so `coverAll` roofs it
  from the first facade to the last.

## Delivery destinations are data, not baked (2026-09-30)

`data/deliveries.json` is resolved against `city.json` walls at load in the browser (no Dart rebake): a wall id plus
`at`/`out` survives facade re-exports as long as the wall id does. Pads are pale yellow, `MeshBasicMaterial`, not tone
mapped (white washes out under this sun). Delivering needs the vehicle within 2.4 m of the pad at under 9 m/s.
The Google Maps sweep the brief asked for was not done street by street: businesses come from the lettering already on
our textures, cross-checked against Maps only for Pod zidom 3.

## Terrain hollows are filled in the terrain tool, not by levels (2026-10-01)

The grid's 6 m drop at the start of Ilica was not a slope to reshape locally but a closed pit under dense blocks: step 1 of
`tool/prepare_terrain.py` takes ~65% of the OSM building height off each radar pixel, too much where tall deep blocks (Nama, Ilica 6-14)
stand at the foot of the Gornji grad escarpment. A `levels.json` region would have needed a hand-made profile and the client's bare grid
to follow it (as `dip` does); a harmonic fill in the terrain tool keeps one source of truth, follows whatever surrounds the polygon,
is idempotent, and reaches the exporter and the game alike through `data/terrain/ground.json`. Street View agrees: two or three steps
under Nama's arcade over 25 m, not a 20% street.

## Arches are cut in the export; the arcade's back is a part (2026-10-01)

Nama's arcade could have stayed painted. Cutting the arches out of the wall (`Arches`) keeps the facade picture as the one source of the
look (the piers and spandrels ARE the picture) and makes the arcade walkable and its depth visible; the steps follow from a wall that
starts at its highest sidewalk. The walkway's back wall is an ordinary building part with pictures, so it uses the hero pipeline.

## The download is compressed losslessly where it can be (2026-10-01)

For public hosting the build was 176 MB a first visit. The city glb (19 MB of floats and indices) ships gzipped and is unzipped
in the browser: lossless, so the colliders, the hero UVs (`-1 - page` in UV1.x) and the chunk seams stay bit-exact, which mesh
quantization (Draco, meshopt) would not guarantee; 2.6 MB is as small as those would get. Hosts do not compress `.glb` on their own.
The tiled facade/surface/roof atlases went from PNG (10.8 MB) to ETC1S KTX2 (1.7 MB, also a quarter of the GPU memory); side-by-side
renders differ by 1-3 levels in 255. The hero pages (130 MB) are already ETC1S at -q 255 and smaller than JPEG at quality 85: their
size is the picture area (41 pages), not the format.

## Frame rate: cut CPU and draw calls, not picture quality (2026-10-01)

The game ran ~60 fps on the M1 Pro; the aim was cheaper laptops. Measured, the frame was bound by the CPU (three.js submitting ~850
draw calls, program lookups, Rapier's bookkeeping), not by pixels, so the cuts went there and nothing visible changed: merging static
meshes, one program per material, the bare physics pipeline. MSAA, anisotropic filtering and the 4096 shadow map stayed, since turning
them down measured as noise here; on a weak GPU the adaptive resolution trades pixels instead, and it now refuses to blur a picture
when fewer pixels do not help. Skipping Rapier's `mapNewSoftBodies` sweep is safe because the game never makes bodies inside wasm
(no soft bodies, no snapshots): JS-made bodies are mapped at creation and unmapped at removal.

## Generic walls go back on shared tiles to cut the download (2026-10-02)

The hero atlas was 41 pages (130 MB of a 158 MB build), and about a third of its area was not real buildings: 49 duplicate
pictures (twins), 95 procedural plaster firewalls and 219 `fill_` crops of neighbouring facades. Those now cost almost nothing:

- Twins are stored once (`pack` gives every picture with the same key the same cell).
- Plaster firewalls wear facade-atlas tile 49, the seamless plaster the rear walls already used, in a per-wall tint that reproduces
  the picture's mean colour (`data/plaster_walls.json`). Lost: the bricked-up window ghosts and downpipes the pictures had.
- Fillers are laid out again in rows of a style, as the 2026-09-29 style kit did, but with six generic styles cut from the most-used
  filler donors (`gen_cottage`, `gen_shutters`, `gen_arched`, `gen_tenement`, `gen_yellow`, `gen_tall`, cells 0-23) and painted in
  the building's own paint (`data/generic_walls.json`, one style per building by storeys; neighbours alternate).

This brings back the style kit only for walls that never had a photograph of their own; every real or invented picture of a real
facade stays a hero picture, and delivery buildings get proper pictures with their signs. Generic walls count as covered in
`coverage.json` (`generic`), so the filler and firewall tools leave them alone. `tool/shared_walls.py` moves any new plaster
or filler pictures the same way.
Measured after one `HERO_REPACK`: 41 pages / 130.3 MB of hero atlas became 28 pages / 92.3 MB (1,213 pictures, 49 twins sharing
a cell), and the build went from 158.5 MB to 120.7 MB. Then 73 corner strips (short corner edges beyond 150 m of the square that had
always been plain, conspicuous next to a generic wall) opened a 29th page: 94.1 MB.

## Dress the rider while the city loads (2026-10-02)

Loading takes long even on a fast line (the hero atlas alone is ~94 MB), and the loading screen used to show only a bar, with the
HUD's empty "Deliver the package to" box over it. Now the logo sits at the top with one sentence saying what the game is, and the
middle is a small lobby: the player picks the coat's colour (8), its cloth (6: melton, tweed, herringbone, houndstooth, glen check,
corduroy) and the hair's colour (6) on the rider pedalling on a turntable, and presses Start once the city is in. The game waits for
that press rather than snatching the screen away mid-choice; the HUD stays hidden until then.

- The lobby has to come up first, so the page's entry is `boot.ts` (three.js, the bike and rider, ~185 KB gzipped) and the game
  (`main.ts` with Rapier, ~1.8 MB gzipped) is a dynamic chunk fetched straight behind it. Before, all 5.3 MB of JS arrived before
  anything ran.
- Cloths and hair are one 896x128 greyscale JPEG (45 KB, `tool/make_outfits.py`), cut into a canvas texture per cell and tinted in
  the material (colour / the cells' mean linear value, so a swatch's colour is the coat's average). The woven cloths are
  colour-and-weave drafts in a 2/2 twill, periodic on the tile by construction, wearing the old coat's gen-image felt; the hair is
  the old strand texture. They replace `bike_coat.jpg` (512 px) and `bike_hair.jpg`. The default (camel melton, brown hair) is the
  rider as he was.
- The coat's UVs are rescaled to metres (`metricUVs` in rider.ts, one repeat per 0.3 m, a whole number round each lathe): lathes
  and spheres map 0..1 over their own size, which printed a check three times finer on a sleeve than on the back.
- The choice is kept in localStorage; anything unknown there falls back to the default.
