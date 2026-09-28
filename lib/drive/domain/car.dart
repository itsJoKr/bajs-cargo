/// The car: a deterministic arcade bicycle model on the ground height field,
/// colliding with building footprints. Pure Dart, no Flutter GPU.
///
/// Adapted from Doomscrool's `RampRun` (Sky Drop): the same fixed 1/120 s
/// step, the same eased front-wheel angle, and the same sprung body (pitch
/// from acceleration, roll from cornering, a vertical spring that kerbs
/// compress). Generalised from "distance along a course" to free 2D driving:
/// position (x east, z north), heading clockwise from north, signed speed
/// along the heading.
library;

import 'dart:math' as math;

import 'collision.dart';
import 'terrain.dart';

/// Driver input, each in its range: steer -1 (left) .. 1 (right), throttle
/// and brake 0 .. 1. Brake held at a standstill reverses.
class CarInput {
  const CarInput({this.steer = 0, this.throttle = 0, this.brake = 0});
  final double steer, throttle, brake;
  static const idle = CarInput();
}

class Car {
  Car({
    required this.ground,
    required this.footprints,
    this.x = 0,
    this.z = 0,
    this.heading = 0,
  }) {
    _settle();
  }

  final Ground ground;
  final Footprints footprints;

  static const physicsStep = 1 / 120;

  /// Wheel contacts around the body origin (the car's centre at road
  /// level), matching the Car Concept model: 1.6 m track, 2.6 m wheelbase.
  static const halfTrack = .8, halfWheelbase = 1.3;
  static const wheelbase = halfWheelbase * 2;

  /// The body's footprint for collision: three circles along its length,
  /// inside the 2.0 x 4.3 m body.
  static const collisionRadius = .98;
  static const collisionOffsets = [-1.2, 0.0, 1.2];

  /// Top speed forwards and in reverse, m/s (about 100 and 25 km/h).
  static const topSpeed = 28.0, reverseSpeed = 7.0;

  /// Front wheel lock at a standstill; it narrows with speed.
  static const maxWheelAngle = .58;

  /// Tyre grip: the most lateral acceleration a turn can ask for (m/s^2).
  static const grip = 8.5;
  static const droopTravel = .1, bumpTravel = .08;
  static const wheelCorners = [
    (-1.0, 1.0), // front left
    (1.0, 1.0), // front right
    (-1.0, -1.0), // rear left
    (1.0, -1.0), // rear right
  ];

  double x, z, heading;

  /// Ground-contact height under the body centre.
  double y = 0;
  double speed = 0, yawRate = 0, elapsed = 0;

  /// Front wheel steering angle in radians; positive turns right.
  double wheelAngle = 0;

  /// How far the wheels have rolled, in radians of wheel rotation.
  double wheelSpin = 0;
  static const wheelRadius = .36;

  /// Body attitude: pitch raises the nose, roll raises the right side.
  double pitch = 0, roll = 0;
  double groundPitch = 0, groundRoll = 0;
  double _pitchRate = 0, _rollRate = 0;
  double suspensionOffset = 0, _suspensionVelocity = 0;
  final wheelDrop = List<double>.filled(4, 0);
  final _wheelGround = List<double>.filled(4, 0);

  /// Wall contacts: how many, and how hard the last one was (m/s into the
  /// wall), so audio and the camera can react to the physics itself.
  int wallHits = 0;
  double lastWallImpact = 0;
  bool touchingWall = false;

  double _pending = 0;

  double get forwardX => math.sin(heading);
  double get forwardZ => math.cos(heading);
  double get rightX => math.cos(heading);
  double get rightZ => -math.sin(heading);

  /// Speed in km/h, for the HUD.
  double get kmh => speed * 3.6;

  /// Moves the car to a pose and zeroes its motion (spawn, debug parks).
  void place(double px, double pz, double h) {
    x = px;
    z = pz;
    heading = h;
    speed = yawRate = wheelAngle = 0;
    _pitchRate = _rollRate = _suspensionVelocity = suspensionOffset = 0;
    _pending = 0;
    _resolveWalls(countHits: false, dt: 0);
    _settle();
  }

