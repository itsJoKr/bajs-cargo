import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_scene/scene.dart';
import 'package:vector_math/vector_math.dart' as vm;

import '../domain/city_index.dart';
import 'chunk_streamer.dart';
import 'city_materials.dart';
import 'drive_world.dart';

/// A pinned debug view: where the camera sits and what it looks at. Parks
/// freeze everything animated, so two captures of one park compare equal.
class Park {
  const Park(this.eye, this.target);
  final (double, double, double) eye, target;
}

/// Everything the drive view shows, loaded and warmed up.
class DriveGame {
  DriveGame._(this.world, this.streamer);

  final DriveWorld world;
  final ChunkStreamer streamer;
  Scene get scene => world.scene;

  /// The debug parks, in local metres (x east, y up, z north). Registered as
  /// `zagreb.<name>` by the view.
  static const parks = <String, Park>{
    // From the square's west end, where Ilica opens onto it, looking east
    // past the statue (13, 17) toward Manduševac and the east side.
    'square': Park((-100, 2.2, 2), (30, 7, 18)),
    // Down Ilica's first pedestrian blocks, looking east toward the square.
    'ilica': Park((-300, 2.2, 9), (-110, 5, 9)),
    // The Cathedral's west front and twin spires from Kaptol square.
    'cathedral': Park((105, 2.2, 150), (180, 38, 167)),
    // High over the square from the south-west: the perimeter blocks and
    // their courtyards.
    'overview': Park((-230, 230, -330), (10, 0, 20)),
  };

  String? parked;

  static Future<DriveGame> load() async {
    final world = DriveWorld();
    await world.initialize();
    final index = CityIndex.fromJson(
      jsonDecode(await rootBundle.loadString('assets/data/city_index.json'))
          as Map<String, Object?>,
    );
    final streamer = ChunkStreamer(world.scene, index, CityMaterials());
    final game = DriveGame._(world, streamer);
    game._buildGround();
    game.park('square');
    final eye = world.camera.position;
    await streamer.preload(eye.x, eye.z);
    await streamer.warmUp(world.warmUp);
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

  /// Whether [name] is parked and its surroundings are streamed in.
  bool isParked(String name) => parked == name && streamer.settled;

  void tick(double dt) {
    final eye = world.camera.position;
    streamer.update(eye.x, eye.z);
  }
}
