/// Debug-only render introspection for the running game.
///
/// Ported from Doomscrool's probe. The running game on a real device is where
/// the interesting faults live (the half-precision traps in
/// `.claude/rules/flutter-scene.md` only reproduce on Adreno and Mali), so
/// this exposes render-graph observations over the VM service and a gate can
/// interrogate the game itself. `tool/probe.dart` is the client.
///
/// Everything here is behind [kDebugMode] so the capture branches stay
/// tree-shakeable in release, matching the engine's own default.
library;

import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:ui' show ImageByteFormat;

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_scene/gpu.dart' as gpu;
import 'package:flutter_scene/scene.dart';

/// One drivable state of a game: how to enter it, and how to tell you are
/// there.
///
/// A gate that reads the render graph wants the scene doing representative
/// work, not sitting on a menu. Each game declares its own states, so the
/// harness needs no knowledge of any particular game's widgets or controls.
class GameState {
  const GameState({required this.enter, required this.ready});

  /// Puts the game into this state. Called only when [ready] is false.
  final void Function() enter;

  /// Whether the game is in this state right now.
  final bool Function() ready;
}

/// Render-graph observations published as `ext.zagrebdrive.*` service
/// extensions. Call [arm] before the first frame and [attach] once the scene
/// exists.
abstract final class SceneProbe {
  static Scene? _scene;
  static bool _registered = false;

  /// Opts the engine into render-graph capture. Must run before the first
  /// frame; the capture branch is compiled out otherwise.
  static void arm() {
    if (!kDebugMode) return;
    Scene.debugAllowRenderGraphCapture = true;
  }

  /// Publishes the extensions against [scene]. Safe to call more than once.
  static void attach(Scene scene) {
    if (!kDebugMode) return;
    _scene = scene;
    if (_registered) return;
    _registered = true;
    _publish('frame', _frame);
    _publish('states', _statesList);
    _publish('enterState', _enterState);
    _publish('renderStats', _renderStats);
    _publish('passes', _passes);
    _publish('nonFinite', _nonFinite);
    _publish('readPixel', _readPixel);
    _publish('command', _command);
  }

  /// Free-form debug commands (`teleport`, `look`, ...) the game registers,
  /// called as `probe.dart command --name <name> [--arg value ...]`. Parks
  /// cover the pinned shots; commands are for looking anywhere else.
  static final Map<
    String,
    Future<Map<String, Object?>> Function(Map<String, String>)
  >
  _commands = {};

  static void registerCommand(
    String name,
    Future<Map<String, Object?>> Function(Map<String, String>) handler,
  ) {
    if (!kDebugMode) return;
    _commands[name] = handler;
  }

  static Future<Map<String, Object?>> _command(
    Map<String, String> parameters,
  ) async {
    final name = parameters['name'];
    final handler = _commands[name];
    if (handler == null) {
      throw ArgumentError(
        'Unknown command "$name". Registered: ${_commands.keys.join(', ')}',
      );
    }
    return handler(parameters);
  }

  /// Drivable states, keyed `<game>.<state>`.
  static final Map<String, GameState> _states = {};

  /// Declares [game]'s drivable states, replacing any it registered before.
  /// Call from the widget that owns the game's run lifecycle, and pair with
  /// [unregisterStates] in its dispose.
  static void registerStates(String game, Map<String, GameState> states) {
    if (!kDebugMode) return;
    unregisterStates(game);
    for (final entry in states.entries) {
      _states['$game.${entry.key}'] = entry.value;
    }
  }

  static void unregisterStates(String game) {
    if (!kDebugMode) return;
    _states.removeWhere((key, _) => key.startsWith('$game.'));
  }

  /// Every registered state and whether the game is in it right now.
  static Future<Map<String, Object?>> _statesList(Map<String, String> _) async {
    return {
      'states': [
        for (final entry in _states.entries)
          {'name': entry.key, 'ready': entry.value.ready()},
      ],
    };
  }

