// Per-tree instance data; web3d/src/trees.ts builds and instances the trees.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

/// One tree instance for the runtime: [x, z, base y, scale, yaw], rounded to
/// keep the index small and stable.
List<double> treeInstance(Vector2 p, double baseY) {
  // A hash of the position, so a tree's size never depends on its
  // neighbours or on the order trees were read.
  final h = _hash(p.x, p.y);
  final scale = .75 + .55 * h;
  final yaw = 6.2832 * _hash(p.y, p.x);
  double r(double v, int places) {
    final f = math.pow(10, places);
    return (v * f).roundToDouble() / f;
  }

  return [r(p.x, 2), r(p.y, 2), r(baseY, 2), r(scale, 3), r(yaw, 3)];
}

double _hash(double a, double b) {
  final v = math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - v.floorToDouble();
}
