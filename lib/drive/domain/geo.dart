/// The one geo -> local conversion every generator, tool and runtime query
/// uses. Pure Dart (no Flutter), so `tool/` scripts import it too.
///
/// Local frame (see AGENTS.md "Coordinates"): metres in a tangent plane
/// whose origin is the Ban Jelačić statue. `x` is east, `y` is up, `z` is
/// north. flutter_scene's world is left-handed (a camera looking along +z
/// has +x on its right), so a driver facing north sees east on the right:
/// x = east, z = north renders unmirrored.
library;

import 'dart:math' as math;

/// The Ban Jelačić statue on Trg bana Jelačića.
const originLatitude = 45.81303, originLongitude = 15.97713;

/// Metres per degree of latitude and of longitude at the origin (WGS84
/// series). Over the 2 km centre box the flat-plane error is far below a
/// metre, so a single scale per axis is enough.
final double metresPerDegreeLatitude = _metresPerDegreeLatitude(
  originLatitude,
);
final double metresPerDegreeLongitude = _metresPerDegreeLongitude(
  originLatitude,
);

double _metresPerDegreeLatitude(double latitude) {
  final phi = latitude * math.pi / 180;
  return 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi);
}

double _metresPerDegreeLongitude(double latitude) {
  final phi = latitude * math.pi / 180;
  return 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi);
}

/// A point in the local plane: [x] east and [z] north, in metres.
typedef LocalPoint = ({double x, double z});

/// Projects WGS84 degrees to the local plane.
LocalPoint geoToLocal(double latitude, double longitude) => (
  x: (longitude - originLongitude) * metresPerDegreeLongitude,
  z: (latitude - originLatitude) * metresPerDegreeLatitude,
);

/// The inverse of [geoToLocal].
({double latitude, double longitude}) localToGeo(double x, double z) => (
  latitude: originLatitude + z / metresPerDegreeLatitude,
  longitude: originLongitude + x / metresPerDegreeLongitude,
);
