import 'package:flutter/material.dart';
import 'package:flutter_scene/scene.dart';
import 'package:vector_math/vector_math.dart' as vm;

import '../debug/scene_probe.dart';
import '../scene/drive_game.dart';

/// The full-screen game: the scene plus (later) the controls and HUD.
class DriveView extends StatefulWidget {
  const DriveView({super.key, required this.game});

  final DriveGame game;

  @override
  State<DriveView> createState() => _DriveViewState();
}

class _DriveViewState extends State<DriveView> {
  DriveGame get game => widget.game;

  @override
  void initState() {
    super.initState();
    // Attach here, not in the loader: only a mounted game should answer.
    SceneProbe.attach(game.scene);
    SceneProbe.registerStates('zagreb', {
      for (final name in DriveGame.parks.keys)
        name: GameState(
          enter: () => game.park(name),
          ready: () => game.parked == name,
        ),
      'driving': GameState(enter: game.drive, ready: () => game.parked == null),
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
  void dispose() {
    SceneProbe.unregisterStates('zagreb');
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: const Color(0xFF0E1116),
      child: SceneView(
        key: const ValueKey('drive_scene'),
        game.scene,
        camera: game.world.camera,
        onTick: (_, dt) => game.tick(dt),
      ),
    );
  }
}
