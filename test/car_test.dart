import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:zagreb_drive/drive/domain/car.dart';
import 'package:zagreb_drive/drive/domain/chase_camera.dart';
import 'package:zagreb_drive/drive/domain/collision.dart';
import 'package:zagreb_drive/drive/domain/terrain.dart';

/// An axis-aligned building from (x0, z0) to (x1, z1), counter-clockwise.
List<List<(double, double)>> box(double x0, double z0, double x1, double z1) =>
    [
      [(x0, z0), (x1, z0), (x1, z1), (x0, z1)],
    ];

ByteData bytes(String path) =>
    ByteData.sublistView(File(path).readAsBytesSync());

bool anyCircleInside(Car car, Footprints f) {
  for (final offset in Car.collisionOffsets) {
    if (f.contains(car.x + car.forwardX * offset, car.z + car.forwardZ * offset)) {
      return true;
    }
  }
  return false;
}

void main() {
  group('Car on a flat plane', () {
    test('accelerates toward top speed and brakes to a stop', () {
      final car = Car(ground: Ground.flat(), footprints: Footprints.empty());
      for (var i = 0; i < 120 * 20; i++) {
        car.step(1 / 60, const CarInput(throttle: 1));
      }
      expect(car.speed, greaterThan(Car.topSpeed * .8));
      expect(car.speed, lessThanOrEqualTo(Car.topSpeed));
      expect(car.z, greaterThan(200));
      for (var i = 0; i < 60 * 6; i++) {
        car.step(1 / 60, const CarInput(brake: 1));
        if (car.speed <= 0) break;
      }
      expect(car.speed, lessThanOrEqualTo(.3));
    });

    test('steering right turns the heading clockwise (toward east)', () {
      final car = Car(ground: Ground.flat(), footprints: Footprints.empty());
      for (var i = 0; i < 60 * 3; i++) {
        car.step(1 / 60, const CarInput(throttle: .6, steer: 1));
      }
      expect(car.heading, greaterThan(.3));
      expect(car.x, greaterThan(0));
      // The body leans out of the turn: the outside (left) side dips, so
      // the right side rises and roll is positive.
      expect(car.roll, greaterThan(0));
    });

    test('holding the brake at a standstill reverses slowly', () {
      final car = Car(ground: Ground.flat(), footprints: Footprints.empty());
      for (var i = 0; i < 60 * 5; i++) {
        car.step(1 / 60, const CarInput(brake: 1));
      }
      expect(car.speed, lessThan(0));
      expect(car.speed, greaterThanOrEqualTo(-Car.reverseSpeed));
    });
  });

  group('Walls', () {
    test('the car stops at a wall it drives straight into', () {
      final walls = Footprints.fromPolygons([box(-30, 30, 30, 50)]);
      final car = Car(ground: Ground.flat(), footprints: walls);
      for (var i = 0; i < 60 * 8; i++) {
        car.step(1 / 60, const CarInput(throttle: 1));
      }
      expect(car.speed.abs(), lessThan(.5));
      // The front circle rests against the wall face at z = 30.
      final front = car.z + Car.collisionOffsets.last;
      expect(front, lessThanOrEqualTo(30 - Car.collisionRadius + .01));
      expect(front, greaterThan(30 - Car.collisionRadius - .3));
      expect(anyCircleInside(car, walls), isFalse);
      expect(car.wallHits, greaterThan(0));
    });

    test('a glancing hit slides along the wall and loses some speed', () {
      // A long wall along x = 12, the car heading 20 degrees east of north.
      final walls = Footprints.fromPolygons([box(12, -200, 40, 400)]);
      final car = Car(
        ground: Ground.flat(),
        footprints: walls,
        heading: 20 * math.pi / 180,
      );
      double? speedAtContact;
      for (var i = 0; i < 60 * 12; i++) {
        car.step(1 / 60, const CarInput(throttle: 1));
        if (car.touchingWall && speedAtContact == null) {
          speedAtContact = car.speed;
        }
      }
      expect(speedAtContact, isNotNull);
      // Still moving north along the wall, not stopped.
      expect(car.speed, greaterThan(3));
      expect(car.z, greaterThan(60));
      expect(car.x, lessThanOrEqualTo(12 - Car.collisionRadius + .05));
      expect(anyCircleInside(car, walls), isFalse);
    });
  });

  group('The baked city', () {
    final footprints = Footprints.fromBytes(bytes('assets/data/collision.bin'));
    final ground = Ground(
      HeightGrid.fromBytes(bytes('assets/data/terrain.bin')),
      RoadMask.fromBytes(bytes('assets/data/roadmask.bin')),
    );

    test('loads every footprint', () {
      expect(footprints.polygonCount, greaterThan(500));
    });

    test('never ends up inside a footprint over thousands of random steps',
        () {
      final random = math.Random(2609);
      var steps = 0, hits = 0;
      for (var run = 0; run < 24; run++) {
        // Spawn somewhere open in the core.
        double sx, sz;
        do {
          sx = -300 + random.nextDouble() * 600;
          sz = -300 + random.nextDouble() * 600;
        } while (footprints.contains(sx, sz) ||
            footprints.pushOut(sx, sz, 3).hit);
        final car = Car(
          ground: ground,
          footprints: footprints,
          x: sx,
          z: sz,
          heading: random.nextDouble() * 2 * math.pi,
        );
        var input = const CarInput();
        for (var i = 0; i < 1500; i++) {
          if (i % 45 == 0) {
            input = CarInput(
              steer: random.nextDouble() * 2 - 1,
              throttle: random.nextDouble() < .8 ? random.nextDouble() : 0,
              brake: random.nextDouble() < .2 ? random.nextDouble() : 0,
            );
          }
          car.step(1 / 60, input);
          steps++;
          expect(
            anyCircleInside(car, footprints),
            isFalse,
            reason: 'run $run step $i at (${car.x}, ${car.z})',
          );
          expect(car.x.isFinite && car.z.isFinite && car.y.isFinite, isTrue);
        }
        hits += car.wallHits;
      }
      expect(steps, 24 * 1500);
      // The random drives really did test the walls.
      expect(hits, greaterThan(10));
    });

    test('terrain height is continuous across chunk borders', () {
      const chunk = 200.0;
      for (var k = -2; k <= 2; k++) {
        for (var s = -400.0; s <= 400; s += 7.3) {
          final border = k * chunk;
          // Across a north-south border (x = const) and an east-west one.
          expect(
            (ground.terrainAt(border - 1e-3, s) -
                    ground.terrainAt(border + 1e-3, s))
                .abs(),
            lessThan(1e-3),
          );
          expect(
            (ground.terrainAt(s, border - 1e-3) -
                    ground.terrainAt(s, border + 1e-3))
                .abs(),
            lessThan(1e-3),
          );
        }
      }
    });

    test('the kerb puts sidewalks 15 cm above the road', () {
      // The statue stands on the square (kerb level); Praška's carriageway
      // south of the square is road level somewhere along x = 30.
      expect(ground.roads.isRoad(13, 17), isFalse);
      var foundRoad = false;
      for (var z = -300.0; z < 300; z += .5) {
        if (ground.roads.isRoad(30, z)) foundRoad = true;
      }
      expect(foundRoad, isTrue);
    });
  });

  group('Chase camera', () {
    test('pulls in when a building stands between it and the car', () {
      // The car faces north with a building right behind it.
      final walls = Footprints.fromPolygons([box(-20, -12, 20, -3.5)]);
      final car = Car(ground: Ground.flat(), footprints: walls);
      final camera = ChaseCamera(walls)..snap(car);
      final back = math.sqrt(
        math.pow(camera.eyeX - car.x, 2) + math.pow(camera.eyeZ - car.z, 2),
      );
      expect(back, lessThan(3.5));
      expect(walls.contains(camera.eyeX, camera.eyeZ), isFalse);
    });

    test('rests behind the car in the open', () {
      final car = Car(ground: Ground.flat(), footprints: Footprints.empty());
      final camera = ChaseCamera(Footprints.empty())..snap(car);
      expect(camera.eyeZ, closeTo(-ChaseCamera.distance, 1e-9));
      expect(camera.targetZ, greaterThan(0));
    });
  });
}
