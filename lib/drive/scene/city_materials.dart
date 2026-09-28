import 'package:flutter_scene/scene.dart';
import 'package:vector_math/vector_math.dart' as vm;

/// One shared material per name the generator writes (`facade`, `roof`,
/// ...). Every streamed chunk's meshes are pointed at these instances, so
/// chunks share pipelines and binds instead of each carrying its own copy.
class CityMaterials {
  CityMaterials();

  final Map<String, Material> byName = {
    'facade': PhysicallyBasedMaterial()
      ..baseColorFactor = vm.Vector4(1, 1, 1, 1)
      ..roughnessFactor = .92
      ..metallicFactor = 0,
    'roof': PhysicallyBasedMaterial()
      ..baseColorFactor = vm.Vector4(1, 1, 1, 1)
      ..roughnessFactor = .8
      ..metallicFactor = 0,
    'ground': PhysicallyBasedMaterial()
      ..baseColorFactor = vm.Vector4(1, 1, 1, 1)
      ..roughnessFactor = .9
      ..metallicFactor = 0,
    // Rails lie on the road and paving; the bias (metres toward the camera)
    // keeps them in front instead of lifting the geometry.
    'rails': PhysicallyBasedMaterial()
      ..baseColorFactor = vm.Vector4(1, 1, 1, 1)
      ..roughnessFactor = .45
      ..metallicFactor = .6
      ..depthBias = .04,
    'tree': PhysicallyBasedMaterial()
      ..baseColorFactor = vm.Vector4(1, 1, 1, 1)
      ..roughnessFactor = .92
      ..metallicFactor = 0,
  };

  /// Replaces every primitive's material under [root] by the shared one of
  /// the same name. Unknown names keep the document's own material.
  void adopt(Node root) {
    void walk(Node node) {
      final mesh = node.mesh;
      if (mesh != null) {
        for (final primitive in mesh.primitives) {
          final shared = byName[primitive.material.name];
          if (shared != null) primitive.material = shared;
        }
      }
      for (final child in node.children) {
        walk(child);
      }
    }

    walk(root);
  }
}
