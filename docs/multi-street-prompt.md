# Prompt: recreate several streets in parallel (orchestrator)

Paste this into a fresh Claude Code session in the repo. The user must say "use a workflow"
or otherwise opt in to multi-agent orchestration, and must allow workers to edit files
(the standing rule is otherwise: sub-agents are review-only).

```
You are the orchestrator for Zagreb Drive (repo: current directory). Read AGENTS.md,
.claude/rules/zagreb-web.md and .claude/skills/recreate-building/SKILL.md first.
Goal: recreate N streets at once, faithfully from Street View, both sides, WITH 3D
decorations, then integrate them. The user has explicitly allowed sub-agents to EDIT
FILES for this task (normally they are review-only).

STREETS: <list, e.g. Gajeva ulica, Petrinjska ulica, Tkalčićeva ulica>.

0. PREREQUISITE (you, serial, before any worker starts). Today only `sign` features can
   carry an image (web3d/src/features.ts loads `features/<image>`); `box`, `awning`,
   `dome`, `terrace` and `scaffolding` take a flat colour. Add optional texture support
   to those types: fields `texture` (file under web3d/public/features/tex/) and `repeat`
   (metres per tile, default 1), applied as a tiling map on the mesh with the colour as a
   tint; keep colour-only features working. Check that the Dart export passes the new
   fields through (tool/export_web.dart / city.dart features), add one example on a
   Preradovićeva feature, screenshot it with shot.mjs, run `npm run check`, `node
   tools/sim.ts`, `fvm dart analyze`. Document the fields in the recreate-building skill's
   feature table.

1. PLAN (you, serial). For each street: list its walls (nearest named highway per todo
   wall in data/hero/coverage.json, then
   `fvm dart tool/list_hero_facades.dart --building ... > .art/streetview/<slug>_todo.json`).
   Give each street a slug and reserve: facade names `<slug>_*`, section file
   data/hero/<slug>.json, corner file data/hero/<slug>_corners.json, work dir
   .art/streetview/<slug>/, patch file data/patches/<slug>_buildings.json.
   Max 3 workers at once (one Chrome; the extension drops out under load).

2. WORKERS (Agent tool, one per street, in parallel, subagent_type general-purpose).
   Each worker owns ONLY its reserved names and files. Forbidden: any other street's
   files, data/buildings.json, data/hero/atlas.json, coverage.json, AGENTS.md, docs/,
   web3d/public/*, tool/*, `prepare_facades.py pack`, `export_web.dart`,
   `sync-assets.mjs`, git commits. Each worker:
   a. CAPTURE. Opens its OWN Chrome tab (tabs_create_mcp; never reuse another tab),
      Street View only. Finds official panos (the viewpoint URL snaps to indoor
      photospheres on pedestrian streets: probe several points, read the tab title),
      computes each pano's tool x,z from lat/lng ((lat-45.81303)*111132,
      (lng-15.97713)*77620), captures 8 headings per pano (fov 90; tilt 110/115/125 as
      in tool/prad_rect.py), one screenshot per call, wait 10 s, saves to
      .art/streetview/<slug>/. Chrome disconnect/freeze: tabs_context_mcp, open a new
      tab, retry; after 3 failures report and stop instead of looping.
   b. PICTURES. Rectifies walls from 1-3 HAND-PICKED frames that face the wall (copy
      tool/prad_rect.py into the work dir; never let sv_rectify pick from all frames).
      Walls under ~4 m from the pano cannot be rectified: crop/montage or invent.
      Writes data/hero/<slug>.json (photo, edges, bays, storeys, look with every sign
      spelled letter for letter, source says INVENTED where not seen). One entry per
      building, consecutive collinear edges only, print the real ring edge ids first.
      Chamfered/rounded corners (short edges) get a "corner" entry.
   c. GENERATE. Runs `prepare_facades.py crop|generate <names>` from a bash script
      (never zsh `$N`), in the background with polling, batches of 4; reviews every raw.png
      next to its photo (signs, diacritics, bays, storeys, no map overlay) and
      regenerates bad ones.
   d. DECORATE (required, 6-10 per street, written to the patch file in the shape of
      data/buildings.json). For each item MEASURE its height/position on the raw.png
      (rows = pavement..eave) so it does not duplicate a painted one:
        - awnings over shops (`awning`, y = bottom edge, depth 0.5-1.0),
        - scaffolding where the photo shows it (`scaffolding`),
        - cafe terraces where tables/umbrellas stand (`terrace`),
        - turrets/spires/domes on corner towers (`dome`, shape cone/onion),
        - projecting cornices and balcony slabs (`box`, out = depth/2 is flush),
        - blade/wall signs for the 2-3 most recognisable shops (`sign`, image via the
          green-screen recipe in the skill),
        - one real roof covering per house (`roof` from data/roofs.json; keep OSM shape
          unless the photo clearly shows another).
      Every feature has a `source`. Do not put decorations on INVENTED walls.
      TEXTURES for decorations (use /gen-image, not flat colours): every decoration gets its
      own small generated texture, so nothing is a plain coloured box. For each one, crop a
      reference from a Street View frame and run gen-image on it exactly as for facades
      (`codex exec -m gpt-5.5 --sandbox workspace-write --skip-git-repo-check "<prompt>" -i
      ref.png < /dev/null`, `-i` after the prompt, stdin closed, `\$imagegen`), in a bash
      script, 4 at a time. The prompt asks for a flat, straight-on, evenly lit, SEAMLESSLY
      TILEABLE texture of exactly that material as photographed (keep lettering, stripes,
      patina), no perspective, no shadows, no people; things that carry a name (an awning
      with a shop name) are drawn as one flat panel instead of a tile. Examples: striped or
      plain awning fabric with its lettering, wrought-iron balcony railing pattern, weathered
      stone or plaster cornice, scaffolding net and boards, copper/zinc/slate/tile turret roof,
      parasol fabric, shop-front blind, painted metal shutter. Downscale to 256-512 px, save as
      jpg (png only if it needs alpha, e.g. railings or nets, keyed from a #00FF00 background
      with tool/key_feature.py) under web3d/public/features/tex/<slug>_<name>.jpg, at most
      ~60 KB each, reference it as "texture" with "repeat" in metres (tile size), and keep
      "color" as the tint/fallback. Review each texture next to its reference (spelling,
      material, no seams, no map overlay) and regenerate bad ones. Reuse a texture for
      identical items on the same street. Workers add files only under their own prefix.
   e. RETURN: facades done, walls still plain (id, length), invented ones, decorations
      added, problems.

3. INTEGRATE (you, serial, after all workers return): merge the patch files into
   data/buildings.json; `.venv/bin/python tool/prepare_facades.py pack`;
   `fvm dart tool/export_web.dart`; `node web3d/tools/sync-assets.mjs` (stale atlas = other
   buildings' pictures on the new walls); screenshot every street with
   web3d/tools/shot.mjs (eye at the street centre, zg.look, fov ~70) and fix wrong walls
   or floating decorations; then `npm run check`, `npm run build`, `node tools/sim.ts`,
   `fvm dart analyze` (must print `No issues found!`). Update docs/progress.md and add
   new traps to .claude/rules/zagreb-web.md. Do not commit unless the user asks.

4. REPORT: per street walls/metres done, what was invented, what is still plain, the
   decorations, screenshots.
```
