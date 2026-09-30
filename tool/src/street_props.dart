// Street furniture and landmarks for the web export: news kiosks and
// canopies (OSM `building=kiosk|roof|gazebo|...`, which the building pass
// would otherwise dress as small palaces), the Ban Jelačić statue, the
// Manduševac fountain and the street lamps.
//
// Everything is flat-shaded, vertex-coloured geometry in the local frame
// (x east, y up, z north); colours are LINEAR, like every payload colour.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

import 'mesh_writer.dart';
import 'geom.dart';
import 'osm.dart';

double _lin(int c) {
  final v = c / 255;
  return v <= .04045 ? v / 12.92 : math.pow((v + .055) / 1.055, 2.4).toDouble();
}

Vector4 hex(int rgb) =>
    Vector4(_lin((rgb >> 16) & 0xff), _lin((rgb >> 8) & 0xff), _lin(rgb & 0xff), 1);

/// UV1.y carries roughness for the web material; UV1.x a material hint
/// (0 = matte, 1 = metal, 2 = clear glass, 3 = water, 4 = lamp glow,
/// 5 = opaque tinted glass). Clear glass goes to [glass], drawn see-through.
class PropBuilder {
  PropBuilder(this.mesh, [MeshWriter? glass]) : glass = glass ?? mesh;
  final MeshWriter mesh;
  final MeshWriter glass;

  void _tri(Vector3 a, Vector3 b, Vector3 c, Vector4 color, double kind, double rough) {
    final n = (b - a).cross(c - a);
    if (n.length2 < 1e-12) return;
    n.normalize();
    final out = kind == 2 ? glass : mesh;
    final ids = [
      for (final p in [a, b, c]) out.vertex(p, n, 0, 0, u1: kind, v1: rough, color: color),
    ];
    out.triangle(ids[0], ids[1], ids[2], n);
  }

