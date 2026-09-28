# Verification

Ported from Doomscrool (read its `docs/verification.md` for the long
history). A gate is an executable in `tool/verify/gates/` that exits 0 pass,
77 skip, 78 review, anything else fail, and prints one JSON line for
`--describe`.

```sh
fvm dart tool/verify.dart              # everything that can run here
fvm dart tool/verify.dart --tier 1     # no-judgment gates only
fvm dart tool/verify.dart --only render-budget
```

| Gate | Needs | Decides |
| --- | --- | --- |
| `analyze` | — | `fvm flutter analyze` prints `No issues found!` |
| `unit-tests` | — | `fvm flutter test` prints `All tests passed!` |
| `scene-assets` | — | the baked chunks, collision and terrain data are consistent (`test/city_asset_test.dart`) |
| `generator-determinism` | — | `tool/generate_zagreb.dart` into an EMPTY scratch root reproduces `assets/city/` byte for byte, file set included |
| `render-budget` | device | per state in `tool/verify/render-budget.txt`: no mid-frame pipeline builds, colour-pass draws and total vertices under the ceiling |
| `render-nonfinite` | device | no NaN/Inf in any float target, with empty-frame guards |
| `frame-shots` | device | the parks still match the last accepted frame (review, never fail, on a move) |

Device gates need `tool/ensure_device.sh` first. Run device gates one at a
time; they all drive the same app.

## Render budget

Ceilings live in `tool/verify/render-budget.txt`. Readings are recorded here
with the date and the build they came from.

| Date | State | colour draws | total draws | vertices |
| --- | --- | --- | --- | --- |
| 2026-09-28 | phase 0, `zagreb.square` | 2 | 10 | 60 |
| 2026-09-28 | phase 1, `zagreb.square` | 22 | 100 | 317k |
| 2026-09-28 | phase 2, `zagreb.square` | 38 | 164 | 1.09 M |
| 2026-09-28 | phase 3 (car, 109 parts unmerged), `zagreb.square` | 152 | 380 | 2.0 M |
| 2026-09-28 | phase 3 (car merged per material), `zagreb.square` | 80 | 246 | 2.34 M |
| 2026-09-28 | phase 3, `zagreb.driving` at spawn | 61 | 183 | 2.08 M |
