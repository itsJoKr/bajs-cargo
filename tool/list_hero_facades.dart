// Lists the street facades of one section of the city, with a Street View
// viewpoint for each, as the work list for photographing real buildings.
//
//   fvm dart tool/list_hero_facades.dart [section] > .art/streetview/<section>.json
//   fvm dart tool/list_hero_facades.dart --building w105487407,w97235393 \
//       > .art/streetview/<name>.json
//   ... --building <ids> --min 0.3   # short corner edges too (default 4 m)
//
// `--building` lists EVERY street-facing wall of those buildings (a corner
// building is seen from two or more streets, and each side needs its own
// picture), whatever space it faces; ids are OSM ids as in
// data/hero/coverage.json (`w<way>` or `r<relation>`, `_<n>` for a
// multipolygon's n-th part).
//
// Sections are named areas (see `sections`). A facade is one street-facing
// footprint edge of a building whose outward side opens onto the section's
// public space. The viewpoint stands in front of the facade's middle, far
// enough back to see all of it, and the heading (degrees clockwise from
// north) looks straight at it.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';
import 'src/geo.dart';

import 'src/buildings.dart';
import 'src/city.dart';
import 'src/geom.dart';
import 'src/osm.dart';

/// Named sections: an OSM area whose surroundings count as "facing it".
const sections = {
  // Trg bana Josipa Jelačića, the place=square outline.
  'square': 105489682,
};

void main(List<String> args) {
  final at = args.indexOf('--building');
  final only = at >= 0 ? args[at + 1].split(',').toSet() : null;
  // `--min <m>` lists shorter walls too (corner edges; default 4 m).
  final minAt = args.indexOf('--min');
  final minLength = minAt >= 0 ? double.parse(args[minAt + 1]) : 4.0;
  final section = only != null ? 'buildings' : (args.isEmpty ? 'square' : args.first);
  final osm = OsmData.load('data/osm/zagreb_centre.json');
  final city = City(osm, coreExtent, separateSmallStructures: true)..build();
  bool Function(Vector2) facesArea = (_) => true;
  if (only == null) {
    final way = osm.ways[sections[section]]!;
    final area = Polygon(cleanRing(osm.points(way)));
    // The square's outline runs along the facades, so test a little inside.
    facesArea = (p) =>
        area.contains(p) ||
        area.edges.any((e) => distanceToSegment(p, e.$1, e.$2) < 6);
  }

  final facades = <Map<String, Object?>>[];
  for (final b in city.buildings) {
    if (only != null && !only.contains(b.id)) continue;
    var edge = -1;
    for (final (a, c) in b.polygon.edges) {
      edge++;
      if (edge >= b.walls.length || b.walls[edge] != WallKind.street) continue;
      final d = c - a;
      final length = d.length;
      if (length < minLength) continue;
      final n = Vector2(d.y, -d.x) / length;
      final mid = (a + c) * .5;
      if (!facesArea(mid + n * 8)) continue;
      final back = (length * .85).clamp(14.0, 40.0);
      final view = mid + n * back;
      final heading = (math.atan2(-n.x, -n.y) * 180 / math.pi + 360) % 360;
      ({double latitude, double longitude}) geo(Vector2 p) =>
          localToGeo(p.x, p.y);
      final ga = geo(a), gc = geo(c), gv = geo(view);
      facades.add({
        'id': '${b.id}_e$edge',
        'building': b.id,
        'edge': edge,
        'name': b.name,
        'length': double.parse(length.toStringAsFixed(1)),
        'eave': double.parse(b.eave.toStringAsFixed(1)),
        'levels': b.tags['building:levels'],
        'height': b.tags['height'],
        'a': [a.x, a.y],
        'b': [c.x, c.y],
        'aGeo': [ga.latitude, ga.longitude],
        'bGeo': [gc.latitude, gc.longitude],
        'view': [gv.latitude, gv.longitude],
        'heading': double.parse(heading.toStringAsFixed(1)),
        'distance': back,
      });
    }
  }
  facades.sort((x, y) => (x['heading'] as double).compareTo(y['heading'] as double));
  stdout.writeln(const JsonEncoder.withIndent('  ').convert({
    'section': section,
    'facades': facades,
  }));
  stderr.writeln('${facades.length} facades face $section');
}
