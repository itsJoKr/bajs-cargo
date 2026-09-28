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
