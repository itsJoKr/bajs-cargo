// Collects generated geometry: MeshWriter packs vertices and indices,
// which tool/export_web.dart writes into the web city's glTF.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:math' as math;
import 'dart:typed_data';

import 'package:vector_math/vector_math.dart';

/// Collects vertices and packs them in the `unskinned_soa_uv1_tangent`
/// layout: position, normal, UV0, UV1, colour (LINEAR, alpha free for the
/// material to use), tangent -- 72 bytes per vertex, concatenated streams.
class MeshWriter {
  final _positions = <double>[], _normals = <double>[];
  final _uvs = <double>[], _uv1s = <double>[], _colors = <double>[];
  final _indices = <int>[];

  int get vertexCount => _positions.length ~/ 3;
  int get triangleCount => _indices.length ~/ 3;
  bool get isEmpty => _indices.isEmpty;

  int vertex(
    Vector3 p,
    Vector3 n,
    double u,
    double v, {
    double u1 = 0,
    double v1 = 0,
    Vector4? color,
  }) {
    _positions.addAll([p.x, p.y, p.z]);
    _normals.addAll([n.x, n.y, n.z]);
    _uvs.addAll([u, v]);
    _uv1s.addAll([u1, v1]);
    final c = color ?? _white;
    _colors.addAll([c.x, c.y, c.z, c.w]);
    return vertexCount - 1;
  }

  static final _white = Vector4(1, 1, 1, 1);

  Vector3 position(int i) =>
      Vector3(_positions[i * 3], _positions[i * 3 + 1], _positions[i * 3 + 2]);

  /// Adds a triangle wound so its front face looks along [facing]. A
  /// triangle's front face points along `(b - a) x (c - a)`.
  void triangle(int a, int b, int c, Vector3 facing) {
    final pa = position(a);
    final front =
        (position(b) - pa).cross(position(c) - pa).dot(facing) >= 0;
    _indices.addAll(front ? [a, b, c] : [a, c, b]);
  }

  /// Appends raw indices whose winding is already right.
  void rawTriangle(int a, int b, int c) => _indices.addAll([a, b, c]);

  (List<double>, List<double>) get bounds {
    final min = [double.infinity, double.infinity, double.infinity];
    final max = [-double.infinity, -double.infinity, -double.infinity];
    for (var i = 0; i < _positions.length; i++) {
      min[i % 3] = math.min(min[i % 3], _positions[i]);
      max[i % 3] = math.max(max[i % 3], _positions[i]);
    }
    return (min, max);
  }

  Uint8List vertexBytes() {
    final count = vertexCount;
    final floats = Float32List(count * 18);
    var o = 0;
    for (final v in _positions) {
      floats[o++] = v;
    }
    for (final v in _normals) {
      floats[o++] = v;
    }
    for (final v in _uvs) {
      floats[o++] = v;
    }
    for (final v in _uv1s) {
      floats[o++] = v;
    }
    for (final v in _colors) {
      floats[o++] = v;
    }
    for (var i = 0; i < count; i++) {
      final n = Vector3(
        _normals[i * 3],
        _normals[i * 3 + 1],
        _normals[i * 3 + 2],
      );
      final axis = n.y.abs() < .99 ? Vector3(0, 1, 0) : Vector3(0, 0, 1);
      final t = axis.cross(n)..normalize();
      floats.setAll(o, [t.x, t.y, t.z, 1]);
      o += 4;
    }
    return floats.buffer.asUint8List();
  }

  (Uint8List, String) indexBytes() {
    if (vertexCount <= 0xffff) {
      return (Uint16List.fromList(_indices).buffer.asUint8List(), 'uint16');
    }
    return (Uint32List.fromList(_indices).buffer.asUint8List(), 'uint32');
  }
}