  void quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector4 color,
      {double kind = 0, double rough = .8}) {
    _tri(a, b, c, color, kind, rough);
    _tri(a, c, d, color, kind, rough);
  }

  /// A prism: [ring] (counter-clockwise seen from above, x/z) from [y0] to
  /// [y1], with caps.
  void prism(List<Vector2> ring, double y0, double y1, Vector4 color,
      {double kind = 0, double rough = .8, bool bottom = false}) {
    final ccw = signedArea(ring) > 0;
    final r = ccw ? ring : ring.reversed.toList();
    for (var i = 0; i < r.length; i++) {
      final a = r[i], b = r[(i + 1) % r.length];
      // Outward is to the right of a->b for a counter-clockwise ring in
      // x/z-north; build the quad and let the winding follow its normal.
      final p0 = Vector3(a.x, y0, a.y), p1 = Vector3(b.x, y0, b.y);
      final p2 = Vector3(b.x, y1, b.y), p3 = Vector3(a.x, y1, a.y);
      final out = Vector3(b.y - a.y, 0, -(b.x - a.x));
      final n = (p1 - p0).cross(p2 - p0);
      if (n.dot(out) >= 0) {
        quad(p0, p1, p2, p3, color, kind: kind, rough: rough);
      } else {
        quad(p0, p3, p2, p1, color, kind: kind, rough: rough);
      }
    }
    final tris = earcut(r, const []);
    for (var i = 0; i < tris.length; i += 3) {
      final a = r[tris[i]], b = r[tris[i + 1]], c = r[tris[i + 2]];
      final pa = Vector3(a.x, y1, a.y), pb = Vector3(b.x, y1, b.y), pc = Vector3(c.x, y1, c.y);
      final up = (pb - pa).cross(pc - pa).y >= 0;
      up ? _tri(pa, pb, pc, color, kind, rough) : _tri(pa, pc, pb, color, kind, rough);
      if (bottom) {
        final qa = Vector3(a.x, y0, a.y), qb = Vector3(b.x, y0, b.y), qc = Vector3(c.x, y0, c.y);
        up ? _tri(qa, qc, qb, color, kind, rough) : _tri(qa, qb, qc, color, kind, rough);
      }
    }
  }

  /// An oriented box: centre [c] on the ground plane, half extents along
  /// [f] (forward, unit x/z) and its right, from [y0] to [y1].
  void box(Vector2 c, Vector2 f, double halfLength, double halfWidth, double y0, double y1,
      Vector4 color, {double kind = 0, double rough = .8}) {
    final r = Vector2(f.y, -f.x);
    prism([
      c + f * halfLength + r * halfWidth,
      c - f * halfLength + r * halfWidth,
      c - f * halfLength - r * halfWidth,
      c + f * halfLength - r * halfWidth,
    ], y0, y1, color, kind: kind, rough: rough, bottom: y0 > .05);
  }

  /// A capsule-free cylinder between two points.
  void cylinder(Vector3 a, Vector3 b, double radius, Vector4 color,
      {int sides = 8, double kind = 0, double rough = .6, double? radiusB}) {
    final axis = b - a;
    final len = axis.length;
    if (len < 1e-6) return;
    final w = axis / len;
    final helper = w.y.abs() < .9 ? Vector3(0, 1, 0) : Vector3(1, 0, 0);
    final u = w.cross(helper)..normalize();
    final v = w.cross(u)..normalize();
    final rb = radiusB ?? radius;
    Vector3 at(Vector3 o, double rad, int i) {
      final t = i / sides * 2 * math.pi;
      return o + u * (math.cos(t) * rad) + v * (math.sin(t) * rad);
    }

    for (var i = 0; i < sides; i++) {
      final a0 = at(a, radius, i), a1 = at(a, radius, i + 1);
      final b0 = at(b, rb, i), b1 = at(b, rb, i + 1);
      final mid = (a0 + a1 + b0 + b1) / 4;
      final out = mid - (a + b) / 2;
      final n = (a1 - a0).cross(b0 - a0);
      if (n.dot(out) >= 0) {
        quad(a0, a1, b1, b0, color, kind: kind, rough: rough);
      } else {
        quad(a0, b0, b1, a1, color, kind: kind, rough: rough);
      }
      // Caps.
      _capTri(a, a0, a1, -w, color, kind, rough);
      _capTri(b, b0, b1, w, color, kind, rough);
    }
  }

  void _capTri(Vector3 c, Vector3 p, Vector3 q, Vector3 facing, Vector4 color, double kind, double rough) {
    final n = (p - c).cross(q - c);
    n.dot(facing) >= 0 ? _tri(c, p, q, color, kind, rough) : _tri(c, q, p, color, kind, rough);
  }

  /// A low-poly ellipsoid centred at [c] with radii along the local frame
  /// ([f] forward in x/z, right, up).
  void ellipsoid(Vector3 c, Vector2 f, double rForward, double rSide, double rUp, Vector4 color,
      {double kind = 0, double rough = .6, int segments = 10, int rings = 6, double pitch = 0}) {
    final fw = Vector3(f.x, 0, f.y), up = Vector3(0, 1, 0);
    final right = Vector3(f.y, 0, -f.x);
    // Pitch tilts the forward axis up (positive) or down.
    final fwd = fw * math.cos(pitch) + up * math.sin(pitch);
    final upp = up * math.cos(pitch) - fw * math.sin(pitch);
    Vector3 at(int ring, int seg) {
      final th = ring / rings * math.pi;
      final ph = seg / segments * 2 * math.pi;
      return c +
          upp * (math.cos(th) * rUp) +
          fwd * (math.sin(th) * math.cos(ph) * rForward) +
          right * (math.sin(th) * math.sin(ph) * rSide);
    }

    for (var i = 0; i < rings; i++) {
      for (var j = 0; j < segments; j++) {
        final a = at(i, j), b = at(i, j + 1), cc = at(i + 1, j + 1), d = at(i + 1, j);
        final mid = (a + b + cc + d) / 4;
        final out = mid - c;
        final n = (b - a).cross(d - a);
        final tri1 = (b - a).cross(cc - a);
        final flip = (n.length2 > 1e-12 ? n : tri1).dot(out) < 0;
        if (!flip) {
          quad(a, b, cc, d, color, kind: kind, rough: rough);
        } else {
          quad(a, d, cc, b, color, kind: kind, rough: rough);
        }
      }
    }
  }
}

