// The ground: carriageways, sidewalks, squares, parks, kerbs and tram rails.
//
// Every surface is a polygon region computed once for the whole city with
// Clipper2 (so junctions are single polygons, never overlapping ribbons),
// then cut per chunk. Roads sit at terrain height; everything else is a
// raised sidewalk level `kerbHeight` above it, with a kerb face along every
// road edge. Tram rails are the one stacked surface and use a depth-biased
// material instead of a lift.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

import 'buildings.dart' show isUpperTown, parseMetres;
import 'city.dart';
import 'clip.dart';
import 'fscene_writer.dart';
import 'geom.dart';
import 'osm.dart';

const kerbHeight = .15;

/// Standard gauge, and the width of one rail's visible strip.
const gauge = 1.435, railWidth = .11;

/// Surface kinds. The index is the tile the atlas material samples
/// (`uv1.x`); see `lib/drive/scene/city_materials.dart`.
enum Surface {
  asphalt(0, 0xFFFFFF, 4, .85),
  sidewalk(1, 0xF4F4F4, 2, .9),
  paving(2, 0xFFF1DE, 2.5, .75),
  grass(3, 0xEEEEEE, 4, .95),
  gravel(4, 0xFFFFFF, 2, .95),
  kerb(5, 0xFFFFFF, 1, .7),
  rails(9, 0xFFFFFF, 2, .35),
  cobbles(12, 0xFFFFFF, 2, .8);

  const Surface(this.tile, this.color, this.period, this.roughness);
  final int tile;

  /// A tint multiplied over the atlas tile (sRGB hex; white keeps it).
  final int color;

  /// World-planar UV period in metres. Every period divides the 200 m
  /// chunk, so chunk-local UVs line up across chunk borders.
  final double period;
  final double roughness;
}

/// Carriageway width, kerb to kerb.
double carriageway(Tags t) {
  final width = parseMetres(t['width']);
  if (width != null && width >= 2.5 && width < 40) return width;
  final lanes = parseMetres(t['lanes']);
  final kind = t['highway']!;
  final base = switch (kind) {
    'motorway' || 'trunk' || 'primary' => 14.0,
    'secondary' => 12.0,
    'tertiary' => 10.5,
    'primary_link' || 'secondary_link' || 'tertiary_link' => 7.0,
    // Donji grad side streets carry a parking lane or two.
    'residential' || 'unclassified' => 8.5,
    'living_street' => 6.0,
    'service' => t['service'] == 'parking_aisle' ? 5.0 : 4.2,
    _ => 6.0,
  };
  if (lanes != null && lanes > 0) {
    return math.max(base * .8, lanes * 3.3 + (kind == 'service' ? 0 : 2.6));
  }
  return base;
}

class Ground {
  Ground(this.osm, this.city);

  final OsmData osm;
  final City city;

  late Shape road, paving, grass, gravel;
  final tramLines = <List<Vector2>>[];
  final trees = <Vector2>[];

