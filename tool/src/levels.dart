// Hand-shaped ground levels (data/levels.json): flat plateaus, ramps and
// stairs where the smooth terrain grid cannot show a real step in the
// ground, such as Dolac's market plateau over Pod zidom and the rise from
// it to Opatovina. The grid (Copernicus GLO-30 at 30 m, smoothed) turns
// them into a gentle slope.
//
// Each region overrides the terrain inside its outline; later regions win
// where they overlap. Kinds:
//   flat    a constant `level` (terrain metres, like the grid: street
//           surfaces sit on it, sidewalks and paving kerbHeight higher);
//   ramp    from the line through `from` (height `fromLevel`, or the
//           ground beneath when null) to the line through `to`, linear
//           along `from` -> `to`, so it meets a plateau and the grid alike;
//   dip     the ground beneath sunk by `sinkFrom` .. `sinkTo` metres (linear
//           along `from` -> `to`), easing back to nothing over `taper` metres
//           from the outline, so a hollow (Ribnjak park below the Kaptol
//           terrace) has no edge and no retaining wall;
//   stairs  the same parametrisation, drawn as steps of about `riser`
//           metres ('steps' mesh, no collider) over an invisible straight
//           ramp the car drives up ('ramp' mesh, collider only). The risers
//           sit half a tread off the ends, so the ramp runs through the
//           middle of every riser and meets both floors without a lip.
// Along an outline where the ground jumps, a retaining wall runs from the
// lower side to the higher; `parapets` are low walls along a polyline.
// Pedestrians walk every region but dips and those marked `"crowd": false`
// (tool/src/walk.dart sends them the regions' heights).
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

import 'city.dart' show Extent;
import 'clip.dart';
import 'geom.dart';
import 'mesh_writer.dart';
import 'osm.dart';

enum RegionKind { flat, ramp, stairs, dip }

class LevelRegion {
  LevelRegion(
    this.name,
    this.kind,
    this.shape, {
    this.level,
    this.from,
    this.to,
    this.fromLevel,
    this.toLevel,
    this.riser = .15,
    this.sinkFrom = 0,
    this.sinkTo = 0,
    this.taper = 10,
    this.crowd = true,
  }) : polygons = shape.polygons {
    var x0 = double.infinity, z0 = double.infinity;
    var x1 = -double.infinity, z1 = -double.infinity;
    for (final p in polygons.expand((q) => q.outer)) {
      x0 = math.min(x0, p.x);
      z0 = math.min(z0, p.y);
      x1 = math.max(x1, p.x);
      z1 = math.max(z1, p.y);
    }
    bounds = Extent(x0, z0, x1, z1);
  }

  final String name;
  final RegionKind kind;
  final Shape shape;
  final List<Polygon> polygons;
  late final Extent bounds;
  final double? level, fromLevel, toLevel;
  final Vector2? from, to;
  final double riser;
  final double sinkFrom, sinkTo, taper;

  /// Pedestrians may walk here (`"crowd": false` keeps them off, e.g. a
  /// fenced stairwell); never in a dip.
  final bool crowd;

  bool overlaps(double minX, double minZ, double maxX, double maxZ) =>
      bounds.maxX > minX &&
      bounds.minX < maxX &&
      bounds.maxZ > minZ &&
      bounds.minZ < maxZ;

  bool contains(Vector2 p) =>
      p.x >= bounds.minX &&
      p.x <= bounds.maxX &&
      p.y >= bounds.minZ &&
      p.y <= bounds.maxZ &&
      polygons.any((q) => q.contains(p));

  /// Position along `from` -> `to`, 0..1 (clamped).
  double along(Vector2 p) {
    final d = to! - from!;
    return ((p - from!).dot(d) / d.length2).clamp(0.0, 1.0);
  }

  /// Distance from [p] to the outline (outer rings and holes).
  double outlineDistance(Vector2 p) {
    var best = double.infinity;
    for (final polygon in polygons) {
      for (final ring in [polygon.outer, ...polygon.holes]) {
        for (var i = 0; i < ring.length; i++) {
          final a = ring[i], b = ring[(i + 1) % ring.length];
          final ab = b - a;
          final t = ab.length2 == 0 ? 0.0 : ((p - a).dot(ab) / ab.length2).clamp(0.0, 1.0);
          best = math.min(best, p.distanceTo(a + ab * t));
        }
      }
    }
    return best;
  }