  void _settle() {
    _measureGround();
    y = _groundHeight;
    pitch = groundPitch;
    roll = groundRoll;
    for (var i = 0; i < 4; i++) {
      wheelDrop[i] = 0;
    }
  }

  void step(double dt, CarInput input) {
    if (!dt.isFinite || dt <= 0) return;
    // Resuming from the background must not replay the suspended time.
    _pending = math.min(_pending + dt, .25);
    while (_pending + 1e-10 >= physicsStep) {
      _pending -= physicsStep;
      _advance(physicsStep, input);
    }
  }

  void _advance(double dt, CarInput input) {
    elapsed += dt;
    final lastSpeed = speed, lastY = y, lastYVelocity = _yVelocity;
    final steer = input.steer.clamp(-1.0, 1.0);
    final throttle = input.throttle.clamp(0.0, 1.0);
    final brake = input.brake.clamp(0.0, 1.0);

    // Longitudinal: engine pull falls off toward top speed; the brake
    // stops the car, then reverses it once it is (nearly) stopped.
    var accel = 0.0;
    if (throttle > 0) {
      if (speed >= -.3) {
        final f = (speed / topSpeed).clamp(0.0, 1.0);
        accel += throttle * 7.2 * (1 - f * f);
      } else {
        accel += throttle * 11;
      }
    }
    if (brake > 0) {
      if (speed > .3) {
        accel -= brake * 11;
      } else if (speed > -reverseSpeed) {
        accel -= brake * 4.5 * (1 - (-speed / reverseSpeed).clamp(0.0, 1.0));
      }
    }
    // Rolling resistance and air drag.
    accel -= speed.sign * (.35 + .0042 * speed * speed);
    final before = speed;
    speed += accel * dt;
    // Drag never reverses the car on its own.
    if (throttle == 0 && brake == 0 && before.sign != speed.sign) speed = 0;
    if (throttle == 0 && brake == 0 && speed.abs() < .05) speed = 0;

    // Steering: the lock narrows with speed and the wheels ease toward it.
    final lock = maxWheelAngle / (1 + speed.abs() / 11);
    wheelAngle += (steer * lock - wheelAngle) * math.min(1.0, dt * 9);
    var targetYaw = speed * math.tan(wheelAngle) / wheelbase;
    // Grip: past it the car understeers rather than turning tighter.
    final lateral = (speed * targetYaw).abs();
    if (lateral > grip) targetYaw *= grip / lateral;
    yawRate += (targetYaw - yawRate) * math.min(1.0, dt * 12);
    heading += yawRate * dt;
    if (heading > math.pi) heading -= 2 * math.pi;
    if (heading < -math.pi) heading += 2 * math.pi;

    x += forwardX * speed * dt;
    z += forwardZ * speed * dt;
    _resolveWalls(countHits: true, dt: dt);
    wheelSpin += speed * dt / wheelRadius;

    _measureGround();
    y = _groundHeight;
    _yVelocity = (y - lastY) / dt;
    _suspend(
      dt,
      forwardAcceleration: (speed - lastSpeed) / dt,
      lateralAcceleration: speed * yawRate,
      contactAcceleration: (_yVelocity - lastYVelocity) / dt,
    );
  }

  double _yVelocity = 0;