  /// Enters the state named by the `state` parameter and waits until the game
  /// reports it is there. Drive immediately before measuring: a live state
  /// (`zagreb.driving`) keeps moving.
  static Future<Map<String, Object?>> _enterState(
    Map<String, String> parameters,
  ) async {
    final name = parameters['state'];
    final state = _states[name];
    if (state == null) {
      throw ArgumentError(
        'Unknown state "$name". Registered: ${_states.keys.join(', ')}',
      );
    }
    if (state.ready()) return {'state': name, 'changed': false};

    state.enter();
    final timeout = Duration(
      milliseconds: int.tryParse(parameters['timeoutMs'] ?? '') ?? 20000,
    );
    final deadline = DateTime.now().add(timeout);
    var frames = 0;
    while (!state.ready()) {
      if (DateTime.now().isAfter(deadline)) {
        throw StateError(
          'Entered "$name" but it was not ready within '
          '${timeout.inMilliseconds}ms ($frames frames)',
        );
      }
      // Parks settle over a few ticks (streamed chunks load, the camera
      // snaps), so advance frames rather than sleeping blind.
      WidgetsBinding.instance.scheduleFrame();
      await WidgetsBinding.instance.endOfFrame;
      frames++;
    }
    return {'state': name, 'changed': true, 'frames': frames};
  }

  /// Test seam onto the same routing `states` uses, without going through
  /// `developer.registerExtension` or a VM service connection.
  @visibleForTesting
  static Future<Map<String, Object?>> debugStates() => _statesList(const {});

  /// Test seam onto the same routing `enterState` uses, without going
  /// through `developer.registerExtension` or a VM service connection.
  @visibleForTesting
  static Future<Map<String, Object?>> debugEnterState(
    Map<String, String> parameters,
  ) => _enterState(parameters);

  /// Clears every static registration -- live states and the attached
  /// scene -- so tests don't leak state into one another. `kDebugMode`-gated like everything else here, since
  /// tests run in debug mode too.
  ///
  /// Deliberately leaves `_registered` alone: `developer.registerExtension`
  /// throws if the same extension name is registered twice in one process,
  /// so once `attach` has published the `ext.zagrebdrive.*` handlers here,
  /// nothing -- including a test -- can safely ask it to do that again.
  @visibleForTesting
  static void debugReset() {
    if (!kDebugMode) return;
    _states.clear();
    _commands.clear();
    _scene = null;
  }

  static void _publish(
    String name,
    Future<Map<String, Object?>> Function(Map<String, String>) handler,
  ) {
    developer.registerExtension('ext.zagrebdrive.$name', (_, parameters) async {
      try {
        final value = await handler(parameters);
        return developer.ServiceExtensionResponse.result(jsonEncode(value));
      } catch (error, stack) {
        return developer.ServiceExtensionResponse.error(
          developer.ServiceExtensionResponse.extensionError,
          jsonEncode({'error': '$error', 'stack': '$stack'}),
        );
      }
    });
  }

  static Scene get _live {
    final scene = _scene;
    if (scene == null) throw StateError('SceneProbe has no scene attached');
    return scene;
  }

  /// Last completed frame's draw, culling, batching and pipeline counters.
  /// `AGENTS.md` asks for these before any frame-budget work; nothing was
  /// logging them.
  static Future<Map<String, Object?>> _renderStats(
    Map<String, String> parameters,
  ) async {
    // renderStats is passive: it reports the last frame that rendered on its
    // own, and the SceneView only redraws when something changes. Ask a
    // parked game view and it answers with a frame that drew nothing, which
    // would clear every budget ceiling. A metadata-only capture forces the
    // scene to render one real frame first, so the counters describe actual
    // work. Pass force=false for the passive reading.
    if (parameters['force'] != 'false') {
      await _capture(const RenderGraphCaptureRequest(captureImages: false));
    }
    final latest = _live.renderStats.latest;
    return {
      'frameCount': _live.renderStats.frameCount,
      'forced': parameters['force'] != 'false',
      'latest': latest?.toJson(),
    };
  }

