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
