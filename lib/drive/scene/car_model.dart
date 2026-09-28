import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter_scene/scene.dart';
import 'package:vector_math/vector_math.dart' as vm;

import '../domain/car.dart';

/// The Car Concept model (Khronos, CC BY 4.0) posed from a [Car].
///
/// Ported from Doomscrool's `RampScene`: the model's own shadow casting is
/// replaced by three invisible shapes (its ~200k triangles in 109 parts
/// otherwise dominate every shadow cascade), and each wheel node follows
/// its suspension travel, the steering and, here, the rolling spin.
class CarModel {
  CarModel._(this.root);

  /// Carries the simulation pose: position at road level, heading, pitch
  /// and roll.
  final Node root;
  final List<_Wheel> _wheels = [];

  static Future<CarModel> load() async {
    final model = await loadScene('assets/models/car-concept.glb');
    // loadScene of the .glb is already in metres (Doomscrool's 45.9x scale
    // belonged to its editor import); the model faces -z, so it is turned
    // half round to face the car's +z forward.
    final placed = Node(
      name: 'Car Concept',
      localTransform: vm.Matrix4.rotationY(math.pi),
    )..add(model);
    final root = Node(name: 'Car')..add(placed);
    // Stand it on its tyres and centre it over the body origin.
    final bounds = root.combinedLocalBounds;
    if (bounds != null) {
      final c = (bounds.min + bounds.max) * .5;
      placed.localTransform = vm.Matrix4.translationValues(
        -c.x,
        -bounds.min.y,
        -c.z,
      )..multiply(placed.localTransform);
      debugPrint(
        'Car model bounds: ${(bounds.max - bounds.min).storage.map((v) => v.toStringAsFixed(2)).toList()} m',
      );
    }
    final car = CarModel._(root);
    // Wheels are measured before merging: the merge moves their geometry
    // into new child nodes, which leaves the wheel nodes' cached bounds
    // stale.
    car._mountWheels();
    final before = root.meshNodes.length;
    car._mergeRigidParts();
    debugPrint(
      'Car model: $before mesh nodes merged into ${root.meshNodes.length}',
    );
    car._castShadowFromShapes();
    return car;
  }

  static const _wheelNames = [
    'WheelFrontL',
    'WheelFrontR',
    'WheelRearL',
    'WheelRearR',
  ];

  /// The model arrives as 109 mesh parts, one draw each, which alone blew
  /// the city's colour-pass budget. The body is rigid and each wheel is
  /// rigid, so each of those five groups is merged into one primitive per
  /// material, in the group's own frame (a wheel still turns as a node).
  void _mergeRigidParts() {
    final wheels = [
      for (final name in _wheelNames) root.getChildByName(name),
    ].whereType<Node>().toSet();

    void merge(Node group) {
      final toGroup = vm.Matrix4.inverted(group.globalTransform);
      final buckets = <Material, List<MeshData>>{};
      final order = <Material>[];
      final emptied = <Node>[];
      void walk(Node node) {
        if (node != group && wheels.contains(node)) return;
        final mesh = node.mesh;
        if (mesh != null && node.skin == null) {
          final keep = <MeshPrimitive>[];
          for (final primitive in mesh.primitives) {
            final geometry = primitive.geometry;
            if (!geometry.isReadable) {
              keep.add(primitive);
              continue;
            }
            final data = geometry.extractMeshData().transformed(
              toGroup.multiplied(node.globalTransform),
            );
            if (!buckets.containsKey(primitive.material)) {
              order.add(primitive.material);
            }
            (buckets[primitive.material] ??= []).add(data);
          }
          if (keep.isEmpty) {
            emptied.add(node);
          } else {
            node.mesh = Mesh.primitives(primitives: keep);
          }
        }
        for (final child in node.children.toList()) {
          walk(child);
        }
      }

      walk(group);
      if (order.isEmpty) return;
      for (final node in emptied) {
        node.mesh = null;
      }
      final primitives = <MeshPrimitive>[];
      for (final material in order) {
        // Parts can differ in which attributes they carry; merge the ones
        // that match and keep the rest as their own primitive.
        final bySignature = <String, List<MeshData>>{};
        for (final data in buckets[material]!) {
          final signature = [
            data.normals != null,
            data.texCoords != null,
            data.texCoords1 != null,
            data.colors != null,
            data.tangents != null,
            data.primitiveType,
          ].join();
          (bySignature[signature] ??= []).add(data);
        }
        for (final parts in bySignature.values) {
          primitives.add(
            MeshPrimitive(
              MeshGeometry.fromMeshData(MeshData.merge(parts)),
              material,
            ),
          );
        }
      }
      group.add(
        Node(
          name: '${group.name} merged',
          mesh: Mesh.primitives(primitives: primitives),
        )..shadowCastingMode = ShadowCastingMode.off,
      );
    }

    for (final wheel in wheels) {
      merge(wheel);
    }
    merge(root);
  }

