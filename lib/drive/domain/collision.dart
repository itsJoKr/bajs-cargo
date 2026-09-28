/// Building footprints as 2D collision: circles push out of them, rays stop
/// at them. Pure Dart.
///
/// Reads `assets/data/collision.bin` (`ZDCL`, see
/// `tool/src/runtime_data.dart`). Coordinates are local metres, x east and
/// z north. Every ring keeps its polygon's interior on its left (outer rings
/// counter-clockwise, holes clockwise), so an edge's right-hand normal
/// always points out of the building.
library;

import 'dart:math' as math;
import 'dart:typed_data';

/// A resolved push: where the circle ends up and the averaged wall normal
/// (zero when nothing was touched).
typedef Push = ({double x, double z, double nx, double nz, bool hit});

class Footprints {
  Footprints._(this._edges, this._edgePolygon, this._polygonRings,
      this._ringStart, this._ringLength, this._points);

  /// Builds from polygons given as lists of rings of (x, z) pairs.
  factory Footprints.fromPolygons(List<List<List<(double, double)>>> polygons) {
    final points = <double>[];
    final ringStart = <int>[], ringLength = <int>[];
    final polygonRings = <List<int>>[];
    for (final polygon in polygons) {
      final rings = <int>[];
      for (final ring in polygon) {
        rings.add(ringStart.length);
        ringStart.add(points.length ~/ 2);
        ringLength.add(ring.length);
        for (final (x, z) in ring) {
          points.addAll([x, z]);
        }
      }
      polygonRings.add(rings);
    }
    final edges = <double>[];
    final edgePolygon = <int>[];
    for (var p = 0; p < polygonRings.length; p++) {
      for (final ring in polygonRings[p]) {
        final start = ringStart[ring], n = ringLength[ring];
        for (var i = 0; i < n; i++) {
          final a = start + i, b = start + (i + 1) % n;
          edges.addAll([
            points[a * 2],
            points[a * 2 + 1],
            points[b * 2],
            points[b * 2 + 1],
          ]);
          edgePolygon.add(p);
        }
      }
    }
    return Footprints._(
      Float64List.fromList(edges),
      edgePolygon,
      polygonRings,
      ringStart,
      ringLength,
      Float64List.fromList(points),
    ).._index();
  }

  factory Footprints.fromBytes(ByteData data) {
    final magic = String.fromCharCodes([
      for (var i = 0; i < 4; i++) data.getUint8(i),
    ]);
    if (magic != 'ZDCL') throw FormatException('Expected ZDCL, found $magic');
    var o = 8;
    int u32() {
      final v = data.getUint32(o, Endian.little);
      o += 4;
      return v;
    }

    double f32() {
      final v = data.getFloat32(o, Endian.little);
      o += 4;
      return v;
    }

    final polygons = <List<List<(double, double)>>>[];
    final chunks = u32();
    for (var c = 0; c < chunks; c++) {
      o += 8; // chunk i, j
      final count = u32();
      for (var p = 0; p < count; p++) {
        final rings = <List<(double, double)>>[];
        final ringCount = u32();
        for (var r = 0; r < ringCount; r++) {
          final n = u32();
          rings.add([for (var k = 0; k < n; k++) (f32(), f32())]);
        }
        polygons.add(rings);
      }
    }
    return Footprints.fromPolygons(polygons);
  }

  factory Footprints.empty() => Footprints.fromPolygons(const []);

  /// Edges as ax, az, bx, bz quadruples.
  final Float64List _edges;
  final List<int> _edgePolygon;
  final List<List<int>> _polygonRings;
  final List<int> _ringStart, _ringLength;
  final Float64List _points;

  static const _cell = 8.0;
  final Map<int, List<int>> _grid = {};

  /// Polygons by cell, and each polygon's box (minX, minZ, maxX, maxZ).
  final Map<int, List<int>> _polygonGrid = {};
  late final Float64List _bounds;

  int get polygonCount => _polygonRings.length;
  int get edgeCount => _edgePolygon.length;

