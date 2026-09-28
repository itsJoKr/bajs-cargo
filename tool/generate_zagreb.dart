// Bakes central Zagreb from the committed snapshots into streamed chunks.
//
//   fvm dart tool/generate_zagreb.dart
//
// Plain `dart`, not `dart run`: the build hook compiles every chunk this
// writes, and `dart run` would run it first (and fail on a missing chunk the
// first time). Reads only data/ (never the network), so reruns are byte
// identical; `tool/verify/gates/generator-determinism` checks that.
//
// Writes:
//   assets/city/chunk_<e|w><i>_<n|s><j>.fscene (+ .payloads.fsceneb), one per
//     200 m chunk, geometry merged per material;
//   assets/data/city_index.json, the chunk list the runtime streams from.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

import 'src/buildings.dart';
import 'src/city.dart';
import 'src/fscene_writer.dart';
import 'src/osm.dart';

const chunkSize = 200.0;

/// This generator's id range. Each chunk is its own document, so the range
/// only has to be stable, not disjoint between chunks.
const firstToken = 70000;

const facadeMaterial = MaterialSpec('facade', roughness: .92);
const roofMaterial = MaterialSpec('roof', roughness: .8);

String chunkName(int i, int j) =>
    'chunk_${i < 0 ? 'w${-i}' : 'e$i'}_${j < 0 ? 's${-j}' : 'n$j'}';

/// sRGB hex channel to linear, since payload vertex colours are linear.
double linear(int channel) {
  final c = channel / 255;
  return c <= .04045 ? c / 12.92 : math.pow((c + .055) / 1.055, 2.4).toDouble();
}

Vector4 colorHex(int rgb, {double alpha = 1}) => Vector4(
  linear((rgb >> 16) & 0xff),
  linear((rgb >> 8) & 0xff),
  linear(rgb & 0xff),
  alpha,
);

void main(List<String> args) {
  final watch = Stopwatch()..start();
  final osm = OsmData.load('data/osm/zagreb_centre.json');
  final city = City(osm, coreExtent)..build();

  final chunks = <(int, int), BuildingMeshes>{};
  final counts = <(int, int), int>{};
  for (final b in city.buildings) {
    final c = b.center;
    final key = ((c.x / chunkSize).floor(), (c.y / chunkSize).floor());
    final meshes = chunks.putIfAbsent(key, BuildingMeshes.new);
    counts[key] = (counts[key] ?? 0) + 1;
    emitBuilding(
      b,
      meshes,
      ground: 0,
      wallColor: colorHex(0x9A968F),
      roofColor: colorHex(0x7A5A4E),
    );
  }

  final keys = chunks.keys.toList()
    ..sort((a, b) => a.$2 != b.$2 ? a.$2.compareTo(b.$2) : a.$1.compareTo(b.$1));
  final index = <Map<String, Object?>>[];
  var vertices = 0, triangles = 0;
  for (final key in keys) {
    final (i, j) = key;
    final name = chunkName(i, j);
    final meshes = chunks[key]!;
    final doc = SceneDocBuilder(
      relativePath: 'assets/city/$name.fscene',
      firstToken: firstToken,
      seedName: name,
    );
    doc.addGroup('Buildings', [
      ('Facades', facadeMaterial, meshes.facades),
      ('Roofs', roofMaterial, meshes.roofs),
    ]);
    doc.save();
    vertices += meshes.facades.vertexCount + meshes.roofs.vertexCount;
    triangles += meshes.facades.triangleCount + meshes.roofs.triangleCount;
    index.add({
      'name': name,
      'i': i,
      'j': j,
      'minX': i * chunkSize,
      'minZ': j * chunkSize,
      'size': chunkSize,
      'buildings': counts[key],
    });
  }
  writeAsset(
    'assets/data/city_index.json',
    utf8.encode(
      '${const JsonEncoder.withIndent('  ').convert({'chunkSize': chunkSize, 'chunks': index})}\n',
    ),
  );
  stdout.writeln(
    'Baked ${city.buildings.length} buildings into ${keys.length} chunks '
    '($vertices vertices, $triangles triangles) in '
    '${watch.elapsedMilliseconds} ms',
  );
  // Roof shape and height mix, for a sanity read of the defaults.
  final shapes = <RoofShape, int>{};
  for (final b in city.buildings) {
    shapes[b.roof] = (shapes[b.roof] ?? 0) + 1;
  }
  stdout.writeln('Roofs: $shapes');
}