  void build() {
    final carLines = <(List<Vector2>, double)>[];
    final pedestrianLines = <List<Vector2>>[];
    final parkPaths = <List<Vector2>>[];
    final ids = osm.ways.keys.toList()..sort();
    for (final id in ids) {
      final way = osm.ways[id]!;
      final t = way.tags;
      if (t['tunnel'] == 'yes' || t['location'] == 'underground') continue;
      if ((parseMetres(t['layer']) ?? 0) < 0 || t['layer'] == '-1') continue;
      final pts = osm.points(way);
      if (pts.length < 2) continue;
      final kind = t['highway'];
      if (t['railway'] == 'tram') {
        tramLines.add(pts);
      } else if (kind == 'pedestrian' && t['area'] != 'yes') {
        pedestrianLines.add(pts);
      } else if (kind != null &&
          streetClasses.contains(kind) &&
          t['area'] != 'yes') {
        carLines.add((pts, carriageway(t)));
      } else if (kind == 'footway' ||
          kind == 'path' ||
          kind == 'cycleway' ||
          kind == 'steps') {
        if (t['footway'] != 'sidewalk' && t['footway'] != 'crossing') {
          parkPaths.add(pts);
        }
      }
    }

    // Carriageways: every centreline thickened to its width, unioned, so a
    // junction is one polygon. Widths bucket to 0.5 m to batch the offsets.
    final byWidth = <double, List<List<Vector2>>>{};
    for (final (line, width) in carLines) {
      (byWidth[(width * 2).round() / 2] ??= []).add(line);
    }
    var cars = Shape.empty();
    for (final width in byWidth.keys.toList()..sort()) {
      cars = cars | Shape.lines(byWidth[width]!, width / 2);
    }

    final pedestrianAreas = osm.areas(
      (t) =>
          t['place'] == 'square' ||
          (t['highway'] == 'pedestrian' && t['area'] == 'yes') ||
          t['area:highway'] == 'pedestrian' ||
          (t['highway'] == 'footway' && t['area'] == 'yes') ||
          t['amenity'] == 'marketplace',
    );
    final pedestrian =
        Shape.of(pedestrianAreas.expand((a) => a.polygons)) |
        Shape.lines(pedestrianLines, 5);

    final parks = Shape.of(
      osm
          .areas(
            (t) =>
                t['leisure'] == 'park' ||
                t['leisure'] == 'garden' ||
                t['landuse'] == 'grass' ||
                t['landuse'] == 'recreation_ground' ||
                t['landuse'] == 'village_green' ||
                t['natural'] == 'grassland' ||
                t['natural'] == 'scrub' ||
                t['landuse'] == 'forest' ||
                t['natural'] == 'wood',
          )
          .expand((a) => a.polygons),
    );
    // Trams run in the carriageway (a 3.2 m corridor per track), except
    // across pedestrian zones like the square, where they are flush with
    // the paving.
    final trams = Shape.lines(tramLines, 1.6);
    road = cars | (trams - pedestrian);
    // Zrinjevac is tagged a square as well as a park: the park wins, so its
    // lawns and trees are not paved over.
    paving = pedestrian - road - parks;

    final parkLand = parks - road - paving;
    gravel = Shape.lines(parkPaths, 1.4) & parkLand;
    grass = parkLand - gravel;

    // Trees: tagged nodes, plus tree rows every 8 m.
    for (final entry in osm.nodeTags.entries) {
      if (entry.value['natural'] == 'tree') trees.add(osm.nodes[entry.key]!);
    }
    for (final id in ids) {
      final way = osm.ways[id]!;
      if (way.tags['natural'] != 'tree_row') continue;
      final pts = osm.points(way);
      for (var i = 0; i < pts.length - 1; i++) {
        final d = pts[i + 1] - pts[i];
        final n = math.max(1, (d.length / 8).round());
        for (var k = 0; k < n; k++) {
          trees.add(pts[i] + d * (k / n));
        }
      }
    }
    trees.sort((a, b) => a.y != b.y ? a.y.compareTo(b.y) : a.x.compareTo(b.x));
  }

