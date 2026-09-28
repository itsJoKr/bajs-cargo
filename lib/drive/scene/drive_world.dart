import 'dart:math' as math;

import 'package:flutter_scene/scene.dart';
import 'package:vector_math/vector_math.dart' as vm;

/// The scene graph shell: sky, sun, lighting look and the camera. City
/// chunks, the car and everything else hang off [scene] from the systems
/// that own them; this class only owns what every view shares.
class DriveWorld {
  final scene = Scene();

  /// A 0.5 m near plane keeps depth precision for roofs a kilometre away
  /// (Doomscrool saw distant roofs flicker at 0.1 m), and a landscape phone
  /// wants a slightly wider vertical field of view than a portrait one.
  final camera = PerspectiveCamera(
    fovRadiansY: 55 * vm.degrees2Radians,
    fovNear: .5,
    fovFar: 2600,
    position: vm.Vector3(0, 30, -120),
    target: vm.Vector3(0, 0, 0),
  );

  /// Late-afternoon sun from the south-west, so north-facing street walls
  /// (most of the square's south side) are not all in shadow and east-west
  /// streets like Ilica get raking light.
  static final sunDirection = vm.Vector3(-.45, .62, -.64)..normalize();

  late final PhysicalSkySource sky;

  Future<void> initialize() async {
    await Scene.initializeStaticResources();
    sky = PhysicalSkySource(
      sunDirection: sunDirection.clone(),
      turbidity: 3.5,
      rayleighCoefficient: 2.6,
    );
    // EnvironmentSettings also carries environment, skybox and sunLight, so
    // assigning it clears them: set the look first, then the sky.
    scene.environmentSettings = EnvironmentSettings(
      toneMapping: ToneMappingMode.aces,
      // The physical sky reads 1.2-2.0 in linear HDR and sunlit ground about
      // the same; at exposure 1 ACES washed both out to near white.
      exposure: .26,
      environmentIntensity: .5,
      ambientOcclusionEnabled: true,
      ambientOcclusionIntensity: .8,
      ambientOcclusionHalfResolution: true,
      fogEnabled: true,
      fogMode: FogMode.exponential,
      fogColor: vm.Vector3(.62, .70, .80),
      fogDensity: .0011,
      colorGradingEnabled: true,
      contrast: 1.05,
      saturation: 1.05,
      vignetteEnabled: true,
      vignetteIntensity: .18,
    );
    scene.skybox = Skybox(sky);
    scene.environment = EnvironmentMap.fromSky(sky);
    scene.sunLight = SunLight(
      sky,
      castsShadow: true,
      intensityScale: 1.05,
      shadowMaxDistance: 220,
      shadowCascadeCount: 3,
      shadowMapResolution: 2048,
      shadowDepthBias: .05,
      shadowNormalBias: .18,
    );
  }

  /// Points the camera from [eye] at [target], both in local metres.
  void look(vm.Vector3 eye, vm.Vector3 target) {
    camera.position = eye;
    camera.target = target;
  }

  /// A camera orbiting [target] at [distance] metres, [heading] radians
  /// clockwise from north (0 looks north), [pitch] radians above horizontal.
  void orbit(
    vm.Vector3 target, {
    required double heading,
    required double pitch,
    required double distance,
  }) {
    final back = vm.Vector3(
      -math.sin(heading) * math.cos(pitch),
      math.sin(pitch),
      -math.cos(heading) * math.cos(pitch),
    );
    look(target + back * distance, target);
  }

  /// Compiles every pipeline in the scene, including meshes out of view, so
  /// no later frame stalls. Blocks the UI thread for a moment on a phone;
  /// call it behind a static loading screen.
  Future<void> warmUp() async {
    await scene.warmUp([RenderView(camera: camera)], includeOffscreen: true);
  }
}
