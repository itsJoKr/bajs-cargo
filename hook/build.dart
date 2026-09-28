import 'dart:io';

import 'package:flutter_scene/build_hooks.dart';
import 'package:hooks/hooks.dart';

void main(List<String> args) async {
  await build(args, (input, output) async {
    // flutter_scene:init:start
    // The city is baked into one .fscene per chunk by
    // tool/generate_zagreb.dart. List them explicitly (sorted, so the hook is
    // deterministic) and depend on the directory, so adding or removing a
    // chunk reruns the hook.
    final cityDir = Directory.fromUri(input.packageRoot.resolve('assets/city/'));
    final chunks = cityDir.existsSync()
        ? (cityDir
                  .listSync()
                  .whereType<File>()
                  .map((f) => f.uri.pathSegments.last)
                  .where((name) => name.endsWith('.fscene'))
                  .map((name) => 'assets/city/$name')
                  .toList()
                ..sort())
        : <String>[];
    output.dependencies.add(input.packageRoot.resolve('assets/city/'));
    buildScenes(
      buildInput: input,
      buildOutput: output,
      inputFilePaths: [...chunks],
    );
    // Compile .fmat materials under assets/, loadable by source path with
    // loadFmatMaterial. A no-op when there are none.
    await buildMaterials(buildInput: input, buildOutput: output);
    // flutter_scene:init:end
  });
}
