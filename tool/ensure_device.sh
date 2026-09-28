#!/usr/bin/env bash
#
# ensure_device.sh — guarantee an emulator is booted AND a debug build is
# running with its VM service URI written to /tmp, so the device gates in
# tool/verify.dart and tool/probe.dart can reach it. (Ported from Doomscrool;
# Zagreb Drive has no Marionette, the vmservice file is the only registry.)
#
# Without this the loop's device gates skip (exit 77) on an unattended
# machine, and a skip is not evidence — a render change would ship unverified.
#
# Reuses whatever is already healthy rather than spawning duplicates. A
# previous run's orphaned `flutter run` plus a booted emulator are reusable
# leftovers, not a reason to start a second one: two debug sessions on one
# device contend, and the accumulation is a real resource leak.
#
# Usage:
#   tool/ensure_device.sh              # boot + run, wait for the probe
#   tool/ensure_device.sh --device-only # just boot the emulator
#   tool/ensure_device.sh --print-serial # boot it, print only the adb serial
#   tool/ensure_device.sh --stop       # stop the app session this started
#
# A physical phone is driven by setting ZAGREB_DEVICE to its adb serial;
# the frame-shots gate reads the same variable as its per-device baseline
# scope, so one variable names both the device and its frames.
#
# Exits 0 when the app is reachable, 1 when it could not be brought up.

set -uo pipefail

AVD="${ZAGREB_AVD:-Slim_1}"
# Left empty, the serial is resolved from the AVD name below. A console port is
# assigned at boot in the order emulators start, so emulator-5554 is only this
# AVD when it happens to be the first one up.
DEVICE="${ZAGREB_DEVICE:-}"
PACKAGE="com.joeitsolutions.zagrebdrive"
VMSERVICE="/tmp/flutter-zagrebdrive-vmservice.json"
RUN_LOG="/tmp/zagrebdrive-run.log"
PIDFILE="/tmp/zagrebdrive-run.pid"
DEVICEFILE="/tmp/zagrebdrive-run.device"
SDK="$HOME/Library/Android/sdk"
export PATH="$SDK/platform-tools:$SDK/emulator:$PATH"

cd "$(dirname "$0")/.." || exit 1

# Sends SIGTERM to a process and every descendant of it, deepest first. `fvm`
# is a shell wrapper whose child runs flutter_tools' dartvm, and killing only
# the wrapper leaves that child -- and the app on the device -- alive, which is
# how a superseded build keeps answering the probe.
stop_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    stop_tree "$child"
  done
  kill "$pid" 2>/dev/null
}

DEVICE_ONLY=0
PRINT_SERIAL=0
case "${1:-}" in
  --device-only) DEVICE_ONLY=1 ;;
  # For `-d "$(tool/ensure_device.sh --print-serial)"`: progress goes to stderr
  # so stdout carries the serial and nothing else.
  --print-serial) DEVICE_ONLY=1; PRINT_SERIAL=1 ;;
  --stop)
    stopped=0
    if [ -f "$PIDFILE" ]; then
      stop_tree "$(cat "$PIDFILE")"
      rm -f "$PIDFILE"
      stopped=1
    fi
    # Force-stop the app too. A process tree that survived (or a build from an
    # older session whose pidfile is gone) would otherwise keep answering
    # probe.dart, and the next ensure_device.sh would reuse the previous code.
    if [ -f "$DEVICEFILE" ]; then
      adb -s "$(cat "$DEVICEFILE")" shell am force-stop "$PACKAGE" >/dev/null 2>&1
      rm -f "$DEVICEFILE"
    fi
    if [ "$stopped" -eq 1 ]; then
      echo "stopped the debug session and force-stopped the app"
    else
      echo "no debug session of this tool's was recorded; force-stopped the app anyway"
    fi
    exit 0
    ;;
  "") ;;
  *) echo "unknown argument: $1" >&2; exit 64 ;;
esac

say() {
  if [ "$PRINT_SERIAL" -eq 1 ]; then
    echo "[ensure_device] $*" >&2
  else
    echo "[ensure_device] $*"
  fi
}

# Ask each running emulator its AVD name; the console answers with the name it
# was booted from. Prints nothing and returns 1 when this AVD is not running.
resolve_serial() {
  local serial
  for serial in $(adb devices | awk '/^emulator-[0-9]+[[:space:]]/ {print $1}'); do
    if [ "$(adb -s "$serial" emu avd name 2>/dev/null | head -1 | tr -d '\r')" = "$AVD" ]; then
      echo "$serial"
      return 0
    fi
  done
  return 1
}