/// The footprint's longest-edge direction and its oriented box.
(Vector2 center, Vector2 forward, double halfLength, double halfWidth) orientedBox(Polygon p) {
  final ring = p.outer;
  var best = Vector2(1, 0);
  var longest = 0.0;
  for (var i = 0; i < ring.length; i++) {
    final d = ring[(i + 1) % ring.length] - ring[i];
    if (d.length > longest) {
      longest = d.length;
      best = d.normalized();
    }
  }
  final r = Vector2(best.y, -best.x);
  var f0 = double.infinity, f1 = -double.infinity, r0 = double.infinity, r1 = -double.infinity;
  for (final q in ring) {
    f0 = math.min(f0, q.dot(best));
    f1 = math.max(f1, q.dot(best));
    r0 = math.min(r0, q.dot(r));
    r1 = math.max(r1, q.dot(r));
  }
  final center = best * ((f0 + f1) / 2) + r * ((r0 + r1) / 2);
  return (center, best, (f1 - f0) / 2, (r1 - r0) / 2);
}

/// A news kiosk on its footprint: a plinth, a painted lower panel, a glass
/// band, a brand-coloured sign band and a thin overhanging roof.
void emitKiosk(PropBuilder b, Tags tags, Polygon footprint, double ground) {
  final (c, f, hl, hw) = orientedBox(footprint);
  final name = (tags['name'] ?? tags['brand'] ?? tags['operator'] ?? '').toLowerCase();
  // Brand colours: Tisak red, iNovine blue, anything else bottle green.
  final brand = name.contains('tisak')
      ? hex(0xC4262E)
      : name.contains('novine')
          ? hex(0x1E5AA8)
          : hex(0x2E6B45);
  final y = ground + .15;
  b.box(c, f, hl, hw, y - .3, y + .25, hex(0x55585C), rough: .7);
  b.box(c, f, hl - .03, hw - .03, y + .25, y + .95, hex(0xE8E6E0), rough: .5);
  b.box(c, f, hl - .08, hw - .08, y + .95, y + 2.05, hex(0x2A3440), kind: 5, rough: .08);
  // Mullions at the corners and the long sides' middles.
  final r = Vector2(f.y, -f.x);
  for (final s in [-1.0, 1.0]) {
    for (final t in [-1.0, 0.0, 1.0]) {
      b.box(c + f * (hl - .06) * t + r * (hw - .06) * s, f, .05, .05, y + .95, y + 2.05,
          hex(0xD9D7D2), rough: .5);
    }
  }
  b.box(c, f, hl, hw, y + 2.05, y + 2.55, brand, rough: .45);
  b.box(c, f, hl + .35, hw + .35, y + 2.55, y + 2.72, hex(0xF0EEEA), rough: .5);
}

/// A canopy (`building=roof`, carport, shelter): posts and a flat roof.
void emitCanopy(PropBuilder b, Polygon footprint, double ground, {bool pyramid = false}) {
  final (c, f, hl, hw) = orientedBox(footprint);
  final r = Vector2(f.y, -f.x);
  final y = ground + .15;
  final top = y + (pyramid ? 2.6 : 3.1);
  final post = hex(0x33373A);
  for (final s in [-1.0, 1.0]) {
    for (final t in [-1.0, 1.0]) {
      final p = c + f * (hl - .25) * t + r * (hw - .25) * s;
      b.cylinder(Vector3(p.x, y, p.y), Vector3(p.x, top, p.y), .07, post, sides: 6, kind: 1, rough: .5);
    }
  }
  b.box(c, f, hl, hw, top, top + .18, hex(0xB9BCC0), rough: .6);
  if (pyramid) {
    final apex = Vector3(c.x, top + 1.4, c.y);
    final corners = [
      for (final (t, s) in const [(1.0, 1.0), (-1.0, 1.0), (-1.0, -1.0), (1.0, -1.0)])
        () {
          final p = c + f * (hl + .2) * t + r * (hw + .2) * s;
          return Vector3(p.x, top + .18, p.y);
        }(),
    ];
    for (var i = 0; i < 4; i++) {
      final a = corners[i], d = corners[(i + 1) % 4];
      final out = (a + d) / 2 - Vector3(c.x, top, c.y);
      final n = (d - a).cross(apex - a);
      n.dot(out) >= 0
          ? b.quad(a, d, apex, apex, hex(0x7A3B2E))
          : b.quad(a, apex, apex, d, hex(0x7A3B2E));
    }
  }
}

