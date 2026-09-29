#!/usr/bin/env bash
# Generates the raw style-kit images with the gen-image skill (Codex CLI,
# gpt-image-2) into the git-ignored .art/gen/<name>/<name>.png. Resumable:
# an image that already exists is skipped. tool/prepare_textures.py turns
# the raws into the committed atlases; the prompts below are the record of
# how every raw was made.
#
#   tool/gen_textures.sh [name ...]   # default: everything missing
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
OUT=.art/gen
PARALLEL=${PARALLEL:-3}
# The configured default model (gpt-6-astra) needs a newer Codex CLI than
# 0.144.6; gpt-5.5 works with a ChatGPT account.


FACADE_RULES="Perfectly orthographic, straight-on front elevation, no perspective, no vanishing lines. The image shows exactly 4 identical window bays side by side, filling the full width edge to edge, each bay exactly one quarter of the width, with the facade continuing past both side edges so the image tiles seamlessly left to right. From bottom to top: a tall ground floor occupying the bottom 28% of the image height, a first floor occupying the next 22%, two identical upper floors occupying the next 20% each, and a cornice band at the very top occupying the top 10%. Floors are exactly level and aligned across all 4 bays. The plain wall stucco is painted a flat very light warm grey (#E6E2DA) so it can be tinted later; window frames, mouldings, cornices and ornament are a slightly darker warm stone colour so they separate from the wall. Evenly lit soft overcast daylight, no cast shadows falling across the facade, no people, no cars, no trees, no signs, no lettering, no graffiti, no sky, no roof, no pavement, no street. Photorealistic texture for a 3D city game, 1024x1024."

SURFACE_RULES="Seamless tileable texture, perfectly top-down orthographic view filling the frame edge to edge, flat even diffuse lighting with no directional shadows, no perspective, no objects, no text, no border, equal brightness at all edges so it tiles on both axes. Photorealistic material for a 3D city game, 1024x1024."

declare -a NAMES PROMPTS
add() { NAMES+=("$1"); PROMPTS+=("$2"); }

add facade_historicist_a "A late-19th-century Austro-Hungarian historicist (neo-Renaissance) apartment house facade in Donji grad, Zagreb, Croatia. Tall rectangular windows with triangular and segmental pediments on the first floor, moulded window surrounds on the upper floors, string courses between floors. Ground floor: rusticated stone base with arched shop windows and dark wooden shop fronts. $FACADE_RULES"
add facade_historicist_b "A neo-Baroque historicist palace facade in central Zagreb, Croatia, with shallow pilasters between the bays, decorative window crowns with shell ornaments and balustrade panels below the first-floor windows. Ground floor: rusticated stone base with large round-arched shop windows. $FACADE_RULES"
add facade_historicist_plain "A modest 1880s apartment house facade in Donji grad, Zagreb, Croatia: simple tall rectangular windows with flat moulded surrounds and small cornice caps, thin horizontal string courses. Ground floor: plain shop fronts with dark wooden frames and a wooden door. $FACADE_RULES"
add facade_secession_floral "A 1905 Viennese Secession (Art Nouveau) apartment house facade in Zagreb, Croatia: windows with gently curved tops, floral stucco reliefs and wreaths between the windows, delicate linear ornament under the cornice. Ground floor: shop windows with curved Secession frames. $FACADE_RULES"
add facade_secession_late "A 1910 late-Secession geometric apartment house facade in Zagreb, Croatia: vertical relief panels between the bays, paired square windows, stylised geometric stucco ornament. Ground floor: large glazed shop windows with slim dark frames. $FACADE_RULES"
add facade_interwar "A 1930s Zagreb interwar modernist (functionalist) apartment building facade: completely plain smooth render, wide horizontal windows with thin white frames, no ornament, a thin projecting ledge at each floor. Ground floor: wide glazed shop fronts under a thin flat canopy. $FACADE_RULES"
add facade_postwar "A 1960s socialist-modernist infill building facade in Zagreb, Croatia: a regular grid of rectangular windows set in exposed concrete frames, grey horizontal spandrel panels between floors. Ground floor: aluminium-framed glass shop fronts. $FACADE_RULES"
add facade_baroque_upper "An 18th-century Baroque townhouse facade from Zagreb's Upper Town (Gornji grad): small rectangular windows with simple stone frames and dark green wooden shutters, thick smooth walls, a modest profiled eaves cornice. Ground floor: a small round-arched wooden gateway and small barred windows. $FACADE_RULES"
add facade_biedermeier "An 1840s Biedermeier classicist house facade in Zagreb, Croatia: tall simple windows with flat surrounds, thin flat pilasters, very restrained ornament, a simple dentil cornice. Ground floor: small shop windows and a panelled wooden door. $FACADE_RULES"
add facade_arcade "A historicist building facade in central Zagreb whose ground floor is an open arcade of round arches on rusticated stone piers over a shaded walkway; above it tall windows with pediments and moulded surrounds. $FACADE_RULES"
add facade_commercial "A contemporary commercial building facade in central Zagreb: large rectangular glass windows with slim dark metal frames set in pale limestone cladding panels. Ground floor: full-height glass shop fronts. $FACADE_RULES"
add facade_courtyard "The plain rear courtyard facade of an old Zagreb apartment house: small simple rectangular windows, a few with simple metal balcony railings, slightly weathered plain stucco with faint water stains, no ornament. Ground floor: plain wall with small windows and a plain door. $FACADE_RULES"

