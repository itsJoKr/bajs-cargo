import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_scene/scene.dart';
import 'package:vector_math/vector_math.dart' as vm;

import '../audio/engine_audio.dart';
import '../debug/scene_probe.dart';
import '../domain/car.dart';
import '../scene/drive_game.dart';
import 'pedals.dart';
import 'steering_stick.dart';

/// The full-screen game: the scene, the touch controls (stick on the left,
/// pedals on the right), the keyboard, the speedometer and engine sound.
class DriveView extends StatefulWidget {
  const DriveView({super.key, required this.game});

  final DriveGame game;

  @override
  State<DriveView> createState() => _DriveViewState();
}

class _DriveViewState extends State<DriveView> with WidgetsBindingObserver {
  DriveGame get game => widget.game;
  final _speed = ValueNotifier<int>(0);
  late final EngineAudio _engine = EngineAudio();
  final _focus = FocusNode(debugLabel: 'drive');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Attach here, not in the loader: only a mounted game should answer.
    SceneProbe.attach(game.scene);
    SceneProbe.registerStates('zagreb', {
      for (final name in DriveGame.parks.keys)
        name: GameState(
          enter: () => game.park(name),
          ready: () => game.isParked(name),
        ),
      'driving': GameState(
        enter: game.drive,
        ready: () => game.parked == null && game.streamer.settled,
      ),
    });
    _registerCommands();
  }

  /// Debug commands for `tool/probe.dart command --name ...`.
  void _registerCommands() {
    double arg(Map<String, String> a, String key, double fallback) =>
        double.tryParse(a[key] ?? '') ?? fallback;
    // Parks the camera anywhere: eye (ex, ey, ez) looking at (tx, ty, tz).
    SceneProbe.registerCommand('look', (a) async {
      game.lookAt(
        vm.Vector3(arg(a, 'ex', 0), arg(a, 'ey', 2), arg(a, 'ez', 0)),
        vm.Vector3(arg(a, 'tx', 0), arg(a, 'ty', 2), arg(a, 'tz', 50)),
      );
      return {'parked': game.parked};
    });
    // Puts the car at (x, z) facing heading (degrees clockwise from north)
    // and resumes driving.
    SceneProbe.registerCommand('teleport', (a) async {
      game.teleport(
        arg(a, 'x', 0),
        arg(a, 'z', 0),
        arg(a, 'heading', 0) * vm.degrees2Radians,
      );
      return {'x': game.car.x, 'z': game.car.z};
    });
    // Holds driver input: steer, throttle, brake (0 releases).
    SceneProbe.registerCommand('input', (a) async {
      final c = game.controls;
      c.stickSteer = arg(a, 'steer', 0);
      c.gasPedal = arg(a, 'throttle', 0);
      c.brakePedal = arg(a, 'brake', 0);
      return {'speed': game.car.speed, 'heading': game.car.heading};
    });
    SceneProbe.registerCommand('car', (a) async {
      final car = game.car;
      return {
        'x': car.x,
        'z': car.z,
        'y': car.y,
        'heading': car.heading,
        'speed': car.speed,
        'wallHits': car.wallHits,
      };
    });
    // Live look tuning without a rebuild.
    SceneProbe.registerCommand('tune', (a) async {
      final scene = game.scene;
      if (a['exposure'] != null) scene.exposure = arg(a, 'exposure', 1);
      if (a['env'] != null) scene.environmentIntensity = arg(a, 'env', 1);
      if (a['fog'] != null) scene.fog.density = arg(a, 'fog', .001);
      return {
        'exposure': scene.exposure,
        'env': scene.environmentIntensity,
        'fog': scene.fog.density,
      };
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) {
      game.controls.releaseAll();
      _engine.mute();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    SceneProbe.unregisterStates('zagreb');
    _engine.dispose();
    _speed.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _tick(double dt) {
    game.tick(dt);
    final car = game.car;
    _speed.value = car.kmh.abs().round();
    if (game.parked != null) {
      _engine.mute();
    } else {
      _engine.update(
        speedFraction: (car.speed.abs() / Car.topSpeed).clamp(0.0, 1.0),
        throttle: game.lastInput.throttle,
      );
    }
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    final down = event is! KeyUpEvent;
    final c = game.controls;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.keyW || key == LogicalKeyboardKey.arrowUp) {
      c.keyGas = down;
    } else if (key == LogicalKeyboardKey.keyS ||
        key == LogicalKeyboardKey.arrowDown) {
      c.keyBrake = down;
    } else if (key == LogicalKeyboardKey.keyA ||
        key == LogicalKeyboardKey.arrowLeft) {
      c.keyLeft = down;
    } else if (key == LogicalKeyboardKey.keyD ||
        key == LogicalKeyboardKey.arrowRight) {
      c.keyRight = down;
    } else {
      return KeyEventResult.ignored;
    }
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      focusNode: _focus,
      autofocus: true,
      onKeyEvent: _onKey,
      child: ColoredBox(
        color: const Color(0xFF0E1116),
        child: Stack(
          fit: StackFit.expand,
          children: [
            SceneView(
              key: const ValueKey('drive_scene'),
              game.scene,
              camera: game.world.camera,
              onTick: (_, dt) => _tick(dt),
            ),
            Positioned(
              left: 12,
              bottom: 8,
              child: SteeringStick(
                onSteer: (value) => game.controls.stickSteer = value,
              ),
            ),
            Positioned(
              right: 16,
              bottom: 16,
              child: Pedals(
                onGas: (value) => game.controls.gasPedal = value,
                onBrake: (value) => game.controls.brakePedal = value,
              ),
            ),
            Positioned(
              left: 20,
              top: 14,
              child: ValueListenableBuilder<int>(
                valueListenable: _speed,
                builder: (context, kmh, _) => _Speedometer(kmh: kmh),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Speedometer extends StatelessWidget {
  const _Speedometer({required this.kmh});
  final int kmh;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      key: const ValueKey('speedometer'),
      decoration: BoxDecoration(
        color: const Color(0x66101418),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            Text(
              '$kmh',
              style: const TextStyle(
                color: Color(0xFFF4EBDD),
                fontSize: 26,
                fontWeight: FontWeight.w800,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(width: 4),
            const Text(
              'km/h',
              style: TextStyle(color: Color(0xAAF4EBDD), fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}
