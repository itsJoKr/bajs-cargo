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
