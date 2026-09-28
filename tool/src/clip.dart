// Polygon booleans and offsets over Clipper2, in millimetre integers.
// ignore_for_file: depend_on_referenced_packages
library;

import 'package:clipper2/clipper2.dart';
import 'package:vector_math/vector_math.dart';

import 'geom.dart';
import 'osm.dart';

const _scale = 1000.0;

/// A region of the plane: any number of polygons with holes, stored as
/// Clipper paths under the non-zero rule.
class Shape {
  const Shape(this.paths);
  Shape.empty() : paths = <Path64>[];

  factory Shape.of(Iterable<Polygon> polygons) => Shape([
    for (final p in polygons) ...[
      _path(p.outer),
      for (final h in p.holes) _path(h),
    ],
  ]).normalized;

  factory Shape.rect(double minX, double minZ, double maxX, double maxZ) =>
      Shape([
        _path([
          Vector2(minX, minZ),
          Vector2(maxX, minZ),
          Vector2(maxX, maxZ),
          Vector2(minX, maxZ),
        ]),
      ]);

  /// Open polylines thickened by [halfWidth] metres on each side.
  factory Shape.lines(
    Iterable<List<Vector2>> lines,
    double halfWidth, {
    bool round = true,
  }) {
    final paths = [
      for (final l in lines)
        if (l.length >= 2) _path(l),
    ];
    if (paths.isEmpty) return Shape.empty();
    return Shape(
      Clipper.inflatePaths(
        paths: paths,
        delta: halfWidth * _scale,
        joinType: round ? JoinType.round : JoinType.miter,
        endType: round ? EndType.round : EndType.butt,
        arcTolerance: 60,
      ),
    ).normalized;
  }

  final Paths64 paths;
  bool get isEmpty => paths.isEmpty;

  Shape get normalized => Shape(
    Clipper.union(subject: paths, fillRule: FillRule.nonZero),
  );

  // Clipper returns nothing when the subject is empty, so an empty shape
  // must hand back the other operand itself.
  Shape operator |(Shape other) => isEmpty
      ? other
      : Shape(
    Clipper.union(
      subject: paths,
      clip: other.paths,
      fillRule: FillRule.nonZero,
    ),
  );

  Shape operator -(Shape other) => other.isEmpty
      ? this
      : Shape(
          Clipper.difference(
            subject: paths,
            clip: other.paths,
            fillRule: FillRule.nonZero,
          ),
        );

  Shape operator &(Shape other) => Shape(
    Clipper.intersect(
      subject: paths,
      clip: other.paths,
      fillRule: FillRule.nonZero,
    ),
  );

  /// The part inside an axis-aligned rectangle. (Clipper's own `rectClip`
  /// throws a RangeError in this Dart port on some paths, so this uses the
  /// general intersection.)
  Shape clipRect(double minX, double minZ, double maxX, double maxZ) =>
      isEmpty ? this : this & Shape.rect(minX, minZ, maxX, maxZ);

  /// Grows (or with a negative [delta], shrinks) every polygon.
  Shape inflate(double delta) => Shape(
    Clipper.inflatePaths(
      paths: paths,
      delta: delta * _scale,
      joinType: JoinType.miter,
      endType: EndType.polygon,
    ),
  );

  double get area => paths.fold(0.0, (s, p) => s + p.area) / (_scale * _scale);

  /// The shape as polygons with holes (outer counter-clockwise).
  List<Polygon> get polygons {
    if (isEmpty) return const [];
    final tree = Clipper.booleanOpPolyTree(
      clipType: ClipType.union,
      subject: paths,
      fillRule: FillRule.nonZero,
    );
    final out = <Polygon>[];
    void visit(PolyPath64 node) {
      final polygon = node.polygon;
      if (polygon != null && !node.isHole) {
        final outer = cleanRing(_ring(polygon), epsilon: .005);
        final holes = [
          for (final child in node.children)
            if (child.polygon != null)
              cleanRing(_ring(child.polygon!), epsilon: .005),
        ].where((h) => h.length >= 3).toList();
        if (outer.length >= 3) out.add(Polygon(outer, holes));
      }
      for (final child in node.children) {
        visit(child);
      }
    }

    for (final child in tree.children) {
      visit(child);
    }
    return out;
  }
}

Path64 _path(List<Vector2> ring) => [
  for (final p in ring) Point64((p.x * _scale).round(), (p.y * _scale).round()),
];

Ring _ring(Path64 path) => [
  for (final p in path) Vector2(p.x / _scale, p.y / _scale),
];
