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

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

import 'buildings.dart' show isUpperTown, parseMetres;
import 'city.dart';
import 'clip.dart';
import 'mesh_writer.dart';
import 'geom.dart';
import 'levels.dart';
import 'osm.dart';

const kerbHeight = .15;

/// Nested levels of raised ground; level k is `k * rise` above the sidewalk.
class Terrace {
  Terrace(this.levels, this.rise, this.run)
      : polygons = [for (final l in levels) l.polygons],
        flats = [for (final l in levels) l.inflate(-run)];
  final List<Shape> levels;

  /// Each level shrunk by [run]: the flat top. The band between the two is
  /// the slope up from the level below, so the car can climb it.
  final List<Shape> flats;
  final double rise, run;
  final List<List<Polygon>> polygons;
}

/// Standard gauge, and the width of one rail's visible strip.
const gauge = 1.435, railWidth = .11;

/// Surface kinds. The index is the tile the atlas material samples
/// (`uv1.x`); see the atlas material in `web3d/src/city.ts`.
enum Surface {
  asphalt(0, 0xFFFFFF, 4, .85),
  sidewalk(1, 0xF4F4F4, 2, .9),
  paving(2, 0xFFF1DE, 2.5, .75),
  grass(3, 0xEEEEEE, 4, .95),
  gravel(4, 0xFFFFFF, 2, .95),
  kerb(5, 0xFFFFFF, 1, .7),
  rails(9, 0xFFFFFF, 2, .35),
  cobbles(12, 0xFFFFFF, 2, .8),
  // The tram zone across the square (Street View): dark grey-brown setts either side of the track and
  // red clinker between the rails. Same cobble tile, tinted.
  setts(12, 0xB0A498, 1.25, .85),
  clinker(12, 0xE0B9A8, 1.25, .8);

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

  /// Paved squares' tram zone: 2.9 m either side of a track in setts, 1.5 m in clinker.
  late final Shape _tramSetts = Shape.lines(tramLines, 2.9) & paving;
  late final Shape _tramClinker = Shape.lines(tramLines, 1.5) & paving;

