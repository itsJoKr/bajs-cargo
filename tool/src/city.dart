// The city model the generator bakes: buildings and streets in local metres,
// read from the committed OSM snapshot.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

import 'buildings.dart';
import 'facades.dart';
import 'geom.dart';
import 'osm.dart';

/// An axis-aligned box in local metres (x east, y = z north).
class Extent {
  const Extent(this.minX, this.minZ, this.maxX, this.maxZ);
  final double minX, minZ, maxX, maxZ;
  bool contains(Vector2 p) =>
      p.x >= minX && p.x < maxX && p.y >= minZ && p.y < maxZ;
}

/// The phase 1-5 core: about 45.8100-45.8160 N, 15.9730-15.9815 E.
const coreExtent = Extent(-322, -337, 341, 330);

/// Road classes cars use, plus pedestrian streets (drivable here too).
const streetClasses = {
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'primary_link',
  'secondary_link',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'pedestrian',
  'service',
};

class Street {
  Street(this.id, this.tags, this.points);
  final int id;
  final Tags tags;
  final List<Vector2> points;
  String get kind => tags['highway']!;
}

/// Buckets segments on a coarse grid so "is anything within r metres" is
/// cheap.
class SegmentGrid {
  SegmentGrid(this.cell);
  final double cell;
  final _cells = <int, List<(Vector2, Vector2)>>{};

  int _key(int i, int j) => (i + 10000) * 20000 + (j + 10000);

  void add(Vector2 a, Vector2 b) {
    final i0 = (math.min(a.x, b.x) / cell).floor();
    final i1 = (math.max(a.x, b.x) / cell).floor();
    final j0 = (math.min(a.y, b.y) / cell).floor();
    final j1 = (math.max(a.y, b.y) / cell).floor();
    for (var i = i0; i <= i1; i++) {
      for (var j = j0; j <= j1; j++) {
        (_cells[_key(i, j)] ??= []).add((a, b));
      }
    }
  }

  double nearest(Vector2 p, double radius) {
    var best = double.infinity;
    final r = (radius / cell).ceil();
    final pi = (p.x / cell).floor(), pj = (p.y / cell).floor();
    for (var i = pi - r; i <= pi + r; i++) {
      for (var j = pj - r; j <= pj + r; j++) {
        for (final (a, b) in _cells[_key(i, j)] ?? const <(Vector2, Vector2)>[]) {
          best = math.min(best, distanceToSegment(p, a, b));
        }
      }
    }
    return best;
  }
}

class City {
  City(
    this.osm,
    this.extent, {
    this.heroEaves = const {},
    this.separateSmallStructures = false,
  });

  /// `building=` values that are street furniture rather than buildings.
  static const smallStructureKinds = {'kiosk', 'roof', 'gazebo', 'carport', 'shelter'};

  /// When set, [smallStructureKinds] go to [smallStructures] (for props)
  /// instead of becoming buildings with facades and roofs.
  final bool separateSmallStructures;
  final smallStructures = <(String, Tags, Polygon)>[];

  final OsmData osm;
  final Extent extent;

  /// Building id -> eave for buildings wearing a hero facade
  /// (`HeroAtlas.eaves`).
  final Map<String, double> heroEaves;
  final buildings = <Building>[];
  final streets = <Street>[];
  final streetGrid = SegmentGrid(25);

  void build() {
    _readStreets();
    _readBuildings();
    _dressBuildings();
  }

