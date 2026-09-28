import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:flutter_scene/scene.dart';
import 'package:vector_math/vector_math.dart' as vm;

import '../domain/car.dart';
import '../domain/chase_camera.dart';
import '../domain/city_index.dart';
import '../domain/collision.dart';
import '../domain/controls.dart';
import '../domain/terrain.dart';
import 'car_model.dart';
import 'chunk_streamer.dart';
import 'city_materials.dart';
import 'drive_world.dart';
import 'trees.dart';

/// A pinned debug view: where the camera sits and what it looks at. The car
/// is parked [carAhead] metres in front of the eye, facing the view. Parks
/// freeze everything animated, so two captures of one park compare equal.
class Park {
  const Park(this.eye, this.target, {this.carAhead = 9});
  final (double, double, double) eye, target;
  final double carAhead;
}

/// Everything the drive view shows, loaded and warmed up: the world, the
/// streamed city, and the car with its chase camera.
class DriveGame {
  DriveGame._({
    required this.world,
    required this.streamer,
    required this.car,
    required this.model,
    required this.camera,
  });

  final DriveWorld world;
  final ChunkStreamer streamer;
  final Car car;
  final CarModel model;
  final ChaseCamera camera;
  final controls = DriveControls();
  Scene get scene => world.scene;

  /// Where a new drive starts: the square's west end, facing east past the
  /// statue.
  static const spawn = (-70.0, 6.0, math.pi / 2);

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
    'overview': Park((-230, 230, -330), (10, 0, 20), carAhead: 0),
  };

  /// The park the game is frozen in, `custom` for a debug `look`, or null
  /// while driving.
  String? parked;

  static Future<DriveGame> load() async {
    final world = DriveWorld();
    await world.initialize();
    Future<ByteData> data(String name) => rootBundle.load('assets/data/$name');
    final index = CityIndex.fromJson(
      jsonDecode(await rootBundle.loadString('assets/data/city_index.json'))
          as Map<String, Object?>,
    );
    final footprints = Footprints.fromBytes(await data('collision.bin'));
    final ground = Ground(
      HeightGrid.fromBytes(await data('terrain.bin')),
      RoadMask.fromBytes(await data('roadmask.bin')),
    );
    final materials = await CityMaterials.load();
    final trees = await Trees.load(materials);
    final streamer = ChunkStreamer(
      world.scene,
      index,
      materials,
      onLoaded: trees.plant,
    );
    final car = Car(
      ground: ground,
      footprints: footprints,
      x: spawn.$1,
      z: spawn.$2,
      heading: spawn.$3,
    );
    final model = await CarModel.load();
    world.scene.add(model.root);
    final game = DriveGame._(
      world: world,
      streamer: streamer,
      car: car,
      model: model,
      camera: ChaseCamera(footprints),
    );
    game._buildGround();
    game.drive();
    await streamer.preload(car.x, car.z);
    await streamer.warmUp(world.warmUp);
    return game;
  }

  void _buildGround() {
    final ground = PhysicallyBasedMaterial()
      ..baseColorFactor = vm.Vector4(.30, .30, .28, 1)
      ..roughnessFactor = .95
      ..metallicFactor = 0;
    scene.add(
      Node(
        name: 'Ground',
        // Below the baked streets (roads sit at y = 0), so it only shows
        // past the edge of the city and never z-fights a road.
        localTransform: vm.Matrix4.translationValues(0, -.4, 0),
        mesh: Mesh(PlaneGeometry(width: 4000, depth: 4000), ground),
      ),
    );
  }

  void park(String name) {
    final park = parks[name]!;
    final eye = vm.Vector3(park.eye.$1, park.eye.$2, park.eye.$3);
    final target = vm.Vector3(park.target.$1, park.target.$2, park.target.$3);
    final view = target - eye;
    if (park.carAhead > 0) {
      final flat = vm.Vector2(view.x, view.z)..normalize();
      car.place(
        eye.x + flat.x * park.carAhead,
        eye.z + flat.y * park.carAhead,
        math.atan2(view.x, view.z),
      );
    }
    model.update(car);
    world.look(eye, target);
    controls.releaseAll();
    parked = name;
  }

  /// A free debug park: the camera at [eye] looking at [target].
  void lookAt(vm.Vector3 eye, vm.Vector3 target) {
    world.look(eye, target);
    parked = 'custom';
  }

  /// Moves the car (and the chase camera) to a pose and resumes driving.
  void teleport(double x, double z, double heading) {
    car.place(x, z, heading);
    drive();
  }

  /// Leaves any park and resumes live play from wherever the car is.
  void drive() {
    parked = null;
    controls.releaseAll();
    camera.snap(car);
    _applyCamera();
    model.update(car);
  }

  void _applyCamera() {
    world.look(
      vm.Vector3(camera.eyeX, camera.eyeY, camera.eyeZ),
      vm.Vector3(camera.targetX, camera.targetY, camera.targetZ),
    );
  }

  /// Whether [name] is parked and its surroundings are streamed in.
  bool isParked(String name) => parked == name && streamer.settled;

  /// The input the car saw on the last tick (for audio).
  CarInput lastInput = CarInput.idle;

  void tick(double dt) {
    if (parked != null) {
      final eye = world.camera.position;
      streamer.update(eye.x, eye.z);
      return;
    }
    lastInput = controls.resolve(dt);
    car.step(dt, lastInput);
    camera.update(dt, car);
    _applyCamera();
    model.update(car);
    streamer.update(car.x, car.z);
  }
}
