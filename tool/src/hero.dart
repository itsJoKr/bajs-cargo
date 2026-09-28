// Hero facades: real buildings photographed in Street View and redrawn as
// straight-on elevations (tool/prepare_facades.py), packed into
// assets/textures/hero_atlas.png. data/hero/atlas.json says which footprint
// edges each picture covers.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'osm.dart';

/// The atlas-space span of one footprint edge: the picture's columns
/// [u0]..[u1] (left to right as seen from the street) and its rows [top]
/// (the eave) .. [bottom] (the pavement), in texture coordinates.
class HeroSpan {
  const HeroSpan(this.u0, this.u1, this.top, this.bottom);
  final double u0, u1, top, bottom;
}

class HeroFacade {
  HeroFacade(this.name, this.rect, this.edges, this.storeys);
  final String name;
  final List<double> rect;

  /// `<building id>_e<edge index>` in `Polygon.edges` order.
  final List<String> edges;
  final int storeys;
}

class HeroAtlas {
  HeroAtlas._(this.facades, this.storey, this.groundExtra);

  /// No hero facades: every building wears the style kit.
  HeroAtlas.none() : facades = const [], storey = 0, groundExtra = 0;

  final List<HeroFacade> facades;

  /// The storey height the pictures were drawn at, and the ground floor's
  /// extra: a hero building's eave is `storeys * storey + groundExtra`, so
  /// the picture is never stretched.
  final double storey, groundExtra;

  static HeroAtlas load(String path) {
    final file = File(path);
    if (!file.existsSync()) return HeroAtlas.none();
    final json = jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
    final entries = json['facades']! as Map<String, Object?>;
    final names = entries.keys.toList()..sort();
    return HeroAtlas._(
      [
        for (final name in names)
          () {
            final e = entries[name]! as Map<String, Object?>;
            return HeroFacade(
              name,
              [for (final v in e['rect']! as List) (v as num).toDouble()],
              [for (final v in e['edges']! as List) v as String],
              e['storeys']! as int,
            );
          }(),
      ],
      (json['storey']! as num).toDouble(),
      (json['groundExtra']! as num).toDouble(),
    );
  }

  static (String, int) _split(String edge) {
    final i = edge.lastIndexOf('_e');
    return (edge.substring(0, i), int.parse(edge.substring(i + 2)));
  }

  /// Hero building id -> its eave above the terrain.
  Map<String, double> get eaves {
    final out = <String, double>{};
    for (final f in facades) {
      for (final edge in f.edges) {
        final id = _split(edge).$1;
        out[id] = math.max(out[id] ?? 0, f.storeys * storey + groundExtra);
      }
    }
    return out;
  }

  /// Edge index -> span for building [id] with footprint [polygon]. A
  /// picture that covers several consecutive edges (a corner building) is
  /// split between them by length, walking the ring in order: seen from
  /// outside, an edge runs left to right.
  Map<int, HeroSpan> spansFor(String id, Polygon polygon) {
    final edges = polygon.edges.toList();
    final out = <int, HeroSpan>{};
    for (final f in facades) {
      final mine = {
        for (final e in f.edges)
          if (_split(e).$1 == id) _split(e).$2,
      };
      if (mine.isEmpty) continue;
      // The chain starts at the edge whose predecessor is not in it.
      final n = polygon.outer.length;
      final start = mine.firstWhere(
        (i) => !mine.contains((i - 1 + n) % n),
        orElse: () => mine.reduce(math.min),
      );
      final chain = [for (var k = 0; k < mine.length; k++) (start + k) % n];
      double lengthOf(int i) => edges[i].$1.distanceTo(edges[i].$2);
      final total = chain.fold(0.0, (s, i) => s + lengthOf(i));
      final r = f.rect;
      var s = 0.0;
      for (final i in chain) {
        final l = lengthOf(i);
        out[i] = HeroSpan(
          r[0] + (r[2] - r[0]) * s / total,
          r[0] + (r[2] - r[0]) * (s + l) / total,
          r[1],
          r[3],
        );
        s += l;
      }
    }
    return out;
  }
}
