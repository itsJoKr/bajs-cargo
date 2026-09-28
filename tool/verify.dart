/// Runs the Zagreb Drive verification gates and reports pass/fail per gate.
///
/// Each gate is a standalone executable in `tool/verify/gates/`. The runner
/// only orchestrates, so a gate can be written in any language and can also
/// be invoked directly by an external harness:
///
///   fvm dart tool/verify.dart              # every gate that can run here
///   fvm dart tool/verify.dart --tier 1     # mechanical gates only
///   fvm dart tool/verify.dart --only generator-determinism
///   fvm dart tool/verify.dart --list
///
/// Gate contract:
///   `<gate> --describe`  prints one JSON line: name, tier, summary, needs,
///                        and optionally `state` (e.g. "zagreb.driving"),
///                        which the runner drives the app into first. The
///                        game declares its own states; see scene_probe.dart.
///   `<gate>`             exit 0 pass, 77 skip (prerequisite absent), else fail.
///
/// Exit code is 0 only when no gate failed. Skips do not fail the run, so a
/// machine without a device still gets a meaningful green on the rest.
library;

import 'dart:convert';
import 'dart:io';

const gatesDir = 'tool/verify/gates';
const skipExit = 77;

/// A gate that could not reach a machine verdict and needs a human or a model
/// to judge. Tier 2 comparisons exit this when the frame moved: that is not a
/// failure, it is a question.
const reviewExit = 78;

Future<void> main(List<String> args) async {
  final only = _option(args, '--only');
  final tier = _option(args, '--tier');
  final listOnly = args.contains('--list');
  final json = args.contains('--json');

  final gates = await _discover();
  if (gates.isEmpty) {
    stderr.writeln('No gates found in $gatesDir');
    exit(1);
  }

  final selected = gates.where((g) {
    if (only != null && g.name != only) return false;
    if (tier != null && '${g.tier}' != tier) return false;
    return true;
  }).toList();

  if (selected.isEmpty) {
    stderr.writeln('No gate matched (--only $only --tier $tier).');
    stderr.writeln('Known gates: ${gates.map((g) => g.name).join(', ')}');
    exit(1);
  }

  if (listOnly) {
    for (final gate in selected) {
      final needs = gate.needs.isEmpty ? '-' : gate.needs.join('+');
      stdout.writeln(
        '${gate.name.padRight(24)} tier ${gate.tier}  needs $needs  '
        '${gate.summary}',
      );
    }
    return;
  }

  final runId = DateTime.now().toIso8601String().replaceAll(':', '-');
  final outDir = Directory('artifacts/verify/$runId')..createSync(recursive: true);
  final results = <Map<String, Object?>>[];

  for (final gate in selected) {
    // Drive per gate, not once per suite: a live state keeps moving, so a
    // state established earlier may be gone.
    if (gate.state != null) {
      final drive = await Process.run('fvm', [
        'dart',
        'tool/probe.dart',
        'enterState',
        '--state',
        gate.state!,
      ], runInShell: false);
      if (drive.exitCode != 0) {
        final unreachable = drive.exitCode == 3;
        results.add({
          'name': gate.name,
          'tier': gate.tier,
          'status': unreachable ? 'skip' : 'fail',
          'exitCode': drive.exitCode,
          'millis': 0,
          'summary': gate.summary,
        });
        if (!json) {
          final mark = unreachable ? ' skip ' : ' FAIL ';
          stdout.writeln('[$mark] ${gate.name.padRight(24)} (drive)');
          stdout.writeln(
            '         could not reach state "${gate.state}": '
            '${_firstMeaningful('${drive.stdout}${drive.stderr}')}',
          );
        }
        continue;
      }
    }
    final watch = Stopwatch()..start();
    final run = await Process.run(gate.path, const [], runInShell: false);
    watch.stop();
    final output = '${run.stdout}${run.stderr}';
    File('${outDir.path}/${gate.name}.log').writeAsStringSync(output);

    final status = switch (run.exitCode) {
      0 => 'pass',
      skipExit => 'skip',
      reviewExit => 'review',
      _ => 'fail',
    };
    results.add({
      'name': gate.name,
      'tier': gate.tier,
      'status': status,
      'exitCode': run.exitCode,
      'millis': watch.elapsedMilliseconds,
      'summary': gate.summary,
    });
    if (!json) _printRow(gate, status, watch.elapsedMilliseconds, output);
  }

  final failed = results.where((r) => r['status'] == 'fail').toList();
  final report = {
    'runId': runId,
    'gates': results,
    'failed': failed.length,
    'passed': results.where((r) => r['status'] == 'pass').length,
    'skipped': results.where((r) => r['status'] == 'skip').length,
    'review': results.where((r) => r['status'] == 'review').length,
  };
  final encoded = const JsonEncoder.withIndent('  ').convert(report);
  File('${outDir.path}/report.json').writeAsStringSync(encoded);
  final latest = Link('artifacts/verify/latest');
  if (latest.existsSync()) latest.deleteSync();
  latest.createSync(runId);

  if (json) {
    stdout.writeln(encoded);
  } else {
    stdout.writeln('');
    stdout.writeln(
      '${report['passed']} passed, ${report['failed']} failed, '
      '${report['skipped']} skipped, ${report['review']} to review '
      '-> ${outDir.path}/report.json',
    );
  }
  exit(failed.isEmpty ? 0 : 1);
}