/// The Ban Jelačić monument (Fernkorn, 1866): a stone pedestal on two steps
/// and the ban on horseback in patinated bronze, sabre raised, facing south
/// as it has since 1990. [footprint] is OSM's outline of the pedestal.
void emitJelacic(PropBuilder b, Polygon footprint, double ground) {
  var (c, f, hl, hw) = orientedBox(footprint);
  // Face south (z north, so forward.z < 0).
  if (f.y > 0) f = -f;
  final r = Vector2(f.y, -f.x);
  final stone = hex(0x9E978A), stoneDark = hex(0x837D72);
  final bronze = hex(0x3E4636), bronzeLight = hex(0x55604A);
  var y = ground + .15;
  b.box(c, f, hl + .9, hw + .9, y - .3, y + .25, stoneDark, rough: .85);
  y += .25;
  b.box(c, f, hl + .45, hw + .45, y, y + .3, stoneDark, rough: .85);
  y += .3;
  b.box(c, f, hl, hw, y, y + 2.7, stone, rough: .8);
  b.box(c, f, hl + .12, hw + .12, y + 2.7, y + 3.0, stoneDark, rough: .8);
  final top = y + 3.0;

  Vector3 at(double fw, double side, double h) {
    final p = c + f * fw + r * side;
    return Vector3(p.x, top + h, p.y);
  }

  // The horse, walking: one foreleg raised.
  b.ellipsoid(at(0, 0, 1.55), f, 1.2, .52, .62, bronze, rough: .45, pitch: .05);
  b.ellipsoid(at(1.05, 0, 2.05), f, .42, .3, .62, bronze, rough: .45, pitch: .7);
  b.ellipsoid(at(1.45, 0, 2.55), f, .42, .19, .2, bronze, rough: .45, pitch: -.6);
  b.ellipsoid(at(1.28, 0, 2.62), f, .12, .08, .22, bronzeLight, rough: .45); // mane tuft / ears
  for (final (fw, side, lift, reach) in [
    (.78, .22, .45, .3), // front right, raised
    (.78, -.22, 0.0, 0.0),
    (-.82, .22, 0.0, 0.0),
    (-.82, -.22, 0.0, -.12),
  ]) {
    final hip = at(fw, side, 1.25);
    final knee = at(fw + reach * .6, side, .6 + lift);
    final hoof = at(fw + reach, side, lift > 0 ? .55 : 0);
    b.cylinder(hip, knee, .17, bronze, sides: 6, rough: .45, radiusB: .11);
    b.cylinder(knee, hoof, .1, bronze, sides: 6, rough: .45, radiusB: .09);
  }
  b.cylinder(at(-1.1, 0, 1.75), at(-1.4, 0, .9), .1, bronze, sides: 6, rough: .45, radiusB: .05);

  // The rider.
  b.ellipsoid(at(-.05, 0, 2.2), f, .45, .5, .12, bronzeLight, rough: .45); // saddle cloth
  b.ellipsoid(at(-.05, 0, 2.7), f, .22, .28, .45, bronze, rough: .45);
  b.ellipsoid(at(-.03, 0, 3.28), f, .14, .13, .17, bronze, rough: .45);
  b.cylinder(at(-.05, 0, 3.4), at(-.05, 0, 3.55), .16, bronze, sides: 8, rough: .45, radiusB: .12); // kalpak
  b.ellipsoid(at(-.25, 0, 2.5), f, .25, .42, .32, bronzeLight, rough: .45); // cloak
  for (final s in [-1.0, 1.0]) {
    b.cylinder(at(0, .3 * s, 2.35), at(.2, .5 * s, 1.75), .09, bronze, sides: 6, rough: .45);
    b.cylinder(at(.2, .5 * s, 1.75), at(.1, .52 * s, 1.35), .07, bronze, sides: 6, rough: .45);
  }
  // Right arm up with the sabre, left hand on the reins.
  b.cylinder(at(0, .26, 2.95), at(.3, .45, 3.35), .07, bronze, sides: 6, rough: .45);
  b.cylinder(at(.3, .45, 3.35), at(.95, .6, 4.2), .025, bronzeLight, sides: 4, kind: 1, rough: .3);
  b.cylinder(at(0, -.26, 2.95), at(.4, -.2, 2.55), .07, bronze, sides: 6, rough: .45);
}

