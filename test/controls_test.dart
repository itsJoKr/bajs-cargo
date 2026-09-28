import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zagreb_drive/drive/domain/controls.dart';
import 'package:zagreb_drive/drive/widgets/pedals.dart';
import 'package:zagreb_drive/drive/widgets/steering_stick.dart';

void main() {
  test('keyboard steering ramps in and back out', () {
    final c = DriveControls()..keyRight = true;
    expect(c.resolve(.1).steer, closeTo(.4, 1e-9));
    for (var i = 0; i < 10; i++) {
      c.resolve(.1);
    }
    expect(c.resolve(.1).steer, 1);
    c.keyRight = false;
    expect(c.resolve(.1).steer, closeTo(.4, 1e-9));
  });

  test('the touch stick wins over the keyboard, and keys win pedals', () {
    final c = DriveControls()
      ..keyLeft = true
      ..stickSteer = .5
      ..gasPedal = .3
      ..keyGas = true;
    final input = c.resolve(1 / 60);
    expect(input.steer, .5);
    expect(input.throttle, 1);
  });

  testWidgets('pedals report held and released', (tester) async {
    double gas = 0, brake = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: Pedals(onGas: (v) => gas = v, onBrake: (v) => brake = v),
          ),
        ),
      ),
    );
    final press = await tester.startGesture(
      tester.getCenter(find.byKey(const ValueKey('pedal_gas'))),
    );
    await tester.pump();
    expect(gas, 1);
    expect(brake, 0);
    await press.up();
    await tester.pump();
    expect(gas, 0);
  });

  testWidgets('the steering stick steers right when pushed right', (
    tester,
  ) async {
    double steer = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(child: SteeringStick(onSteer: (v) => steer = v)),
        ),
      ),
    );
    final stick = find.byKey(const ValueKey('steering_stick'));
    final gesture = await tester.startGesture(tester.getCenter(stick));
    await gesture.moveBy(const Offset(60, 0));
    await tester.pump();
    expect(steer, greaterThan(.9));
    await gesture.up();
    await tester.pump();
    expect(steer, 0);
  });
}
