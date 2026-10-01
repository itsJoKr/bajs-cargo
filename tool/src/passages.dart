// Covered passages through buildings (data/passages.json): Marićev prolaz,
// the Oktogon. The export cuts a doorway into every wall edge a passage
// crosses (`openings`, used by emitBuilding) and writes the passage to
// city.json; web3d/src/passages.ts builds the inside (walls, ceiling,
// lamps, the Oktogon's hall and glass dome) and its colliders.
//
// data/passages.json, tool frame (x east, z north):
//   {name, style, points: [[x, z], ...] (centreline, both ends outside the
//    buildings), width (inside, m), height (inside, floor to ceiling or vault
//    crown), doorWidth, door (the doorway cut into each wall: width, height),
//    hall?: {at: [x, z], apothem, heading (deg, a face normal), height, dome}}
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

import 'osm.dart' show Polygon;

class PassageHall {
  PassageHall(this.at, this.apothem, this.heading, this.height, this.dome);
  final Vector2 at;
  final double apothem, heading, height, dome;

  /// The octagon's corners, [inset] metres inside its walls, counter-clockwise.
  List<Vector2> corners([double inset = 0]) {
    final r = (apothem - inset) / math.cos(math.pi / 8);
    final h = heading * math.pi / 180;
    return [
      // Bearings clockwise from north, (sin, cos) in x east / z north; going
      // clockwise in bearing is clockwise in the plane, so walk backwards.
      for (var k = 7; k >= 0; k--)
        Vector2(at.x + r * math.sin(h + math.pi / 8 + k * math.pi / 4),
            at.y + r * math.cos(h + math.pi / 8 + k * math.pi / 4)),
    ];
  }
}

class Passage {
  Passage(this.name, this.style, this.points, this.width, this.height, this.doorWidth, this.door, this.hall,
      {this.coverAll = false});
  final String name, style;

  /// Roofed from the first facade to the last, courtyards included (the
  /// Oktogon's glass-roofed arms).
  final bool coverAll;
  final List<Vector2> points;
  final double width, height, doorWidth, door;
  final PassageHall? hall;
}

class Passages {
  Passages(this.list, this.floor);
  final List<Passage> list;

  /// The floor height at a point (terrain plus the sidewalk).
  final double Function(Vector2) floor;

  static Passages load(String path, double Function(Vector2) floor) {
    final file = File(path);
    if (!file.existsSync()) return Passages(const [], floor);
    Vector2 v(List p) => Vector2((p[0] as num).toDouble(), (p[1] as num).toDouble());
    double d(Map m, String k) => (m[k] as num).toDouble();
    final json = jsonDecode(file.readAsStringSync()) as Map;
    return Passages([
      for (final p in (json['passages'] as List).cast<Map>())
        Passage(
          p['name'] as String,
          p['style'] as String,
          [for (final q in p['points'] as List) v(q as List)],
          d(p, 'width'),
          d(p, 'height'),
          d(p, 'doorWidth'),
          d(p, 'door'),
          p['hall'] is Map
              ? PassageHall(v((p['hall'] as Map)['at'] as List), d(p['hall'] as Map, 'apothem'),
                  d(p['hall'] as Map, 'heading'), d(p['hall'] as Map, 'height'), d(p['hall'] as Map, 'dome'))
              : null,
          coverAll: p['coverAll'] == true,
        ),
    ], floor);
  }

  bool get isEmpty => list.isEmpty;

  /// The building outlines, set before [openings]: a wall where a passage
  /// goes in or out of the buildings (a facade) gets the doorway, every wall
  /// inside (party walls, courtyard walls) is cut to the full corridor, so
  /// no jambs or lintels stand in it.
  List<Polygon> buildings = const [];
  final _ends = <Passage, List<double>>{};
  List<double> _endsOf(Passage p) =>
      _ends.putIfAbsent(p, () => [for (final (s0, s1) in _covered(p, buildings)) ...[s0, s1]]);

