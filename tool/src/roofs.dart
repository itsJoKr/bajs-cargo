// The roof set (tool/prepare_roofs.py -> data/roofs.json and the web
// build's roof atlas): a handful of roof coverings, each building picks one
// from its OSM tags, else from its style and a stable hash, weighted toward
// what Zagreb's centre actually has (mostly old red and brown clay).
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:convert';
import 'dart:io';

import 'package:vector_math/vector_math.dart';

import 'buildings.dart';
import 'facades.dart' show stableHash;

class RoofChoice {
  const RoofChoice(this.tile, this.metres, this.shade);
  final double tile;
  final double metres;
  final Vector4 shade;
}

class RoofStyles {
  RoofStyles._(this._roofs);

  factory RoofStyles.load(String path) {
    final j = jsonDecode(File(path).readAsStringSync()) as Map<String, dynamic>;
    return RoofStyles._({
      for (final e in (j['roofs'] as Map<String, dynamic>).entries)
        e.key: (
          ((e.value as Map)['tile'] as num).toDouble(),
          ((e.value as Map)['metres'] as num).toDouble(),
        ),
    });
  }

  final Map<String, (double, double)> _roofs;

  RoofChoice _of(String name, Building b) {
    final (tile, metres) = _roofs[name] ?? _roofs['biber_old']!;
    // A small per-building shade so neighbours on the same covering differ.
    final v = .9 + .16 * stableHash(b.id, 7);
    return RoofChoice(tile, metres, Vector4(v, v, v, 1));
  }

  /// Per-building coverings chosen by hand (data/buildings.json `roof`).
  final overrides = <String, String>{};

  /// The covering for [b]'s roof.
  RoofChoice pick(Building b) {
    final chosen = overrides[b.id];
    if (chosen != null && _roofs.containsKey(chosen)) return _of(chosen, b);
    final t = b.tags;
    final material = t['roof:material'] ?? '';
    final colour = (t['roof:colour'] ?? '').toLowerCase();
    if (b.roof == RoofShape.flat) return _of('flat_gravel', b);
    if (material == 'copper' || colour.contains('green')) return _of('copper_green', b);
    if (material == 'metal' || material == 'tin' || material == 'zinc' || material == 'metal_sheet') {
      return _of('zinc_dark', b);
    }
    if (material == 'eternit' || material == 'slate' || material == 'concrete' ||
        colour.contains('grey') || colour.contains('gray')) {
      return _of('slate_grey', b);
    }
    // Post-war and interwar blocks get sheet or fibre-cement roofs more often.
    final h = stableHash(b.id, 11);
    if (const {'postwar', 'interwar', 'commercial'}.contains(b.style)) {
      return _of(h < .45 ? 'slate_grey' : h < .7 ? 'zinc_dark' : 'clay_red', b);
    }
    if (b.eave < 8.5) {
      // Courtyard sheds and low houses: the oldest, darkest tiles.
      return _of(h < .55 ? 'clay_brown' : 'biber_old', b);
    }
    return _of(
      h < .42
          ? 'biber_old'
          : h < .62
              ? 'clay_red'
              : h < .8
                  ? 'clay_pale'
                  : h < .93
                      ? 'clay_brown'
                      : 'slate_grey',
      b,
    );
  }
}