  /// Arms a capture and schedules the frame that fulfills it. The engine times
  /// the arm out on its own if no frame renders (a hidden or zero-sized view),
  /// so this cannot hang its caller.
  static Future<RenderGraphCaptureResult> _capture(
    RenderGraphCaptureRequest request,
  ) {
    final future = _live.captureRenderGraph(request: request);
    WidgetsBinding.instance.scheduleFrame();
    return future;
  }

  /// Executed passes in order with CPU times and the buffer keys each moved.
  /// No images, so this is cheap enough to gate every iteration on.
  static Future<Map<String, Object?>> _passes(Map<String, String> _) async {
    final capture = await _capture(
      const RenderGraphCaptureRequest(captureImages: false),
    );
    return {
      'pixelWidth': capture.pixelWidth,
      'pixelHeight': capture.pixelHeight,
      'passes': [
        for (final pass in capture.passes)
          {
            'index': pass.indexInGraph,
            'name': pass.name,
            'cpuMicros': pass.cpuMicros,
            'draws': pass.draws.length,
            'skips': pass.skips.length,
            'reads': pass.reads,
            'writes': pass.writes,
          },
      ],
    };
  }

  /// Scans every float render target for NaN/Inf in execution order.
  ///
  /// A non-finite value does not crash: it propagates silently and surfaces as
  /// black or garbage several passes downstream, so the pass where the damage
  /// is visible is almost never the pass that caused it. `offenders` is in
  /// execution order, and the first entry is the origin.
  static Future<Map<String, Object?>> _nonFinite(Map<String, String> _) async {
    final capture = await _capture(
      const RenderGraphCaptureRequest(
        thumbnailMaxDim: null,
        fullResolution: true,
      ),
    );
    return _scan(capture);
  }

  static Future<Map<String, Object?>> _scan(
    RenderGraphCaptureResult capture,
  ) async {
    final offenders = <Map<String, Object?>>[];
    final unscanned = <String>[];
    final failedCopies = <String>[];
    var scanned = 0;
    // A buffer of all zeros holds no NaN either, so "clean" over readbacks
    // that came back empty is vacuously true. Count the targets that actually
    // carried a non-zero value so a gate can tell a real clean frame from a
    // readback that produced nothing.
    var withContent = 0;
    final detail = <Map<String, Object?>>[];
    for (final resource in capture.resources) {
      if (!_isFloatFormat(resource)) continue;
      // An exhausted pool reports the copy as failed rather than throwing.
      if (resource.snapshotFailed) {
        failedCopies.add(resource.key);
        continue;
      }
      final snapshot = resource.snapshot;
      final floats = snapshot == null ? null : await _readFloats(snapshot);
      if (floats == null) {
        unscanned.add(resource.key);
        continue;
      }
      scanned++;
      var nans = 0;
      var infs = 0;
      var nonZero = 0;
      for (final value in floats) {
        if (value.isNaN) {
          nans++;
        } else if (value.isInfinite) {
          infs++;
        } else if (value != 0) {
          nonZero++;
        }
      }
      if (nonZero > 0) withContent++;
      detail.add({
        'key': resource.key,
        'pass': resource.passIndex,
        'size': '${resource.width}x${resource.height}',
        'floats': floats.length,
        'nonZero': nonZero,
      });
      if (nans > 0 || infs > 0) {
        offenders.add({
          'key': resource.key,
          'pass': resource.passIndex,
          'nan': nans,
          'inf': infs,
        });
      }
    }
    // A capture of a frame that drew nothing scans perfectly clean, which is
    // a false green: the SceneView only re-renders when something changes, so
    // a game parked on its start card composites a cached texture while the
    // scene issues no draws at all. Report the draw count so a gate can
    // refuse to conclude anything from an empty frame.
    final draws = capture.passes.fold<int>(0, (sum, p) => sum + p.draws.length);
    return {
      'clean': offenders.isEmpty,
      'draws': draws,
      'empty': draws == 0,
      'scanned': scanned,
      'withContent': withContent,
      'targets': detail,
      'unscanned': unscanned,
      'failedCopies': failedCopies,
      'offenders': offenders,
    };
  }