  /// Pushes the body's circles out of every footprint, then removes the
  /// part of the velocity that points into the wall: head-on stops the car,
  /// a glancing hit swings the nose along the wall and slides, losing speed
  /// to scraping.
  void _resolveWalls({required bool countHits, required double dt}) {
    var hitAny = false;
    var nx = 0.0, nz = 0.0;
    for (var iteration = 0; iteration < 3; iteration++) {
      var moved = false;
      for (final offset in collisionOffsets) {
        final cx = x + forwardX * offset, cz = z + forwardZ * offset;
        final push = footprints.pushOut(cx, cz, collisionRadius);
        if (!push.hit) continue;
        x += push.x - cx;
        z += push.z - cz;
        nx += push.nx;
        nz += push.nz;
        hitAny = moved = true;
      }
      if (!moved) break;
    }
    touchingWall = hitAny;
    if (!hitAny) return;
    final l = math.sqrt(nx * nx + nz * nz);
    if (l < 1e-9) return;
    nx /= l;
    nz /= l;
    final vx = forwardX * speed, vz = forwardZ * speed;
    final into = vx * nx + vz * nz;
    if (into >= 0) return;
    if (countHits && -into > 1.5) {
      wallHits++;
      lastWallImpact = -into;
    }
    // Keep only the tangential part.
    final tx = vx - nx * into, tz = vz - nz * into;
    final tangential = math.sqrt(tx * tx + tz * tz);
    speed = tx * forwardX + tz * forwardZ;
    if (tangential > .2 && dt > 0) {
      // Swing the nose toward the direction of the slide (backwards when
      // reversing), so the car runs along the wall instead of grinding.
      final sign = speed >= 0 ? 1.0 : -1.0;
      var d = math.atan2(tx * sign, tz * sign) - heading;
      while (d > math.pi) {
        d -= 2 * math.pi;
      }
      while (d < -math.pi) {
        d += 2 * math.pi;
      }
      heading += d * math.min(1.0, dt * 10);
      yawRate *= .5;
      // Scraping along the wall costs speed steadily.
      speed -= sign * math.min(speed.abs(), 3.5 * dt);
    }
  }

  double _groundHeight = 0;

  /// Samples the ground under each wheel and fits the body's plane to it.
  void _measureGround() {
    for (var i = 0; i < 4; i++) {
      final (side, end) = wheelCorners[i];
      final wx = x + rightX * side * halfTrack + forwardX * end * halfWheelbase;
      final wz = z + rightZ * side * halfTrack + forwardZ * end * halfWheelbase;
      _wheelGround[i] = ground.heightAt(wx, wz);
    }
    final fl = _wheelGround[0], fr = _wheelGround[1];
    final rl = _wheelGround[2], rr = _wheelGround[3];
    groundPitch = math.atan((fl + fr - rl - rr) / (4 * halfWheelbase));
    groundRoll = math.atan((fr + rr - fl - rl) / (4 * halfTrack));
    _groundHeight = (fl + fr + rl + rr) / 4;
  }

  void _suspend(
    double dt, {
    required double forwardAcceleration,
    required double lateralAcceleration,
    required double contactAcceleration,
  }) {
    // Weight transfer: the nose lifts under power and dips under braking;
    // the body leans out of a turn. Constants from Sky Drop's RampRun.
    final targetPitch =
        groundPitch + forwardAcceleration.clamp(-12.0, 12.0) * .003;
    final targetRoll =
        groundRoll + lateralAcceleration.clamp(-10.0, 10.0) * .0035;
    _pitchRate += (240 * (targetPitch - pitch) - 20 * _pitchRate) * dt;
    _rollRate += (300 * (targetRoll - roll) - 22 * _rollRate) * dt;
    pitch += _pitchRate * dt;
    roll += _rollRate * dt;
    // A kerb pushes the wheels up into the body.
    _suspensionVelocity -= contactAcceleration.clamp(-400.0, 400.0) * .3 * dt;
    _suspensionVelocity +=
        (-180 * suspensionOffset - 20 * _suspensionVelocity) * dt;
    suspensionOffset = (suspensionOffset + _suspensionVelocity * dt).clamp(
      -.12,
      .06,
    );
    for (var i = 0; i < 4; i++) {
      final (side, end) = wheelCorners[i];
      // How far the wheel's mount sits above its patch of ground.
      final plane =
          _groundHeight +
          end * halfWheelbase * math.tan(groundPitch) +
          side * halfTrack * math.tan(groundRoll);
      final gap =
          suspensionOffset +
          end * halfWheelbase * math.sin(pitch - groundPitch) +
          side * halfTrack * math.sin(roll - groundRoll) +
          (plane - _wheelGround[i]);
      final target = gap.clamp(-bumpTravel, droopTravel);
      wheelDrop[i] += (target - wheelDrop[i]) * math.min(1.0, dt * 40);
    }
  }
}
