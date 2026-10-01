// Where a pedestrian can stand: a 1 m bit grid over the core of the city
// (web3d/src/people.ts walks the crowd on it). A cell is walkable when its
// centre is inside the extent, outside every building (grown 0.6 m), outside
// the carriageways, outside the blocked areas, dips and levels marked
// `"crowd": false`, and clear of trees and lamps.
// Trams run flush with the paving on the square, so their tracks stay walkable.
// Plateaus, ramps and stairs (Dolac) are walkable, but the client knows only
// the bare terrain grid: their ground heights go out as `levels`, and the
// crowd itself refuses the step down a retaining wall.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:convert';
import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

import 'city.dart';
import 'clip.dart';
import 'ground.dart';
import 'levels.dart';
import 'osm.dart' show Polygon;

/// The grid as JSON: `x0`, `z0` (web frame, z south, the cell corner with the
/// smallest x and z), `cell` (m), `w`, `h`, and `bits` (base64, row-major
/// from z0 southwards, bit i of a row's byte k = column 8k + i), and `levels`:
/// the ground of the walkable cells on hand-shaped levels, over the cells
/// `i0` .. `i0 + w`, `j0` .. `j0 + h` (base64 bytes, row-major, 0 = not on a
/// level, else height = byte / 5 - 10 m).
Map<String, Object?> walkGrid(
  City city,
  Ground ground,
  Extent extent,
  List<Extent> blocked,
  Levels levels, {
  required List<(Vector2, double)> obstacles,
  List<Polygon> passages = const [],
  double radius = 240,
}) {
  const cell = 1.0;
  final minX = math.max(extent.minX, -radius), maxX = math.min(extent.maxX, radius + 20);
  final minZ = math.max(extent.minZ, -radius), maxZ = math.min(extent.maxZ, radius);
  var area = Shape.rect(minX, minZ, maxX, maxZ);
  area = area - Shape.of([for (final b in city.buildings) b.polygon]).inflate(.6);
  // Covered passages through the blocks are walkable.
  if (passages.isNotEmpty) area = area | (Shape.of(passages) & Shape.rect(minX, minZ, maxX, maxZ));
  area = area - ground.road;
  for (final e in blocked) {
    area = area - Shape.rect(e.minX, e.minZ, e.maxX, e.maxZ);
  }
  for (final r in levels.regions) {
    if (!r.crowd) area = area - r.shape.inflate(1);
  }
  final stumps = Shape.of([
    for (final (p, r) in obstacles)
      Polygon([
        Vector2(p.x - r, p.y - r),
        Vector2(p.x + r, p.y - r),
        Vector2(p.x + r, p.y + r),
        Vector2(p.x - r, p.y + r),
      ]),
  ]);
  area = area - stumps;

  // Scanline fill of the polygons' rings (even-odd over outers and holes).
  final rings = <List<Vector2>>[];
  for (final polygon in area.polygons) {
    rings.add(polygon.outer);
    rings.addAll(polygon.holes);
  }
  final w = (maxX - minX).ceil(), h = (maxZ - minZ).ceil();
  final rowBytes = (w + 7) ~/ 8;
  final bits = List<int>.filled(rowBytes * h, 0);
  // Row j covers web z = z0 + j .. j + 1, i.e. tool z = -(z0 + j + .5).
  final z0 = -maxZ;
  for (var j = 0; j < h; j++) {
    final tz = -(z0 + (j + .5) * cell);
    final xs = <double>[];
    for (final ring in rings) {
      for (var i = 0; i < ring.length; i++) {
        final a = ring[i], b = ring[(i + 1) % ring.length];
        if ((a.y <= tz) == (b.y <= tz)) continue;
        xs.add(a.x + (tz - a.y) / (b.y - a.y) * (b.x - a.x));
      }
    }
    xs.sort();
    for (var k = 0; k + 1 < xs.length; k += 2) {
      final c0 = ((xs[k] - minX) / cell - .5).ceil().clamp(0, w);
      final c1 = ((xs[k + 1] - minX) / cell - .5).floor().clamp(-1, w - 1);
      for (var c = c0; c <= c1; c++) {
        bits[j * rowBytes + (c >> 3)] |= 1 << (c & 7);
      }
    }
  }
  final grid = <String, Object?>{'x0': minX, 'z0': z0, 'cell': cell, 'w': w, 'h': h, 'bits': base64Encode(bits)};

  // The ground of the walkable cells on levels, over the cells their regions cover.
  final walkable = [for (final r in levels.regions) if (r.crowd) r];
  if (walkable.isEmpty) return grid;
  var i0 = w, i1 = -1, j0 = h, j1 = -1;
  for (final r in walkable) {
    final b = r.bounds;
    i0 = math.min(i0, ((b.minX - minX) / cell).floor());
    i1 = math.max(i1, ((b.maxX - minX) / cell).ceil());
    j0 = math.min(j0, ((-b.maxZ - z0) / cell).floor());
    j1 = math.max(j1, ((-b.minZ - z0) / cell).ceil());
  }
  i0 = i0.clamp(0, w - 1);
  i1 = i1.clamp(0, w - 1);
  j0 = j0.clamp(0, h - 1);
  j1 = j1.clamp(0, h - 1);
  if (i1 < i0 || j1 < j0) return grid;
  final lw = i1 - i0 + 1, lh = j1 - j0 + 1;
  final ys = List<int>.filled(lw * lh, 0);
  var count = 0;
  for (var j = j0; j <= j1; j++) {
    for (var i = i0; i <= i1; i++) {
      if ((bits[j * rowBytes + (i >> 3)] >> (i & 7)) & 1 == 0) continue;
      final p = Vector2(minX + (i + .5) * cell, -(z0 + (j + .5) * cell));
      final top = levels.top(p);
      if (top < 0 || !levels.regions[top].crowd) continue;
      ys[(j - j0) * lw + (i - i0)] = ((levels.heightAt(p) + 10) * 5).round().clamp(1, 255);
      count++;
    }
  }
  if (count > 0) grid['levels'] = {'i0': i0, 'j0': j0, 'w': lw, 'h': lh, 'y': base64Encode(ys)};
  return grid;
}
