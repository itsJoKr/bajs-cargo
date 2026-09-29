# Zagreb Drive rules

Hard-won gotchas. Keep entries to one or two lines, and add a new one
whenever a session learns something a future session would waste time
rediscovering. `AGENTS.md` holds the setup; this file holds the traps.
(Flutter / flutter_scene traps went with the app to the `flutter-archive`
branch.)

## City pipeline (tool/)

- The `clipper2` Dart port's `Clipper.rectClip` can throw a RangeError on
  real city paths; intersect with a rectangle path instead. A union whose
  subject is empty returns empty, not the clip.
- Moving vertices by `a + (b - a) * 1.0` instead of using `b` changes the
  last bit of a float; keep exact endpoints when subdividing, or reruns and
  comparisons drift.
- Prove a before/after comparison is not hollow: `cmp` the export against a
  copy taken before the change, and perturb something on purpose once to
  see it go red.

## gen-image and Street View

- `codex exec` for gen-image: put `-i photo.png` AFTER the prompt (`-i`
  takes any number of files and swallows the prompt otherwise) and close
  stdin (`stdin=DEVNULL` / `< /dev/null`), or it waits forever for more
  prompt input.
- Street View via Maps URLs: `pano=<id>` only resolves official panoramas;
  a user photosphere needs the `@lat,lng,3a,<fov>y,<h>h,<t>t/data=!3m4!1e1
  !3m2!1s<id>!2e10` form. Screenshots saved by the Chrome extension land in
  a per-session `claude-chrome-screenshots-*` directory; name it explicitly.
- The first facade prompt removed shop signs and lettering; the user wants
  faithful copies. Never prompt a facade "clean".

## three.js and Rapier

- GLTFLoader sanitizes node names (`/`, `.`, `:`, `[`, `]` are dropped), so
  `chunk_e0_n0/facade` arrives as `chunk_e0_n0facade`. Identify exported
  meshes by their glTF material name instead.
- The Chrome extension froze on the game page twice (screenshots and
  `Runtime.evaluate` timed out, then the tab group vanished). Use
  `web3d/tools/shot.mjs` (its own headless Chrome over CDP) for stills and
  console output instead.
- Rapier's `DynamicRayCastVehicleController` applies the brake only to a
  wheel with zero engine force, has no rolling resistance by default (a
  coasting car rolls forever), and `setIndexForwardAxis` is a setter
  property, not a method (`controller.setIndexForwardAxis = 2`).
- A "holds on a slope with the brake" check is vacuous when the brake pedal
  reverses at a standstill: the car drives away backwards and `speed < 0`
  passes. Hold with the handbrake and measure the drift.
- Copernicus GLO-30 is a surface model: in dense old towns nearly every
  pixel is mostly roof. Dropping covered pixels fills a hilltop from the
  valley; subtract the building heights instead (`tool/prepare_terrain.py`).