  /// The doorways along the wall [a]-[c]: (t0, t1, top y) with t the
  /// fraction along the wall, sorted and merged. Inside a hall the wall goes
  /// altogether (top = infinity).
  List<(double, double, double)> openings(Vector2 a, Vector2 c) {
    final out = <(double, double, double)>[];
    for (final p in list) {
      // A wall passing near where the passage goes in or out is a facade.
      final ends = [for (final s in _endsOf(p)) _at(p, s)];
      final facade = ends.any((q) => _distance(q, a, c) < p.width / 2 + .3);
      final w = facade ? p.doorWidth / 2 : p.width / 2 + .1;
      for (var i = 0; i + 1 < p.points.length; i++) {
        final s = p.points[i], e = p.points[i + 1];
        final dir = (e - s).normalized();
        final n = Vector2(-dir.y, dir.x);
        final hit = _clip(a, c, [s - n * w, e - n * w, e + n * w, s + n * w]);
        if (hit == null) continue;
        final mid = a + (c - a) * ((hit.$1 + hit.$2) / 2);
        out.add((hit.$1, hit.$2, floor(mid) + (facade ? p.door : p.height + .3)));
      }
      // At a bend the two legs' rectangles leave a wedge uncut: an octagon round the corner.
      for (var i = 1; i + 1 < p.points.length; i++) {
        final q = p.points[i];
        final r = w / math.cos(math.pi / 8);
        final hit = _clip(a, c, [
          for (var k = 0; k < 8; k++)
            Vector2(q.x + r * math.cos(math.pi / 8 + k * math.pi / 4), q.y + r * math.sin(math.pi / 8 + k * math.pi / 4)),
        ]);
        if (hit == null) continue;
        final mid = a + (c - a) * ((hit.$1 + hit.$2) / 2);
        out.add((hit.$1, hit.$2, floor(mid) + (facade ? p.door : p.height + .3)));
      }
      final hall = p.hall;
      if (hall != null) {
        final hit = _clip(a, c, hall.corners(.3));
        if (hit != null) out.add((hit.$1, hit.$2, double.infinity));
      }
    }
    out.sort((x, y) => x.$1.compareTo(y.$1));
    final merged = <(double, double, double)>[];
    for (final o in out) {
      if (merged.isNotEmpty && o.$1 <= merged.last.$2) {
        final l = merged.removeLast();
        merged.add((l.$1, math.max(l.$2, o.$2), math.max(l.$3, o.$3)));
      } else {
        merged.add(o);
      }
    }
    return merged;
  }

  static double _distance(Vector2 q, Vector2 a, Vector2 c) {
    final d = c - a;
    final t = ((q - a).dot(d) / d.length2).clamp(0.0, 1.0);
    return (a + d * t).distanceTo(q);
  }

  /// The part of segment [a]-[c] inside the convex counter-clockwise
  /// [ring], as fractions along it (Cyrus-Beck); null when under 5 cm.
  static (double, double)? _clip(Vector2 a, Vector2 c, List<Vector2> ring) {
    var t0 = 0.0, t1 = 1.0;
    final d = c - a;
    for (var i = 0; i < ring.length; i++) {
      final p = ring[i], q = ring[(i + 1) % ring.length];
      final e = q - p;
      final inward = Vector2(-e.y, e.x); // left of a ccw edge
      final num = inward.dot(a - p), den = inward.dot(d);
      if (den.abs() < 1e-12) {
        if (num < 0) return null;
        continue;
      }
      final t = -num / den;
      if (den > 0) {
        t0 = math.max(t0, t);
      } else {
        t1 = math.min(t1, t);
      }
      if (t0 >= t1) return null;
    }
    if ((t1 - t0) * d.length < .05) return null;
    return (t0, t1);
  }

  /// The walkable floor: each passage's corridor (less a margin) and hall.
  List<Polygon> floors({double margin = .5}) => [
        for (final p in list) ...[
          for (var i = 0; i + 1 < p.points.length; i++)
            () {
              final s = p.points[i], e = p.points[i + 1];
              final dir = (e - s).normalized();
              final n = Vector2(-dir.y, dir.x) * (p.width / 2 - margin);
              return Polygon([s - n, e - n, e + n, s + n]);
            }(),
          if (p.hall != null) Polygon(p.hall!.corners(margin)),
        ],
      ];

