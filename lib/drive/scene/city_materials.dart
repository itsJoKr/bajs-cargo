import 'package:flutter_scene/scene.dart';
import 'package:vector_math/vector_math.dart' as vm;

/// One shared material per name the generator writes (`facade`, `roof`,
/// `ground`, `rails`, `tree`). Every streamed chunk's meshes are pointed at
/// these instances, so chunks share pipelines and binds.
///
/// Facades, roofs, ground and rails are the `CityAtlas` material
/// (`assets/materials/city_atlas.fmat`) over the style-kit atlases; each
/// vertex names its tile. Trees keep a plain vertex-coloured PBR material,
/// since they are instanced.
class CityMaterials {
  CityMaterials._(this.byName);

  final Map<String, Material> byName;

  /// A stand-in set with no textures, for code paths without Flutter GPU
  /// assets.
  factory CityMaterials.plain() {
    PhysicallyBasedMaterial pbr(double roughness) => PhysicallyBasedMaterial()
      ..baseColorFactor = vm.Vector4(1, 1, 1, 1)
      ..roughnessFactor = roughness
      ..metallicFactor = 0;
    return CityMaterials._({
      for (final name in ['facade', 'roof', 'ground', 'rails', 'tree'])
        name: pbr(.9),
    });
  }

  static Future<CityMaterials> load() async {
    final facadeAtlas = await loadTexture('assets/textures/facade_atlas.png');
    final surfaceAtlas = await loadTexture('assets/textures/surface_atlas.png');
    // Street View facades of real buildings (tool/prepare_facades.py),
    // selected per vertex by UV1.x < 0.
    final heroAtlas = await loadTexture('assets/textures/hero_atlas.png');

    Future<Material> atlasMaterial(
      TextureSource atlas,
      double columns, {
      double depthBias = 0,
    }) async {
      final material = await loadFmatMaterial('assets/materials/city_atlas.fmat');
      material.parameters
        ..setTexture(
          'atlas',
          atlas.sampledTexture!,
          sampler: atlas.sampledSampler,
        )
        ..setTexture(
          'hero_atlas',
          heroAtlas.sampledTexture!,
          sampler: heroAtlas.sampledSampler,
        )
        ..setFloat('columns', columns)
        ..setFloat('padding', 16 / 256);
      material.depthBias = depthBias;
      return material;
    }

    final surface = await atlasMaterial(surfaceAtlas, 4);
    return CityMaterials._({
      'facade': await atlasMaterial(facadeAtlas, 8),
      'roof': surface,
      'ground': surface,
      // Rails lie on the road and paving; the bias (metres toward the
      // camera) keeps them in front instead of lifting the geometry.
      'rails': await atlasMaterial(surfaceAtlas, 4, depthBias: .04),
      'tree': PhysicallyBasedMaterial()
        ..baseColorFactor = vm.Vector4(1, 1, 1, 1)
        ..roughnessFactor = .92
        ..metallicFactor = 0,
    });
  }

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
