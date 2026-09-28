# Flutter Scene rules

Hard-won gotchas from building Doomscrool's game with `flutter_scene`. Keep
entries to one or two lines, and add a new one whenever a session learns
something a future session would waste time rediscovering. `AGENTS.md`'s
"Flutter Scene (FScene)" section holds the setup, editor and asset-pipeline
rules; this file holds the traps.

## Runtime scene building

- `Node.localTransform` takes any affine matrix. Shear with `setEntry(0, 2, k)`
  (drift x along z) or `setEntry(1, 2, -slope)` (stand on a slope) instead of
  rewriting vertex data.
- Normals are transformed by that same matrix, so keep shears small; a strong
  one visibly mis-lights the surface.
- Clone editor templates for placement, and remove the templates themselves
  from the loaded scene, or they render where the editor parked them.
- Set a clone's `localTransform` outright. `position +=` keeps the template's
  editor offset, which is right for a template authored at the origin and
  wrong for one parked to the side.
- `Scene.warmUp` during a static loading screen. A "pipeline build took N ms
  mid-frame" log means a material was not in the warmed set.

## Skinned characters

- **Capture from a debug park, never from `running`, when comparing frames.**
  A "joints texture row alignment" bug was chased for a day on the strength
  of before/after captures taken in `templerun.running`, where distance --
  and so the weights bug's displacement -- grows with the seconds between
  entering the state and pressing capture. Re-tested from `shot` (24 m) and
  `far` (3 km) with normalized weights, a 2-joint skin's 4x4 joints texture
  renders correctly on the emulator (GLES) and on an Adreno 829 (Vulkan);
  upstream's smoke scene covers the same case. The floor of 16 that "fixed"
  it was a false positive and was withdrawn (upstream PR #415).
- **Skin weights that do not sum to 1 explode with distance from the origin.**
  A joint matrix is the joint's *global* transform, so its translation column
  carries the model's world position, and the shader's weighted sum scales
  that translation too. A vertex whose weights sum to 0.98 lands at 98% of
  the world position: 0.5 m out at 24 m, 60 m out at 3 km, kilometres out
  past that. The mesh looks perfect near the origin and grows black spikes
  as it travels, because the strays are anchored near the origin while the
  body is not. glTF requires normalized weights and exporters miss by a
  fraction of a percent (52 of this character's 7,325 vertices did), so the
  fork now normalizes in both skinned vertex shaders, and
  `tool/prepare_temple_runner.py` normalizes the asset too.
- **A small-scaled model lit black on an Adreno phone but not the emulator.**
  Seen on a glTF character with a 0.01 root scale: correct silhouette and
  shadow, but black with faint Fresnel rims, on a OnePlus (Adreno 829) while
  Slim_1 and Sky Drop's 45x-scaled car were fine. The `world_normal` debug
  view showed the mesh's normals as zero on that phone. `WorldNormalMatrix`
  returns the cofactor matrix, whose entries scale as the square of the model
  scale, so the world normal left the vertex stage at magnitude ~1e-4 -- and
  `v_normal`/`v_tangent` are mediump varyings, at the edge of fp16's 6.1e-5
  minimum. The fork now writes those varyings at unit length (`UnitOrZero`,
  `normal_transform.glsl`), verified black-to-lit on the same OnePlus. A
  Pixel 7a (Mali-G710) renders the model correctly with or without the
  change, so it is GPU-specific. Nothing to do with skinning.
- **The emulator and the phones run different Impeller backends**: Slim_1 is
  OpenGLES (`android_context_gl_impeller`), the OnePlus and Pixel are Vulkan
  (`android_context_vk_impeller`), and Slim_1's host GL is fp32 besides. A
  phone-only artifact is a backend *or* precision difference; check which
  with `adb logcat -d | grep "Impeller rendering backend"`.
- **Bisect a black or mis-lit mesh with the engine's debug views** rather than
  guessing: `scene.debugViewId = 'world_normal'` (also `face_orientation`,
  `base_color`, `shading_normal`, `world_position`, `view_direction`; the ids
  are in `render/debug_view.dart`). A `--dart-define` hook that sets it in
  `TempleScene.initialize` turned four hypotheses into one capture.
- Tinting a material red with its textures removed (`baseColorFactor`, the
  method upstream issue #123 used) separates "uniforms don't arrive" from
  "textures don't sample" from "lighting is zero" in one build.
- When a skinned mesh misbehaves, **check it at distance, not just at the
  start**. Anything that scales the joint matrix (a weight deficit, a
  precision loss) is invisible near the origin and obvious at 3 km, and the
  pinned frame gates only park near the origin.
- `AnimationClip` channels bind by node **name**, though glTF itself targets
  node *indices*. A converted model that names a mesh node after the bone it
  hangs under drives the wrong node, and the first match wins. Check for
  duplicate node names before blaming the engine
  (`tool/prepare_temple_runner.py` fixes them).
- Never write a skinned mesh node's own `localTransform`: glTF requires it to
  be ignored and the engine passes identity, so the write silently does
  nothing. Put the pose on a plain wrapper node above it; joints walk every
  ancestor, so a wrapper's translation *and* scale reach the skeleton.
- A looping clip means the view never settles, so a pinned frame gate can
  never match. Give every debug park a way to freeze the clip at a defined
  time, and report that in the park's `ready` — a paused clip still poses the
  skeleton, so the still is a real pose, not the bind pose.
- A rigid model swap is a Y scale; a character swap is not. Scaling a
  character to crouch it squashes the mesh and mis-lights it, because normals
  are transformed by the same matrix. Lean it about the feet instead:
  `acos(target / height)` puts the head at exactly the target height with the
  body rigid.
- Judge a skinned import by its **bind pose** first (don't play a clip). It
  separates a bad rig or a bad import from a bad animation binding in one
  capture.

## Shaders and devices

- Rendering artifacts on Android only (shadow stripes, banding) usually mean
  half precision: Impeller's headers make every `sampler2D` mediump, which
  Adreno and Mali honour and Metal ignores. Declare samplers holding depth,
  positions or indices `highp` in the fork's shaders.
- The fork's build hook rebuilds shader bundles into `flutter_scene_generated/`
  when `shaders/` change. Targets are `metalDesktop`, `openglEs` and
  `openglEs,vulkan`; check the one the device actually uses, since bundles for
  other targets can be stale.

## Tools that write scene assets

- Shared helpers live in `tool/src/fscene_writer.dart` (`MeshWriter`,
  `FsceneFile`). Payload layout `unskinned_soa_uv1_tangent` is 72 bytes per
  vertex: position, normal, UV0, UV1, colour, tangent.
- Payload vertex colours are LINEAR (`flutter_scene_standard.frag` multiplies
  them in after `SRGBToLinear(baseColorTex)`): convert palette hexes first.
- A resource minted before `removeTemplates` renumbers a template's ids on
  that first run; a second run converges to the stable, reproducible ids.
- Give each generator its own id range (`FsceneFile(firstToken:)`) and release
  ids when deleting nodes, so a rerun mints the same ids and writes
  byte-identical assets. Verify with `cmp` after every generator change.
- When several generators write one document the write order is load bearing:
  `generate_coast_city.dart` must run LAST, or 177k bytes of `ramp-racer.fscene`
  come back reordered even though the scene parses identically and the payload
  sidecar matches. `tool/verify/gates/generator-determinism` enforces it.
- Record a root node's index before removing it. Removing several roots and
  re-inserting at the indices recorded during removal reverses their order.
- Inside an `FsceneFile` subclass, write `this.json`: `dart:convert` exports a
  top-level `json`, which shadows the inherited field.
- Match neighbouring texel density instead of inventing one. The ramp kit's
  concrete UVs are world-planar at one tile per 5 m.
- A template that tiles end to end needs a UV period that divides its length.
  Otherwise every join jumps by the remainder: the 12 m temple tile uses 4 m,
  because 5 m would leave a 0.4-repeat jump.
- Create a new material before `removeTemplates` with a pinned `presetId`,
  not after the reclaim: creating it late keeps the ids but reorders the
  resources map on run 2.
- A generator whose output is in `hook/build.dart`'s `buildScenes` can't
  bootstrap via `dart run` once the document is missing again — the build
  hook runs first and dies on the file the script would have written. Use
  plain `fvm dart tool/generate_x.dart` for that one first run.
- Route every output path through `assetPath()` (`tool/src/fscene_writer.dart`),
  which prefixes `DOOMSCROOL_ASSET_ROOT` when set. `generator-determinism` runs
  the generators against a scratch root seeded with the committed artifacts, so
  a new generator that hardcodes `assets/...` writes the tracked tree during the
  gate *and* compares itself against what it just wrote — a vacuous pass.
- Prove a determinism check is not hollow by perturbing each generator
  separately and watching the right artifact go red. A scratch seeded with
  byte-identical copies prints `identical` just as happily for a generator that
  silently wrote nothing at all.

## Render-graph capture from the running game

- `Scene.debugAllowRenderGraphCapture = true` must be set before the first
  frame or the capture branch is compiled out. `SceneProbe.arm()` does it in
  `main.dart`; `SceneProbe.attach` publishes `ext.doomscrool.*` after the scene
  loads, and `tool/probe.dart` calls them.
- Call `SceneProbe.attach` from the mounted game view's `initState`, not from
  its loader. With a debug game switch, an abandoned load finishes later and
  would repoint the probe at a scene that is no longer on screen.
- `enterState` skips `enter` when the state's `ready()` already holds. A new
  debug park that changes the pose must fail every pinned `<game>.shot`'s
  `ready`, or entering the shot after it is a no-op and the frame is wrong.
- `GameStartup` reads the game selector once. To switch games, rebuild
  `DoomscroolApp` under a new `ValueKey`; `setState` alone keeps the old game.
- **A player-facing random game pick has to be pinned for the gates.** The
  rotation picks a game at random per launch, but every device gate needs the
  same starting game or `render-budget`, `render-nonfinite` and `frame-shots`
  measure a different scene run to run. `_DebugGameHost` pins
  `debugPinnedSelector` and `--dart-define=DOOMSCROOL_RANDOM_GAME=true` opts
  back into the real rotation for on-device evidence. Note the define is read
  with `bool.fromEnvironment`, i.e. a **compile-time** constant: exporting a
  shell variable of that name does nothing, and the flag only takes effect on
  a rebuild.
- Reading ONE full-resolution snapshot on its own returns a cleared texture
  that is entirely zero. Read every float target of the capture in order and
  keep the one you want; the sweep is what makes the copies valid. It still
  fails roughly one capture in three, so retry, and never report an all-zero
  buffer as a reading.
- `renderStats` is passive: it reports the last frame that rendered on its own,
  and a `SceneView` only redraws when something changes. Ask a parked game view
  and it answers `draws=0`, which clears every budget ceiling. Force one frame
  with a metadata-only capture first.
- A non-finite scan of a frame that drew nothing is vacuously clean, and so is
  a scan of buffers whose readback came back empty. Assert the frame drew
  something AND that the targets hold non-zero data before trusting "clean".
- `directional_shadow_map` and the MSAA scene colour never survive the
  snapshot copy, so they cannot be scanned or sampled this way.
- **`scanned` counts targets the readback *produced*, not targets that hold
  data.** A cleared, all-zero buffer scans perfectly clean, so a gate that
  only asserts `scanned > 0` can be vacuously green. `nonFinite`'s
  `withContent` is the real content signal. Related: `unscanned` and
  `failedCopies` are permanently non-empty (the two above), so coverage can
  shrink without any guard firing.
- **A gate that declares a `state` in its `--describe` is driven into exactly
  one game by `tool/verify.dart` and can never see another.** Dropping
  `state` and self-driving from `probe.dart states` is how a gate covers
  every registered game — `render-budget` and `render-nonfinite` both do it,
  and both fail loudly on a discovered game their per-game table doesn't
  cover rather than skipping it.
- Identical geometry far down a course does not render byte-identical to
  the start: shadow-map texels align differently, so shadow edges shift
  (`templerun.far` at 3 km moved about 1.9k px). Compare a far frame only
  against its own far baseline, never against the start frame.
- `templerun.running` is a real `Random.secure()`-seeded run with nobody
  swiping, so it dies on the first obstacle in well under a second (`TempleRun
  .step` freezes state at death, so the scene keeps rendering that last pose,
  not a blank one). Measured across 16 attempts on Slim_1: draws/vertices
  climb for 2-6 frames then plateau at the death frame, and by the time a
  second `fvm dart run tool/probe.dart` process has spun up to call
  `renderStats`, `states` already reports the run `ready: false` -- so the
  reading `render-budget` takes is always the death frame, not a mid-run
  one. That is fine here (the plateaued count is what got measured and
  ceilinged), but do not assume `ready` is still true by the time you look,
  and do not expect a longer average survival from a faster caller.
- A render budget measured at the start of a course is only valid if the
  render graph is **flat with distance** -- check that before trusting it.
  Temple Run's is, by construction: `TempleLayout.tileCount` pins the pool at
  20 tiles and `TempleScene.advanceTo` only rewrites transforms, so
  `templerun.far` at 3 km reads 59 draws against 51-58 at the start. A game
  that streams in new geometry instead of recycling would blow a start-measured
  ceiling deep in a run, and the gate would look like it regressed when the
  ceiling was simply wrong. Read the deep parks before picking the number.

- **`culled` was a constant 0 because the counter sat downstream of the
  culling.** `RenderScene.cull` -> `Bvh.query` rejects a whole subtree at an
  interior node and never touches the leaf items, so `SceneEncoder.submit` --
  the only place that touches `submitted`/`culled` -- never saw a culled item.
  The lone `culled++` was in the per-*instance* `cullInstances` branch, off by
  default. Fixed 2026-09-20 by having `Bvh.query` report visited-vs-total and
  the **colour pass only** charge `itemCount - visited`; `cull` has nine call
  sites and `collectMaterialInputs` renders nothing, so counting inside `cull`
  would double-count across passes.
- **Frustum culling is not occlusion culling, and the numbers look wrong until
  you remember that.** Sky Drop rejects only 20-32 of 361 considered items,
  because 356 individually-bounded rooftops sit 566-1731 m *ahead* of the
  camera inside a widening frustum: fog and the ramp hide them from the eye,
  not from the frustum test. The same `cull` rejects most of the scene for the
  tight shadow cascade (104 shadow draws vs 336 colour). Judge a low `culled`
  against where the geometry actually is before calling it a bug.
- **A counter that cannot be non-zero reads exactly like an optimiser that is
  not running.** The `culled=0` question sat in the backlog as "either culling
  is off or the bounds are too large" when the real answer was neither. Before
  theorising about a zero metric, check whether anything on its path can
  increment it.

## Checking the result

- With marionette down, `adb shell input swipe x1 y1 x2 y2 150` on the
  game viewport drives real swipes into the running game, and an
  `exec-out screencap` right after it can catch a lane change mid-flight.
- The editor's title bar reads `project · file.fscene`; check it before
  `open_document`, which discards unsaved editor edits. Bring the window
  forward with `open -a ...` first or screenshot tools hang.
- The editor can answer MCP with no window at all: System Events counts 0
  windows, and `open -a` does not bring one up. Its screenshot tools then hang.
  Check `count windows` before relying on the editor for stills.
- `marionette hot-restart` restarts the isolate but does not reliably
  recompile changed sources, so the app can keep rendering code you already
  reverted. Capture a frame baseline only from a fresh `flutter run`, or you
  bake stale code into it and every later run reports a change that is not
  there. Reload first, restart second, when you need both new code and a
  re-run `initState`.
- `tool/ensure_device.sh --stop` kills only the `fvm` wrapper. The flutter
  tool and the app keep answering the probe, so the next bring-up reuses the
  stale build. Kill the wrapper's children (`pgrep -P`) and `adb shell am
  force-stop com.joeitsolutions.doomscrool` first.
- An unstarted Temple Dash run's start card hides the corridor beyond about
  15 m in an `adb screencap`. For a still of a debug park, use `probe.dart
  frame`, which captures the scene without the overlay.
- **A pinned shot only proves what its own park can see.** Slice 13 put coins
  down every lane of the temple corridor and `templerun.shot` still compared
  `same`: that park sits at d = 0 and the coins start at d = 80 m, past where
  the exponential-squared fog has swallowed the corridor. The gate was honest
  and vacuous at once. When a change adds geometry, check where the pinned
  park is looking before reading `same` as evidence — and expect no exit 78
  from content beyond the fog.
- Driving a real run for a screenshot beats parking when the shot needs
  *state* (a collected-coin count, a score). Per-shot `adb exec-out screencap`
  round-trips are too slow to catch a narrow window at 24 m/s; `adb shell
  screenrecord` plus an `ffmpeg` frame extraction catches it.
- The editor only shows authored templates. To see runtime-assembled geometry,
  run on the emulator with a temporary `--dart-define` hook that parks the
  player on the piece, then `adb exec-out screencap -p`. Remove the hook after.
- The `Slim_1` AVD brings Impeller up on **OpenGLES**, not Vulkan
  (`android_context_gl_impeller.cc` says which at launch; the boot log also
  warns "Guest Angle is still unstable for API > 35"). Check that line before
  trusting a shader fix: the fork's bundles are built per target, so an
  `openglEs,vulkan` bundle can be stale while `openglEs` is the one in use.
  Frame baselines captured on a Vulkan device do not transfer — re-baseline.
- The emulator's console port is assigned in boot order, so `emulator-5554` is
  not a fixed name for our AVD. Resolve it with `adb -s <serial> emu avd name`,
  or take `tool/ensure_device.sh --print-serial`. `adb wait-for-device` is worse
  than useless here: it returns for a USB-attached phone too.
- **`ensure_device.sh`'s "no VM service after 5 minutes" is usually guest memory,
  not the build.** `adb logcat -d | grep -E 'failed to attach|start timeout'`
  tells them apart: "Process ... failed to attach" then "Killing ... (adj
  -10000): start timeout" means the 207 MB debug APK could not call
  `ActivityThread.attach()` inside Android's ~10 s window, before Dart runs at
  all — so it is never a Dart-side bug. Seen twice in a row on 2026-09-20 with
  `com.google.android.gms.persistent` holding 102 MB and GMS extending its own
  start timeout in the same seconds. `~/.local/bin/avdslim on <serial>`
  (AGENTS.md's bloat pass, ~24 packages) fixed it on the next attempt; the
  packages come back after a wipe, so a run that suddenly cannot launch is
  worth an `avdslim on` before any code hypothesis. Each attempt costs 5+
  minutes, so check logcat before retrying blind.
- The editor's in-app menu bar ignores synthetic clicks (System Events and
  CGEvent alike), though clicks on panels land with a 32 pt title-bar
  offset. To dock a panel such as **Render Graph**, quit the editor, splice
  it into `dockLayout` in `~/Library/Application Support/FlutterSceneEditor/
  settings.json`, and relaunch: the layout is read at startup and rewritten
  on quit, so edit it only while the editor is closed.
- The editor's `renderStats.latest` (MCP `get_render_stats`, the Render
  Graph strip) reads `draws 0 / views 0` whenever the viewport is parked;
  something records empty frames continuously. Set a *changed* viewport
  camera and read or screenshot within about a second, while the orbit
  transition keeps the viewport rendering.
- `flutter test --enable-impeller --enable-flutter-gpu` cannot run the
  fork's GPU-gated `testWidgets` on macOS: the hook builds a `metal_desktop`
  bundle for the host while `flutter_tester` renders Impeller on
  Vulkan/SwiftShader, so `initializeStaticResources` dies with `Failed to
  unpack shader`. Without the flags those tests return early
  (`_gpuAvailable()` is false), so a 0 s "All tests passed" is vacuous.
  Regression coverage that actually runs goes in `examples/smoke_render`
  under `flutter drive -d macos --enable-impeller --enable-flutter-gpu
  --dart-define=SMOKE_ONLY=<id>`; the driver writes each scene's frame to
  `build/smoke/<id>.png`, and that is the harness upstream CI runs on every
  backend.