/// Manduševac: a round stone basin with a low rim and water inside.
void emitFountain(PropBuilder b, Polygon footprint, double ground) {
  final ring = footprint.outer;
  final c = centroid(ring);
  var radius = 0.0;
  for (final p in ring) {
    radius += p.distanceTo(c);
  }
  radius /= ring.length;
  final y = ground + .15;
  List<Vector2> circle(double rad) => [
    for (var i = 0; i < 24; i++)
      c + Vector2(math.cos(i / 24 * 2 * math.pi), math.sin(i / 24 * 2 * math.pi)) * rad,
  ];
  final stone = hex(0xC9C2B4);
  // The rim as 24 blocks around the circle, water in the middle.
  final outer = circle(radius + .25), inner = circle(radius - .2);
  for (var i = 0; i < 24; i++) {
    b.prism([outer[i], outer[(i + 1) % 24], inner[(i + 1) % 24], inner[i]], y - .1, y + .38, stone,
        rough: .8);
  }
  b.prism(circle(radius - .15), y - .1, y + .22, hex(0x2C5F6E), kind: 3, rough: .05);
  // A low jet in the middle.
  b.cylinder(Vector3(c.x, y + .22, c.y), Vector3(c.x, y + .95, c.y), .05, hex(0xDDEBF0), sides: 6, kind: 3,
      rough: .1, radiusB: .02);
}

/// One street lamp at the origin: the square's dark cast-iron post with a
/// lantern, 4.6 m. Instanced by the web app.
MeshWriter lampMesh() {
  final mesh = MeshWriter();
  final b = PropBuilder(mesh);
  final iron = hex(0x23282A);
  b.cylinder(Vector3(0, 0, 0), Vector3(0, .5, 0), .16, iron, sides: 8, kind: 1, rough: .5, radiusB: .12);
  b.cylinder(Vector3(0, .5, 0), Vector3(0, 3.9, 0), .075, iron, sides: 8, kind: 1, rough: .5, radiusB: .055);
  b.cylinder(Vector3(0, 3.9, 0), Vector3(0, 4.05, 0), .14, iron, sides: 8, kind: 1, rough: .5);
  b.cylinder(Vector3(0, 4.05, 0), Vector3(0, 4.55, 0), .15, hex(0xF3E2B8), sides: 6, kind: 4, rough: .2,
      radiusB: .2);
  b.cylinder(Vector3(0, 4.55, 0), Vector3(0, 4.75, 0), .24, iron, sides: 6, kind: 1, rough: .5, radiusB: .04);
  return mesh;
}

double _hash(double a, double b) {
  final v = math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - v.floorToDouble();
}

