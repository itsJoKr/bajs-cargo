// Buildings: which OSM features become buildings, how tall they are, what
// roof they get, and the watertight wall + roof mesh for each.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

import 'facades.dart';
import 'mesh_writer.dart';
import 'geom.dart';
import 'hero.dart';
import 'roofs.dart';
import 'osm.dart';

/// What a wall edge faces, which decides what it wears.
enum WallKind { street, courtyard, party }

/// The sidewalk sits this far above the terrain (ground.dart kerbHeight);
/// facades start there.
const _sidewalk = .15;

/// One storey, and the extra a ground floor gets (shop fronts, portals).
const storeyHeight = 3.4, groundFloorExtra = 1.2;

enum RoofShape { flat, gabled, hipped }

class Building {
  Building({
    required this.id,
    required this.tags,
    required this.polygon,
    required this.base,
    required this.eave,
    required this.roof,
    required this.roofRise,
    required this.roofSlope,
    required this.box,
  });

  final String id;
  final Tags tags;
  final Polygon polygon;

  /// Bottom of the walls and the eave line, in metres above the local
  /// terrain datum; [roofRise] is the ridge above the eave.
  final double base, eave, roofRise;

  /// Rise per metre run of the pitched faces. A roof whose rise is capped
  /// flattens into a plateau at `roofRise` instead of getting shallower.
  final double roofSlope;
  final RoofShape roof;
  final OrientedBox box;

  /// Filled in by the city once streets and neighbours are known: one per
  /// edge of [Polygon.edges], in order.
  List<WallKind> walls = const [];

  /// The facade style its street walls wear, its paint (a vertex colour
  /// multiplying the atlas stucco) and its roof tint.
  String style = 'historicist_plain';
  Vector4 paint = Vector4(1, 1, 1, 1);
  Vector4 roofTint = Vector4(1, 1, 1, 1);

  Vector2 get center => centroid(polygon.outer);
  double get area => polygon.area;
  String? get name => tags['name'];
}

double? parseMetres(String? value) {
  if (value == null) return null;
  final match = RegExp(r'^\s*([0-9]+(?:[.,][0-9]+)?)').firstMatch(value);
  if (match == null) return null;
  return double.tryParse(match.group(1)!.replaceAll(',', '.'));
}

/// Gornji grad (the Upper Town) and Kaptol: older, lower houses.
bool isUpperTown(Vector2 p) {
  // Gornji grad's plateau, roughly Radićeva/Mesnička to the Strossmayer
  // promenade, and the Kaptol ridge north-east of the square.
  final gornji = p.x > -560 && p.x < -150 && p.y > 150 && p.y < 560;
  final kaptol = p.x > 60 && p.x < 330 && p.y > 170 && p.y < 520;
  return gornji || kaptol;
}

/// Decides a building's height and roof from its tags, size and district.
/// [interior] is true when it does not front any street (courtyard sheds,
/// workshops), which OSM rarely tags but which are almost always low.
Building makeBuilding(
  String id,
  Tags tags,
  Polygon polygon, {
  required bool interior,
  Vector2? ridgeAxis,
  double? heroEave,
}) {
  final area = polygon.area;
  // Donji grad roofs run their ridge along the street, whatever the plot's
  // depth; without a street edge, the tightest box decides.
  var box = orientedBox(polygon.outer);
  if (ridgeAxis != null && box.axis.dot(ridgeAxis).abs() < math.cos(.35)) {
    box = boxAlong(polygon.outer, ridgeAxis);
  }
  final kind = tags['building'] ?? tags['building:part'] ?? 'yes';
  final upper = isUpperTown(centroid(polygon.outer));

  var shape = switch (tags['roof:shape']) {
    'flat' => RoofShape.flat,
    'hipped' || 'half-hipped' || 'pyramidal' || 'many' => RoofShape.hipped,
    'gabled' ||
    'gabled_height_moved' ||
    'skillion' ||
    'saltbox' ||
    'mansard' ||
    'gambrel' => RoofShape.gabled,
    _ => null,
  };
  const small = {'garage', 'garages', 'shed', 'kiosk', 'roof', 'carport'};
  if (shape == null) {
    if (small.contains(kind) || kind == 'roof') {
      shape = RoofShape.flat;
    } else if (area > 3500) {
      shape = RoofShape.flat;
    } else {
      shape = RoofShape.gabled;
    }
  }

  final levels = parseMetres(tags['building:levels']);
  final height = parseMetres(tags['height']);
  final minHeight =
      parseMetres(tags['min_height']) ??
      (parseMetres(tags['building:min_level']) ?? 0) * storeyHeight;

  // Pitched roofs rise at about 32 degrees, capped so a deep block's roof
  // flattens into a plateau instead of towering.
  const slope = .62, maxRise = 5.5;
  final halfWidth = shape == RoofShape.flat ? 0.0 : box.halfWidth;
  var rise = shape == RoofShape.flat
      ? 0.0
      : math.min(slope * halfWidth, maxRise);
  final roofHeight = parseMetres(tags['roof:height']);
  if (roofHeight != null && shape != RoofShape.flat) {
    // Mapped roof heights are honoured: the Cathedral's spires are 34 m
    // pyramids, not 8 m caps.
    rise = roofHeight;
  }

  double eave;
  if (height != null) {
    eave = math.max(2.5, height - rise);
  } else if (levels != null) {
    eave = levels * storeyHeight + groundFloorExtra;
  } else if (small.contains(kind) || area < 45) {
    eave = 3.2;
    rise = math.min(rise, 1.5);
  } else if (interior && area < 600) {
    // Courtyard workshops and sheds: one or two storeys.
    eave = area < 150 ? 4.0 : 7.5;
    rise = math.min(rise, 2.5);
  } else if (upper) {
    eave = area < 250 ? 8.0 : 11.5;
  } else if (kind == 'church' || kind == 'cathedral') {
    eave = 16;
  } else {
    // Donji grad's perimeter blocks: four storeys over a tall ground floor.
    eave = 4 * storeyHeight + groundFloorExtra + .6;
  }
  // A hero facade's picture runs from the pavement to its cornice at a
  // fixed storey height; the wall matches it rather than the tags.
  if (heroEave != null) eave = heroEave;
  // `zg:eave` (data/buildings.json tags) wins over the picture's storeys: a hand-built part whose
  // picture is only roughly as tall as the volume (the arcade's recessed ground floor).
  final eaveOverride = parseMetres(tags['zg:eave']);
  if (eaveOverride != null) eave = eaveOverride;
  if (tags['roof:shape'] == null && eave > 30) {
    shape = RoofShape.flat;
    rise = 0;
  }
  return Building(
    id: id,
    tags: tags,
    polygon: polygon,
    base: minHeight,
    eave: math.max(minHeight + 2, eave),
    roof: rise < .3 ? RoofShape.flat : shape,
    roofRise: rise < .3 ? 0 : rise,
    roofSlope: math.max(slope, rise / math.max(box.halfWidth, .01)),
    box: box,
  );
}

