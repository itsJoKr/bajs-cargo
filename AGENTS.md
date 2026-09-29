# Zagreb Drive project guide

Zagreb Drive is a full-screen, landscape, free-roam driving game set in a
recognisable 3D model of central Zagreb, rendered with Flutter Scene
(`flutter_scene`). A personal pet project. This file is the next session's
only memory: keep it current. `docs/decisions.md` records why things are the
way they are; `docs/progress.md` records what each phase delivered.

## The web version (main line)

Since 2026-09-29 the game is developed as the three.js version in `web3d/`
(Vite, TypeScript, three.js, Rapier). The Flutter app below is the
original; its city pipeline is the base the web export reuses, and its bake
no longer has to stay byte-identical.

- `cd web3d && npm run dev` (port 5180; `predev` copies the atlases and the
  Draco decoder into `public/`). `npm run check` typechecks,
  `npm run build` builds, `node tools/sim.ts` runs the physics checks.
- `fvm dart tool/export_web.dart` (plain `dart`) writes
  `web3d/public/city/zagreb.glb` + `city.json` + the terrain grids. Rerun
  after any change to `tool/src/`, then reload the page.
- `.venv/bin/python tool/prepare_terrain.py` rebuilds `data/terrain/`
  from `.art/dem/N45_E01{5,6}.tif` (Copernicus GLO-30, see decisions).
- **Web frame: x east, y up, z SOUTH** (north = -z). The export mirrors
  z; `tool/` and `data/` stay in the Flutter frame (z north).
- Screenshots without the Chrome extension: `node tools/shot.mjs --eval
  "zg.look([x,y,z],[tx,ty,tz],fov)" --sleep 800 --shot out.png`
  (headless Chrome over CDP, prints the page console). `window.zg` has
  `look`, `drive`, `teleport(x, z, heading)`, `groundAt`, `vehicle`,
  `trams`; `?park=square` parks the camera, `?ao=0` disables GTAO.
- **Recreating buildings: use the `recreate-building` project skill**
  (`.claude/skills/recreate-building/SKILL.md`): every street side from
  Street View, faithful facades (signs spelled as photographed), the roof
  (`data/buildings.json`, `data/roofs.json`) and 3D features (signs,
  awnings, terraces, scaffolding, domes, models). Walls without a real
  facade are plain stucco on purpose; `data/hero/coverage.json` is the
  done/todo list.
- `web3d/src/`: `vehicle.ts` (Rapier car, no three.js), `carModel.ts`,
  `city.ts` (GLB, atlas material, props, colliders), `features.ts`
  (data/buildings.json features), `terrain.ts`, `trams.ts`,
  `chaseCamera.ts`, `input.ts`, `places.ts`, `main.ts`. `zg.lookAtWall(id,
  distance, eyeHeight)` frames any street wall straight on.

## Toolchain

- Flutter 3.47.2 through FVM (`.fvmrc`): `fvm flutter ...`, `fvm dart ...`.
- `fvm flutter analyze` and `fvm flutter test` only count as passing when
  they print the literal `No issues found!` / `All tests passed!`. A
  sandboxed run that cannot write the SDK cache under
  `~/fvm/versions/3.47.2/bin/cache` prints nothing and exits non-zero, which
  reads like a clean run if you only grep for diagnostics.
- Tools run with plain `fvm dart tool/<tool>.dart`, not `dart run`: `dart
  run` runs `hook/build.dart` first, which compiles every city chunk.
- Riverpod for app state. Every interactive widget gets a stable
  `ValueKey<String>`.
- `fvm flutter build apk --debug` for the Android build gate.
- Secrets only in the git-ignored `.env` (e.g. `GOOGLE_MAPS_API_KEY`), never
  in source, logs or docs. Raw downloads live in the git-ignored `.art/`;
  only processed textures under `assets/` are committed. Evidence goes to
  the git-ignored `artifacts/`.

## The emulator

