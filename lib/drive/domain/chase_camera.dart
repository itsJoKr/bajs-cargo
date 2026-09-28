/// The chase camera rig: where the eye sits behind the car and what it looks
/// at, smoothed, and pulled in whenever a building would come between it
/// and the car. Pure Dart; the scene layer copies [eye] and [target] onto
/// the PerspectiveCamera.
library;

import 'dart:math' as math;

import 'car.dart';
import 'collision.dart';

class ChaseCamera {
  ChaseCamera(this.footprints);

  final Footprints footprints;

  /// Resting offset: this far behind the car, this high above the road.
  static const distance = 6.6, height = 2.5;

  /// The eye never gets closer than this to the car when pulling in.
  static const minDistance = 1.4;

  /// How far ahead of the car (and how high) the camera aims.
  static const lookAhead = 3.5, lookHeight = 1.15;

  double eyeX = 0, eyeY = 0, eyeZ = 0;
  double targetX = 0, targetY = 0, targetZ = 0;
  double _heading = 0, _reach = distance;
  bool _primed = false;

  /// Snaps the rig to its resting pose behind [car] (spawn, parks).
  void snap(Car car) {
    _primed = false;
    update(0, car);
  }

  void update(double dt, Car car) {
    if (!_primed) {
      _heading = car.heading;
      _reach = distance;
    } else {
      // The camera swings round after the car, a little behind it.
      var d = car.heading - _heading;
      while (d > math.pi) {
        d -= 2 * math.pi;
      }
      while (d < -math.pi) {
        d += 2 * math.pi;
      }
      _heading += d * math.min(1.0, dt * 4.5);
    }
    final bx = -math.sin(_heading), bz = -math.cos(_heading);
    final pivotX = car.x, pivotZ = car.z;

    // Pull in at once when a footprint blocks the line from the car to the
    // resting eye; ease back out when it clears.
    var reach = distance;
    final hit = footprints.raycast(
      pivotX,
      pivotZ,
      pivotX + bx * (distance + .6),
      pivotZ + bz * (distance + .6),
    );
    if (hit != null) {
      reach = math.max(minDistance, hit * (distance + .6) - .6);
    }
    if (!_primed || reach < _reach) {
      _reach = reach;
    } else {
      _reach += (reach - _reach) * math.min(1.0, dt * 2.5);
    }

    final wantX = pivotX + bx * _reach;
    final wantZ = pivotZ + bz * _reach;
    final wantY = car.y + height * (.55 + .45 * _reach / distance);
    final aimX = car.x + car.forwardX * lookAhead;
    final aimZ = car.z + car.forwardZ * lookAhead;
    final aimY = car.y + lookHeight;
    if (!_primed) {
      eyeX = wantX;
      eyeY = wantY;
      eyeZ = wantZ;
      targetX = aimX;
      targetY = aimY;
      targetZ = aimZ;
      _primed = true;
      return;
    }
    final k = math.min(1.0, dt * 9);
    eyeX += (wantX - eyeX) * k;
    eyeY += (wantY - eyeY) * k;
    eyeZ += (wantZ - eyeZ) * k;
    // Smoothing must never carry the eye back behind a wall it was pulled
    // in front of: if the smoothed eye is blocked, use the unsmoothed one.
    if (footprints.raycast(pivotX, pivotZ, eyeX, eyeZ) != null) {
      eyeX = wantX;
      eyeZ = wantZ;
    }
    final t = math.min(1.0, dt * 12);
    targetX += (aimX - targetX) * t;
    targetY += (aimY - targetY) * t;
    targetZ += (aimZ - targetZ) * t;
  }
}