// ---------------------------------------------------------------- roofs

/// A planar roof region: where it applies (half-planes in the box's
/// (u along, v across) frame) and its height `k + ku * u + kv * v` above
/// the eave.
class RoofRegion {
  RoofRegion(this.planes, this.k, this.ku, this.kv);
  final List<(double, double, double)> planes; // a*u + b*v >= c
  final double k, ku, kv;
}

class RoofModel {
  /// [streetEaves]: the roof also slopes down to the eave along every
  /// street wall, instead of only along its bounding box. Without it, a
  /// street wall set back inside the box gets a vertical stucco "gable" up
  /// to the roof surface (Gradska štedionica's front showed a grey
  /// trapezoid where its roof should be).
  ///
  /// [wings] (data/buildings.json `roofWings`): the roof is the highest of one roof per box
  /// instead of one over the whole footprint's box. The archbishop's palace is an L whose
  /// single box sat 23 degrees off both wings: its hipped roof flattened into a plateau with a
  /// 5.5 m stucco band on every wall and ran through Kula Nebojan's cone. Each wing slopes down
  /// to the eave at its own box, so wings meet in hips and valleys; footprint outside every
  /// wing (a round tower under its own cone) is flat at the eave.
  RoofModel(this.building, {bool streetEaves = false, List<OrientedBox> wings = const []})
      : box = building.box {
    final b = building;
    if (wings.isNotEmpty && b.roof != RoofShape.flat && b.roofRise > 0) {
      _wings = [
        for (final w in wings) RoofModel._wing(b, w, math.min(b.roofRise, b.roofSlope * w.halfWidth)),
      ];
      _flat = RoofModel._wing(b, b.box, 0);
      regions = const [];
      return;
    }
    _build(b.roofRise);
    if (streetEaves) _addStreetEaves();
  }

  RoofModel._wing(this.building, this.box, double rise) : _clip = true {
    _build(rise);
  }

  void _build(double rise) {
    final b = building;
    final w = box.halfWidth, l = box.halfLength;
    this.rise = rise;
    if (b.roof == RoofShape.flat || rise <= 0) {
      regions = [RoofRegion(const [], 0, 0, 0)];
      return;
    }
    slope = b.roofSlope;
    final cap = rise / slope; // how far in from the eave the slope stops
    if (b.roof == RoofShape.gabled) {
      final inner = w - cap;
      regions = [
        // +v side: h = slope * (w - v)
        RoofRegion([(0, 1, inner)], slope * w, 0, -slope),
        RoofRegion([(0, -1, inner)], slope * w, 0, slope),
        if (inner > 1e-6)
          RoofRegion([(0, 1, -inner), (0, -1, -inner)], rise, 0, 0),
      ];
    } else {
      final d = w - l;
      final ic = w - cap, lc = l - cap;
      regions = [
        // +v face: w - v is the smallest term.
        RoofRegion([(-1, 1, d), (1, 1, d), (0, 1, ic)], slope * w, 0, -slope),
        RoofRegion([(1, -1, d), (-1, -1, d), (0, -1, ic)], slope * w, 0, slope),
        // +u end: l - u smallest.
        RoofRegion([(1, -1, -d), (1, 1, -d), (1, 0, lc)], slope * l, -slope, 0),
        RoofRegion([(-1, 1, -d), (-1, -1, -d), (-1, 0, lc)], slope * l, slope, 0),
        if (ic > 1e-6 && lc > 1e-6)
          RoofRegion(
            [(0, 1, -ic), (0, -1, -ic), (1, 0, -lc), (-1, 0, -lc)],
            rise,
            0,
            0,
          ),
      ];
    }
  }

