// The Zagreb style kit: which facade style and paint colour a building
// gets, and how its bays and storeys are laid out on each wall.
//
// Styles and their proportions come from data/facade_styles.json, written by
// tool/prepare_textures.py alongside the facade atlas.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

import 'osm.dart';

class FacadeStyle {
  FacadeStyle(this.name, Map<String, dynamic> json)
    : bay = (json['bay'] as num).toDouble(),
      ground = (json['ground'] as num).toDouble(),
      first = (json['first'] as num).toDouble(),
      upper = (json['upper'] as num).toDouble(),
      cornice = (json['cornice'] as num).toDouble(),
      tiles = (json['tiles'] as List).cast<int>();

  final String name;

  /// Metres: bay width and each row's natural height.
  final double bay, ground, first, upper, cornice;

  /// Atlas tiles: ground floor, first floor, upper storey, cornice.
  final List<int> tiles;
}

/// One horizontal band of a facade: [y0, y1] in metres above the sidewalk,
/// showing [tile] repeated [repeats] times vertically.
typedef FacadeRow = ({double y0, double y1, int tile, double repeats});

class FacadeStyles {
  FacadeStyles._(this.styles, this.plainTile);

  factory FacadeStyles.load(String path) {
    final json = jsonDecode(File(path).readAsStringSync()) as Map;
    final styles = <String, FacadeStyle>{
      for (final e in (json['styles'] as Map).entries)
        e.key as String: FacadeStyle(
          e.key as String,
          e.value as Map<String, dynamic>,
        ),
    };
    return FacadeStyles._(styles, json['plainTile'] as int);
  }

  final Map<String, FacadeStyle> styles;
  final int plainTile;

  FacadeStyle operator [](String name) => styles[name]!;

  /// Rows for a facade [height] metres tall (sidewalk to eave): ground
  /// floor, first floor, as many upper storeys as fit, cornice, all
  /// stretched a little so they fill the height exactly. Below
  /// [firstShare] of a first floor over the ground floor the wall is one
  /// ground-floor row (a generic wall passes less: a two-storey house on
  /// the uphill side keeps both storeys, squashed, as its old picture did).
  static List<FacadeRow> rows(FacadeStyle s, double height, {double firstShare = .6}) {
    final c = math.min(s.cornice, height * .12);
    final spec = <(double, int, double)>[]; // natural height, tile, repeats
    if (height < s.ground + c + s.first * firstShare) {
      spec.add((height - c, s.tiles[0], 1));
    } else {
      spec.add((s.ground, s.tiles[0], 1));
      final rest = height - s.ground - c;
      final n = math.max(0, ((rest - s.first) / s.upper).round());
      spec.add((s.first, s.tiles[1], 1));
      if (n > 0) spec.add((s.upper * n, s.tiles[2], n.toDouble()));
    }
    spec.add((c, s.tiles[3], 1));
    final natural = spec.fold(0.0, (sum, r) => sum + r.$1);
    final scale = height / natural;
    final out = <FacadeRow>[];
    var y = 0.0;
    for (final (h, tile, repeats) in spec) {
      out.add((y0: y, y1: y + h * scale, tile: tile, repeats: repeats));
      y += h * scale;
    }
    return out;
  }
}

double stableHash(String text, [int salt = 0]) {
  var hash = 0x811c9dc5 ^ salt;
  for (final unit in utf8.encode(text)) {
    hash ^= unit;
    hash = (hash * 0x01000193) & 0xffffffff;
  }
  return (hash & 0xffffff) / 0x1000000;
}

T _pick<T>(List<(T, double)> weighted, double r) {
  final total = weighted.fold(0.0, (s, w) => s + w.$2);
  var x = r * total;
  for (final (value, weight) in weighted) {
    if (x < weight) return value;
    x -= weight;
  }
  return weighted.last.$1;
}

int? _year(Tags tags) {
  for (final key in ['start_date', 'building:year', 'construction_date']) {
    final m = RegExp(r'(1[5-9]\d\d|20\d\d)').firstMatch(tags[key] ?? '');
    if (m != null) return int.parse(m.group(1)!);
  }
  return null;
}

