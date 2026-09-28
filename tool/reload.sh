#!/usr/bin/env bash
# Hot-reloads (default) or hot-restarts (--restart) the debug build that
# tool/ensure_device.sh started, by signalling its `flutter run` process:
# SIGUSR1 is a hot reload, SIGUSR2 a hot restart. New or changed assets under
# assets/city/ are NOT picked up this way (the build hook compiles them); use
# `tool/ensure_device.sh --stop && tool/ensure_device.sh` for those.
set -uo pipefail
PIDFILE="/tmp/zagrebdrive-run.pid"
RUN_LOG="/tmp/zagrebdrive-run.log"
signal=USR1
[ "${1:-}" = "--restart" ] && signal=USR2
[ -f "$PIDFILE" ] || { echo "no debug session recorded"; exit 1; }
# The recorded pid is fvm's wrapper; the flutter tool is a descendant whose
# command line mentions flutter_tools.
find_tool() {
  local pid="$1" child
  if ps -o command= -p "$pid" 2>/dev/null | grep -q "flutter_tools"; then
    echo "$pid"; return 0
  fi
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    find_tool "$child" && return 0
  done
  return 1
}
tool=$(find_tool "$(cat "$PIDFILE")") || { echo "flutter tool process not found"; exit 1; }
before=$(( $(wc -l < "$RUN_LOG" | tr -d " ") + 1 ))
kill -"$signal" "$tool"
for _ in $(seq 1 120); do
  if tail -n +"$before" "$RUN_LOG" | grep -qE "Reloaded|Restarted application|Hot reload rejected|Error|error:"; then
    tail -n +"$before" "$RUN_LOG" | grep -E "Reloaded|Restarted|rejected|Error|error:" | head -5
    exit 0
  fi
  sleep 1
done
echo "no reload confirmation within 120 s; see $RUN_LOG"
exit 1