  /// Rebuilds [regions] as the lower envelope of the box's roof planes plus
  /// one plane rising from each street wall that the box roof leaves above
  /// the eave, clamped at the eave. Each plane is `k + ku * u + kv * v` in
  /// the box frame; its region is where it is the lowest.
  void _addStreetEaves() {
    final b = building;
    final planes = <(double, double, double)>[];
    for (final r in regions) {
      if (!planes.contains((r.k, r.ku, r.kv))) planes.add((r.k, r.ku, r.kv));
    }
    var i = 0;
    for (final (a, c) in b.polygon.edges) {
      final edge = i++;
      if (edge >= b.walls.length || b.walls[edge] != WallKind.street) continue;
      final d = c - a;
      if (d.length < 2) continue;
      final mid = (a + c) * .5;
      if (_boxHeight(mid) < .3) continue;
      var n = Vector2(-d.y, d.x).normalized();
      if (!b.polygon.contains(mid + n * .2)) n = -n;
      if (!b.polygon.contains(mid + n * .2)) continue;
      planes.add((
        slope * n.dot(box.center - a),
        slope * n.dot(box.axis),
        slope * n.dot(box.across),
      ));
    }
    if (planes.length == regions.length) return;
    final out = <RoofRegion>[];
    for (var p = 0; p < planes.length; p++) {
      final (k, ku, kv) = planes[p];
      final hp = <(double, double, double)>[];
      var empty = false;
      for (var q = 0; q < planes.length; q++) {
        if (q == p) continue;
        final (k2, ku2, kv2) = planes[q];
        // P_q - P_p >= 0; ties go to the lower index.
        final a = ku2 - ku, bb = kv2 - kv;
        final cc = k - k2 + (q < p ? 1e-6 : -1e-6);
        if (a.abs() < 1e-9 && bb.abs() < 1e-9) {
          if (cc > 0) empty = true;
          continue;
        }
        hp.add((a, bb, cc));
      }
      if (empty) continue;
      // Above the eave: the plane itself; below it: flat at the eave.
      out.add(RoofRegion([...hp, if (ku.abs() + kv.abs() > 1e-9) (ku, kv, -k)], k, ku, kv));
      if (ku.abs() + kv.abs() > 1e-9) {
        out.add(RoofRegion([...hp, (-ku, -kv, k)], 0, 0, 0));
      }
    }
    regions = out;
    _envelope = planes;
  }

  List<(double, double, double)>? _envelope;

  double _boxHeight(Vector2 p) {
    final b = building;
    final (u, v) = box.local(p);
    final w = box.halfWidth, l = box.halfLength;
    final run = b.roof == RoofShape.gabled
        ? w - v.abs()
        : math.min(w - v.abs(), l - u.abs());
    return math.min(math.max(run, 0) * slope, rise);
  }

  final Building building;

  /// The box the roof planes are measured in: the building's, or a wing's.
  final OrientedBox box;
  late List<RoofRegion> regions;
  double slope = 0, rise = 0;

  /// A wing's roof stops at its box (a gabled one would run on past its ends).
  bool _clip = false;
  List<RoofModel> _wings = const [];
  RoofModel? _flat;

  /// The box's inside, `a*u + b*v >= c` like region planes.
  List<(double, double, double)> get _sides => [
        (-1, 0, -box.halfLength),
        (1, 0, -box.halfLength),
        (0, -1, -box.halfWidth),
        (0, 1, -box.halfWidth),
      ];

  HalfPlane _halfPlane((double, double, double) plane) {
    final (a, b, c) = plane;
    // a*u + b*v >= c with u = (p - center).axis, v = (p - center).across
    final n = box.axis * a + box.across * b;
    return HalfPlane(n.x, n.y, c + n.dot(box.center));
  }

  /// Roof height above the eave at [p].
  double heightAt(Vector2 p) {
    final b = building;
    if (_wings.isNotEmpty) {
      return _wings.fold(0.0, (h, wing) => math.max(h, wing.heightAt(p)));
    }
    if (b.roof == RoofShape.flat || rise <= 0) return 0;
    final env = _envelope;
    if (env != null) {
      final (u, v) = box.local(p);
      var h = double.infinity;
      for (final (k, ku, kv) in env) {
        h = math.min(h, k + ku * u + kv * v);
      }
      return math.max(0, h);
    }
    final (u, v) = box.local(p);
    final w = box.halfWidth, l = box.halfLength;
    if (_clip && (u.abs() > l + .01 || v.abs() > w + .01)) return 0;
    final run = b.roof == RoofShape.gabled
        ? w - v.abs()
        : math.min(w - v.abs(), l - u.abs());
    return math.min(math.max(run, 0) * slope, rise);
  }

  /// Parameters in (0, 1) along [a]-[b] where the roof surface kinks.
  List<double> breaks(Vector2 a, Vector2 b) {
    if (_wings.isNotEmpty) {
      final ts = {for (final wing in _wings) ...wing.breaks(a, b)}.toList()..sort();
      // The highest wing changes where two wings' heights cross between breaks.
      final cuts = [0.0, ...ts, 1.0];
      for (var i = 0; i < cuts.length - 1; i++) {
        final p0 = a + (b - a) * cuts[i], p1 = a + (b - a) * cuts[i + 1];
        final h0 = [for (final wing in _wings) wing.heightAt(p0)];
        final h1 = [for (final wing in _wings) wing.heightAt(p1)];
        for (var j = 0; j < _wings.length; j++) {
          for (var k = j + 1; k < _wings.length; k++) {
            final d0 = h0[j] - h0[k], d1 = h1[j] - h1[k];
            if (d0 * d1 < 0) ts.add(cuts[i] + (cuts[i + 1] - cuts[i]) * d0 / (d0 - d1));
          }
        }
      }
      return ts..sort();
    }
    if (building.roof == RoofShape.flat || rise <= 0) return const [];
    final (ua, va) = box.local(a);
    final (ub, vb) = box.local(b);
    final lines = <(double, double, double)>{};
    for (final region in regions) {
      lines.addAll(region.planes);
    }
    lines.add((0, 1, 0));
    lines.add((1, 0, 0));
    if (_clip) lines.addAll(_sides);
    final ts = <double>[];
    for (final (pa, pb, c) in lines) {
      final fa = pa * ua + pb * va - c, fb = pa * ub + pb * vb - c;
      if ((fa > 0) != (fb > 0) && (fa - fb).abs() > 1e-12) {
        final t = fa / (fa - fb);
        if (t > 1e-4 && t < 1 - 1e-4) ts.add(t);
      }
    }
    ts.sort();
    return ts;
  }