void _printRow(_Gate gate, String status, int millis, String output) {
  final mark = switch (status) {
    'pass' => '  ok  ',
    'skip' => ' skip ',
    'review' => 'review',
    _ => ' FAIL ',
  };
  stdout.writeln('[$mark] ${gate.name.padRight(24)} ${millis}ms');
  if (status != 'pass') {
    for (final line in const LineSplitter().convert(output)) {
      if (line.trim().isEmpty) continue;
      stdout.writeln('         $line');
    }
  }
}

Future<List<_Gate>> _discover() async {
  final dir = Directory(gatesDir);
  if (!dir.existsSync()) return const [];
  final gates = <_Gate>[];
  final files = dir.listSync().whereType<File>().toList()
    ..sort((a, b) => a.path.compareTo(b.path));
  for (final file in files) {
    if (file.path.endsWith('.md')) continue;
    final described = await Process.run(file.path, const ['--describe']);
    if (described.exitCode != 0) {
      stderr.writeln('Gate ${file.path} failed --describe; ignoring it.');
      continue;
    }
    final meta =
        jsonDecode(described.stdout.toString().trim()) as Map<String, Object?>;
    gates.add(
      _Gate(
        path: file.path,
        name: meta['name'] as String,
        tier: meta['tier'] as int,
        summary: meta['summary'] as String? ?? '',
        needs: (meta['needs'] as List?)?.cast<String>() ?? const [],
        state: meta['state'] as String?,
      ),
    );
  }
  gates.sort((a, b) => a.tier != b.tier
      ? a.tier.compareTo(b.tier)
      : a.name.compareTo(b.name));
  return gates;
}

/// The first line worth showing, skipping the build-hook chatter the Dart
/// tooling prints ahead of a script's own output. Errors lead with their
/// summary and follow with detail, so the first line is the useful one.
String _firstMeaningful(String output) {
  final lines = const LineSplitter()
      .convert(output.replaceAll('Running build hooks...', ''))
      .map((line) => line.trim())
      .where((line) => line.isNotEmpty)
      .toList();
  return lines.isEmpty ? 'no output' : lines.first;
}

String? _option(List<String> args, String flag) {
  final index = args.indexOf(flag);
  if (index == -1 || index + 1 >= args.length) return null;
  return args[index + 1];
}

class _Gate {
  const _Gate({
    required this.path,
    required this.name,
    required this.tier,
    required this.summary,
    required this.needs,
    this.state,
  });

  final String path;
  final String name;
  final int tier;
  final String summary;
  final List<String> needs;

  /// App state this gate must be measured in, as `<game>.<state>`, driven
  /// immediately before it runs. Null leaves the app wherever it is.
  final String? state;
}