  /// The terrain height at [p] inside this region; [below] is the ground
  /// beneath it (the grid and any earlier region).
  double height(Vector2 p, double Function(Vector2) below) {
    switch (kind) {
      case RegionKind.flat:
        return level!;
      case RegionKind.ramp:
        final a = fromLevel ?? below(p), b = toLevel ?? below(p);
        return a + (b - a) * along(p);
      case RegionKind.stairs:
        final a = fromLevel ?? below(from!), b = toLevel ?? below(to!);
        return a + (b - a) * along(p);
      case RegionKind.dip:
        final t = (outlineDistance(p) / taper).clamp(0.0, 1.0);
        final ease = t * t * (3 - 2 * t);
        return below(p) - (sinkFrom + (sinkTo - sinkFrom) * along(p)) * ease;
    }
  }
}

class Levels {
  Levels(this.regions, this.parapets, this.base);

  /// Reads [path]; [base] is the terrain without levels.
  factory Levels.load(String path, double Function(Vector2) base) {
    final file = File(path);
    if (!file.existsSync()) return Levels(const [], const [], base);
    final j = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    Vector2 pt(Object? v) =>
        Vector2(((v as List)[0] as num).toDouble(), (v[1] as num).toDouble());
    double? num_(Object? v) => (v as num?)?.toDouble();
    final regions = <LevelRegion>[];
    for (final r in j['regions'] as List) {
      final e = r as Map<String, dynamic>;
      var shape = Shape.empty();
      for (final ring in (e['polygons'] as List? ?? const [])) {
        shape =
            shape |
            Shape.of([
              Polygon([for (final p in ring as List) pt(p)], const []),
            ]);
      }
      for (final l in (e['lines'] as List? ?? const [])) {
        final line = l as Map<String, dynamic>;
        shape =
            shape |
            Shape.lines(
              [
                [for (final p in line['points'] as List) pt(p)],
              ],
              (line['halfWidth'] as num).toDouble(),
              round: false,
            );
      }
      final kind = RegionKind.values.byName(e['kind'] as String);
      if (shape.isEmpty) {
        throw FormatException(
          'data/levels.json: "${e['name']}" has no outline',
        );
      }
      if (kind != RegionKind.flat && (e['from'] == null || e['to'] == null)) {
        throw FormatException(
          'data/levels.json: "${e['name']}" needs from and to',
        );
      }
      regions.add(
        LevelRegion(
          e['name'] as String,
          kind,
          shape,
          level: num_(e['level']),
          from: e['from'] == null ? null : pt(e['from']),
          to: e['to'] == null ? null : pt(e['to']),
          fromLevel: num_(e['fromLevel']),
          toLevel: num_(e['toLevel']),
          riser: num_(e['riser']) ?? .15,
          sinkFrom: num_(e['sinkFrom']) ?? 0,
          sinkTo: num_(e['sinkTo']) ?? 0,
          taper: num_(e['taper']) ?? 10,
          crowd: kind != RegionKind.dip && (e['crowd'] as bool? ?? true),
        ),
      );
    }
    final parapets = [
      for (final p in (j['parapets'] as List? ?? const []))
        (
          [for (final q in (p as Map)['points'] as List) pt(q)],
          (p['height'] as num?)?.toDouble() ?? 1.0,
        ),
    ];
    return Levels(regions, parapets, base);
  }

  final List<LevelRegion> regions;
  final List<(List<Vector2>, double)> parapets;
  final double Function(Vector2) base;

  bool get isEmpty => regions.isEmpty;

  /// The index of the region that shapes the ground at [p] (the last one
  /// containing it, among the first [below]), or -1.
  int top(Vector2 p, {int? below}) {
    for (var i = (below ?? regions.length) - 1; i >= 0; i--) {
      if (regions[i].contains(p)) return i;
    }
    return -1;
  }

  /// The terrain at [p] from the regions before [below] (all by default)
  /// and the base.
  double heightAt(Vector2 p, {int? below}) {
    final i = top(p, below: below);
    return i < 0 ? base(p) : regionHeight(i, p);
  }

  /// Region [i]'s own height at [p] (inside it or on its outline).
  double regionHeight(int i, Vector2 p) =>
      regions[i].height(p, (q) => heightAt(q, below: i));
}

// ------------------------------------------------------------ meshes

const _stone = 5.0, _stoneRough = .7, _stonePeriod = 2.0;
const _tread = 2.0, _treadRough = .75, _treadPeriod = 2.5;

