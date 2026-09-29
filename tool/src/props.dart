// The street tree mesh, instanced at runtime, and its per-tree instance data.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

import 'mesh_writer.dart';

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

double _linear(int c) {
  final v = c / 255;
  return v <= .04045
      ? v / 12.92
      : math.pow((v + .055) / 1.055, 2.4).toDouble();
}

Vector4 _hex(int rgb, [double alpha = .9]) => Vector4(
  _linear((rgb >> 16) & 0xff),
  _linear((rgb >> 8) & 0xff),
  _linear(rgb & 0xff),
  alpha,
);

/// A 12 m deciduous street tree (Zrinjevac's plane trees and chestnuts,
/// scaled per instance): a six-sided trunk and a lumpy two-lobe crown.
MeshWriter treeMesh() {
  final mesh = MeshWriter();
  final bark = _hex(0x4B3A2C), leafDark = _hex(0x3E5A26), leafLight = _hex(0x6E8A3A);

  // Trunk.
  const sides = 6, trunkTop = 4.6;
  for (var i = 0; i < sides; i++) {
    final a0 = i / sides * 2 * math.pi, a1 = (i + 1) / sides * 2 * math.pi;
    final r0 = .26, r1 = .17;
    final n = Vector3(math.cos((a0 + a1) / 2), 0, math.sin((a0 + a1) / 2));
    final ids = [
      mesh.vertex(Vector3(math.cos(a0) * r0, 0, math.sin(a0) * r0), n, 0, 0,
          u1: 11, color: bark),
      mesh.vertex(Vector3(math.cos(a1) * r0, 0, math.sin(a1) * r0), n, 1, 0,
          u1: 11, color: bark),
      mesh.vertex(Vector3(math.cos(a1) * r1, trunkTop, math.sin(a1) * r1), n,
          1, 2, u1: 11, color: bark),
      mesh.vertex(Vector3(math.cos(a0) * r1, trunkTop, math.sin(a0) * r1), n,
          0, 2, u1: 11, color: bark),
    ];
    mesh.triangle(ids[0], ids[1], ids[2], n);
    mesh.triangle(ids[0], ids[2], ids[3], n);
  }

  // Crown: two overlapping squashed icospheres with jittered vertices.
  void lobe(Vector3 center, double radius, double seed) {
    final t = (1 + math.sqrt(5)) / 2;
    var verts = <Vector3>[
      Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0),
      Vector3(0, -1, t), Vector3(0, 1, t), Vector3(0, -1, -t), Vector3(0, 1, -t),
      Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1),
    ].map((v) => v.normalized()).toList();
    var faces = <List<int>>[
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    // One subdivision.
    final mid = <int, int>{};
    int midpoint(int a, int b) {
      final key = a < b ? a * 1000 + b : b * 1000 + a;
      return mid.putIfAbsent(key, () {
        verts.add(((verts[a] + verts[b]) * .5).normalized());
        return verts.length - 1;
      });
    }

    faces = [
      for (final f in faces) ...() {
        final ab = midpoint(f[0], f[1]), bc = midpoint(f[1], f[2]);
        final ca = midpoint(f[2], f[0]);
        return [
          [f[0], ab, ca],
          [f[1], bc, ab],
          [f[2], ca, bc],
          [ab, bc, ca],
        ];
      }(),
    ];
    verts = [
      for (var i = 0; i < verts.length; i++)
        () {
          final v = verts[i];
          final j = .82 + .3 * _hash(v.x * 7 + seed, v.z * 5 + v.y * 3);
          return Vector3(v.x * radius * j, v.y * radius * .78 * j, v.z * radius * j);
        }(),
    ];
    for (final f in faces) {
      final a = verts[f[0]], b = verts[f[1]], c = verts[f[2]];
      final n = (b - a).cross(c - a)..normalize();
      final outward = ((a + b + c) / 3).normalized();
      final facing = n.dot(outward) >= 0 ? n : -n;
      // Faces toward the sky are lighter, like sunlit leaves.
      final shade = (.5 + .5 * facing.y).clamp(0.0, 1.0);
      final color = leafDark + (leafLight - leafDark) * shade;
      final ids = [
        for (final p in [a, b, c])
          mesh.vertex(center + p, facing, p.x / 4, p.z / 4, u1: 10, color: color),
      ];
      mesh.triangle(ids[0], ids[1], ids[2], facing);
    }
  }

  lobe(Vector3(0, 7.4, 0), 3.6, 1);
  lobe(Vector3(1.2, 8.8, .6), 2.6, 2);
  return mesh;
}