  /// One texel's exact float RGBA from a named buffer, with non-finite flags.
  ///
  /// This is what turns an appearance question into an assertion: "is the sky
  /// washed out" becomes a bounds check on a number that a gate can fail on.
  /// Parameters: `key` (a blackboard key from `passes`), `x`, `y` in texels
  /// from the top-left of the full-resolution target.
  static Future<Map<String, Object?>> _readPixel(
    Map<String, String> parameters,
  ) async {
    final key = parameters['key'];
    if (key == null) throw ArgumentError('readPixel needs a "key" parameter');
    final x = int.parse(parameters['x'] ?? '0');
    final y = int.parse(parameters['y'] ?? '0');

    // Restricting image capture to one key is the cheap path, but it is also
    // the suspect when a snapshot comes back empty; `all` captures every
    // resource so the two can be compared.
    final captureAll = parameters['all'] != 'false';
    final attempts = int.tryParse(parameters['attempts'] ?? '') ?? 4;

    // The full-resolution snapshot copy fails intermittently: roughly one
    // capture in three comes back as a cleared texture. _pixel refuses those
    // instead of reporting a confident all-zero reading, which is what makes
    // retrying safe -- a bad capture is always distinguishable from a real
    // one, so a retry can never launder an empty frame into a value.
    Object? lastError;
    for (var attempt = 1; attempt <= attempts; attempt++) {
      final capture = await _capture(
        RenderGraphCaptureRequest(
          thumbnailMaxDim: null,
          fullResolution: true,
          onlyKeys: captureAll ? null : {key},
        ),
      );
      try {
        final result = await _pixel(capture, key, x, y);
        return {...result, 'attempts': attempt};
      } on StateError catch (error) {
        lastError = error;
      }
    }
    throw StateError(
      'No usable snapshot of "$key" in $attempts captures. Last: $lastError',
    );
  }

  static Future<Map<String, Object?>> _pixel(
    RenderGraphCaptureResult capture,
    String key,
    int x,
    int y,
  ) async {
    final matches = capture.resources.where((r) => r.key == key).toList();
    if (matches.isEmpty) {
      throw ArgumentError(
        'No resource "$key" in this frame. Available: '
        '${capture.resources.map((r) => r.key).toSet().join(', ')}',
      );
    }
    // A key rewritten by a later pass appears once per write, but the list
    // also carries build-time acquisitions (passIndex -1) whose snapshot was
    // never written. Taking the last entry outright reads one of those and
    // comes back all zeros; take the last entry an actual pass wrote.
    final written = matches.where((r) => r.passIndex >= 0).toList();
    final resource = written.isNotEmpty ? written.last : matches.last;
    final snapshot = resource.snapshot;
    if (snapshot == null) {
      throw StateError('Resource "$key" produced no readable snapshot');
    }
    if (x < 0 || y < 0 || x >= resource.width || y >= resource.height) {
      throw RangeError(
        '($x, $y) is outside ${resource.width}x${resource.height}',
      );
    }
    // Read every float target in order, exactly as the non-finite scan does,
    // and keep the one asked for. Reading the single target on its own comes
    // back all zeros while the same target read as part of a full sweep comes
    // back complete, so the sweep is doing something the lone read is not.
    List<double>? floats;
    for (final candidate in capture.resources) {
      if (!_isFloatFormat(candidate)) continue;
      final candidateSnapshot = candidate.snapshot;
      if (candidateSnapshot == null) continue;
      final values = await _readFloats(candidateSnapshot);
      if (identical(candidate, resource)) floats = values;
    }
    if (floats == null) throw StateError('Could not read "$key" back');

    // rawExtendedRgba128 is four 32-bit floats per texel.
    final firstNonZero = floats.indexWhere((v) => v != 0);
    if (firstNonZero == -1) {
      throw StateError(
        'Snapshot of "$key" is entirely zero (${floats.length} floats), so no '
        'reading from it means anything. Some targets do not survive the '
        'full-resolution snapshot copy; check the nonFinite report for which '
        'keys came back with content.',
      );
    }
    final offset = (y * resource.width + x) * 4;
    final rgba = [
      for (var channel = 0; channel < 4; channel++) floats[offset + channel],
    ];
    return {
      'key': key,
      'pass': resource.passIndex,
      'width': resource.width,
      'height': resource.height,
      'x': x,
      'y': y,
      'rgba': rgba,
      'nonZeroCount': floats.where((v) => v != 0).length,
      'nan': rgba.any((v) => v.isNaN),
      'inf': rgba.any((v) => v.isInfinite),
    };
  }

