import 'dart:math' as math;

import 'package:flutter_scene/scene.dart';
import 'package:vector_math/vector_math.dart' as vm;

import '../domain/city_index.dart';
import 'city_materials.dart';

/// Street and park trees: one baked tree mesh (`assets/city/props.fscene`),
/// drawn per chunk as a single [InstancedMesh], so a chunk full of
/// Zrinjevac's plane trees costs one draw.
class Trees {
  Trees._(this._geometry, this._material);

  final Geometry _geometry;
  final Material _material;

  static Future<Trees> load(CityMaterials materials) async {
    final props = await loadScene('assets/city/props.fscene');
    materials.adopt(props);
    final node = props.getChildByName('Tree mesh');
    final primitive = node?.mesh?.primitives.first;
    if (primitive == null) throw StateError('props.fscene has no Tree mesh');
    return Trees._(primitive.geometry, primitive.material);
  }

  /// Adds [chunk]'s trees under [node].
  void plant(ChunkInfo chunk, Node node) {
    if (chunk.trees.isEmpty) return;
    final mesh = InstancedMesh(geometry: _geometry, material: _material);
    for (final t in chunk.trees) {
      final scale = t[3];
      mesh.addInstance(
        vm.Matrix4.compose(
          vm.Vector3(t[0], t[2], t[1]),
          vm.Quaternion.axisAngle(vm.Vector3(0, 1, 0), t[4]),
          vm.Vector3.all(scale),
        ),
        // A little per-tree variation in leaf colour.
        color: vm.Vector4(
          .9 + .2 * _hash(t[0], t[1]),
          .92 + .16 * _hash(t[1], t[0]),
          .9 + .1 * _hash(t[0] + 3, t[1]),
          1,
        ),
      );
    }
    node.add(
      Node(name: 'Trees')..addComponent(InstancedMeshComponent(mesh)),
    );
  }

  static double _hash(double a, double b) {
    final v = math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return v - v.floorToDouble();
  }
}