Device work runs on the **`Slim_1`** AVD (API 37, Google APIs, arm64, 1.5 GB
guest; see Doomscrool's AGENTS.md for why this image). `tool/ensure_device.sh`
boots it, starts a debug build with `--enable-flutter-gpu`, writes the VM
service URI to `/tmp/flutter-zagrebdrive-vmservice.json` and waits until the
probe answers. It resolves the adb serial by asking each emulator
`adb -s <serial> emu avd name`, because `emulator-5554` is only this AVD when
it booted first. `--print-serial` prints the serial, `--stop` stops the
session and force-stops `com.joeitsolutions.zagrebdrive`. `ZAGREB_AVD` and
`ZAGREB_DEVICE` override the AVD and the serial.

Slim_1 renders Impeller on **OpenGLES**; phones use Vulkan. Its counts match a
phone, its timings do not. When an app cannot launch ("failed to attach",
"start timeout" in `adb logcat -d`), run `~/.local/bin/avdslim on <serial>`
before suspecting code (rules file, "Checking the result").

## Coordinates

Local metres in a tangent plane with the origin at the Ban Jelačić statue
(45.81303 N, 15.97713 E): **x east, y up, z north**. flutter_scene's world is
left-handed, so a camera looking along +z (north) has +x (east) on its right
and nothing renders mirrored. `lib/drive/domain/geo.dart` (`geoToLocal`,
`localToGeo`) is the only conversion; tools import it too. Headings are
radians clockwise from north (0 = north, pi/2 = east).

## Layout

- `lib/drive/domain/` — pure Dart, no Flutter GPU, unit-testable: geo,
  terrain, collision, car physics.
- `lib/drive/scene/` — maps simulation state onto the scene graph
  (`DriveWorld` owns sky/sun/look/camera, `DriveGame` owns the rest).
- `lib/drive/widgets/` — `LoadingScreen` (static, calls warm-up), `DriveView`
  (the `SceneView`, controls and HUD).
- `lib/drive/debug/scene_probe.dart` — `ext.zagrebdrive.*` service
  extensions; `tool/probe.dart` is the client.
- `tool/` — generators and gates. `data/` — committed source snapshots.

## The city pipeline

`fvm dart tool/generate_zagreb.dart` (plain `dart`) bakes the OSM snapshot
into `assets/city/chunk_<e|w><i>_<n|s><j>.fscene` (200 m chunks, origin
anchored, one mesh per material per chunk) and `assets/data/city_index.json`.
Never edit baked chunks; change the generator (`tool/src/`: `osm.dart`
parsing and multipolygons, `geom.dart` earcut/clipping/boxes,
`buildings.dart` heights and roofs, `city.dart` the model,
`fscene_writer.dart` the document writer) and rerun. After baking, relaunch
the app (`tool/ensure_device.sh --stop && tool/ensure_device.sh`): the hook
must recompile the chunks, a hot restart does not.

### Hero facades (real buildings)

Around Trg bana Jelačića the street walls wear the real buildings, not the
style kit. The pipeline, per section (`square` so far):

1. `fvm dart tool/list_hero_facades.dart square` lists the street-facing
   walls (`<building id>_e<edge>`) with a viewpoint and heading each.
2. `tool/sv_plan.py` picks a Street View panorama and aim per wall;
   `tool/sv_batch.py emit` writes navigate/wait/screenshot batches for the
   claude-in-chrome `browser_batch` tool (the user's Chrome, no API key),
   `sv_batch.py file` copies the screenshots into `.art/streetview/frames/`.
   The URL fov is over a 900 px reference: `f = 450 / tan(fov/2)` px.
3. `data/hero/<section>.json` (committed, written by hand while looking at
   the frames): per facade the frame, crop box, walls, bays, storeys and a
   description.
4. `.venv/bin/python tool/prepare_facades.py crop|generate|pack [name...]`:
   crops, redraws each with gen-image (Codex, photo attached) into an
   orthographic elevation, then packs `assets/textures/hero_atlas.png` and
   `data/hero/atlas.json`. Look at every `raw.png` beside its `photo.png`
   before packing; rerun `generate <name>` for a bad one.
5. `tool/generate_zagreb.dart` reads `data/hero/atlas.json`: those walls
   get one quad each (UV1.x = -1 selects `hero_atlas` in
   `city_atlas.fmat`), and the building's eave becomes
   `storeys * 3.7 + 1.0` m so the picture keeps its proportions. It exits
   non-zero if a named wall no longer exists.

At runtime `ChunkStreamer` loads/shows/releases chunks by distance from the
focus (camera now, car later) and `CityMaterials.adopt` points every chunk
at one shared material per name.

## Flutter Scene

The fork lives at `/Users/jokr/Projects/flutter_scene` and is a path
dependency (`flutter_scene` plus a `dependency_overrides` entry for `scene`).
Don't modify it unless an engine bug blocks you; if you must, commit the
change on a separate branch there and write it up in `docs/decisions.md`.

The version-matched agent skills are installed under `.claude/skills/`
(`fvm dart run flutter_scene:skills`; `--check` reports updates). Do not edit
the installed copies. `.claude/rules/flutter-scene.md` holds the engine traps;
add to it whenever something costs time.

- Run flag: `--enable-flutter-gpu` (also set in the Android manifest and the
  macOS Info.plist).
- `EnvironmentSettings` carries `environment`, `skybox` and `sunLight` too:
  assigning it clears them, so set the look first and the sky after.
- `hook/build.dart` lists every `assets/city/*.fscene` for `buildScenes`
  (sorted) and compiles `.fmat` files with `buildMaterials`.

## Debug parks and the probe

`DriveView` registers states `zagreb.<park>` for each park in
`DriveGame.parks` (`square`, `ilica`, `cathedral`, `overview`) plus the live
`zagreb.driving`. Parks freeze everything animated so frames settle, and
are only `ready` once the streamer has loaded everything around them.

```sh
tool/ensure_device.sh
fvm dart tool/probe.dart states
fvm dart tool/probe.dart enterState --state zagreb.square
fvm dart tool/probe.dart frame --out artifacts/shot.png
fvm dart tool/probe.dart renderStats
fvm dart tool/probe.dart command --name look --ex -100 --ey 3 --ez 2 --tx 30 --ty 7 --tz 18
fvm dart tool/probe.dart command --name tune --exposure .5 --fog .001
tool/reload.sh [--restart]   # hot reload/restart the running build
```

## Verification gates

`fvm dart tool/verify.dart` runs `tool/verify/gates/*`: `analyze`,
`unit-tests`, `scene-assets`, `generator-determinism` (tier 1, no device),
`render-budget`, `render-nonfinite` (tier 1, device) and `frame-shots`
(tier 2, device; a moved frame is a review, not a failure). Ceilings for
`render-budget` live in `tool/verify/render-budget.txt`. See
`docs/verification.md`.
