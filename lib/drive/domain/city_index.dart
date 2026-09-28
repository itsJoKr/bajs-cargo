/// The baked chunk list (`assets/data/city_index.json`, written by
/// `tool/generate_zagreb.dart`). Pure Dart.
library;

import 'dart:math' as math;

class ChunkInfo {
  const ChunkInfo({
    required this.name,
    required this.minX,
    required this.minZ,
    required this.size,
  });

  final String name;
  final double minX, minZ, size;

  /// The source path `loadScene` resolves.
  String get path => 'assets/city/$name.fscene';

  /// Distance in the ground plane from (x, z) to this chunk's square; zero
  /// inside it.
  double distanceTo(double x, double z) {
    final dx = math.max(0.0, math.max(minX - x, x - (minX + size)));
    final dz = math.max(0.0, math.max(minZ - z, z - (minZ + size)));
    return math.sqrt(dx * dx + dz * dz);
  }
}

class CityIndex {
  const CityIndex(this.chunkSize, this.chunks);

  factory CityIndex.fromJson(Map<String, Object?> json) => CityIndex(
    (json['chunkSize'] as num).toDouble(),
    [
      for (final c in (json['chunks'] as List).cast<Map<String, Object?>>())
        ChunkInfo(
          name: c['name'] as String,
          minX: (c['minX'] as num).toDouble(),
          minZ: (c['minZ'] as num).toDouble(),
          size: (c['size'] as num).toDouble(),
        ),
    ],
  );

  final double chunkSize;
  final List<ChunkInfo> chunks;
}