  /// The game viewport as PNG bytes, base64 encoded.
  ///
  /// This is the scene's own output, not a screen grab: the HUD (stick,
  /// pedals, minimap) is left out, so a frame comparison sees only the city.
  /// `display_color` is the resolve pass's output, which is exactly what the
  /// SceneView shows.
  static Future<Map<String, Object?>> _frame(
    Map<String, String> parameters,
  ) async {
    final key = parameters['key'] ?? 'display_color';
    final attempts = int.tryParse(parameters['attempts'] ?? '') ?? 4;

    Object? lastError;
    for (var attempt = 1; attempt <= attempts; attempt++) {
      final capture = await _capture(
        const RenderGraphCaptureRequest(
          thumbnailMaxDim: null,
          fullResolution: true,
        ),
      );
      final drawn = capture.passes.fold<int>(
        0,
        (sum, p) => sum + p.draws.length,
      );
      if (drawn == 0) {
        lastError = StateError('the captured frame drew nothing');
        continue;
      }
      final written = capture.resources
          .where((r) => r.key == key && r.passIndex >= 0 && r.snapshot != null)
          .toList();
      if (written.isEmpty) {
        throw ArgumentError(
          'No written resource "$key" in this frame. Available: '
          '${capture.resources.map((r) => r.key).toSet().join(', ')}',
        );
      }
      final resource = written.last;
      // Encoding one snapshot on its own yields a blank image, the same way
      // reading one float target on its own yields zeros: the copies only
      // become valid once every snapshot in the capture has been read back.
      // Touch them all, then encode the one asked for.
      for (final other in capture.resources) {
        if (identical(other, resource)) continue;
        final snapshot = other.snapshot;
        if (snapshot == null) continue;
        final image = snapshot.asImage();
        try {
          await image.toByteData();
        } catch (_) {
          // An unreadable format is fine; the point is the readback itself.
        } finally {
          image.dispose();
        }
      }
      final image = resource.snapshot!.asImage();
      try {
        final png = await image.toByteData(format: ImageByteFormat.png);
        if (png == null) {
          lastError = StateError('could not encode "$key" as PNG');
          continue;
        }
        final bytes = png.buffer.asUint8List(
          png.offsetInBytes,
          png.lengthInBytes,
        );
        return {
          'key': key,
          'width': resource.width,
          'height': resource.height,
          'draws': drawn,
          'attempts': attempt,
          'png': base64Encode(bytes),
        };
      } finally {
        image.dispose();
      }
    }
    throw StateError('No usable frame in $attempts captures. Last: $lastError');
  }

  /// Only float targets can carry non-finite values. The concrete formats are
  /// r16g16b16a16Float, r32g32b32a32Float and r32Float; the enum type is not
  /// part of the package's public surface, so match it by name instead of
  /// reaching into `src/`.
  static bool _isFloatFormat(CapturedResource resource) =>
      resource.format?.toString().contains('Float') ?? false;

  static Future<List<double>?> _readFloats(gpu.Texture source) async {
    final image = source.asImage();
    try {
      final data = await image.toByteData(
        format: ImageByteFormat.rawExtendedRgba128,
      );
      if (data == null) return null;
      return data.buffer.asFloat32List(
        data.offsetInBytes,
        data.lengthInBytes ~/ 4,
      );
    } catch (_) {
      return null;
    } finally {
      image.dispose();
    }
  }
}