/// A tram platform along its OSM centreline: a raised 2.8 m strip, glass
/// shelters with benches on the side away from [trackSide] (a unit x/z
/// vector toward the rails), and a stop sign at the head.
void emitPlatform(PropBuilder b, List<Vector2> line, Vector2 trackSide,
    double Function(Vector2) terrain) {
  const half = 1.4, lift = .22;
  final kerb = hex(0xA9A59C), top = hex(0xBDB8AE);
  for (var i = 0; i + 1 < line.length; i++) {
    final a = line[i], c = line[i + 1];
    final d = (c - a).normalized();
    final n = Vector2(d.y, -d.x);
    final quad = [a + n * half, c + n * half, c - n * half, a - n * half];
    final y0 = math.min(terrain(a), terrain(c)) + .15;
    b.prism(quad, y0 - .1, y0 + lift, top, rough: .8);
    // A darker edge along the rails' side.
    final s = n.dot(trackSide) > 0 ? 1.0 : -1.0;
    b.prism([a + n * (half * s), c + n * (half * s), c + n * ((half - .3) * s), a + n * ((half - .3) * s)],
        y0 - .1, y0 + lift + .01, kerb, rough: .8);
  }
  // Shelters every ~18 m along the whole line.
  var total = 0.0;
  for (var i = 0; i + 1 < line.length; i++) {
    total += line[i].distanceTo(line[i + 1]);
  }
  Vector2 at(double s) {
    var left = s;
    for (var i = 0; i + 1 < line.length; i++) {
      final l = line[i].distanceTo(line[i + 1]);
      if (left <= l) return line[i] + (line[i + 1] - line[i]) * (left / l);
      left -= l;
    }
    return line.last;
  }

  final glass = hex(0x9DB4C0), frame = hex(0x3B4046), roof = hex(0xDADDE0);
  final count = math.max(1, (total / 18).floor());
  for (var k = 0; k < count; k++) {
    final s = total * (k + .5) / count;
    final p = at(s), q = at(math.min(total, s + 1));
    final f = (q - p).normalized();
    final r = Vector2(f.y, -f.x);
    final away = r.dot(trackSide) > 0 ? -r : r;
    final c = p + away * .8;
    final y = terrain(p) + .15 + lift;
    const hl = 3.0, depth = .7;
    // Back glass wall and two side panes.
    b.box(c + away * depth, f, hl, .03, y, y + 2.4, glass, kind: 2, rough: .05);
    for (final e in [-1.0, 1.0]) {
      b.box(c + f * (hl * e) + away * (depth / 2), away, depth / 2, .03, y, y + 2.4, glass, kind: 2, rough: .05);
      b.cylinder(Vector3((c + f * (hl * e) + away * depth).x, y, (c + f * (hl * e) + away * depth).y),
          Vector3((c + f * (hl * e) + away * depth).x, y + 2.5, (c + f * (hl * e) + away * depth).y), .05, frame,
          sides: 6, kind: 1, rough: .4);
    }
    b.box(c + away * (depth / 2 - .1), f, hl + .2, depth / 2 + .5, y + 2.5, y + 2.65, roof, rough: .5);
    // Bench.
    b.box(c + away * (depth - .25), f, hl - .5, .22, y + .42, y + .48, hex(0x6B4B32), rough: .7);
    for (final e in [-1.0, 1.0]) {
      b.box(c + away * (depth - .25) + f * ((hl - .8) * e), f, .04, .2, y, y + .42, frame, kind: 1, rough: .4);
    }
  }
  // The stop sign (a ZET blue post) at the head of the platform.
  final head = line.first;
  final hy = terrain(head) + .15 + lift;
  b.cylinder(Vector3(head.x, hy, head.y), Vector3(head.x, hy + 2.9, head.y), .05, frame, sides: 6, kind: 1);
  final f0 = (line[1] - line[0]).normalized();
  b.box(head, f0, .35, .04, hy + 2.3, hy + 2.9, hex(0x1D4E9E), rough: .4);
}