# ---- 1. the emulator ------------------------------------------------------

if [ -z "$DEVICE" ]; then
  DEVICE="$(resolve_serial)"
fi

if [ -n "$DEVICE" ] && adb devices | grep -q "^${DEVICE}[[:space:]]*device$"; then
  say "$AVD already booted on $DEVICE"
else
  if ! emulator -list-avds 2>/dev/null | grep -qx "$AVD"; then
    say "AVD '$AVD' not found. Available: $(emulator -list-avds 2>/dev/null | tr '\n' ' ')"
    exit 1
  fi
  say "booting $AVD"
  # -no-snapshot-save keeps repeated unattended boots from growing the image.
  # -lowram lifts QEMU's 4 GB floor so the AVD's 1536 MB actually applies, and
  # -gpu host pins Metal: a swiftshader fallback would both cost gigabytes of
  # host RAM and make every render gate measure software rendering.
  nohup emulator -avd "$AVD" -no-snapshot-save -no-boot-anim -lowram -gpu host \
    > /tmp/zagrebdrive-emulator.log 2>&1 &
  # Not `adb wait-for-device`: that returns for any device, including a phone
  # plugged in over USB. Wait for this AVD's own console to answer instead.
  say "waiting for boot to complete"
  for _ in $(seq 1 90); do
    [ -z "$DEVICE" ] && DEVICE="$(resolve_serial)"
    if [ -n "$DEVICE" ] &&
       [ "$(adb -s "$DEVICE" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
      break
    fi
    sleep 2
  done
  if [ -z "$DEVICE" ]; then
    say "$AVD never appeared in adb devices within 3 minutes"
    exit 1
  fi
  if [ "$(adb -s "$DEVICE" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; then
    say "emulator did not finish booting within 3 minutes"
    exit 1
  fi
  say "$AVD booted on $DEVICE"
fi

# A physical phone that has gone to sleep (`mWakefulness=Dozing`) stalls the
# first frame: the scene never loads, so `ext.zagrebdrive.*` never publish and
# the wait below times out looking like a broken build. Wake it and keep it
# awake while it is plugged in. Harmless on an emulator, which is never dozing.
adb -s "$DEVICE" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
adb -s "$DEVICE" shell wm dismiss-keyguard >/dev/null 2>&1
adb -s "$DEVICE" shell svc power stayon true >/dev/null 2>&1

if [ "$DEVICE_ONLY" -eq 1 ]; then
  [ "$PRINT_SERIAL" -eq 1 ] && echo "$DEVICE"
  exit 0
fi

# ---- 2. a reachable debug build -------------------------------------------

# The probe exits 3 when nothing is reachable; anything else means the app is
# up and answering, so reuse it rather than launching a second session.
if fvm dart tool/probe.dart states >/dev/null 2>&1; then
  say "a debug build is already running and registered"
  exit 0
fi

say "starting a debug build on $DEVICE"
rm -f "$VMSERVICE"
nohup fvm flutter run -d "$DEVICE" --enable-flutter-gpu \
  --vmservice-out-file="$VMSERVICE" > "$RUN_LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "$DEVICE" > "$DEVICEFILE"

for _ in $(seq 1 450); do
  [ -f "$VMSERVICE" ] && break
  if grep -qE "Error: |FAILURE:|Gradle task .* failed" "$RUN_LOG" 2>/dev/null; then
    say "the build failed:"
    grep -E "Error: |FAILURE:|Gradle task .* failed" "$RUN_LOG" | head -5
    exit 1
  fi
  sleep 2
done

if [ ! -f "$VMSERVICE" ]; then
  say "no VM service after 15 minutes; see $RUN_LOG"
  exit 1
fi

say "VM service at $(cat "$VMSERVICE")"

# The scene loads and warms up after the first frame; the probe's extensions
# are published only once it has. Wait for them rather than racing the gates.
for _ in $(seq 1 80); do
  if fvm dart tool/probe.dart states 2>/dev/null | grep -q '"name"'; then
    say "probe is answering; device gates can run"
    exit 0
  fi
  sleep 3
done

say "the app started but never published ext.zagrebdrive.* — see $RUN_LOG"
exit 1
