import 'package:flutter_scene/scene.dart';
import 'package:vector_math/vector_math.dart' as vm;

import 'drive_world.dart';

/// A pinned debug view: where the camera sits and what it looks at. Parks
/// freeze everything animated, so two captures of one park compare equal.
class Park {
  const Park(this.eye, this.target);
  final (double, double, double) eye, target;
}

/// Everything the drive view shows, loaded and warmed up.
class DriveGame {
  DriveGame._(this.world);

  final DriveWorld world;
  Scene get scene => world.scene;

  /// The debug parks, in local metres (x east, y up, z north). Registered as
  /// `zagreb.<name>` by the view.
  static const parks = <String, Park>{
    // From the south-west corner of the square, looking north-east across
    // the statue toward Manduševac and the Cathedral's spires.
    'square': Park((-70, 2.2, -45), (40, 8, 60)),
    // Down Ilica's first blocks from Frankopanska, looking east toward the
    // square.
    'ilica': Park((-420, 2.2, -12), (-150, 6, 4)),
    // The Cathedral from Kaptol square's south-west.
    'cathedral': Park((150, 2.5, 90), (212, 40, 165)),
  };

  String? parked;

  static Future<DriveGame> load() async {
    final world = DriveWorld();
    await world.initialize();
    final game = DriveGame._(world);
    game._buildGround();
    game.park('square');
    await world.warmUp();
    return game;
  }

  void _buildGround() {
    final ground = PhysicallyBasedMaterial()
      ..baseColorFactor = vm.Vector4(.42, .43, .42, 1)
      ..roughnessFactor = .95
      ..metallicFactor = 0;
    scene.add(
      Node(
        name: 'Ground',
        mesh: Mesh(PlaneGeometry(width: 4000, depth: 4000), ground),
      ),
    );
  }

  void park(String name) {
    final park = parks[name]!;
    world.look(
      vm.Vector3(park.eye.$1, park.eye.$2, park.eye.$3),
      vm.Vector3(park.target.$1, park.target.$2, park.target.$3),
    );
    parked = name;
  }

  /// A free debug park: the camera at [eye] looking at [target].
  void lookAt(vm.Vector3 eye, vm.Vector3 target) {
    world.look(eye, target);
    parked = 'custom';
  }

  /// Leaves any park and resumes live play.
  void drive() {
    parked = null;
    world.orbit(vm.Vector3.zero(), heading: 0, pitch: .35, distance: 60);
  }

  void tick(double dt) {}
}