  /// Clips a footprint triangle into roof regions and emits them.
  void emitTriangle(
    MeshWriter mesh,
    Ring triangle,
    double eaveY, {
    required Vector4 color,
    required double tile,
    double roughness = .8,
    double period = 2.0,
  }) {
    if (_wings.isNotEmpty) {
      bool keep(Ring piece) => piece.length >= 3 && signedArea(piece).abs() >= 1e-4;
      var rest = [triangle];
      for (final wing in _wings) {
        final sides = [for (final s in wing._sides) wing._halfPlane(s)];
        final piece = clipToHalfPlanes(triangle, sides);
        if (keep(piece)) {
          wing.emitTriangle(mesh, piece, eaveY,
              color: color, tile: tile, roughness: roughness, period: period);
        }
        // What lies outside this wing: one convex piece per side of its box.
        rest = [
          for (final r in rest)
            for (var k = 0; k < sides.length; k++)
              clipToHalfPlanes(r, [sides[k].flipped, ...sides.take(k)]),
        ].where(keep).toList();
      }
      for (final r in rest) {
        _flat!.emitTriangle(mesh, r, eaveY,
            color: color, tile: tile, roughness: roughness, period: period);
      }
      return;
    }
    final axis = box.axis, across = box.across;
    for (final region in regions) {
      final planes = [for (final plane in region.planes) _halfPlane(plane)];
      final piece = clipToHalfPlanes(triangle, planes);
      if (piece.length < 3 || signedArea(piece).abs() < 1e-4) continue;
      // Height gradient in world x/z.
      final grad = axis * region.ku + across * region.kv;
      final normal = Vector3(-grad.x, 1, -grad.y)..normalize();
      double h(Vector2 p) {
        final (u, v) = box.local(p);
        return eaveY + region.k + region.ku * u + region.kv * v;
      }

      // Roof tiles run down the slope: u along the eave, v up the slope.
      final downhill = grad.length2 > 1e-9 ? grad.normalized() : axis;
      final along = Vector2(-downhill.y, downhill.x);
      final stretch = math.sqrt(1 + grad.length2);
      final ids = [
        for (final p in piece)
          mesh.vertex(
            Vector3(p.x, h(p), p.y),
            normal,
            p.dot(along) / period,
            p.dot(downhill) * stretch / period,
            u1: tile,
            v1: roughness,
            color: color,
          ),
      ];
      for (var i = 1; i < ids.length - 1; i++) {
        mesh.triangle(ids[0], ids[i], ids[i + 1], normal);
      }
    }
  }
}

// ---------------------------------------------------------------- meshes

class BuildingMeshes {
  final facades = MeshWriter();
  final roofs = MeshWriter();
}

/// Surface atlas tiles for roofs (tool/prepare_textures.py SURFACES).
/// Facade-atlas tile 49 (tool/prepare_textures.py): seamless weathered plaster, and its tint.
const plasterTile = 49.0;
final rearTint = Vector4(.93, .89, .82, 1);
const clayRoofTile = 6, flatRoofTile = 7, copperRoofTile = 8, stoneTile = 14;

/// An open ground floor (a colonnade): the walls of [edges] start [base] metres above the sidewalk,
/// with the underside of the overhang ([soffit], a polygon in the tool frame) closed at that height.
/// `data/arcades.json`; the recessed ground floor is a separate building part and the columns are
/// `box` features. [spans] opens only part of a wall (t0..t1 along the edge), where the colonnade's
/// end runs into a wall that stays on the ground beside it.
class Arcade {
  Arcade(this.edges, this.base, this.soffit, {this.spans = const {}, this.arches});
  final Set<int> edges;
  final double base;
  final List<Vector2> soffit;
  final Map<int, (double, double)> spans;
  final Arches? arches;
}

/// Round arches through one wall of an [Arcade] (Nama's arcade on Ilica): the openings ([openings],
/// t0..t1 along edge [edge]) are cut out of the wall and its picture up to semicircular tops that
/// meet at [crown] picture metres (the picture's own scale, pavement to cornice = the building's
/// eave). The wall starts at its HIGHEST sidewalk, so the arches stay level as the street falls;
/// each bay of the walkway behind them ([walk]: t0..t1 along the edge, [depth] m deep) has its own
/// floor a [riser] above the pavement in front of it, so every arch downhill stands a little lower
/// and its floor a step above the street. The front is [thick] m deep (stone reveals); the
/// arcade's [base] (picture metres too) is the walkway's ceiling.
class Arches {
  Arches(this.edge, this.openings, this.crown,
      {required this.walk, this.depth = 3, this.thick = .7, this.riser = .15, this.soffitColor});
  final int edge;
  final List<(double, double)> openings;
  final double crown, depth, thick, riser;
  final (double, double) walk;
  final Vector4? soffitColor;
}