  /// Picks each building's style and colours and classifies its walls:
  /// against a neighbour (party), toward a street, or into a courtyard.
  void _dressBuildings() {
    // Buildings by 20 m cell, for "is this point inside a neighbour".
    const cell = 20.0;
    final grid = <int, List<Building>>{};
    int key(int i, int j) => (i + 5000) * 10000 + (j + 5000);
    for (final b in buildings) {
      var x0 = double.infinity, x1 = -double.infinity;
      var z0 = double.infinity, z1 = -double.infinity;
      for (final p in b.polygon.outer) {
        x0 = math.min(x0, p.x);
        x1 = math.max(x1, p.x);
        z0 = math.min(z0, p.y);
        z1 = math.max(z1, p.y);
      }
      for (var i = (x0 / cell).floor(); i <= (x1 / cell).floor(); i++) {
        for (var j = (z0 / cell).floor(); j <= (z1 / cell).floor(); j++) {
          (grid[key(i, j)] ??= []).add(b);
        }
      }
    }
    Building? neighbourAt(Vector2 p, Building self) {
      for (final other in grid[key((p.x / cell).floor(), (p.y / cell).floor())] ??
          const <Building>[]) {
        if (!identical(other, self) && other.polygon.contains(p)) return other;
      }
      return null;
    }

    for (final b in buildings) {
      final upper = isUpperTown(b.center);
      b.style = styleFor(
        id: b.id,
        tags: b.tags,
        upperTown: upper,
        eave: b.eave,
        flatRoof: b.roof == RoofShape.flat,
        area: b.area,
      );
      b.paint = paintFor(b.id, upperTown: upper);
      final kind = b.tags['building'] ?? b.tags['building:part'] ?? '';
      if (const {'church', 'cathedral', 'chapel', 'tower', 'bell_tower'}
              .contains(kind) ||
          b.tags['amenity'] == 'place_of_worship' ||
          b.tags['building:part'] == 'tower' ||
          (b.tags['building:part'] != null && b.eave > 30)) {
        b.style = 'stone';
        b.paint = Vector4(.88, .86, .82, 1);
      }
      b.roofTint = roofTintFor(b.id);
      final walls = <WallKind>[];
      for (final (a, c) in b.polygon.edges) {
        final d = c - a;
        final length = d.length;
        if (length < 1e-6) {
          walls.add(WallKind.party);
          continue;
        }
        final n = Vector2(d.y, -d.x) / length;
        // A neighbour directly outside most of the edge: party wall.
        var inside = 0;
        for (final t in const [.2, .5, .8]) {
          if (neighbourAt(a + d * t + n * .7, b) != null) inside++;
        }
        if (inside >= 2) {
          walls.add(WallKind.party);
        } else if (streetGrid.nearest((a + c) * .5 + n * 5, 12) < 12) {
          walls.add(WallKind.street);
        } else {
          walls.add(WallKind.courtyard);
        }
      }
      b.walls = walls;
    }
  }

  void _readStreets() {
    final ids = osm.ways.keys.toList()..sort();
    for (final id in ids) {
      final way = osm.ways[id]!;
      final kind = way.tags['highway'];
      if (kind == null || way.tags['area'] == 'yes') continue;
      final pts = osm.points(way);
      if (pts.length < 2) continue;
      if (streetClasses.contains(kind)) {
        streets.add(Street(id, way.tags, pts));
        // Service lanes lead into courtyards; they must not make a
        // courtyard shed count as street-facing.
        if (kind != 'service') {
          for (var i = 0; i < pts.length - 1; i++) {
            streetGrid.add(pts[i], pts[i + 1]);
          }
        }
      }
    }
    // Pedestrian squares front buildings just like streets do.
    for (final area in osm.areas(
      (t) =>
          t['place'] == 'square' ||
          (t['highway'] == 'pedestrian' && t['area'] == 'yes'),
    )) {
      for (final polygon in area.polygons) {
        for (final (a, b) in polygon.edges) {
          streetGrid.add(a, b);
        }
      }
    }
  }

  void _readBuildings() {
    bool isBuilding(Tags t) =>
        t['building'] != null &&
        t['building'] != 'no' &&
        t['building:part'] == null;
    bool isPart(Tags t) =>
        t['building:part'] != null && t['building:part'] != 'no';

    final outlines = osm.areas(isBuilding);
    final parts = osm.areas(isPart);

    // A building drawn as parts renders the parts, not its outline.
    final replaced = <String>{};
    for (final outline in outlines) {
      for (final polygon in outline.polygons) {
        var covered = 0.0;
        for (final part in parts) {
          for (final pp in part.polygons) {
            if (polygon.contains(centroid(pp.outer))) covered += pp.area;
          }
        }
        if (covered > polygon.area * .4) replaced.add(outline.id);
      }
    }

    void add(OsmArea area, {required bool part}) {
      if (!part && replaced.contains(area.id)) return;
      for (var i = 0; i < area.polygons.length; i++) {
        final polygon = area.polygons[i];
        if (!extent.contains(centroid(polygon.outer))) continue;
        if (polygon.area < 6) continue;
        final interior = !polygon.outer.any(
          (p) => streetGrid.nearest(p, 16) < 16,
        );
        // The longest outer edge that fronts a street sets the ridge.
        Vector2? ridge;
        var longest = 4.0;
        final ring = polygon.outer;
        for (var k = 0; k < ring.length; k++) {
          final a = ring[k], b = ring[(k + 1) % ring.length];
          final length = a.distanceTo(b);
          if (length > longest &&
              streetGrid.nearest((a + b) * .5, 14) < 14) {
            longest = length;
            ridge = (b - a).normalized();
          }
        }
        final id = area.polygons.length == 1 ? area.id : '${area.id}_$i';
        if (separateSmallStructures &&
            smallStructureKinds.contains(area.tags['building'])) {
          smallStructures.add((id, area.tags, polygon));
          continue;
        }
        buildings.add(
          makeBuilding(
            id,
            area.tags,
            polygon,
            interior: interior,
            ridgeAxis: ridge,
            heroEave: heroEaves[id],
          ),
        );
      }
    }

    for (final outline in outlines) {
      add(outline, part: false);
    }
    for (final part in parts) {
      add(part, part: true);
    }
  }
}