/// A vertical quad over (a, b) from [bottomA]/[bottomB] to [topA]/[topB],
/// facing [normal] (horizontal), stone-textured. [twoSided] adds the back:
/// walls have no thickness, and where two levels meet at a corner one is
/// seen from behind (a see-through slit into the space under a plateau).
void _wall(
  MeshWriter out,
  Vector2 a,
  Vector2 b,
  double bottomA,
  double bottomB,
  double topA,
  double topB,
  Vector2 normal,
  Vector4 color, {
  double tile = _stone,
  bool twoSided = true,
}) {
  for (final side in twoSided ? const [1.0, -1.0] : const [1.0]) {
    final n = Vector3(normal.x, 0, normal.y) * side;
    // World-planar along the wall, so neighbouring pieces line up.
    final tangent = Vector2(-normal.y, normal.x);
    int v(Vector2 p, double y) => out.vertex(
      Vector3(p.x, y, p.y),
      n,
      p.dot(tangent) / _stonePeriod,
      y / _stonePeriod,
      u1: tile,
      v1: _stoneRough,
      color: color,
    );
    final v0 = v(a, bottomA),
        v1 = v(b, bottomB),
        v2 = v(b, topB),
        v3 = v(a, topA);
    out.triangle(v0, v1, v2, n);
    out.triangle(v0, v2, v3, n);
  }
}

/// (a, b) cut into pieces at most [step] metres long, exact at the ends.
Iterable<(Vector2, Vector2)> _split(Vector2 a, Vector2 b, double step) sync* {
  final n = math.max(1, (a.distanceTo(b) / step).ceil());
  for (var k = 0; k < n; k++) {
    yield (
      k == 0 ? a : a + (b - a) * (k / n),
      k + 1 == n ? b : a + (b - a) * ((k + 1) / n),
    );
  }
}

/// (a, b) cut where it crosses [rings] (other regions' outlines), then into
/// pieces at most [step] long: each piece is then wholly on one side of every
/// outline, so the test at its middle holds for all of it. (Cutting by length
/// alone dropped a whole metre where a plateau wall ran into a stair, leaving a
/// see-through slit beside the steps.)
Iterable<(Vector2, Vector2)> _cutPieces(
  Vector2 a,
  Vector2 b,
  double step,
  Iterable<Ring> rings,
) sync* {
  final d = b - a;
  final ts = <double>[0, 1];
  for (final ring in rings) {
    for (var i = 0; i < ring.length; i++) {
      final p = ring[i], q = ring[(i + 1) % ring.length];
      final e = q - p;
      final den = d.x * e.y - d.y * e.x;
      if (den.abs() < 1e-12) continue;
      final w = p - a;
      final t = (w.x * e.y - w.y * e.x) / den,
          u = (w.x * d.y - w.y * d.x) / den;
      if (t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1) ts.add(t);
    }
  }
  ts.sort();
  for (var k = 0; k + 1 < ts.length; k++) {
    if (ts[k + 1] - ts[k] < 1e-6) continue;
    final p0 = ts[k] == 0 ? a : a + d * ts[k],
        p1 = ts[k + 1] == 1 ? b : a + d * ts[k + 1];
    yield* _split(p0, p1, step);
  }
}

extension LevelMeshes on Levels {
  /// Where a wall at [p] whose lower side is at [low] starts: down to the
  /// bare ground below every level, so no wall hangs above a lower floor
  /// beside it (seen at a corner, the gap under it looked into the hollow
  /// under a plateau).
  double foot(Vector2 p, double low) => math.min(low, base(p)) - .3;

  /// Every outline ring of the regions other than [i] near (a, b).
  Iterable<Ring> _otherRings(int i, Vector2 a, Vector2 b) sync* {
    final x0 = math.min(a.x, b.x) - .1, x1 = math.max(a.x, b.x) + .1;
    final z0 = math.min(a.y, b.y) - .1, z1 = math.max(a.y, b.y) + .1;
    for (var j = 0; j < regions.length; j++) {
      if (j == i || !regions[j].overlaps(x0, z0, x1, z1)) continue;
      for (final polygon in regions[j].polygons) {
        yield polygon.outer;
        yield* polygon.holes;
      }
    }
  }