/// Travertine (Nama's arcade): the weathered-plaster tile tinted warm.
final _travertine = Vector4(.92, .83, .72, 1);

/// The arch curves of [arches] on a wall [length] m long whose picture starts at [sidewalkY] and is
/// [scale] world metres a picture metre up the wall.
class _ArchCurves {
  _ArchCurves(this.arches, this.length, this.sidewalkY, this.scale);
  final Arches arches;
  final double length, sidewalkY, scale;

  /// Slices per arch, denser at the springs where the curve is steep.
  static const _slices = 16;

  /// Where the curve of the arch over t0..t1 meets the vertical at t.
  double top(double t) {
    for (final (t0, t1) in arches.openings) {
      if (t < t0 - 1e-9 || t > t1 + 1e-9) continue;
      final r = (t1 - t0) * length / 2;
      final x = ((t - (t0 + t1) / 2) * length / r).clamp(-1.0, 1.0);
      final spring = arches.crown - r;
      return sidewalkY + (spring + r * math.sqrt(1 - x * x)) * scale;
    }
    return sidewalkY;
  }

  double springY((double, double) o) => sidewalkY + (arches.crown - (o.$2 - o.$1) * length / 2) * scale;

  /// The slice boundaries along the wall (t), cosine-spaced over each arch.
  List<double> samples() => [
        for (final (t0, t1) in arches.openings)
          for (var j = 0; j <= _slices; j++) (t0 + t1) / 2 - (t1 - t0) / 2 * math.cos(math.pi * j / _slices),
      ];
}

/// Everything of an arched arcade ([Arches]) behind its wall's picture, between corners [a] and [c]
/// (tool frame): the stone reveals of the arches, the back of the arcade front, the floor of each bay
/// with its step up from the pavement, all in [out] (they collide like walls). [tile] is the facade
/// tile they wear (weathered plaster), tinted travertine.
void _emitArcadeFront(
  MeshWriter out,
  _ArchCurves curves, {
  required Vector2 a,
  required Vector2 c,
  required double soffitY,
  required double Function(Vector2)? terrain,
  required double tile,
}) {
  final arches = curves.arches;
  final length = curves.length;
  final along = (c - a) / length;
  final outward = Vector2(along.y, -along.x);
  final out3 = Vector3(outward.x, 0, outward.y), in3 = -out3;
  final along3 = Vector3(along.x, 0, along.y);
  final up = Vector3(0, 1, 0);
  final stone = _travertine, floorStone = Vector4(.66, .63, .6, 1);
  const roughness = .9;
  // A point [s] m along the wall, [q] m in behind its face, at height [y].
  Vector3 at(double s, double q, double y) {
    final p = a + along * s - outward * q;
    return Vector3(p.x, y, p.y);
  }

  // The pavement in front of the wall at [s] m along it.
  double pavement(double s) =>
      (terrain == null ? curves.sidewalkY - _sidewalk : terrain(a + along * s + outward * .6)) + _sidewalk;

  // A planar quad, UVs in 3 m tiles projected along its normal's dominant axis.
  void face(List<Vector3> pts, Vector3 n, Vector4 color) {
    final ids = [
      for (final p in pts)
        out.vertex(
          p,
          n,
          n.y.abs() > .7 ? p.x / 3 : (p.x * n.z - p.z * n.x).abs() / 3,
          n.y.abs() > .7 ? p.z / 3 : p.y / 3,
          u1: tile,
          v1: roughness,
          color: color,
        ),
    ];
    out.triangle(ids[0], ids[1], ids[2], n);
    out.triangle(ids[0], ids[2], ids[3], n);
  }

  final thick = arches.thick, depth = arches.depth;
  final ts = curves.samples();
  const n = _ArchCurves._slices + 1;
  for (var k = 0; k < arches.openings.length; k++) {
    final o = arches.openings[k];
    final spring = curves.springY(o);
    // The intrados: the curve from spring to spring, the depth of the front, facing the opening.
    for (var j = 0; j < n - 1; j++) {
      final s0 = ts[k * n + j] * length, s1 = ts[k * n + j + 1] * length;
      final y0 = curves.top(ts[k * n + j]), y1 = curves.top(ts[k * n + j + 1]);
      final tangent = along3 * (s1 - s0) + up * (y1 - y0);
      final normal = tangent.cross(in3)..normalize();
      if (normal.y > 0) normal.negate();
      face([at(s0, 0, y0), at(s1, 0, y1), at(s1, thick, y1), at(s0, thick, y0)], normal, stone);
    }
    // The piers' sides below the springs, from under the pavement.
    for (final (t, n2) in [(o.$1, along3), (o.$2, -along3)]) {
      final s = t * length;
      final bottom = pavement(s) - .3;
      face([at(s, 0, bottom), at(s, thick, bottom), at(s, thick, spring), at(s, 0, spring)], n2, stone);
    }
  }

  // The walkway: one floor per bay, between the middles of the piers, a riser above the pavement
  // in front of its arch; the step between two bays stands behind the pier.
  final (w0, w1) = arches.walk;
  final bounds = [
    w0,
    for (var k = 1; k < arches.openings.length; k++)
      (arches.openings[k - 1].$2 + arches.openings[k].$1) / 2,
    w1,
  ];
  final floors = [
    for (final (t0, t1) in arches.openings) pavement((t0 + t1) / 2 * length) + arches.riser,
  ];
  for (var k = 0; k < floors.length; k++) {
    final s0 = bounds[k] * length, s1 = bounds[k + 1] * length, f = floors[k];
    face([at(s0, 0, f), at(s1, 0, f), at(s1, depth, f), at(s0, depth, f)], up, floorStone);
    // The riser under the opening, down to below the pavement.
    final (t0, t1) = arches.openings[k];
    final o0 = t0 * length, o1 = t1 * length;
    face([at(o0, 0, pavement(o0) - .3), at(o1, 0, pavement(o1) - .3), at(o1, 0, f), at(o0, 0, f)], out3,
        floorStone);
    if (k > 0) {
      final lower = math.min(f, floors[k - 1]), upper = math.max(f, floors[k - 1]);
      // Faces the lower bay: west (-along) when this bay is the higher one.
      face([at(s0, thick, lower), at(s0, depth, lower), at(s0, depth, upper), at(s0, thick, upper)],
          f > floors[k - 1] ? -along3 : along3, floorStone);
    }
  }

  // The back of the arcade front, seen from the walkway: up to the ceiling, the arches cut out.
  final low = floors.reduce(math.min) - .05;
  final cuts = [w0, ...ts, w1]..sort();
  for (var i = 0; i < cuts.length - 1; i++) {
    final t0 = cuts[i], t1 = cuts[i + 1];
    if (t0 < w0 || t1 > w1 || t1 - t0 < 1e-6) continue;
    final tm = (t0 + t1) / 2;
    final inside = arches.openings.any((o) => tm > o.$1 && tm < o.$2);
    final y0 = inside ? curves.top(t0) : low, y1 = inside ? curves.top(t1) : low;
    if (y0 >= soffitY && y1 >= soffitY) continue;
    final s0 = t0 * length, s1 = t1 * length;
    face([at(s0, thick, math.min(y0, soffitY)), at(s1, thick, math.min(y1, soffitY)), at(s1, thick, soffitY),
        at(s0, thick, soffitY)], in3, stone);
  }
}

