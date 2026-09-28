// Buildings: which OSM features become buildings, how tall they are, what
// roof they get, and the watertight wall + roof mesh for each.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

import 'facades.dart';
import 'fscene_writer.dart';
import 'geom.dart';
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
    rise = math.min(roofHeight, rise * 1.5);
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
  RoofModel(this.building) {
    final b = building;
    final w = b.box.halfWidth, l = b.box.halfLength;
    rise = b.roofRise;
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

  final Building building;
  late final List<RoofRegion> regions;
  double slope = 0, rise = 0;

  /// Roof height above the eave at [p].
  double heightAt(Vector2 p) {
    final b = building;
    if (b.roof == RoofShape.flat || rise <= 0) return 0;
    final (u, v) = b.box.local(p);
    final w = b.box.halfWidth, l = b.box.halfLength;
    final run = b.roof == RoofShape.gabled
        ? w - v.abs()
        : math.min(w - v.abs(), l - u.abs());
    return math.min(math.max(run, 0) * slope, rise);
  }

  /// Parameters in (0, 1) along [a]-[b] where the roof surface kinks.
  List<double> breaks(Vector2 a, Vector2 b) {
    if (building.roof == RoofShape.flat || rise <= 0) return const [];
    final box = building.box;
    final (ua, va) = box.local(a);
    final (ub, vb) = box.local(b);
    final lines = <(double, double, double)>{};
    for (final region in regions) {
      lines.addAll(region.planes);
    }
    lines.add((0, 1, 0));
    lines.add((1, 0, 0));
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
  }) {
    final box = building.box;
    final axis = box.axis, across = box.across;
    for (final region in regions) {
      final planes = [
        for (final (a, b, c) in region.planes)
          // a*u + b*v >= c with u = (p - center).axis, v = (p - center).across
          () {
            final n = axis * a + across * b;
            return HalfPlane(n.x, n.y, c + n.dot(box.center));
          }(),
      ];
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
            p.dot(along) / 2.0,
            p.dot(downhill) * stretch / 2.0,
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
const clayRoofTile = 6, flatRoofTile = 7;

/// Emits [b]'s walls into [out.facades] and roof into [out.roofs]. [ground]
/// is the terrain height under the building (flat until phase 6).
///
/// Street walls wear the building's style, courtyard walls the courtyard
/// style, party walls (against a neighbour) and gables plain stucco. Each
/// wall gets a whole number of bays, so no window is ever cut by a corner,
/// and rows (ground floor, first floor, upper storeys, cornice) fill the
/// wall from the sidewalk to the eave.
void emitBuilding(
  Building b,
  BuildingMeshes out, {
  required double ground,
  required FacadeStyles styles,
}) {
  final roof = RoofModel(b);
  final baseY = ground + b.base - (b.base == 0 ? .6 : 0);
  final eaveY = ground + b.eave;
  final sidewalkY = ground + _sidewalk;
  final facadeHeight = eaveY - sidewalkY;
  final street = styles[b.style == 'stone' ? 'courtyard' : b.style];
  final courtyard = styles['courtyard'];
  final streetRows = FacadeStyles.rows(street, facadeHeight);
  final courtyardRows = FacadeStyles.rows(courtyard, facadeHeight);
  final plain = styles.plainTile.toDouble();
  // Churches and towers are dressed stone, not rows of flats.
  final stone = b.style == 'stone';
  const roughness = .9;

  var edgeIndex = -1;
  for (final (a, c) in b.polygon.edges) {
    edgeIndex++;
    final d = c - a;
    final length = d.length;
    if (length < .05) continue;
    final normal = Vector3(d.y, 0, -d.x) / length;
    final kind = edgeIndex < b.walls.length ? b.walls[edgeIndex] : WallKind.street;
    final style = kind == WallKind.courtyard ? courtyard : street;
    final rows = kind == WallKind.party || stone
        ? null
        : (kind == WallKind.courtyard ? courtyardRows : streetRows);
    final bays = math.max(1, (length / style.bay).round());
    final ts = [0.0, ...roof.breaks(a, c), 1.0];

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
      double tile,
    ) {
      final ids = [
        out.facades.vertex(Vector3(p0.x, y00, p0.y), normal, u0, v00,
            u1: tile, v1: roughness, color: b.paint),
        out.facades.vertex(Vector3(p1.x, y01, p1.y), normal, u1, v01,
            u1: tile, v1: roughness, color: b.paint),
        out.facades.vertex(Vector3(p1.x, y11, p1.y), normal, u1, v11,
            u1: tile, v1: roughness, color: b.paint),
        out.facades.vertex(Vector3(p0.x, y10, p0.y), normal, u0, v10,
            u1: tile, v1: roughness, color: b.paint),
      ];
      out.facades.triangle(ids[0], ids[1], ids[2], normal);
      out.facades.triangle(ids[0], ids[2], ids[3], normal);
    }

    for (var i = 0; i < ts.length - 1; i++) {
      final p0 = a + d * ts[i], p1 = a + d * ts[i + 1];
      final s0 = ts[i] * length, s1 = ts[i + 1] * length;
      final top0 = eaveY + roof.heightAt(p0), top1 = eaveY + roof.heightAt(p1);
      if (rows == null) {
        // Party wall: plain stucco from the base to the roof line, UVs in
        // 3 m units.
        quad(p0, p1, baseY, baseY, top0, top1, s0 / 3, s1 / 3,
            (baseY - sidewalkY) / 3, (baseY - sidewalkY) / 3,
            (top0 - sidewalkY) / 3, (top1 - sidewalkY) / 3, plain);
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
      // Gable: plain stucco between the eave and the roof line.
      if (top0 > eaveY + .01 || top1 > eaveY + .01) {
        quad(p0, p1, eaveY, eaveY, top0, top1, s0 / 3, s1 / 3,
            (eaveY - sidewalkY) / 3, (eaveY - sidewalkY) / 3,
            (top0 - sidewalkY) / 3, (top1 - sidewalkY) / 3, plain);
      }
    }
  }

  // Roof: triangulate the footprint, then cut each triangle along the roof
  // planes. Triangles are convex, so the cut is a plain half-plane clip.
  final outer = b.polygon.outer;
  final holes = b.polygon.holes;
  final all = [...outer, ...holes.expand((h) => h)];
  final tris = earcut(outer, holes);
  final flat = b.roof == RoofShape.flat;
  for (var i = 0; i < tris.length; i += 3) {
    roof.emitTriangle(
      out.roofs,
      [all[tris[i]], all[tris[i + 1]], all[tris[i + 2]]],
      eaveY,
      color: flat ? Vector4(.9, .9, .9, 1) : b.roofTint,
      tile: (flat ? flatRoofTile : clayRoofTile).toDouble(),
      roughness: flat ? .9 : .75,
    );
  }
}
