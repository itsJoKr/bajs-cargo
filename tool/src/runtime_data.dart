// Compact binary data the pure-Dart domain layer loads at runtime (no
// Flutter GPU): collision footprints, the terrain grid and the road mask.
// Formats are documented next to their readers in lib/drive/domain/.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:typed_data';

import 'city.dart' show Extent;
import 'clip.dart';
import 'osm.dart';

class _Writer {
  final _bytes = BytesBuilder();
  final _scratch = ByteData(8);

  void magic(String m) => _bytes.add(m.codeUnits);
  void u32(int v) {
    _scratch.setUint32(0, v, Endian.little);
    _bytes.add(_scratch.buffer.asUint8List(0, 4));
  }

  void i32(int v) {
    _scratch.setInt32(0, v, Endian.little);
    _bytes.add(_scratch.buffer.asUint8List(0, 4));
  }

  void f32(double v) {
    _scratch.setFloat32(0, v, Endian.little);
    _bytes.add(_scratch.buffer.asUint8List(0, 4));
  }

  void raw(List<int> data) => _bytes.add(data);
  Uint8List take() => _bytes.takeBytes();
}

/// `ZDCL` v1: footprints grouped by chunk.
///   magic 'ZDCL', u32 version, u32 chunkCount,
///   per chunk: i32 i, i32 j, u32 polygonCount,
///     per polygon: u32 ringCount, per ring: u32 n, n x (f32 x, f32 z).
/// Rings are outer counter-clockwise, holes clockwise.
Uint8List collisionBytes(Map<(int, int), List<Polygon>> byChunk) {
  final w = _Writer()
    ..magic('ZDCL')
    ..u32(1)
    ..u32(byChunk.length);
  final keys = byChunk.keys.toList()
    ..sort((a, b) => a.$2 != b.$2 ? a.$2.compareTo(b.$2) : a.$1.compareTo(b.$1));
  for (final key in keys) {
    final polygons = byChunk[key]!;
    w
      ..i32(key.$1)
      ..i32(key.$2)
      ..u32(polygons.length);
    for (final p in polygons) {
      final rings = [p.outer, ...p.holes];
      w.u32(rings.length);
      for (final ring in rings) {
        w.u32(ring.length);
        for (final v in ring) {
          w
            ..f32(v.x)
            ..f32(v.y);
        }
      }
    }
  }
  return w.take();
}

/// `ZDTR` v1: a terrain height grid, heights in metres above the statue.
///   magic 'ZDTR', u32 version, f32 originX, f32 originZ, f32 cell,
///   u32 columns, u32 rows, rows x columns f32 (row-major, z then x).
Uint8List terrainBytes(
  double originX,
  double originZ,
  double cell,
  int columns,
  int rows,
  List<double> heights,
) {
  final w = _Writer()
    ..magic('ZDTR')
    ..u32(1)
    ..f32(originX)
    ..f32(originZ)
    ..f32(cell)
    ..u32(columns)
    ..u32(rows);
  for (final h in heights) {
    w.f32(h);
  }
  return w.take();
}

/// `ZDRM` v1: which cells are carriageway (road level) rather than kerb
/// level. magic 'ZDRM', u32 version, f32 originX, f32 originZ, f32 cell,
/// u32 columns, u32 rows, then ceil(columns * rows / 8) bytes, bit k of the
/// row-major cell index set when the cell centre is on the road.
Uint8List roadMaskBytes(Shape road, Extent extent, {double cell = .5}) {
  final columns = ((extent.maxX - extent.minX) / cell).ceil();
  final rows = ((extent.maxZ - extent.minZ) / cell).ceil();
  final bits = Uint8List((columns * rows + 7) ~/ 8);
  for (final polygon in road.polygons) {
    var x0 = double.infinity, x1 = -double.infinity;
    var z0 = double.infinity, z1 = -double.infinity;
    for (final p in polygon.outer) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < z0) z0 = p.y;
      if (p.y > z1) z1 = p.y;
    }
    final c0 = ((x0 - extent.minX) / cell).floor().clamp(0, columns - 1);
    final c1 = ((x1 - extent.minX) / cell).ceil().clamp(0, columns - 1);
    final r0 = ((z0 - extent.minZ) / cell).floor().clamp(0, rows - 1);
    final r1 = ((z1 - extent.minZ) / cell).ceil().clamp(0, rows - 1);
    // Scanline fill: per row, the crossings of every ring.
    final rings = [polygon.outer, ...polygon.holes];
    for (var r = r0; r <= r1; r++) {
      final z = extent.minZ + (r + .5) * cell;
      final xs = <double>[];
      for (final ring in rings) {
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          final a = ring[i], b = ring[j];
          if ((a.y > z) != (b.y > z)) {
            xs.add(a.x + (z - a.y) * (b.x - a.x) / (b.y - a.y));
          }
        }
      }
      xs.sort();
      for (var k = 0; k + 1 < xs.length; k += 2) {
        final ca = ((xs[k] - extent.minX) / cell - .5).ceil().clamp(c0, c1);
        final cb = ((xs[k + 1] - extent.minX) / cell - .5).floor().clamp(c0, c1);
        for (var c = ca; c <= cb; c++) {
          final index = r * columns + c;
          bits[index >> 3] |= 1 << (index & 7);
        }
      }
    }
  }
  final w = _Writer()
    ..magic('ZDRM')
    ..u32(1)
    ..f32(extent.minX)
    ..f32(extent.minZ)
    ..f32(cell)
    ..u32(columns)
    ..u32(rows)
    ..raw(bits);
  return w.take();
}

