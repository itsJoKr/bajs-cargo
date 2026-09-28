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
import 'src/ground.dart';
import 'src/osm.dart';
import 'src/props.dart';

const chunkSize = 200.0;

/// This generator's id range. Each chunk is its own document, so the range
/// only has to be stable, not disjoint between chunks.
const firstToken = 70000;

const facadeMaterial = MaterialSpec('facade', roughness: .92);
const roofMaterial = MaterialSpec('roof', roughness: .8);
const groundMaterial = MaterialSpec('ground', roughness: .9);

/// Tram rails sit on the road and paving; the bias pulls them toward the
/// camera instead of lifting geometry (rules file: coplanar surfaces).
const railsMaterial = MaterialSpec('rails', roughness: .45, depthBias: .04);

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

  final ground = Ground(osm, city)..build();
  stdout.writeln(
    'Ground: road ${ground.road.area.round()} m2, paving '
    '${ground.paving.area.round()} m2, grass ${ground.grass.area.round()} m2, '
    '${ground.tramLines.length} tram lines, ${ground.trees.length} trees '
    '(${watch.elapsedMilliseconds} ms)',
  );
  double terrain(Vector2 p) => 0;

  final extent = city.extent;
  final chunks = <(int, int), BuildingMeshes>{};
  final counts = <(int, int), int>{};
  for (var j = (extent.minZ / chunkSize).floor();
      j * chunkSize < extent.maxZ;
      j++) {
    for (var i = (extent.minX / chunkSize).floor();
        i * chunkSize < extent.maxX;
        i++) {
      chunks[(i, j)] = BuildingMeshes();
      counts[(i, j)] = 0;
    }
  }
  for (final b in city.buildings) {
    final c = b.center;
    final key = ((c.x / chunkSize).floor(), (c.y / chunkSize).floor());
    final meshes = chunks.putIfAbsent(key, BuildingMeshes.new);
    counts[key] = (counts[key] ?? 0) + 1;
    emitBuilding(
      b,
      meshes,
      ground: terrain(c),
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
    final minX = i * chunkSize, minZ = j * chunkSize;
    final surface = MeshWriter(), rails = MeshWriter();
    // Ground only inside the baked extent, so the edge of the city is a
    // clean line rather than streets running off into nothing.
    final gx0 = math.max(minX, extent.minX), gz0 = math.max(minZ, extent.minZ);
    final gx1 = math.min(minX + chunkSize, extent.maxX);
    final gz1 = math.min(minZ + chunkSize, extent.maxZ);
    if (gx1 > gx0 && gz1 > gz0) {
      ground.emitGround(gx0, gz0, gx1, gz1, minX, minZ, surface, rails, terrain);
    }
    final doc = SceneDocBuilder(
      relativePath: 'assets/city/$name.fscene',
      firstToken: firstToken,
      seedName: name,
    );
    doc.addGroup('Buildings', [
      ('Facades', facadeMaterial, meshes.facades),
      ('Roofs', roofMaterial, meshes.roofs),
    ]);
    doc.addGroup('Ground', [
      ('Surface', groundMaterial, surface),
      ('Rails', railsMaterial, rails),
    ]);
    doc.save();
    for (final m in [meshes.facades, meshes.roofs, surface, rails]) {
      vertices += m.vertexCount;
      triangles += m.triangleCount;
    }
    final chunkTrees = [
      for (final t in ground.trees)
        if (t.x >= math.max(minX, extent.minX) &&
            t.x < math.min(minX + chunkSize, extent.maxX) &&
            t.y >= math.max(minZ, extent.minZ) &&
            t.y < math.min(minZ + chunkSize, extent.maxZ))
          treeInstance(t, terrain(t) + kerbHeight),
    ];
    index.add({
      'name': name,
      'i': i,
      'j': j,
      'minX': minX,
      'minZ': minZ,
      'size': chunkSize,
      'buildings': counts[key],
      'trees': chunkTrees,
    });
  }
  writeProps();
  final previewAt = args.indexOf('--preview');
  if (previewAt >= 0) {
    writePreview(args[previewAt + 1], city, ground);
  }
  writeAsset(
    'assets/data/city_index.json',
    utf8.encode(
      '${const JsonEncoder.withIndent('  ').convert({'chunkSize': chunkSize, 'chunks': index})}\n',
    ),
  );
  stdout.writeln(
    'Baked ${city.buildings.length} buildings and the ground into '
    '${keys.length} chunks '
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

/// A top-down 1 px = 1 m map of what was baked (PPM; convert with magick),
/// with a line every 100 m (brighter through the origin, the statue).
void writePreview(String path, City city, Ground ground) {
  final e = city.extent;
  final w = (e.maxX - e.minX).ceil(), h = (e.maxZ - e.minZ).ceil();
  final pixels = List<int>.filled(w * h * 3, 0);
  void paint(List<Polygon> polygons, int rgb) {
    for (final polygon in polygons) {
      var x0 = double.infinity, x1 = -double.infinity;
      var z0 = double.infinity, z1 = -double.infinity;
      for (final p in polygon.outer) {
        x0 = math.min(x0, p.x);
        x1 = math.max(x1, p.x);
        z0 = math.min(z0, p.y);
        z1 = math.max(z1, p.y);
      }
      for (var z = math.max(z0.floor(), e.minZ.floor());
          z <= math.min(z1.ceil(), e.maxZ.ceil() - 1);
          z++) {
        for (var x = math.max(x0.floor(), e.minX.floor());
            x <= math.min(x1.ceil(), e.maxX.ceil() - 1);
            x++) {
          if (!polygon.contains(Vector2(x + .5, z + .5))) continue;
          final col = x - e.minX.floor(), row = e.maxZ.ceil() - 1 - z;
          if (col < 0 || col >= w || row < 0 || row >= h) continue;
          final o = (row * w + col) * 3;
          pixels[o] = rgb >> 16;
          pixels[o + 1] = (rgb >> 8) & 0xff;
          pixels[o + 2] = rgb & 0xff;
        }
      }
    }
  }

  pixels.fillRange(0, pixels.length, 0xB0);
  paint(ground.road.polygons, 0x55565A);
  paint(ground.paving.polygons, 0xD8CBB0);
  paint(ground.grass.polygons, 0x6F9446);
  paint(ground.gravel.polygons, 0xCDBB90);
  paint([for (final b in city.buildings) b.polygon], 0x8A4A3A);
  for (var row = 0; row < h; row++) {
    for (var col = 0; col < w; col++) {
      final x = col + e.minX.floor(), z = e.maxZ.ceil() - 1 - row;
      if (x % 100 == 0 || z % 100 == 0) {
        final o = (row * w + col) * 3;
        final v = (x == 0 || z == 0) ? 255 : 30;
        pixels[o] = v;
        pixels[o + 1] = x == 0 || z == 0 ? 40 : v;
        pixels[o + 2] = x == 0 || z == 0 ? 40 : v;
      }
    }
  }
  File(path).writeAsBytesSync([
    ...ascii.encode('P6 $w $h 255\n'),
    ...pixels,
  ]);
}