/// A café terrace: tables in rows inside [area], each with two chairs and a
/// parasol, in one parasol colour per terrace. They are loose physics bodies
/// in the web (web3d/src/furniture.ts), so this only places them:
/// `[x, z, y, yaw, '#rrggbb']` in the web frame (z south; yaw turns +z onto
/// the line through the two chairs).
List<List<Object>> terraceTables(Polygon area, double Function(Vector2) terrain) {
  final (c, f, hl, hw) = orientedBox(area);
  final r = Vector2(f.y, -f.x);
  const palettes = [0xF1ECE0, 0x8E2B2B, 0x2F5A45, 0xE8E1CF, 0x33383F];
  final canopy = palettes[(_hash(c.x, c.y) * palettes.length).floor() % palettes.length];
  final color = '#${canopy.toRadixString(16).padLeft(6, '0')}';
  final yaw = math.atan2(f.x, -f.y);
  const pitch = 2.8;
  final nx = math.max(1, (2 * hl / pitch).floor()), ny = math.max(1, (2 * hw / pitch).floor());
  final tables = <List<Object>>[];
  for (var i = 0; i < nx; i++) {
    for (var j = 0; j < ny; j++) {
      final p = c + f * (-hl + pitch * (i + .5) + (2 * hl - nx * pitch) / 2) +
          r * (-hw + pitch * (j + .5) + (2 * hw - ny * pitch) / 2);
      if (!area.contains(p)) continue;
      double r3(double v) => (v * 1000).roundToDouble() / 1000;
      tables.add([r3(p.x), r3(-p.y), r3(terrain(p) + .15), r3(yaw), color]);
    }
  }
  return tables;
}

/// A standing figure [height] tall at [p] facing [f], for statues whose
/// likeness we do not model: legs, coat, arms, head.
void emitFigure(PropBuilder b, Vector3 p, Vector2 f, double height, Vector4 color, {double rough = .45}) {
  final k = height / 1.8;
  final r = Vector2(f.y, -f.x);
  Vector3 at(double fw, double side, double h) {
    final q = Vector2(p.x, p.z) + f * (fw * k) + r * (side * k);
    return Vector3(q.x, p.y + h * k, q.y);
  }

  for (final s in [-1.0, 1.0]) {
    b.cylinder(at(0, .1 * s, 0), at(0, .1 * s, .85), .075 * k, color, sides: 6, rough: rough, radiusB: .09 * k);
  }
  b.ellipsoid(at(0, 0, 1.1), f, .16 * k, .23 * k, .42 * k, color, rough: rough);
  b.cylinder(at(0, 0, .75), at(0, 0, 1.05), .24 * k, color, sides: 8, rough: rough, radiusB: .2 * k); // coat skirt
  for (final s in [-1.0, 1.0]) {
    b.cylinder(at(0, .24 * s, 1.42), at(.06, .28 * s, .95), .055 * k, color, sides: 6, rough: rough);
  }
  b.cylinder(at(0, 0, 1.48), at(0, 0, 1.56), .06 * k, color, sides: 6, rough: rough);
  b.ellipsoid(at(0, 0, 1.66), f, .11 * k, .1 * k, .13 * k, color, rough: rough);
}

/// A stone pedestal [h] high, [w] wide, with a plinth and a cornice.
void emitPedestal(PropBuilder b, Vector2 c, Vector2 f, double ground, double w, double h) {
  final stone = hex(0x9E978A), dark = hex(0x837D72);
  b.box(c, f, w / 2 + .15, w / 2 + .15, ground - .2, ground + .2, dark, rough: .85);
  b.box(c, f, w / 2, w / 2, ground + .2, ground + h - .15, stone, rough: .8);
  b.box(c, f, w / 2 + .08, w / 2 + .08, ground + h - .15, ground + h, dark, rough: .8);
}