  /// Retaining walls along every region outline (stairs excepted: see
  /// [emitStairs]) where the ground outside is lower or higher, for the
  /// pieces whose middle is in [chunk]. [lift] is the surface above the
  /// terrain (the sidewalk kerb).
  void emitWalls(Extent chunk, MeshWriter out, Vector4 color, double lift) {
    const eps = .05;
    for (var i = 0; i < regions.length; i++) {
      final r = regions[i];
      if (r.kind == RegionKind.stairs ||
          !r.overlaps(
            chunk.minX - 1,
            chunk.minZ - 1,
            chunk.maxX + 1,
            chunk.maxZ + 1,
          )) {
        continue;
      }
      for (final polygon in r.polygons) {
        for (final ring in [polygon.outer, ...polygon.holes]) {
          for (var e = 0; e < ring.length; e++) {
            final ea = ring[e], eb = ring[(e + 1) % ring.length];
            for (final (a, b) in _cutPieces(
              ea,
              eb,
              1,
              _otherRings(i, ea, eb),
            )) {
              final mid = (a + b) * .5;
              if (!chunk.contains(mid)) continue;
              final d = b - a;
              if (d.length < .01) continue;
              var n = Vector2(d.y, -d.x).normalized();
              if (r.contains(mid + n * eps)) n = -n;
              if (top(mid - n * eps) != i) continue;
              // Only against lower-priority ground: a later region draws its own.
              if (top(mid + n * eps) >= i) continue;
              final ia = regionHeight(i, a) + lift,
                  ib = regionHeight(i, b) + lift;
              final oa = heightAt(a + n * eps, below: i) + lift,
                  ob = heightAt(b + n * eps, below: i) + lift;
              final diff = (ia - oa + ib - ob) / 2;
              if (diff.abs() < .03) continue;
              if (diff > 0) {
                _wall(out, a, b, foot(a, oa), foot(b, ob), ia, ib, n, color);
              } else {
                _wall(out, a, b, foot(a, ia), foot(b, ib), oa, ob, -n, color);
              }
            }
          }
        }
      }
    }
  }

  /// Low walls along the `parapets` polylines, 0.3 m thick, on the ground.
  void emitParapets(Extent chunk, MeshWriter out, Vector4 color, double lift) {
    const half = .15;
    for (final (line, height) in parapets) {
      for (var i = 0; i + 1 < line.length; i++) {
        for (final (a, b) in _split(line[i], line[i + 1], 1)) {
          final mid = (a + b) * .5;
          if (!chunk.contains(mid)) continue;
          final d = (b - a).normalized();
          final side = Vector2(-d.y, d.x);
          final ga = heightAt(a) + lift, gb = heightAt(b) + lift;
          for (final s in const [-1.0, 1.0]) {
            _wall(
              out,
              a + side * (half * s),
              b + side * (half * s),
              ga - .3,
              gb - .3,
              ga + height,
              gb + height,
              side * s,
              color,
              twoSided: false,
            );
          }
          // The top.
          final up = Vector3(0, 1, 0);
          int v(Vector2 p, double y) => out.vertex(
            Vector3(p.x, y, p.y),
            up,
            p.x / _stonePeriod,
            p.y / _stonePeriod,
            u1: _stone,
            v1: _stoneRough,
            color: color,
          );
          final t0 = v(a - side * half, ga + height),
              t1 = v(b - side * half, gb + height);
          final t2 = v(b + side * half, gb + height),
              t3 = v(a + side * half, ga + height);
          out.triangle(t0, t1, t2, up);
          out.triangle(t0, t2, t3, up);
          // End caps at the polyline's ends.
          if (i == 0 && a == line[0]) {
            _wall(
              out,
              a - side * half,
              a + side * half,
              ga - .3,
              ga - .3,
              ga + height,
              ga + height,
              -d,
              color,
              twoSided: false,
            );
          }
          if (i + 2 == line.length && b == line.last) {
            _wall(
              out,
              b + side * half,
              b - side * half,
              gb - .3,
              gb - .3,
              gb + height,
              gb + height,
              d,
              color,
              twoSided: false,
            );
          }
        }
      }
    }
  }