  static int _key(int i, int j) => (i + 32768) * 65536 + (j + 32768);

  void _index() {
    _bounds = Float64List(_polygonRings.length * 4);
    for (var p = 0; p < _polygonRings.length; p++) {
      var x0 = double.infinity, z0 = double.infinity;
      var x1 = -double.infinity, z1 = -double.infinity;
      for (final ring in _polygonRings[p]) {
        for (var k = 0; k < _ringLength[ring]; k++) {
          final x = _points[(_ringStart[ring] + k) * 2];
          final z = _points[(_ringStart[ring] + k) * 2 + 1];
          x0 = math.min(x0, x);
          x1 = math.max(x1, x);
          z0 = math.min(z0, z);
          z1 = math.max(z1, z);
        }
      }
      _bounds.setAll(p * 4, [x0, z0, x1, z1]);
      for (var i = (x0 / _cell).floor(); i <= (x1 / _cell).floor(); i++) {
        for (var j = (z0 / _cell).floor(); j <= (z1 / _cell).floor(); j++) {
          (_polygonGrid[_key(i, j)] ??= []).add(p);
        }
      }
    }
    for (var e = 0; e < _edgePolygon.length; e++) {
      final ax = _edges[e * 4], az = _edges[e * 4 + 1];
      final bx = _edges[e * 4 + 2], bz = _edges[e * 4 + 3];
      final i0 = (math.min(ax, bx) / _cell).floor();
      final i1 = (math.max(ax, bx) / _cell).floor();
      final j0 = (math.min(az, bz) / _cell).floor();
      final j1 = (math.max(az, bz) / _cell).floor();
      for (var i = i0; i <= i1; i++) {
        for (var j = j0; j <= j1; j++) {
          (_grid[_key(i, j)] ??= []).add(e);
        }
      }
    }
  }

  /// Edge indices whose cells overlap the box around (x, z).
  Iterable<int> _near(double x, double z, double radius) sync* {
    final i0 = ((x - radius) / _cell).floor();
    final i1 = ((x + radius) / _cell).floor();
    final j0 = ((z - radius) / _cell).floor();
    final j1 = ((z + radius) / _cell).floor();
    final seen = <int>{};
    for (var i = i0; i <= i1; i++) {
      for (var j = j0; j <= j1; j++) {
        for (final e in _grid[_key(i, j)] ?? const <int>[]) {
          if (seen.add(e)) yield e;
        }
      }
    }
  }

  /// Whether (x, z) is inside any footprint (even-odd over its rings).
  bool contains(double x, double z) => _containingPolygon(x, z) >= 0;

  int _containingPolygon(double x, double z) {
    for (final p in _polygonGrid[_key((x / _cell).floor(), (z / _cell).floor())] ??
        const <int>[]) {
      final box = p * 4;
      if (x < _bounds[box] ||
          z < _bounds[box + 1] ||
          x > _bounds[box + 2] ||
          z > _bounds[box + 3]) {
        continue;
      }
      var inside = false;
      for (final ring in _polygonRings[p]) {
        final start = _ringStart[ring], n = _ringLength[ring];
        for (var i = 0, j = n - 1; i < n; j = i++) {
          final ax = _points[(start + i) * 2], az = _points[(start + i) * 2 + 1];
          final bx = _points[(start + j) * 2], bz = _points[(start + j) * 2 + 1];
          if ((az > z) != (bz > z) &&
              x < (bx - ax) * (z - az) / (bz - az) + ax) {
            inside = !inside;
          }
        }
      }
      if (inside) return p;
    }
    return -1;
  }