  /// city.json `passages` (web frame, z mirrored): `samples`, the centreline
  /// about every metre as [x, floor y, z] (every corner included), and
  /// `covered`, the stretches under a building as [s0, s1, f0x, f0z, f1x,
  /// f1z]: metres along the centreline and the direction of the facade at
  /// each end (so the walls end flush with it).
  List<Map<String, Object?>> toJson(List<Polygon> buildings) {
    double r2(double v) => (v * 100).roundToDouble() / 100;
    double r3(double v) => (v * 1000).roundToDouble() / 1000;
    return [
      for (final p in list)
        () {
          final samples = <List<double>>[];
          for (var i = 0; i + 1 < p.points.length; i++) {
            final a = p.points[i], b = p.points[i + 1];
            final n = math.max(1, a.distanceTo(b).ceil());
            for (var k = 0; k < n || (i + 2 == p.points.length && k == n); k++) {
              final q = a + (b - a) * (k / n);
              samples.add([r2(q.x), r2(floor(q)), r2(-q.y)]);
            }
          }
          return {
            'name': p.name,
            'style': p.style,
            'width': p.width,
            'height': p.height,
            'doorWidth': p.doorWidth,
            'door': p.door,
            'samples': samples,
            'covered': [
              for (final (s0, s1) in _covered(p, buildings))
                [r2(s0), r2(s1), ...() {
                  final f = _facade(_at(p, s0), buildings);
                  return [r3(f.x), r3(-f.y)];
                }(), ...() {
                  final f = _facade(_at(p, s1), buildings);
                  return [r3(f.x), r3(-f.y)];
                }()],
            ],
            if (p.hall != null)
              'hall': {
                'x': r2(p.hall!.at.x),
                'y': r2(floor(p.hall!.at)),
                'z': r2(-p.hall!.at.y),
                'apothem': p.hall!.apothem,
                'heading': p.hall!.heading,
                'height': p.hall!.height,
                'dome': p.hall!.dome,
              },
          };
        }(),
    ];
  }

  static Vector2 _at(Passage p, double s) {
    for (var i = 0; i + 1 < p.points.length; i++) {
      final len = p.points[i].distanceTo(p.points[i + 1]);
      if (s <= len || i + 2 == p.points.length) {
        return p.points[i] + (p.points[i + 1] - p.points[i]) * (s / len);
      }
      s -= len;
    }
    return p.points.last;
  }

  /// The stretches of [p]'s centreline inside a building, to a centimetre.
  static List<(double, double)> _covered(Passage p, List<Polygon> buildings) {
    var length = 0.0;
    for (var i = 0; i + 1 < p.points.length; i++) {
      length += p.points[i].distanceTo(p.points[i + 1]);
    }
    final near = [
      for (final b in buildings)
        if (b.outer.any((v) => p.points.any((q) => q.distanceTo(v) < length))) b,
    ];
    bool inside(double s) {
      final q = _at(p, s);
      return near.any((b) => b.contains(q));
    }

    double edge(double a, double b) {
      // inside(a) != inside(b): bisect to 1 cm.
      final ia = inside(a);
      while (b - a > .01) {
        final m = (a + b) / 2;
        if (inside(m) == ia) {
          a = m;
        } else {
          b = m;
        }
      }
      return (a + b) / 2;
    }

    const step = .25;
    final out = <(double, double)>[];
    double? start;
    var prev = inside(0);
    if (prev) start = 0;
    for (var s = step; s < length + step; s += step) {
      final t = math.min(s, length);
      final now = inside(t);
      if (now != prev) {
        final at = edge(t - step, t);
        if (now) {
          start = at;
        } else {
          out.add((start!, at));
        }
      }
      prev = now;
    }
    if (prev) out.add((start!, length));
    if (p.coverAll && out.length > 1) return [(out.first.$1, out.last.$2)];
    return out;
  }

  /// The direction of the building edge nearest [q].
  static Vector2 _facade(Vector2 q, List<Polygon> buildings) {
    var best = double.infinity;
    var dir = Vector2(1, 0);
    for (final b in buildings) {
      for (final (a, c) in b.edges) {
        final d = c - a;
        final t = ((q - a).dot(d) / d.length2).clamp(0.0, 1.0);
        final dist = (a + d * t).distanceTo(q);
        if (dist < best) {
          best = dist;
          dir = d.normalized();
        }
      }
    }
    return dir;
  }
}