  /// Hand-shaped levels (data/levels.json), set by the exporter: they
  /// replace the grid inside their outlines.
  Levels? levels;
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
    // Car parks laid by hand (data/park.json `asphalt`, tool frame): OSM's outline stops short of the walls.
    final parkFile = File('data/park.json');
    if (parkFile.existsSync()) {
      final asphalt = (jsonDecode(parkFile.readAsStringSync())['asphalt'] as List?) ?? const [];
      for (final ring in asphalt.cast<List>()) {
        road = road |
            Shape.of([
              Polygon([
                for (final p in ring.cast<List>())
                  Vector2((p[0] as num).toDouble(), (p[1] as num).toDouble()),
              ], const []),
            ]);
      }
    }
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
    _buildTerraces();
  }

  /// Raised, stepped ground (`data/raised.json`): each terrace is nested
  /// levels, level k [Terrace.rise] * k above the sidewalk, cut out of the
  /// carriageways. Lets the car climb the steps: they are small.
  final terraces = <Terrace>[];

  void _buildTerraces() {
    final file = File('data/raised.json');
    if (!file.existsSync()) return;
    for (final e in jsonDecode(file.readAsStringSync()) as List) {
      Vector2 pt(String k) =>
          Vector2((e[k][0] as num).toDouble(), (e[k][1] as num).toDouble());
      final from = pt('from'), to = pt('to');
      final steps = e['steps'] as int;
      final rise = (e['rise'] as num).toDouble();
      final tread = (e['tread'] as num).toDouble();
      final inset = (e['inset'] as num).toDouble();
      final depth = (e['depth'] as num).toDouble();
      final dir = (to - from).normalized();
      final north = Vector2(-dir.y, dir.x);
      final levels = <Shape>[];
      for (var k = 1; k <= steps; k++) {
        final south = inset + (steps - k) * tread;
        final quad = Shape.of([
          Polygon([
            from - north * south,
            to - north * south,
            to + north * depth,
            from + north * depth,
          ], const []),
        ]);
        levels.add(quad - road);
      }
      terraces.add(Terrace(levels, rise, (e['run'] as num).toDouble()));
    }
  }

  /// How far the ground at [p] is lifted above the sidewalk by a terrace.
  double liftAt(Vector2 p) {
    for (final t in terraces) {
      for (var k = t.polygons.length; k >= 1; k--) {
        if (t.polygons[k - 1].any((polygon) => polygon.contains(p))) {
          return k * t.rise;
        }
      }
    }
    return 0;
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
    double Function(Vector2) height, {
    double tessellate = 0,
    MeshWriter? steps,
    MeshWriter? ramps,
  }) {
    final rect = Shape.rect(minX, minZ, maxX, maxZ);
    final roadHere = road.clipRect(minX, minZ, maxX, maxZ);
    final pavingHere = paving.clipRect(minX, minZ, maxX, maxZ);
    final grassHere = grass.clipRect(minX, minZ, maxX, maxZ);
    final gravelHere = gravel.clipRect(minX, minZ, maxX, maxZ);
    final sidewalk = rect - roadHere - pavingHere - grassHere - gravelHere;
    // Where trams cross paved squares: setts, and clinker along the rails.
    final clinkerHere = _tramClinker.clipRect(minX, minZ, maxX, maxZ);
    final settsHere = _tramSetts.clipRect(minX, minZ, maxX, maxZ) - clinkerHere;

    // On sloped terrain, large polygons are cut into [tessellate]-metre
    // cells first, so the surface follows the ground between its vertices
    // (earcut alone spans a whole street with one triangle). Two levels:
    // 50 m blocks, then cells, so each clip works on a small shape.
    Iterable<Polygon> pieces(Shape shape) sync* {
      if (tessellate <= 0) {
        yield* shape.polygons;
        return;
      }
      const block = 50.0;
      for (var bz = minZ; bz < maxZ - 1e-6; bz += block) {
        for (var bx = minX; bx < maxX - 1e-6; bx += block) {
          final part = shape.clipRect(bx, bz, math.min(bx + block, maxX),
              math.min(bz + block, maxZ));
          if (part.isEmpty) continue;
          for (var cz = bz; cz < math.min(bz + block, maxZ) - 1e-6; cz += tessellate) {
            for (var cx = bx; cx < math.min(bx + block, maxX) - 1e-6; cx += tessellate) {
              final cell = part.clipRect(cx, cz, cx + tessellate, cz + tessellate);
              if (!cell.isEmpty) yield* cell.polygons;
            }
          }
        }
      }
    }

    void fill(Shape shape, Surface baseKind, double lift, [double Function(Vector2)? heightHere]) {
      final height_ = heightHere ?? height;
      for (final polygon in pieces(shape)) {
        final all = [...polygon.outer, ...polygon.holes.expand((h) => h)];
        final tris = earcut(polygon.outer, polygon.holes);
        final ids = <int, int>{};
        int vertex(int i, Surface kind) =>
            ids.putIfAbsent(i * 16 + kind.index, () {
              final p = all[i];
              return surface.vertex(
                Vector3(p.x, height_(p) + lift, p.y),
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

    // Terraces: every level of every terrace, and each level minus the one
    // above it (the tread you stand on).
    final treads = <(Shape, double)>[];
    var raisedHere = Shape.empty();
    final slopes = <(Polygon, double, double, double)>[]; // polygon, y0, y1, run
    for (final t in terraces) {
      final here = [
        for (final l in t.levels) l.clipRect(minX, minZ, maxX, maxZ),
      ];
      final flats = [
        for (final f in t.flats) f.clipRect(minX, minZ, maxX, maxZ),
      ];
      for (var k = 1; k <= here.length; k++) {
        if (here[k - 1].isEmpty) continue;
        final flat = k < here.length ? flats[k - 1] - here[k] : flats[k - 1];
        treads.add((flat, k * t.rise));
        for (final polygon in here[k - 1].polygons) {
          slopes.add((polygon, kerbHeight + (k - 1) * t.rise,
              kerbHeight + k * t.rise, t.run));
        }
      }
      if (!here.first.isEmpty) raisedHere = raisedHere | here.first;
    }

    // Levels: each region's visible part (later regions win), cut out of
    // the grid's ground and filled at the region's own height.
    final lv = levels;
    final regionsHere = <(int, Shape)>[];
    var leveled = Shape.empty();
    if (lv != null) {
      for (var i = lv.regions.length - 1; i >= 0; i--) {
        final r = lv.regions[i];
        if (!r.overlaps(minX, minZ, maxX, maxZ)) continue;
        final here = r.shape.clipRect(minX, minZ, maxX, maxZ);
        if (here.isEmpty) continue;
        final visible = here - leveled;
        leveled = leveled | here;
        if (!visible.isEmpty && r.kind != RegionKind.stairs) regionsHere.add((i, visible));
      }
    }
    // The ground height at [p] as drawn: the region there, else the grid.
    double groundAt(Vector2 p) => lv == null ? height(p) : lv.heightAt(p, below: lv.regions.length);

    fill(roadHere - leveled, Surface.asphalt, 0);
    fill(sidewalk - raisedHere - leveled, Surface.sidewalk, kerbHeight);
    fill(pavingHere - raisedHere - leveled - settsHere - clinkerHere, Surface.paving, kerbHeight);
    if (!settsHere.isEmpty) fill(settsHere - raisedHere - leveled, Surface.setts, kerbHeight);
    if (!clinkerHere.isEmpty) fill(clinkerHere - raisedHere - leveled, Surface.clinker, kerbHeight);
    fill(grassHere - raisedHere - leveled, Surface.grass, kerbHeight);
    fill(gravelHere - raisedHere - leveled, Surface.gravel, kerbHeight);
    for (final (i, visible) in regionsHere) {
      double h(Vector2 p) => lv!.regionHeight(i, p);
      for (final (kind, area, lift) in [
        (Surface.asphalt, roadHere, 0.0),
        (Surface.sidewalk, sidewalk, kerbHeight),
        (Surface.paving, pavingHere, kerbHeight),
        (Surface.grass, grassHere, kerbHeight),
        (Surface.gravel, gravelHere, kerbHeight),
      ]) {
        if (area.isEmpty) continue;
        final part = area & visible;
        if (!part.isEmpty) fill(part, kind, lift, h);
      }
    }
    for (final (tread, lift) in treads) {
      for (final (kind, area) in [
        (Surface.sidewalk, sidewalk),
        (Surface.paving, pavingHere),
        (Surface.grass, grassHere),
        (Surface.gravel, gravelHere),
      ]) {
        if (area.isEmpty) continue;
        final part = (area & tread) - leveled;
        if (!part.isEmpty) fill(part, kind, kerbHeight + lift);
      }
    }

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
    bool nearLevels(Vector2 a, Vector2 b) =>
        lv != null &&
        lv.regions.any((r) => r.overlaps(
            math.min(a.x, b.x) - 1, math.min(a.y, b.y) - 1, math.max(a.x, b.x) + 1, math.max(a.y, b.y) + 1));
    Iterable<(Vector2, Vector2)> kerbEdges(Polygon polygon) sync* {
      for (final (a, b) in polygon.edges) {
        if (onBorder(a, b)) continue;
        final n = nearLevels(a, b)
            ? (a.distanceTo(b) / .5).ceil()
            : tessellate > 0
                ? (a.distanceTo(b) / tessellate).ceil()
                : 1;
        // Exact endpoints, so an undivided edge is bit-for-bit (a, b).
        Vector2 at(int k) => k == 0 ? a : k == n ? b : a + (b - a) * (k / n);
        for (var k = 0; k < n; k++) {
          yield (at(k), at(k + 1));
        }
      }
    }

    for (final polygon in roadHere.polygons) {
      for (final (a, b) in kerbEdges(polygon)) {
        final d = b - a;
        final length = d.length;
        if (length < .01) continue;
        final normal = Vector3(-d.y, 0, d.x) / length;
        final s = (a - Vector2(originX, originZ)).dot(d / length);
        // A kerb follows the ground of the level its middle is on; none on
        // stairs.
        var ha = height(a), hb = height(b);
        if (lv != null) {
          final at = lv.top((a + b) * .5);
          if (at >= 0) {
            if (lv.regions[at].kind == RegionKind.stairs) continue;
            ha = lv.regionHeight(at, a);
            hb = lv.regionHeight(at, b);
          }
        }
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

    // Terrace slopes: along every edge of a level, an incline from the level
    // below up to the flat top [run] metres inside (outer rings are
    // counter-clockwise, so walking an edge backwards puts the outside on
    // its left, as for the kerbs).
    for (final (polygon, y0, y1, run) in slopes) {
      for (final (a0, b0) in kerbEdges(Polygon(polygon.outer, const []))) {
        final a = b0, b = a0;
        final d = b - a;
        final length = d.length;
        if (length < .01) continue;
        final out = Vector2(-d.y, d.x) / length;
        final ai = a - out * run, bi = b - out * run;
        final normal =
            Vector3(out.x * (y1 - y0), run, out.y * (y1 - y0)).normalized();
        final s = (a - Vector2(originX, originZ)).dot(d / length);
        final ha = height(a), hb = height(b);
        const tile = 5.0, rough = .7;
        final v0 = surface.vertex(Vector3(a.x, ha + y0, a.y), normal, s, 0,
            u1: tile, v1: rough, color: kerbColor);
        final v1 = surface.vertex(Vector3(b.x, hb + y0, b.y), normal,
            s + length, 0, u1: tile, v1: rough, color: kerbColor);
        final v2 = surface.vertex(Vector3(bi.x, hb + y1, bi.y), normal,
            s + length, run, u1: tile, v1: rough, color: kerbColor);
        final v3 = surface.vertex(Vector3(ai.x, ha + y1, ai.y), normal, s,
            run, u1: tile, v1: rough, color: kerbColor);
        surface.triangle(v0, v1, v2, normal);
        surface.triangle(v0, v2, v3, normal);
      }
    }

    // Levels: retaining walls where the ground jumps, parapets, stairs.
    if (lv != null && !lv.isEmpty) {
      final chunk = Extent(minX, minZ, maxX, maxZ);
      final stone = _color(Surface.kerb);
      lv.emitWalls(chunk, surface, stone, kerbHeight);
      lv.emitParapets(chunk, surface, stone, kerbHeight);
      if (steps != null && ramps != null) {
        lv.emitStairs(chunk, steps, surface, ramps, _color(Surface.paving), stone, kerbHeight);
      }
    }

    // Tram rails: two strips per track, on whatever surface the track
    // crosses. Segments belong to the chunk holding their midpoint.
    final railColor = _color(Surface.rails);
    final up = Vector3(0, 1, 0);
    final chunkRect = Extent(minX, minZ, maxX, maxZ);
    for (final original in tramLines) {
      // Short segments on slopes, so the rails stay on the surface.
      final line = tessellate <= 0
          ? original
          : [
              for (var i = 0; i < original.length - 1; i++)
                for (var k = 0,
                        n = (original[i].distanceTo(original[i + 1]) / 4).ceil().clamp(1, 1000);
                    k < n;
                    k++)
                  original[i] + (original[i + 1] - original[i]) * (k / n),
              original.last,
            ];
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
                  groundAt(quad[k]) + (_onRoad(quad[k]) ? 0 : kerbHeight),
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