  /// Pushes a circle of [radius] at (x, z) out of every footprint it
  /// overlaps. A centre that has ended up inside a footprint is moved to
  /// the nearest edge of that footprint first.
  Push pushOut(double x, double z, double radius) {
    var cx = x, cz = z;
    var nx = 0.0, nz = 0.0;
    var hit = false;
    for (var iteration = 0; iteration < 4; iteration++) {
      var moved = false;
      final inside = _containingPolygon(cx, cz);
      if (inside >= 0) {
        // Deep: out through the nearest edge of that polygon.
        var best = double.infinity;
        var qx = cx, qz = cz, ex = 0.0, ez = 0.0;
        for (var e = 0; e < _edgePolygon.length; e++) {
          if (_edgePolygon[e] != inside) continue;
          final (px, pz, d) = _closest(e, cx, cz);
          if (d < best) {
            best = d;
            qx = px;
            qz = pz;
            final dx = _edges[e * 4 + 2] - _edges[e * 4];
            final dz = _edges[e * 4 + 3] - _edges[e * 4 + 1];
            final l = math.sqrt(dx * dx + dz * dz);
            ex = dz / l;
            ez = -dx / l;
          }
        }
        cx = qx + ex * (radius + 1e-3);
        cz = qz + ez * (radius + 1e-3);
        nx += ex;
        nz += ez;
        hit = moved = true;
        continue;
      }
      for (final e in _near(cx, cz, radius)) {
        final (px, pz, d) = _closest(e, cx, cz);
        if (d >= radius) continue;
        double ux, uz;
        if (d > 1e-9) {
          ux = (cx - px) / d;
          uz = (cz - pz) / d;
        } else {
          final dx = _edges[e * 4 + 2] - _edges[e * 4];
          final dz = _edges[e * 4 + 3] - _edges[e * 4 + 1];
          final l = math.sqrt(dx * dx + dz * dz);
          ux = dz / l;
          uz = -dx / l;
        }
        cx = px + ux * (radius + 1e-4);
        cz = pz + uz * (radius + 1e-4);
        nx += ux;
        nz += uz;
        hit = moved = true;
      }
      if (!moved) break;
    }
    final l = math.sqrt(nx * nx + nz * nz);
    return (
      x: cx,
      z: cz,
      nx: l > 0 ? nx / l : 0,
      nz: l > 0 ? nz / l : 0,
      hit: hit,
    );
  }

  (double, double, double) _closest(int e, double x, double z) {
    final ax = _edges[e * 4], az = _edges[e * 4 + 1];
    final bx = _edges[e * 4 + 2], bz = _edges[e * 4 + 3];
    final dx = bx - ax, dz = bz - az;
    final l2 = dx * dx + dz * dz;
    var t = l2 == 0 ? 0.0 : ((x - ax) * dx + (z - az) * dz) / l2;
    t = t.clamp(0.0, 1.0);
    final px = ax + dx * t, pz = az + dz * t;
    return (px, pz, math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz)));
  }

  /// The fraction along (ax, az) -> (bx, bz) where the segment first meets
  /// a footprint edge, or null if it is clear.
  double? raycast(double ax, double az, double bx, double bz) {
    final dx = bx - ax, dz = bz - az;
    final length = math.sqrt(dx * dx + dz * dz);
    double? best;
    final steps = (length / _cell).ceil() + 1;
    final seen = <int>{};
    for (var s = 0; s <= steps; s++) {
      final t = s / steps;
      for (final e in _near(ax + dx * t, az + dz * t, _cell * .75)) {
        if (!seen.add(e)) continue;
        final ex = _edges[e * 4], ez = _edges[e * 4 + 1];
        final fx = _edges[e * 4 + 2] - ex, fz = _edges[e * 4 + 3] - ez;
        final denom = dx * fz - dz * fx;
        if (denom.abs() < 1e-12) continue;
        final u = ((ex - ax) * fz - (ez - az) * fx) / denom;
        final v = ((ex - ax) * dz - (ez - az) * dx) / denom;
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
          if (best == null || u < best) best = u;
        }
      }
    }
    return best;
  }

  /// A polygon's rings as (x, z) lists, for drawing and tests.
  List<List<(double, double)>> polygon(int index) => [
    for (final ring in _polygonRings[index])
      [
        for (var k = 0; k < _ringLength[ring]; k++)
          (
            _points[(_ringStart[ring] + k) * 2],
            _points[(_ringStart[ring] + k) * 2 + 1],
          ),
      ],
  ];
}
