/// Ground height queries for the simulation. Pure Dart.
///
/// Reads `assets/data/terrain.bin` (`ZDTR`) and `assets/data/roadmask.bin`
/// (`ZDRM`), both written by `tool/generate_zagreb.dart`
/// (`tool/src/runtime_data.dart` documents the layouts).
library;

import 'dart:math' as math;
import 'dart:typed_data';

/// Everything that is not carriageway (sidewalks, squares, parks) sits this
/// far above the road.
const kerbHeight = .15;

void _expectMagic(ByteData data, String magic) {
  final found = String.fromCharCodes([
    for (var i = 0; i < 4; i++) data.getUint8(i),
  ]);
  if (found != magic) {
    throw FormatException('Expected $magic data, found "$found"');
  }
}

/// A regular grid of terrain heights, sampled bilinearly. One global grid,
/// so the height is continuous across chunk borders by construction.
class HeightGrid {
  HeightGrid(
    this.originX,
    this.originZ,
    this.cell,
    this.columns,
    this.rows,
    this.heights,
  );

  /// A flat grid of zeros covering nothing in particular.
  factory HeightGrid.flat() =>
      HeightGrid(0, 0, 1000, 2, 2, Float32List.fromList([0, 0, 0, 0]));

  factory HeightGrid.fromBytes(ByteData data) {
    _expectMagic(data, 'ZDTR');
    final originX = data.getFloat32(8, Endian.little);
    final originZ = data.getFloat32(12, Endian.little);
    final cell = data.getFloat32(16, Endian.little);
    final columns = data.getUint32(20, Endian.little);
    final rows = data.getUint32(24, Endian.little);
    final heights = Float32List(columns * rows);
    for (var i = 0; i < heights.length; i++) {
      heights[i] = data.getFloat32(28 + i * 4, Endian.little);
    }
    return HeightGrid(originX, originZ, cell, columns, rows, heights);
  }

  final double originX, originZ, cell;
  final int columns, rows;
  final Float32List heights;

  double at(double x, double z) {
    final fx = ((x - originX) / cell).clamp(0.0, columns - 1.000001);
    final fz = ((z - originZ) / cell).clamp(0.0, rows - 1.000001);
    final c = fx.floor(), r = fz.floor();
    final tx = fx - c, tz = fz - r;
    double h(int cc, int rr) => heights[rr * columns + cc];
    final c1 = math.min(c + 1, columns - 1), r1 = math.min(r + 1, rows - 1);
    return (h(c, r) * (1 - tx) + h(c1, r) * tx) * (1 - tz) +
        (h(c, r1) * (1 - tx) + h(c1, r1) * tx) * tz;
  }
}

/// Which half-metre cells are carriageway.
class RoadMask {
  RoadMask(this.originX, this.originZ, this.cell, this.columns, this.rows,
      this.bits);

  factory RoadMask.none() => RoadMask(0, 0, 1, 0, 0, Uint8List(0));

  factory RoadMask.fromBytes(ByteData data) {
    _expectMagic(data, 'ZDRM');
    final columns = data.getUint32(20, Endian.little);
    final rows = data.getUint32(24, Endian.little);
    return RoadMask(
      data.getFloat32(8, Endian.little),
      data.getFloat32(12, Endian.little),
      data.getFloat32(16, Endian.little),
      columns,
      rows,
      Uint8List.sublistView(data, 28, 28 + (columns * rows + 7) ~/ 8),
    );
  }

  final double originX, originZ, cell;
  final int columns, rows;
  final Uint8List bits;

  /// True on the carriageway. Outside the baked extent everything is road
  /// level (the flat plane past the edge of the city).
  bool isRoad(double x, double z) {
    final c = ((x - originX) / cell).floor();
    final r = ((z - originZ) / cell).floor();
    if (c < 0 || r < 0 || c >= columns || r >= rows) return true;
    final index = r * columns + c;
    return bits[index >> 3] & (1 << (index & 7)) != 0;
  }
}

/// The drivable surface: terrain plus the kerb step off the carriageway.
class Ground {
  Ground(this.terrain, this.roads);

  factory Ground.flat() => Ground(HeightGrid.flat(), RoadMask.none());

  final HeightGrid terrain;
  final RoadMask roads;

  double terrainAt(double x, double z) => terrain.at(x, z);

  double heightAt(double x, double z) =>
      terrain.at(x, z) + (roads.isRoad(x, z) ? 0 : kerbHeight);
}