  void _castShadowFromShapes() {
    final bounds = root.combinedLocalBounds;
    if (bounds == null) return;
    for (final node in root.meshNodes) {
      node.shadowCastingMode = ShadowCastingMode.off;
    }
    final size = bounds.max - bounds.min;
    final center = (bounds.min + bounds.max) * .5;
    void caster(
      Geometry geometry,
      double bottom,
      double top,
      double width,
      double length,
    ) {
      final y = bounds.min.y + size.y * (bottom + top) / 2;
      root.add(
        Node(
          name: 'Car shadow',
          localTransform: vm.Matrix4.compose(
            vm.Vector3(center.x, y, center.z),
            vm.Quaternion.identity(),
            vm.Vector3(size.x * width, size.y * (top - bottom), size.z * length),
          ),
          mesh: Mesh(geometry, UnlitMaterial()),
        )..shadowCastingMode = ShadowCastingMode.shadowsOnly,
      );
    }

    final cube = CuboidGeometry(vm.Vector3.all(1));
    final ball = SphereGeometry(radius: .5, segments: 16, rings: 8);
    caster(cube, .18, .55, .86, .8);
    caster(ball, .15, .6, .98, 1);
    caster(ball, .45, .98, .82, .62);
  }

  void _mountWheels() {
    final toCar = vm.Matrix4.inverted(root.globalTransform);
    for (final name in const [
      'WheelFrontL',
      'WheelFrontR',
      'WheelRearL',
      'WheelRearR',
    ]) {
      final wheel = root.getChildByName(name);
      final parent = wheel?.parent;
      final bounds = wheel?.combinedLocalBounds;
      if (wheel == null || parent == null || bounds == null) {
        debugPrint('Car wheel "$name" not found; it will ride with the body');
        continue;
      }
      final center = toCar
          .multiplied(wheel.globalTransform)
          .transformed3(bounds.center);
      // Car-local +x is the car's right.
      final corner = Car.wheelCorners.indexWhere(
        (c) => c.$1 == center.x.sign && c.$2 == center.z.sign,
      );
      if (corner < 0) continue;
      final parentToCar = toCar.multiplied(parent.globalTransform);
      final carToParent = vm.Matrix4.inverted(parentToCar);
      final down = carToParent.rotated3(vm.Vector3(0, -1, 0));
      final before = carToParent.multiplied(vm.Matrix4.translation(center));
      final after = vm.Matrix4.translation(-center).multiplied(parentToCar);
      // The model's front wheels are authored turned; measure that from the
      // axle (a wheel's thinnest extent) so steering replaces it.
      final size = bounds.max - bounds.min;
      final axle = size.x <= size.y && size.x <= size.z
          ? vm.Vector3(1, 0, 0)
          : size.y <= size.z
          ? vm.Vector3(0, 1, 0)
          : vm.Vector3(0, 0, 1);
      toCar.multiplied(wheel.globalTransform).rotate3(axle);
      if (axle.x < 0) axle.negate();
      final authored = Car.wheelCorners[corner].$2 > 0
          ? math.atan2(-axle.z, axle.x)
          : 0.0;
      _wheels.add(
        _Wheel(
          wheel,
          corner,
          down,
          (steer, spin) => before
              .multiplied(vm.Matrix4.rotationY(steer - authored))
              .multiplied(vm.Matrix4.rotationX(spin))
              .multiplied(after),
        ),
      );
    }
  }

  void update(Car car) {
    root.position = vm.Vector3(car.x, car.y + car.suspensionOffset, car.z);
    root.rotation =
        vm.Quaternion.axisAngle(vm.Vector3(0, 1, 0), car.heading) *
        vm.Quaternion.axisAngle(vm.Vector3(1, 0, 0), -car.pitch) *
        vm.Quaternion.axisAngle(vm.Vector3(0, 0, 1), car.roll);
    for (final wheel in _wheels) {
      final front = Car.wheelCorners[wheel.corner].$2 > 0;
      final pose = vm.Matrix4.translation(
        wheel.down * car.wheelDrop[wheel.corner],
      )..multiply(wheel.turn(front ? car.wheelAngle : 0, car.wheelSpin));
      wheel.node.localTransform = pose..multiply(wheel.rest);
    }
  }
}

typedef _Turn = vm.Matrix4 Function(double steer, double spin);

class _Wheel {
  _Wheel(this.node, this.corner, this.down, this.turn)
    : rest = node.localTransform.clone();
  final Node node;
  final int corner;
  final vm.Vector3 down;
  final _Turn turn;
  final vm.Matrix4 rest;
}
