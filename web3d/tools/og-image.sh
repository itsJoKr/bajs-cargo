#!/bin/bash
# The link preview (index.html's og:image): the bike on Ban Jelačić square, side on, with the statue
# and the Cathedral's spires behind and the title card over the sky. 1200x630, rendered at 2x.
# Needs the dev server (npm run dev); writes public/og.jpg. Walkers and pigeons differ every run.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

pose='(() => {
  document.getElementById("hud").hidden = true;
  zg.teleport(-8, -6, Math.PI * 1.2);
})()'
frame='(() => {
  const b = zg.vehicle.body.translation();
  zg.look([b.x - 5.5, b.y + 0.7, b.z + 1.5], [b.x + 10, b.y + 2.6, b.z - 4], 46);
})()'
card='(() => {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;top:40px;right:40px;width:410px;padding:26px 34px 30px;border-radius:24px;" +
    "background:var(--bajs-blue);box-shadow:0 10px 40px #0005;z-index:20";
  el.innerHTML =
    "<h1 style=\"margin:0;font-size:76px;line-height:1;font-weight:800;font-style:italic;letter-spacing:-0.01em\">" +
    "Bajs <span style=\"font-weight:400;font-style:normal\">Cargo</span></h1>" +
    "<p style=\"margin:14px 0 0;font-size:28px;line-height:1.3;opacity:.95\">" +
    "Deliver 8 packages around central Zagreb on a cargo bike.</p>";
  document.body.append(el);
})()'

node tools/shot.mjs --url "http://localhost:5180/?dpr=2&people=60" --size 1200x630 --wait-ready 120 \
  --eval "$pose" --sleep 2500 --eval "$frame" --eval "$card" --sleep 1500 --shot "$tmp/og.png" > /dev/null
sips -s format jpeg -s formatOptions 85 "$tmp/og.png" --out public/og.jpg > /dev/null
echo "public/og.jpg: $(sips -g pixelWidth -g pixelHeight public/og.jpg | awk '/pixel/ {printf "%s ", $2}')px, $(($(stat -f %z public/og.jpg) / 1024)) KB"