/// Emits [b]'s walls into [out.facades] and roof into [out.roofs]. [ground]
/// is the terrain height under the building's centre, [foot] the lowest
/// under its footprint (the same when the ground is flat).
///
/// Street walls wear the building's style, courtyard walls the courtyard
/// style, party walls (against a neighbour) and gables plain stucco. Each
/// wall gets a whole number of bays, so no window is ever cut by a corner,
/// and rows (ground floor, first floor, upper storeys, cornice) fill the
/// wall from the sidewalk to the eave.
///
/// A wall [hero] has a Street View picture for wears that picture instead,
/// once, from the sidewalk to the eave (UV1.x = -1 - page selects a hero atlas page
/// in `city_atlas.fmat`, UV0 is the atlas coordinate itself).
void emitBuilding(
  Building b,
  BuildingMeshes out, {
  required double ground,
  required FacadeStyles styles,
  HeroAtlas? hero,
  double? foot,
  double Function(Vector2)? terrain,
  Vector4? plainWalls,
  Set<String> rearWalls = const {},
  Arcade? arcade,
  RoofChoice? roofCover,
  List<(double, double, double)> Function(Vector2 a, Vector2 b)? openings,
  List<OrientedBox> roofWings = const [],
}) {
  final roof = RoofModel(b, streetEaves: plainWalls != null, wings: roofWings);
  // On a slope the walls reach down to the lowest ground under the
  // footprint ([foot]), so the downhill side never floats.
  final baseY = math.min(ground, foot ?? ground) + b.base - (b.base == 0 ? .6 : 0);
  final eaveY = ground + b.eave;
  final buildingSidewalkY = ground + _sidewalk;
  final facadeHeight = eaveY - buildingSidewalkY;
  final street = styles[b.style == 'stone' ? 'courtyard' : b.style];
  final courtyard = styles['courtyard'];
  final streetRows = FacadeStyles.rows(street, facadeHeight);
  final courtyardRows = FacadeStyles.rows(courtyard, facadeHeight);
  final plain = styles.plainTile.toDouble();
  // Churches and towers are dressed stone, not rows of flats.
  final stone = b.style == 'stone';
  const roughness = .9;
  final spans = hero?.spansFor(b.id, b.polygon) ?? const <int, HeroSpan>{};
  final white = Vector4(1, 1, 1, 1);

  // The ceiling of an arcade with arches, from its wall's sidewalk ([Arches]).
  double? archSoffitY;
  var edgeIndex = -1;
  for (final (a, c) in b.polygon.edges) {
    edgeIndex++;
    final d = c - a;
    final length = d.length;
    if (length < .05) continue;
    final normal = Vector3(d.y, 0, -d.x) / length;
    final kind = edgeIndex < b.walls.length ? b.walls[edgeIndex] : WallKind.street;
    final style = kind == WallKind.courtyard ? courtyard : street;
    // On sloped ground ([terrain] given) each wall starts its rows at the
    // lowest sidewalk along it, so no row repeats below the pavement; the
    // uphill end buries a little of the ground floor instead.
    var sidewalkY = buildingSidewalkY;
    var wallRows = kind == WallKind.courtyard ? courtyardRows : streetRows;
    final arches = arcade?.arches?.edge == edgeIndex ? arcade!.arches : null;
    if (terrain != null) {
      final low = math.min(terrain(a), math.min(terrain(c), terrain((a + c) * .5)));
      // A wall with arches starts at its highest sidewalk: the arches stay level and the
      // bays downhill get steps ([Arches]).
      final high = math.max(terrain(a), math.max(terrain(c), terrain((a + c) * .5)));
      sidewalkY = math.min((arches != null ? high : low) + _sidewalk, eaveY - 2);
      wallRows = FacadeStyles.rows(
        kind == WallKind.courtyard ? courtyard : street,
        eaveY - sidewalkY,
      );
    }
    // [plainWalls]: every wall without a real (hero) facade is plain
    // stucco in that colour, so the photographed buildings stand out and
    // nothing pretends to be a real facade that is not.
    // [rearWalls] (data/rear_walls.json): back walls along the private roads wear a repeating
    // weathered-plaster tile (3 m a tile, no windows) instead of plain stucco.
    final rear = !stone && rearWalls.contains('${b.id}_e$edgeIndex');
    final rows = kind == WallKind.party || stone || plainWalls != null ? null : wallRows;
    final bays = math.max(1, (length / style.bay).round());
    // Doorways of covered passages (tool/src/passages.dart): (t0, t1, top y)
    // along the wall; every piece of wall inside one starts at its top, which for an arch
    // ([Arches]) follows its curve: (t0, t1, top at t).
    // The picture's metres -> world metres up the wall (the picture spans sidewalk..eave; a
    // `zg:eave` can make the wall taller than the picture was drawn).
    final scale = arches == null ? 1.0 : (eaveY - sidewalkY) / (hero?.eaves[b.id] ?? b.eave);
    final archTop = arches == null ? null : _ArchCurves(arches, length, sidewalkY, scale);
    final holes = <(double, double, double Function(double))>[
      for (final (t0, t1, top) in openings?.call(a, c) ?? const <(double, double, double)>[])
        (t0, t1, (_) => top),
      if (arcade?.spans[edgeIndex] case (final t0, final t1))
        (t0, t1, (_) => sidewalkY + arcade!.base),
      if (archTop != null)
        for (final (t0, t1) in arches!.openings) (t0, t1, archTop.top),
    ];
    final ts = [0.0, ...roof.breaks(a, c), 1.0];
    if (holes.isNotEmpty) {
      for (final (t0, t1, _) in holes) {
        ts.addAll([t0, t1]);
      }
      if (archTop != null) ts.addAll(archTop.samples());
      ts.sort();
      for (var i = ts.length - 1; i > 0; i--) {
        if (ts[i] - ts[i - 1] < 1e-6) ts.removeAt(i);
      }
    }

    (double, double)? cut;
    void quad(
      Vector2 p0,
      Vector2 p1,
      double y00,
      double y01,
      double y10,
      double y11,
      double u0,
      double u1,
      double v00,
      double v01,
      double v10,
      double v11,
      double tile, {
      Vector4? color,
    }) {
      final above = cut;
      if (above != null) {
        // Only what is above the doorway (or the arch, at each end of the
        // slice): raise the bottom edge to it, cutting the texture with it.
        final (aboveA, aboveB) = above;
        if (y10 <= aboveA + 1e-3 && y11 <= aboveB + 1e-3) return;
        if (y00 < aboveA) {
          final f = y10 > y00 ? math.min(1.0, (aboveA - y00) / (y10 - y00)) : 1.0;
          v00 += (v10 - v00) * f;
          y00 = y00 + (y10 - y00) * f;
        }
        if (y01 < aboveB) {
          final f = y11 > y01 ? math.min(1.0, (aboveB - y01) / (y11 - y01)) : 1.0;
          v01 += (v11 - v01) * f;
          y01 = y01 + (y11 - y01) * f;
        }
      }
      final paint = color ?? b.paint;
      final ids = [
        out.facades.vertex(Vector3(p0.x, y00, p0.y), normal, u0, v00,
            u1: tile, v1: roughness, color: paint),
        out.facades.vertex(Vector3(p1.x, y01, p1.y), normal, u1, v01,
            u1: tile, v1: roughness, color: paint),
        out.facades.vertex(Vector3(p1.x, y11, p1.y), normal, u1, v11,
            u1: tile, v1: roughness, color: paint),
        out.facades.vertex(Vector3(p0.x, y10, p0.y), normal, u0, v10,
            u1: tile, v1: roughness, color: paint),
      ];
      out.facades.triangle(ids[0], ids[1], ids[2], normal);
      out.facades.triangle(ids[0], ids[2], ids[3], normal);
    }

    for (var i = 0; i < ts.length - 1; i++) {
      final p0 = a + d * ts[i], p1 = a + d * ts[i + 1];
      final s0 = ts[i] * length, s1 = ts[i + 1] * length;
      final tm = (ts[i] + ts[i + 1]) / 2;
      cut = null;
      for (final (t0, t1, top) in holes) {
        if (tm > t0 && tm < t1) cut = (top(ts[i]), top(ts[i + 1]));
      }
      final top0 = eaveY + roof.heightAt(p0), top1 = eaveY + roof.heightAt(p1);
      // Gable: plain stucco between the eave and the roof line.
      if (top0 > eaveY + .01 || top1 > eaveY + .01) {
        quad(p0, p1, eaveY, eaveY, top0, top1, s0 / 3, s1 / 3,
            (eaveY - sidewalkY) / 3, (eaveY - sidewalkY) / 3,
            (top0 - sidewalkY) / 3, (top1 - sidewalkY) / 3, rear ? plasterTile : plain,
            color: rear ? rearTint : plainWalls);
      }
      final span = spans[edgeIndex];
      if (span != null) {
        // The picture, pavement to cornice; below the sidewalk its bottom
        // row stretches down to the wall's base, which the sidewalk hides.
        final hu0 = span.u0 + (span.u1 - span.u0) * ts[i];
        final hu1 = span.u0 + (span.u1 - span.u0) * ts[i + 1];
        if (arcade != null && arcade.edges.contains(edgeIndex)) {
          // Over the colonnade: only the part of the picture above the overhang's underside.
          final liftY = sidewalkY + arcade.base;
          final vb = span.bottom + (span.top - span.bottom) * (liftY - sidewalkY) / (eaveY - sidewalkY);
          quad(p0, p1, liftY, liftY, eaveY, eaveY, hu0, hu1, vb, vb, span.top, span.top,
              -1.0 - span.page, color: white);
          continue;
        }
        if (archTop != null) {
          // Downhill under an arched wall the street falls a metre below the picture: a stone
          // plinth there, not its bottom row stretched.
          quad(p0, p1, baseY, baseY, sidewalkY, sidewalkY, s0 / 3, s1 / 3,
              (baseY - sidewalkY) / 3, (baseY - sidewalkY) / 3, 0, 0, plasterTile,
              color: _travertine);
        } else {
          quad(p0, p1, baseY, baseY, sidewalkY, sidewalkY, hu0, hu1,
              span.bottom, span.bottom, span.bottom, span.bottom, -1.0 - span.page,
              color: white);
        }
        quad(p0, p1, sidewalkY, sidewalkY, eaveY, eaveY, hu0, hu1,
            span.bottom, span.bottom, span.top, span.top, -1.0 - span.page,
            color: white);
        continue;
      }
      if (rows == null) {
        // Party wall: plain stucco from the base to the eave, UVs in 3 m
        // units. Churches and towers: dressed stone. Over a colonnade or a
        // gateway ([arcade]) it starts at the overhang's underside.
        final bottom = arcade != null && arcade.edges.contains(edgeIndex) ? sidewalkY + arcade.base : baseY;
        quad(p0, p1, bottom, bottom, eaveY, eaveY, s0 / 3, s1 / 3,
            (bottom - sidewalkY) / 3, (bottom - sidewalkY) / 3,
            (eaveY - sidewalkY) / 3, (eaveY - sidewalkY) / 3,
            stone ? -(100.0 + stoneTile) : rear ? plasterTile : plain,
            color: stone ? null : rear ? rearTint : plainWalls);
        continue;
      }
      final u0 = ts[i] * bays, u1 = ts[i + 1] * bays;
      for (var r = 0; r < rows.length; r++) {
        final row = rows[r];
        // The ground floor also covers the few centimetres below the
        // sidewalk down to the wall's base, which the sidewalk hides.
        final y0 = r == 0 ? baseY : sidewalkY + row.y0;
        final y1 = sidewalkY + row.y1;
        final v0 = r == 0 ? (baseY - sidewalkY) / (row.y1 - row.y0) : 0.0;
        quad(p0, p1, y0, y0, y1, y1, u0, u1, v0 * row.repeats, v0 * row.repeats,
            row.repeats, row.repeats, row.tile.toDouble());
      }
    }
    if (archTop != null) {
      archSoffitY = sidewalkY + arcade!.base * scale;
      _emitArcadeFront(out.facades, archTop,
          a: a, c: c, soffitY: archSoffitY, terrain: terrain, tile: plasterTile);
    }
  }

  // Roof: triangulate the footprint, then cut each triangle along the roof
  // planes. Triangles are convex, so the cut is a plain half-plane clip.
  if (arcade != null && arcade.soffit.length >= 3) {
    // The underside of the overhang: dark concrete, facing down (an arcade's vault: its colour).
    final y = archSoffitY ?? buildingSidewalkY + arcade.base;
    final pts = arcade.soffit;
    final dark = arcade.arches?.soffitColor ?? Vector4(.34, .33, .32, 1);
    final down = Vector3(0, -1, 0);
    final ids = [
      for (final p in pts)
        out.facades.vertex(Vector3(p.x, y, p.y), down, p.x / 3, p.y / 3,
            u1: plain, v1: roughness, color: dark),
    ];
    final t = earcut(pts, const []);
    for (var i = 0; i < t.length; i += 3) {
      out.facades.triangle(ids[t[i]], ids[t[i + 1]], ids[t[i + 2]], down);
    }
  }
  final outer = b.polygon.outer;
  final holes = b.polygon.holes;
  final all = [...outer, ...holes.expand((h) => h)];
  final tris = earcut(outer, holes);
  final flat = b.roof == RoofShape.flat;
  final copper = b.tags['roof:material'] == 'copper' ||
      (b.tags['roof:colour'] ?? '').contains('green');
  // A tall pointed roof with no material mapped is a stone spire.
  final spire = !copper && b.tags['roof:material'] == null && b.roofRise > 12;
  for (var i = 0; i < tris.length; i += 3) {
    roof.emitTriangle(
      out.roofs,
      [all[tris[i]], all[tris[i + 1]], all[tris[i + 2]]],
      eaveY,
      color: roofCover != null && !spire
          ? roofCover.shade
          : flat || copper || spire
              ? Vector4(.9, .9, .9, 1)
              : b.roofTint,
      tile: roofCover != null
          // The roof set lives in its own atlas; a spire's stone is a
          // surface-atlas tile, coded -(100 + tile).
          ? (spire ? -(100.0 + stoneTile) : roofCover.tile)
          : (flat
                  ? flatRoofTile
                  : copper
                      ? copperRoofTile
                      : spire
                          ? stoneTile
                          : clayRoofTile)
              .toDouble(),
      period: roofCover == null || spire ? 2.0 : roofCover.metres,
      roughness: flat ? .9 : .75,
    );
  }
}
