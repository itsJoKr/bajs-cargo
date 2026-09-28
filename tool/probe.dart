/// Calls the running game's `ext.zagrebdrive.*` render-graph extensions.
///
/// The app publishes them from `lib/game/debug/scene_probe.dart` in debug
/// builds. This is the client the verification gates use, and it is usable by
/// hand for a one-off look:
///
///   fvm dart tool/probe.dart renderStats
///   fvm dart tool/probe.dart nonFinite
///   fvm dart tool/probe.dart passes
///   fvm dart tool/probe.dart readPixel --key scene_color --x 64 --y 64
///   fvm dart tool/probe.dart frame --out shot.png
///
///   fvm dart tool/probe.dart command --name teleport --x 0 --z 0
///
/// The VM service URI is resolved from an explicit `--uri`, else the
/// `--vmservice-file` that `tool/ensure_device.sh` has `flutter run` write.
/// Exits 3 when no running app can be reached, which gates treat as a skip
/// rather than a failure.
library;

import 'dart:convert';
import 'dart:io';

import 'package:vm_service/vm_service.dart';
import 'package:vm_service/vm_service_io.dart';

const unreachableExit = 3;
const defaultVmServiceFile = '/tmp/flutter-zagrebdrive-vmservice.json';

Future<void> main(List<String> args) async {
  if (args.isEmpty || args.first.startsWith('-')) {
    stderr.writeln(
      'usage: probe.dart <states|enterState|renderStats|passes|nonFinite|'
      'readPixel|frame|command> [options]',
    );
    exit(64);
  }
  final method = args.first;
  final options = _options(args.skip(1).toList());

  final uri = await _resolveUri(options);
  if (uri == null) {
    stderr.writeln(
      'No running Zagreb Drive found. Start one with tool/ensure_device.sh, '
      'or: fvm flutter run -d <device> '
      '--vmservice-out-file=$defaultVmServiceFile',
    );
    exit(unreachableExit);
  }

  late final VmService service;
  try {
    service = await vmServiceConnectUri(uri);
  } catch (error) {
    stderr.writeln('Could not connect to $uri: $error');
    exit(unreachableExit);
  }

  try {
    final vm = await service.getVM();
    final isolates = vm.isolates ?? const [];
    if (isolates.isEmpty) {
      stderr.writeln('The VM reports no isolates.');
      exit(unreachableExit);
    }
    // The root isolate runs the app; the extensions are registered there.
    final isolateId = isolates.first.id!;
    final extensionArgs = <String, String>{
      for (final entry in options.entries)
        if (!_clientOptions.contains(entry.key)) entry.key: entry.value,
    };
    final response = await service.callServiceExtension(
      'ext.zagrebdrive.$method',
      isolateId: isolateId,
      args: extensionArgs,
    );
    final json = response.json ?? const <String, Object?>{};
    // Image results are base64 in the response; write the bytes out and print
    // the rest, so a caller never has to handle the encoding itself.
    final png = json['png'];
    final out = options['out'];
    if (png is String && out != null) {
      File(out).writeAsBytesSync(base64Decode(png));
      stdout.writeln(
        const JsonEncoder.withIndent('  ').convert({
          for (final entry in json.entries)
            if (entry.key != 'png') entry.key: entry.value,
          'saved': out,
        }),
      );
    } else {
      stdout.writeln(const JsonEncoder.withIndent('  ').convert(json));
    }
  } on RPCError catch (error) {
    // An extension that is not registered means the app is running without
    // the probe (a release build, or the scene never finished loading).
    stderr.writeln('ext.zagrebdrive.$method failed: ${error.message}');
    if (error.details != null) stderr.writeln(error.details);
    exit(1);
  } finally {
    await service.dispose();
  }
}

const _clientOptions = {'uri', 'vmservice-file', 'out'};

Future<String?> _resolveUri(Map<String, String> options) async {
  final explicit = options['uri'];
  if (explicit != null) return explicit;

  final outFile = File(options['vmservice-file'] ?? defaultVmServiceFile);
  if (outFile.existsSync()) {
    final match = RegExp(
      r'ws://[^"\s]+',
    ).firstMatch(outFile.readAsStringSync());
    if (match != null) return match.group(0);
  }
  return null;
}

Map<String, String> _options(List<String> args) {
  final options = <String, String>{};
  for (var i = 0; i < args.length; i++) {
    final arg = args[i];
    if (!arg.startsWith('--')) continue;
    final name = arg.substring(2);
    final next = i + 1 < args.length ? args[i + 1] : null;
    if (next != null && !next.startsWith('--')) {
      options[name] = next;
      i++;
    } else {
      options[name] = 'true';
    }
  }
  return options;
}
