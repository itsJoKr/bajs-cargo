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
