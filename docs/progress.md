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
