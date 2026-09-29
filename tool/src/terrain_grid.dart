// The ground grid tool/prepare_terrain.py derives from Copernicus GLO-30:
// heights in metres relative to the ground at the Ban Jelačić statue, on a
// regular grid in the local frame (x east, z north), sampled bilinearly.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

import 'osm.dart';

class TerrainGrid {
  TerrainGrid._(this.x0, this.z0, this.cell, this.columns, this.rows, this.heights);

  factory TerrainGrid.load(String path) {
    final j = jsonDecode(File(path).readAsStringSync()) as Map<String, dynamic>;
    return TerrainGrid._(
      (j['x0'] as num).toDouble(),
      (j['z0'] as num).toDouble(),
      (j['cell'] as num).toDouble(),
      j['columns'] as int,
      j['rows'] as int,
      [for (final h in j['heights'] as List) (h as num).toDouble()],
    );
  }

  final double x0, z0, cell;
  final int columns, rows;
  final List<double> heights;

  double _at(int c, int r) =>
      heights[r.clamp(0, rows - 1) * columns + c.clamp(0, columns - 1)];

  /// Bilinear height at [p] (x east, y = z north); clamps past the edges.
  double call(Vector2 p) {
    final fx = (p.x - x0) / cell, fz = (p.y - z0) / cell;
    final c = fx.floor(), r = fz.floor();
    final tx = (fx - c).clamp(0.0, 1.0), tz = (fz - r).clamp(0.0, 1.0);
    return _at(c, r) * (1 - tx) * (1 - tz) +
        _at(c + 1, r) * tx * (1 - tz) +
        _at(c, r + 1) * (1 - tx) * tz +
        _at(c + 1, r + 1) * tx * tz;
  }

  /// The lowest ground under [polygon]'s outline (vertices and edge
  /// midpoints; the grid is smooth enough for that).
  double lowest(Polygon polygon) {
    var low = double.infinity;
    final ring = polygon.outer;
    for (var i = 0; i < ring.length; i++) {
      final a = ring[i], b = ring[(i + 1) % ring.length];
      low = math.min(low, math.min(call(a), call((a + b) * .5)));
    }
    return low;
  }
}
