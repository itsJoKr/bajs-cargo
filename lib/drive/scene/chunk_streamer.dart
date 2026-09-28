import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_scene/scene.dart';

import '../domain/city_index.dart';
import 'city_materials.dart';

/// Keeps the baked chunks near a focus point in the scene.
///
/// - within [viewRadius] of the focus: loaded and visible;
/// - within [loadRadius]: loaded (hidden past [viewRadius]), so a chunk is
///   ready before it comes into view;
/// - past [releaseRadius]: removed from the scene and its template released.
///
/// The render graph therefore holds only the chunks around the car, however
/// far it drives (the flat-with-distance rule in the rules file). Loads run
/// one at a time so a burst of new chunks never stalls a frame for long.
class ChunkStreamer {
  ChunkStreamer(
    this.scene,
    this.index,
    this.materials, {
    this.viewRadius = 460,
    this.loadRadius = 540,
    this.releaseRadius = 700,
  });

  final Scene scene;
  final CityIndex index;
  final CityMaterials materials;
  final double viewRadius, loadRadius, releaseRadius;

  final Map<String, Node> _loaded = {};
  final Set<String> _loading = {};
  double _x = 0, _z = 0;
  bool _pumping = false;

  int get loadedCount => _loaded.length;
  int get visibleCount => _loaded.values.where((n) => n.visible).length;

  /// True when every chunk within [loadRadius] of the focus is loaded.
  bool get settled =>
      _loading.isEmpty &&
      index.chunks
          .where((c) => c.distanceTo(_x, _z) <= loadRadius)
          .every((c) => _loaded.containsKey(c.name));

  /// Loads everything around ([x], [z]) and waits for it: for the loading
  /// screen, before warm-up.
  Future<void> preload(double x, double z) async {
    _x = x;
    _z = z;
    for (final chunk in _wanted()) {
      await _load(chunk);
    }
    _apply();
  }

  /// Moves the focus; call every frame. Visibility changes at once, loads
  /// and releases happen in the background.
  void update(double x, double z) {
    _x = x;
    _z = z;
    _apply();
    if (!_pumping) unawaited(_pump());
  }

  Iterable<ChunkInfo> _wanted() {
    final wanted = index.chunks
        .where((c) => c.distanceTo(_x, _z) <= loadRadius)
        .toList();
    wanted.sort(
      (a, b) => a.distanceTo(_x, _z).compareTo(b.distanceTo(_x, _z)),
    );
    return wanted;
  }

  Future<void> _pump() async {
    _pumping = true;
    try {
      while (true) {
        final next = _wanted()
            .where((c) => !_loaded.containsKey(c.name))
            .firstOrNull;
        if (next == null) break;
        await _load(next);
        _apply();
      }
    } finally {
      _pumping = false;
    }
  }

  Future<void> _load(ChunkInfo chunk) async {
    if (_loaded.containsKey(chunk.name) || !_loading.add(chunk.name)) return;
    try {
      final node = await loadScene(chunk.path);
      materials.adopt(node);
      node.name = chunk.name;
      _loaded[chunk.name] = node;
      scene.add(node);
    } catch (error) {
      debugPrint('Chunk ${chunk.name} failed to load: $error');
    } finally {
      _loading.remove(chunk.name);
    }
  }

  void _apply() {
    for (final chunk in index.chunks) {
      final node = _loaded[chunk.name];
      if (node == null) continue;
      final d = chunk.distanceTo(_x, _z);
      if (d > releaseRadius) {
        scene.remove(node);
        _loaded.remove(chunk.name);
        unawaited(releaseScene(chunk.path));
        continue;
      }
      node.visible = d <= viewRadius;
    }
  }

  /// Makes every loaded chunk visible (for `Scene.warmUp`, which never
  /// compiles a hidden node's material), then restores the real state.
  Future<void> warmUp(Future<void> Function() warm) async {
    for (final node in _loaded.values) {
      node.visible = true;
    }
    await warm();
    _apply();
  }
}
