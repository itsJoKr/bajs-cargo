/// Merges the touch controls and the keyboard into one [CarInput]. Pure
/// Dart: widgets write into it, the game tick reads [resolve].
library;

import 'car.dart';

class DriveControls {
  /// Touch: the steering stick (-1..1) and the two pedals (0..1).
  double stickSteer = 0, gasPedal = 0, brakePedal = 0;

  /// Keyboard (WASD / arrows): held keys.
  bool keyLeft = false, keyRight = false, keyGas = false, keyBrake = false;

  double _keySteer = 0;

  /// Keys ramp the steering in and out over about a quarter second, the
  /// way a thumb on the stick would, so a tap does not jerk the car.
  CarInput resolve(double dt) {
    final want = (keyRight ? 1.0 : 0.0) - (keyLeft ? 1.0 : 0.0);
    final rate = want == 0 ? 6.0 : 4.0;
    final delta = want - _keySteer;
    final stepSize = rate * dt;
    _keySteer += delta.abs() <= stepSize ? delta : delta.sign * stepSize;
    final steer = stickSteer != 0 ? stickSteer : _keySteer;
    return CarInput(
      steer: steer.clamp(-1.0, 1.0),
      throttle: keyGas ? 1.0 : gasPedal,
      brake: keyBrake ? 1.0 : brakePedal,
    );
  }

  void releaseAll() {
    stickSteer = gasPedal = brakePedal = _keySteer = 0;
    keyLeft = keyRight = keyGas = keyBrake = false;
  }
}