/// Monuments and sculptures from their OSM node (or the centre of their
/// small area). The well-known ones get their own shape; the rest a figure
/// or bust on a pedestal. Returns false when it drew nothing.
bool emitMonument(PropBuilder b, Tags t, Vector2 c, double ground) {
  final name = t['name'] ?? '';
  final bronze = hex(0x4A4F3C);
  final f = Vector2(math.cos(_hash(c.x, c.y) * 6.283), math.sin(_hash(c.x, c.y) * 6.283));
  final g = ground + .15;
  if (name == 'Prizemljeno sunce') {
    // Ivan Kožarić's 2 m bronze sun on a low concrete plinth.
    b.box(c, Vector2(1, 0), .9, .9, g - .1, g + .9, hex(0xA8A49C), rough: .9);
    b.ellipsoid(Vector3(c.x, g + 1.95, c.y), Vector2(1, 0), 1.0, 1.0, 1.0, hex(0xC08A2C),
        kind: 1, rough: .35, segments: 16, rings: 10);
    return true;
  }
  if (name == 'Crvena vertikala') {
    b.box(c, f, .35, .35, g, g + 7.5, hex(0xB0201E), kind: 1, rough: .4);
    return true;
  }
  if (name == 'Maketa grada Zagreba') {
    // The bronze table model of the old town: a slab covered in blocks.
    b.box(c, Vector2(1, 0), 1.9, 1.9, g, g + .9, hex(0x6F6A5E), rough: .8);
    for (var i = 0; i < 40; i++) {
      final q = c + Vector2(_hash(i * 1.0, 3) * 3.4 - 1.7, _hash(7, i * 1.0) * 3.4 - 1.7);
      b.box(q, Vector2(1, 0), .12 + .1 * _hash(i * 2.0, 1), .1 + .08 * _hash(1, i * 2.0), g + .9,
          g + .98 + .2 * _hash(i * 3.0, 5), hex(0x6E5A38), kind: 1, rough: .4);
    }
    return true;
  }
  if (name == 'Djevica Marija') {
    // The Marian column at Kaptol: a tall column with a gilded figure.
    emitPedestal(b, c, Vector2(1, 0), g, 2.6, 3.0);
    b.cylinder(Vector3(c.x, g + 3, c.y), Vector3(c.x, g + 13, c.y), .45, hex(0xC9C1B0), sides: 12, rough: .7,
        radiusB: .38);
    b.box(c, Vector2(1, 0), .55, .55, g + 13, g + 13.5, hex(0xB7AE9C), rough: .7);
    emitFigure(b, Vector3(c.x, g + 13.5, c.y), Vector2(0, -1), 2.4, hex(0xD4A640));
    return true;
  }
  final kind = t['memorial'] ?? t['artwork_type'] ?? '';
  if (kind == 'bust') {
    emitPedestal(b, c, f, g, .7, 1.5);
    b.ellipsoid(Vector3(c.x, g + 1.75, c.y), f, .2, .28, .25, bronze, rough: .45);
    b.ellipsoid(Vector3(c.x, g + 2.1, c.y), f, .12, .11, .15, bronze, rough: .45);
    return true;
  }
  if (kind == 'statue' || kind == 'sculpture') {
    // Kumica Barica and Matoš on his bench stand at street level.
    final grounded = name.contains('Barica') || name.contains('Matoš') || name.contains('Zagorka');
    final h = grounded ? 0.0 : 1.8;
    if (!grounded) emitPedestal(b, c, f, g, 1.3, h);
    emitFigure(b, Vector3(c.x, g + h, c.y), f, grounded ? 1.65 : 2.2, bronze);
    return true;
  }
  return false;
}

/// A fountain: a round basin sized to its OSM outline; `Gljiva` (the
/// mushroom on Zrinjevac) gets its pillar and cap.
void emitBasin(PropBuilder b, Polygon footprint, double ground, {String? name}) {
  if (name == 'Manduševac') {
    emitFountain(b, footprint, ground);
    return;
  }
  emitFountain(b, footprint, ground);
  if (name == 'Gljiva') {
    final c = centroid(footprint.outer);
    final y = ground + .15;
    b.cylinder(Vector3(c.x, y, c.y), Vector3(c.x, y + 2.2, c.y), .35, hex(0x8C8778), sides: 10, rough: .6);
    b.ellipsoid(Vector3(c.x, y + 2.4, c.y), Vector2(1, 0), 1.6, 1.6, .5, hex(0x6F7466), kind: 1, rough: .4,
        segments: 16);
  }
}
