// Fetches the OpenStreetMap snapshot the city generator reads.
//
//   fvm dart tool/fetch_osm.dart [--mirror]
//
// Run once; the result is committed under data/osm/ and the generators read
// only that file, never the network, so every rerun is deterministic. It
// covers the FULL centre box (phase 6), not just the phase-1 core, so growing
// the city never needs a refetch.
//
// overpass-api.de answers 406 to a request without a User-Agent, so one is
// sent. `--mirror` uses overpass.kumi.systems instead.
library;

import 'dart:convert';
import 'dart:io';

/// The full centre box: from the main railway station and the Lenuci
/// horseshoe up to Gornji grad, and from Frankopanska to Draškovićeva.
const south = 45.803, west = 15.962, north = 45.818, east = 15.988;

const query =
    '''
[out:json][timeout:240][bbox:$south,$west,$north,$east];
(
  way["building"];
  relation["building"];
  way["building:part"];
  relation["building:part"];
  way["highway"];
  way["railway"];
  way["area:highway"];
  nwr["place"="square"];
  way["leisure"];
  relation["leisure"];
  way["landuse"];
  relation["landuse"];
  way["natural"];
  relation["natural"];
  node["natural"="tree"];
  way["water"];
  way["waterway"];
  nwr["historic"];
  nwr["amenity"="fountain"];
  nwr["amenity"="place_of_worship"];
  way["amenity"="parking"];
  nwr["tourism"~"artwork|attraction|museum"];
  node["wikidata"];
  way["man_made"];
  way["barrier"];
  node["barrier"~"bollard|kerb"];
  node["highway"~"street_lamp|traffic_signals"];
);
out body;
>;
out skel qt;
''';

Future<void> main(List<String> args) async {
  final host = args.contains('--mirror')
      ? 'https://overpass.kumi.systems/api/interpreter'
      : 'https://overpass-api.de/api/interpreter';
  final client = HttpClient()..userAgent = 'ZagrebDrive/0.1 (pet project)';
  stdout.writeln('Querying $host ...');
  final request = await client.postUrl(Uri.parse(host));
  request.headers
    ..set('User-Agent', 'ZagrebDrive/0.1 (pet project)')
    ..contentType = ContentType('application', 'x-www-form-urlencoded');
  request.write('data=${Uri.encodeQueryComponent(query)}');
  final response = await request.close();
  final body = await response.transform(utf8.decoder).join();
  client.close();
  if (response.statusCode != 200) {
    stderr.writeln('HTTP ${response.statusCode}: $body');
    exit(1);
  }
  final decoded = jsonDecode(body) as Map<String, dynamic>;
  final elements = (decoded['elements'] as List).cast<Map<String, dynamic>>();
  // Sort for a stable, diffable snapshot: Overpass does not promise order.
  int rank(String type) => const {'node': 0, 'way': 1, 'relation': 2}[type]!;
  elements.sort((a, b) {
    final byType = rank(a['type'] as String) - rank(b['type'] as String);
    return byType != 0 ? byType : (a['id'] as int).compareTo(b['id'] as int);
  });
  // Merge duplicates (a node can arrive once with tags and once as a bare
  // skeleton); keep the richest copy.
  final merged = <String, Map<String, dynamic>>{};
  for (final element in elements) {
    final key = '${element['type']}/${element['id']}';
    final existing = merged[key];
    if (existing == null || (element['tags'] != null && existing['tags'] == null)) {
      merged[key] = element;
    }
  }
  final snapshot = {
    'generator': decoded['generator'],
    'osm3s': decoded['osm3s'],
    'bbox': [south, west, north, east],
    'elements': merged.values.toList(),
  };
  final out = File('data/osm/zagreb_centre.json')
    ..parent.createSync(recursive: true);
  // One element per line keeps the committed snapshot diffable.
  final buffer = StringBuffer('{\n');
  buffer.writeln('"generator": ${jsonEncode(snapshot['generator'])},');
  buffer.writeln('"osm3s": ${jsonEncode(snapshot['osm3s'])},');
  buffer.writeln('"bbox": ${jsonEncode(snapshot['bbox'])},');
  buffer.writeln('"elements": [');
  final list = snapshot['elements'] as List;
  for (var i = 0; i < list.length; i++) {
    buffer.write(jsonEncode(list[i]));
    buffer.writeln(i == list.length - 1 ? '' : ',');
  }
  buffer.writeln(']\n}');
  out.writeAsStringSync(buffer.toString());
  final counts = <String, int>{};
  for (final element in list) {
    final type = (element as Map)['type'] as String;
    counts[type] = (counts[type] ?? 0) + 1;
  }
  stdout.writeln('Wrote ${out.path}: $counts');
}