  /// Emits the ground inside ([minX], [minZ])-([maxX], [maxZ]) into
  /// [surface] and its rails into [rails]. UVs are planar relative to the
  /// chunk origin ([originX], [originZ]). [height] is the terrain.
  void emitGround(
    double minX,
    double minZ,
    double maxX,
    double maxZ,
    double originX,
    double originZ,
    MeshWriter surface,
    MeshWriter rails,
    double Function(Vector2) height,
  ) {
    final rect = Shape.rect(minX, minZ, maxX, maxZ);
    final roadHere = road.clipRect(minX, minZ, maxX, maxZ);
    final pavingHere = paving.clipRect(minX, minZ, maxX, maxZ);
    final grassHere = grass.clipRect(minX, minZ, maxX, maxZ);
    final gravelHere = gravel.clipRect(minX, minZ, maxX, maxZ);
    final sidewalk = rect - roadHere - pavingHere - grassHere - gravelHere;

    void fill(Shape shape, Surface baseKind, double lift) {
      for (final polygon in shape.polygons) {
        final all = [...polygon.outer, ...polygon.holes.expand((h) => h)];
        final tris = earcut(polygon.outer, polygon.holes);
        final ids = <int, int>{};
        int vertex(int i, Surface kind) =>
            ids.putIfAbsent(i * 16 + kind.index, () {
              final p = all[i];
              return surface.vertex(
                Vector3(p.x, height(p) + lift, p.y),
                Vector3(0, 1, 0),
                (p.x - originX) / kind.period,
                (p.y - originZ) / kind.period,
                u1: kind.tile.toDouble(),
                v1: kind.roughness,
                color: _tint(_color(kind), p, kind),
              );
            });
        final up = Vector3(0, 1, 0);
        for (var i = 0; i < tris.length; i += 3) {
          // Gornji grad's and Kaptol's streets are cobbled.
          var kind = baseKind;
          if (baseKind == Surface.asphalt) {
            final c = (all[tris[i]] + all[tris[i + 1]] + all[tris[i + 2]]) / 3;
            if (isUpperTown(c)) kind = Surface.cobbles;
          }
          surface.triangle(
            vertex(tris[i], kind),
            vertex(tris[i + 1], kind),
            vertex(tris[i + 2], kind),
            up,
          );
        }
      }
    }

    fill(roadHere, Surface.asphalt, 0);
    fill(sidewalk, Surface.sidewalk, kerbHeight);
    fill(pavingHere, Surface.paving, kerbHeight);
    fill(grassHere, Surface.grass, kerbHeight);
    fill(gravelHere, Surface.gravel, kerbHeight);

    // Kerbs: a vertical face along every road edge that is not the chunk
    // border, facing into the road (the road is on each ring's left).
    bool onBorder(Vector2 a, Vector2 b) {
      const e = .01;
      bool same(double u, double v, double edge) =>
          (u - edge).abs() < e && (v - edge).abs() < e;
      return same(a.x, b.x, minX) ||
          same(a.x, b.x, maxX) ||
          same(a.y, b.y, minZ) ||
          same(a.y, b.y, maxZ);
    }

    final kerbColor = _color(Surface.kerb);
    for (final polygon in roadHere.polygons) {
      for (final (a, b) in polygon.edges) {
        if (onBorder(a, b)) continue;
        final d = b - a;
        final length = d.length;
        if (length < .01) continue;
        final normal = Vector3(-d.y, 0, d.x) / length;
        final s = (a - Vector2(originX, originZ)).dot(d / length);
        final ha = height(a), hb = height(b);
        const tile = 5.0, rough = .7;
        final v0 = surface.vertex(Vector3(a.x, ha, a.y), normal, s, 0,
            u1: tile, v1: rough, color: kerbColor);
        final v1 = surface.vertex(Vector3(b.x, hb, b.y), normal, s + length,
            0, u1: tile, v1: rough, color: kerbColor);
        final v2 = surface.vertex(Vector3(b.x, hb + kerbHeight, b.y), normal,
            s + length, kerbHeight, u1: tile, v1: rough, color: kerbColor);
        final v3 = surface.vertex(Vector3(a.x, ha + kerbHeight, a.y), normal,
            s, kerbHeight, u1: tile, v1: rough, color: kerbColor);
        surface.triangle(v0, v1, v2, normal);
        surface.triangle(v0, v2, v3, normal);
      }
    }

    // Tram rails: two strips per track, on whatever surface the track
    // crosses. Segments belong to the chunk holding their midpoint.
    final railColor = _color(Surface.rails);
    final up = Vector3(0, 1, 0);
    final chunkRect = Extent(minX, minZ, maxX, maxZ);
    for (final line in tramLines) {
      var along = 0.0;
      for (var i = 0; i < line.length - 1; i++) {
        final a = line[i], b = line[i + 1];
        final d = b - a;
        final length = d.length;
        if (length < .01) continue;
        if (!chunkRect.contains((a + b) * .5)) {
          along += length;
          continue;
        }
        final side = Vector2(-d.y, d.x) / length;
        // Extend each strip a little so consecutive segments overlap at
        // bends instead of leaving a notch.
        final ext = d / length * .06;
        for (final offset in const [-gauge / 2, gauge / 2]) {
          final quad = [
            for (final (p, o) in [
              (a - ext, -railWidth / 2),
              (b + ext, -railWidth / 2),
              (b + ext, railWidth / 2),
              (a - ext, railWidth / 2),
            ])
              p + side * (offset + o),
          ];
          final ids = [
            for (var k = 0; k < 4; k++)
              rails.vertex(
                Vector3(
                  quad[k].x,
                  height(quad[k]) + (_onRoad(quad[k]) ? 0 : kerbHeight),
                  quad[k].y,
                ),
                up,
                k == 0 || k == 3 ? 0 : 1,
                (along + (k == 1 || k == 2 ? length : 0)) / Surface.rails.period,
                u1: Surface.rails.tile.toDouble(),
                v1: Surface.rails.roughness,
                color: railColor,
              ),
          ];
          rails.triangle(ids[0], ids[1], ids[2], up);
          rails.triangle(ids[0], ids[2], ids[3], up);
        }
        along += length;
      }
    }
  }

  final _roadCache = <int, bool>{};
  bool _onRoad(Vector2 p) {
    final key = (p.x * 2).round() * 100000 + (p.y * 2).round();
    return _roadCache.putIfAbsent(key, () {
      for (final polygon in _roadPolygons) {
        if (polygon.contains(p)) return true;
      }
      return false;
    });
  }

  late final List<Polygon> _roadPolygons = road.polygons;

  static Vector4 _color(Surface kind) {
    double linear(int c) {
      final v = c / 255;
      return v <= .04045
          ? v / 12.92
          : math.pow((v + .055) / 1.055, 2.4).toDouble();
    }

    return Vector4(
      linear((kind.color >> 16) & 0xff),
      linear((kind.color >> 8) & 0xff),
      linear(kind.color & 0xff),
      1,
    );
  }

  /// A slow world-space mottle so large surfaces are not flat colour.
  static Vector4 _tint(Vector4 base, Vector2 p, Surface kind) {
    final n =
        math.sin(p.x * .071 + math.sin(p.y * .053)) *
        math.cos(p.y * .061 - p.x * .029);
    final amount = kind == Surface.grass ? .12 : .05;
    final f = 1 + amount * n;
    return Vector4(base.x * f, base.y * f, base.z * f, base.w);
  }
}