/// The style a building's street facades wear.
String styleFor({
  required String id,
  required Tags tags,
  required bool upperTown,
  required double eave,
  required bool flatRoof,
  required double area,
}) {
  final r = stableHash(id, 1);
  final year = _year(tags);
  if (year != null) {
    if (year < 1800) return 'baroque_upper';
    if (year < 1860) return r < .6 ? 'biedermeier' : 'historicist_plain';
    if (year < 1900) {
      return _pick([
        ('historicist_a', 3.0),
        ('historicist_b', 2.0),
        ('historicist_plain', 3.0),
      ], r);
    }
    if (year < 1919) return r < .5 ? 'secession_floral' : 'secession_late';
    if (year < 1946) return 'interwar';
    if (year < 1991) return 'postwar';
    return 'commercial';
  }
  final levels = double.tryParse(tags['building:levels'] ?? '');
  if ((levels ?? 0) >= 8 || eave > 26) {
    return r < .6 ? 'postwar' : 'commercial';
  }
  if (flatRoof && area > 600) {
    return _pick([('interwar', 2.0), ('postwar', 2.0), ('commercial', 1.0)], r);
  }
  if (upperTown) {
    return _pick([
      ('baroque_upper', 6.0),
      ('biedermeier', 3.0),
      ('historicist_plain', 1.5),
    ], r);
  }
  return _pick([
    ('historicist_a', 20.0),
    ('historicist_b', 12.0),
    ('historicist_plain', 24.0),
    ('secession_floral', 10.0),
    ('secession_late', 9.0),
    ('biedermeier', 8.0),
    ('interwar', 10.0),
    ('arcade', 3.0),
    ('postwar', 4.0),
  ], r);
}

double _linear(int c) {
  final v = c / 255;
  return v <= .04045
      ? v / 12.92
      : math.pow((v + .055) / 1.055, 2.4).toDouble();
}

/// The atlas stucco's own colour (tool/prepare_textures.py's STUCCO).
final _stucco = Vector3(_linear(230), _linear(226), _linear(218));

/// The paint colours of the centre's facades (sRGB): ochre and yellows,
/// creams, pale greens, terracotta pinks, greys, a few pale blues.
const _palette = <(int, double)>[
  (0xE2C27E, 3), // ochre
  (0xEED9A2, 3), // pale yellow
  (0xEDE2C8, 4), // cream
  (0xF1ECE2, 3), // off-white
  (0xD9D6CF, 3), // light grey
  (0xC9D2B0, 2), // pale green
  (0xB9C7A4, 1), // pistachio
  (0xE3AE96, 2), // terracotta pink
  (0xE8BFA7, 2), // salmon
  (0xD8A9A2, 1), // old rose
  (0xCBD2D8, 1), // pale blue-grey
  (0xD7B26A, 1), // mustard
];

/// The vertex colour that turns the atlas stucco into [id]'s paint: the
/// paint over the stucco, with a little per-building variation.
Vector4 paintFor(String id, {bool upperTown = false}) {
  final rgb = _pick([
    for (final (c, w) in _palette) (c, upperTown ? (c == 0xE2C27E ? w * 2 : w) : w),
  ], stableHash(id, 2));
  final v = .94 + .1 * stableHash(id, 3);
  return Vector4(
    _linear((rgb >> 16) & 0xff) / _stucco.x * v,
    _linear((rgb >> 8) & 0xff) / _stucco.y * v,
    _linear(rgb & 0xff) / _stucco.z * v,
    1,
  );
}

/// Roof tile colour variation: new red, weathered brown, dark old tiles.
Vector4 roofTintFor(String id) {
  final r = stableHash(id, 4);
  final base = r < .45
      ? Vector3(1.0, .96, .94)
      : r < .8
      ? Vector3(.86, .8, .76)
      : Vector3(.7, .66, .64);
  final v = .92 + .14 * stableHash(id, 5);
  return Vector4(base.x * v, base.y * v, base.z * v, 1);
}