  /// Each stairs region whose [LevelRegion.from] lies in [chunk]: the steps
  /// and their side walls into [steps] / [walls], and the smooth ramp the
  /// car drives on into [ramps] (collider only). [lift] as for [emitWalls].
  void emitStairs(
    Extent chunk,
    MeshWriter steps,
    MeshWriter walls,
    MeshWriter ramps,
    Vector4 treadColor,
    Vector4 wallColor,
    double lift,
  ) {
    const eps = .05;
    final up = Vector3(0, 1, 0);
    for (var i = 0; i < regions.length; i++) {
      final r = regions[i];
      if (r.kind != RegionKind.stairs || !chunk.contains(r.from!)) continue;
      final from = r.from!, to = r.to!;
      final length = from.distanceTo(to);
      final dir = (to - from) / length;
      final across = Vector2(-dir.y, dir.x);
      final h0 = r.height(from, (q) => heightAt(q, below: i)) + lift;
      final h1 = r.height(to, (q) => heightAt(q, below: i)) + lift;
      final count = math.max(1, ((h1 - h0).abs() / r.riser).round());
      final rise = (h1 - h0) / count;
      // A band across the stairs between two positions along them.
      Shape band(double t0, double t1) {
        final a = from + dir * (length * t0), b = from + dir * (length * t1);
        const w = 200.0;
        return Shape.of([
          Polygon([
            a - across * w,
            b - across * w,
            b + across * w,
            a + across * w,
          ], const []),
        ]);
      }

      double t(Vector2 p) => (p - from).dot(dir) / length;
      // Tread k (from -1, the floor before the first riser) is k + 1 risers
      // up, between the risers at (k + 1/2) / count and (k + 3/2) / count.
      for (var k = -1; k < count; k++) {
        final t0 = (k + .5) / count, t1 = (k + 1.5) / count;
        final y = h0 + rise * (k + 1);
        final tread = r.shape & band(k < 0 ? -1 : t0, k + 1 == count ? 2 : t1);
        for (final polygon in tread.polygons) {
          final all = [...polygon.outer, ...polygon.holes.expand((h) => h)];
          final ids = [
            for (final p in all)
              steps.vertex(
                Vector3(p.x, y, p.y),
                up,
                p.x / _treadPeriod,
                p.y / _treadPeriod,
                u1: _tread,
                v1: _treadRough,
                color: treadColor,
              ),
          ];
          final tris = earcut(polygon.outer, polygon.holes);
          for (var q = 0; q < tris.length; q += 3) {
            steps.triangle(
              ids[tris[q]],
              ids[tris[q + 1]],
              ids[tris[q + 2]],
              up,
            );
          }
          for (final ring in [polygon.outer, ...polygon.holes]) {
            for (var e = 0; e < ring.length; e++) {
              final a = ring[e], b = ring[(e + 1) % ring.length];
              if (a.distanceTo(b) < .01) continue;
              final onStart =
                  (t(a) - t0).abs() < 1e-3 && (t(b) - t0).abs() < 1e-3;
              final onEnd =
                  (t(a) - t1).abs() < 1e-3 && (t(b) - t1).abs() < 1e-3;
              if (onStart && k >= 0) {
                // The riser up to this tread, facing down the stairs.
                _wall(
                  steps,
                  a,
                  b,
                  y - rise,
                  y - rise,
                  y,
                  y,
                  rise >= 0 ? -dir : dir,
                  treadColor,
                  twoSided: false,
                );
                continue;
              }
              if (onEnd) continue;
              // A side: a wall down (or up) to the ground beside the stairs,
              // in pieces that each face one kind of ground.
              for (final (a, b) in _cutPieces(a, b, 1, _otherRings(i, a, b))) {
                final mid = (a + b) * .5;
                var n = Vector2(b.y - a.y, a.x - b.x).normalized();
                if (r.contains(mid + n * eps)) n = -n;
                if (top(mid + n * eps) > i) continue;
                final oa = heightAt(a + n * eps, below: i) + lift,
                    ob = heightAt(b + n * eps, below: i) + lift;
                final diff = y - (oa + ob) / 2;
                if (diff.abs() < .03) continue;
                // Only a real drop stops the car; a low edge is just drawn.
                final out = diff.abs() > .5 ? walls : steps;
                if (diff > 0) {
                  _wall(out, a, b, foot(a, oa), foot(b, ob), y, y, n, wallColor);
                } else {
                  _wall(out, a, b, foot(a, y), foot(b, y), oa, ob, -n, wallColor);
                }
              }
            }
          }
        }
      }
      // The ramp: floor to floor, through the middle of every riser, so a
      // wheel is never more than half a riser off the steps.
      for (final polygon in r.polygons) {
        final all = [...polygon.outer, ...polygon.holes.expand((h) => h)];
        final ids = [
          for (final p in all)
            ramps.vertex(
              Vector3(p.x, h0 + (h1 - h0) * t(p).clamp(0.0, 1.0), p.y),
              up,
              0,
              0,
            ),
        ];
        final tris = earcut(polygon.outer, polygon.holes);
        for (var q = 0; q < tris.length; q += 3) {
          ramps.triangle(ids[tris[q]], ids[tris[q + 1]], ids[tris[q + 2]], up);
        }
      }
    }
  }
}
