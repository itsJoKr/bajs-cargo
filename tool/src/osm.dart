// Reads the committed Overpass snapshot into local-metre geometry.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:convert';
import 'dart:io';

import 'package:vector_math/vector_math.dart';
import 'geo.dart';

import 'geom.dart';

typedef Tags = Map<String, String>;

class OsmWay {
  OsmWay(this.id, this.nodeIds, this.tags);
  final int id;
  final List<int> nodeIds;
  final Tags tags;
  bool get closed => nodeIds.length > 3 && nodeIds.first == nodeIds.last;
}

class OsmMember {
  OsmMember(this.type, this.ref, this.role);
  final String type, role;
  final int ref;
}

class OsmRelation {
  OsmRelation(this.id, this.members, this.tags);
  final int id;
  final List<OsmMember> members;
  final Tags tags;
}

/// A polygon with holes, outer ring counter-clockwise, holes clockwise.
class Polygon {
  Polygon(Ring outer, [List<Ring> holes = const []])
    : outer = ccw(outer),
      holes = [for (final h in holes) cw(h)];
  final Ring outer;
  final List<Ring> holes;

  double get area =>
      signedArea(outer) + holes.fold(0.0, (s, h) => s + signedArea(h));

  bool contains(Vector2 p) =>
      pointInRing(p, outer) && !holes.any((h) => pointInRing(p, h));

  /// Every ring edge, outer then holes, as (a, b) with the polygon's
  /// interior on the left.
  Iterable<(Vector2, Vector2)> get edges sync* {
    for (final ring in [outer, ...holes]) {
      for (var i = 0; i < ring.length; i++) {
        yield (ring[i], ring[(i + 1) % ring.length]);
      }
    }
  }
}

/// A tagged area feature: a closed way or a multipolygon relation.
class OsmArea {
  OsmArea(this.id, this.tags, this.polygons);
  final String id;
  final Tags tags;
  final List<Polygon> polygons;
}

class OsmData {
  OsmData._();

  final nodes = <int, Vector2>{};
  final nodeTags = <int, Tags>{};
  final ways = <int, OsmWay>{};
  final relations = <int, OsmRelation>{};

  static OsmData load(String path) {
    final data = OsmData._();
    final json = jsonDecode(File(path).readAsStringSync()) as Map;
    for (final e in (json['elements'] as List).cast<Map>()) {
      final id = e['id'] as int;
      final tags = (e['tags'] as Map?)?.cast<String, String>() ?? {};
      switch (e['type']) {
        case 'node':
          final p = geoToLocal(
            (e['lat'] as num).toDouble(),
            (e['lon'] as num).toDouble(),
          );
          data.nodes[id] = Vector2(p.x, p.z);
          if (tags.isNotEmpty) data.nodeTags[id] = tags;
        case 'way':
          data.ways[id] = OsmWay(
            id,
            (e['nodes'] as List).cast<int>(),
            tags,
          );
        case 'relation':
          data.relations[id] = OsmRelation(id, [
            for (final m in (e['members'] as List).cast<Map>())
              OsmMember(m['type'] as String, m['ref'] as int, m['role'] as String),
          ], tags);
      }
    }
    return data;
  }

  /// A way's points, skipping nodes the snapshot does not carry.
  List<Vector2> points(OsmWay way) => [
    for (final id in way.nodeIds)
      if (nodes[id] != null) nodes[id]!,
  ];

  /// Every closed way and multipolygon relation for which [match] holds.
  List<OsmArea> areas(bool Function(Tags tags) match) {
    final out = <OsmArea>[];
    final ids = ways.keys.toList()..sort();
    for (final id in ids) {
      final way = ways[id]!;
      if (!way.closed || !match(way.tags)) continue;
      final ring = cleanRing(points(way));
      if (ring.length < 3 || signedArea(ring).abs() < 1) continue;
      out.add(OsmArea('w$id', way.tags, [Polygon(ring)]));
    }
    final relIds = relations.keys.toList()..sort();
    for (final id in relIds) {
      final rel = relations[id]!;
      if (rel.tags['type'] != 'multipolygon' || !match(rel.tags)) continue;
      final polygons = multipolygon(rel);
      if (polygons.isNotEmpty) out.add(OsmArea('r$id', rel.tags, polygons));
    }
    return out;
  }

  /// Assembles a multipolygon relation's member ways into polygons.
  List<Polygon> multipolygon(OsmRelation rel) {
    List<Ring> rings(String role) {
      final segments = <List<int>>[
        for (final m in rel.members)
          if (m.type == 'way' &&
              (m.role == role || (role == 'outer' && m.role.isEmpty)) &&
              ways[m.ref] != null)
            [...ways[m.ref]!.nodeIds],
      ];
      final result = <Ring>[];
      while (segments.isNotEmpty) {
        var current = segments.removeAt(0);
        var progress = true;
        while (current.first != current.last && progress) {
          progress = false;
          for (var i = 0; i < segments.length; i++) {
            final s = segments[i];
            if (s.first == current.last) {
              current = [...current, ...s.skip(1)];
            } else if (s.last == current.last) {
              current = [...current, ...s.reversed.skip(1)];
            } else if (s.last == current.first) {
              current = [...s, ...current.skip(1)];
            } else if (s.first == current.first) {
              current = [...s.reversed, ...current.skip(1)];
            } else {
              continue;
            }
            segments.removeAt(i);
            progress = true;
            break;
          }
        }
        if (current.first != current.last) continue;
        final ring = cleanRing([
          for (final id in current)
            if (nodes[id] != null) nodes[id]!,
        ]);
        if (ring.length >= 3 && signedArea(ring).abs() > 1) result.add(ring);
      }
      return result;
    }

    final outers = rings('outer');
    final inners = rings('inner');
    return [
      for (final outer in outers)
        Polygon(outer, [
          for (final inner in inners)
            if (pointInRing(centroid(inner), outer)) inner,
        ]),
    ];
  }
}
