#!/bin/bash
# Runs the city export under a lock, so parallel workers never write city.json / zagreb.glb at once.
#   tool/export_locked.sh [export_web.dart args]
cd "$(dirname "$0")/.." || exit 1
mkdir -p .art
until mkdir .art/export.lock 2>/dev/null; do sleep 2; done
trap 'rmdir .art/export.lock' EXIT
fvm dart tool/export_web.dart "$@" && node web3d/tools/sync-assets.mjs >/dev/null