add surf_asphalt "Dark grey city street asphalt with fine aggregate, subtle worn patches and faint tyre polish, no road markings. $SURFACE_RULES"
add surf_sidewalk "A city sidewalk of light grey square concrete paving slabs about 40 cm across with thin joints, slightly worn. $SURFACE_RULES"
add surf_square "Large rectangular pale beige-grey stone paving slabs of a historic European city square, in a regular running-bond pattern, lightly worn and polished. $SURFACE_RULES"
add surf_grass "A well-kept city park lawn, short green grass with slight colour variation. $SURFACE_RULES"
add surf_gravel "A light sandy fine gravel park path, pale beige, compacted, with a few small pebbles. $SURFACE_RULES"
add surf_kerb "The flat side face of light grey granite kerb stones, speckled granite, with a thin joint between stones. $SURFACE_RULES"
add surf_roof_clay "Weathered red-brown clay roof tiles (Central European beaver-tail and interlocking tiles) on a pitched roof seen straight on, rows running horizontally, subtle moss and colour variation. $SURFACE_RULES"
add surf_roof_flat "A flat roof covered with grey bitumen roofing felt and scattered small gravel. $SURFACE_RULES"
add surf_roof_copper "Oxidised copper roof sheeting with standing seams running vertically, pale green verdigris patina with some darker streaks. $SURFACE_RULES"
add surf_cobbles "Old grey granite cobblestones of a historic Upper Town street, small square setts in curved rows. $SURFACE_RULES"
add surf_stucco "Plain light warm grey painted stucco render wall, very subtle texture and faint weathering, perfectly uniform light colour (#E6E2DA). $SURFACE_RULES"

# Roof set (web3d roof atlas, tool/prepare_roofs.py): each image covers a
# known roof area, so the prompts fix the number of tile rows or seams.
ROOF_RULES="Seamless tileable roof covering texture, seen perfectly straight-on and perpendicular to the roof plane (orthographic, no perspective, no horizon, no sky, no ridge, no eaves, no chimneys, no windows), filling the frame edge to edge, flat even diffuse overcast lighting, equal brightness at all edges so it tiles on both axes. Rows run exactly horizontally. Photorealistic material for a 3D city game, 1024x1024."

add roof_biber_old "Old weathered Central European beaver-tail (Biberschwanz) clay roof tiles in a double-lap pattern, exactly 12 rows of tiles from top to bottom and about 16 tiles across, warm red-brown terracotta with darker soot, faint lichen and a few replaced lighter tiles, as on 19th-century roofs in Zagreb. $ROOF_RULES"
add roof_clay_red "Newer orange-red interlocking clay roof tiles (Falzziegel, Mediterranean-style ribbed profile), exactly 10 rows of tiles from top to bottom and about 10 tiles across, clean with slight colour variation between tiles. $ROOF_RULES"
add roof_clay_brown "Dark aged brown clay roof tiles with rounded ends, exactly 12 rows from top to bottom, heavy soot, dark weathering streaks and patches of moss, as on old courtyard buildings in a Central European city. $ROOF_RULES"
add roof_clay_pale "Sun-bleached pale salmon-orange clay roof tiles with rounded beaver-tail ends, exactly 12 rows from top to bottom, faded and dusty with gentle tile-to-tile colour variation. $ROOF_RULES"
add roof_slate_grey "Grey fibre-cement (eternit) roof slates laid in a diamond pattern, exactly 10 rows of diamonds from top to bottom, medium grey with slight weathering and faint streaks, as on post-war and 1930s roofs in Zagreb. $ROOF_RULES"
add roof_zinc_dark "Dark grey zinc standing-seam sheet metal roof, exactly 8 evenly spaced thin raised seams running vertically from top to bottom, matte slightly weathered zinc with faint streaks. $ROOF_RULES"
add roof_copper_green "Oxidised copper standing-seam roof sheeting, exactly 8 evenly spaced raised seams running vertically from top to bottom, pale green verdigris patina with darker streaks and slight colour variation, as on church and palace roofs in Zagreb. $ROOF_RULES"
add roof_flat_gravel "A flat roof covered with dark grey bitumen membrane and scattered light gravel, a faint seam line across it, weathered. $ROOF_RULES"

want=("$@")
run_one() {
  local name="$1" prompt="$2"
  local dir="$OUT/$name"
  mkdir -p "$dir"
  if [ -f "$dir/$name.png" ]; then echo "skip  $name"; return 0; fi
  for attempt in 1 2; do
    (cd "$dir" && codex exec -m "${CODEX_MODEL:-gpt-5.5}" --sandbox workspace-write --skip-git-repo-check \
      "Generate an image: $prompt Save the generated image exactly as produced (no post-processing, cropping, resizing or filtering) as $name.png in the current directory \$imagegen" \
      > codex.log 2>&1)
    if [ ! -f "$dir/$name.png" ]; then
      found=$(ls -t ~/.codex/generated_images/*.png 2>/dev/null | head -1)
      [ -n "$found" ] && [ "$found" -nt "$dir/codex.log" ] && mv "$found" "$dir/$name.png"
    fi
    if [ -f "$dir/$name.png" ]; then echo "done  $name"; return 0; fi
  done
  echo "FAIL  $name (see $dir/codex.log)"
  return 1
}

running=0
for i in "${!NAMES[@]}"; do
  name="${NAMES[$i]}"
  if [ ${#want[@]} -gt 0 ] && [[ ! " ${want[*]} " =~ " $name " ]]; then continue; fi
  run_one "$name" "${PROMPTS[$i]}" &
  running=$((running + 1))
  if [ "$running" -ge "$PARALLEL" ]; then wait; running=0; fi
done
wait
