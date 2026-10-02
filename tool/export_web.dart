// Bakes central Zagreb for the three.js game in web3d/: one glTF binary with
// the buildings, roofs, streets, props and Street View facades, plus the
// JSON the game reads alongside it.
//
//   fvm dart tool/export_web.dart [--extent minX,minZ,maxX,maxZ] [--flat]
//
// Reads only data/ (never the network), so reruns are byte identical. The
// ground follows the terrain from data/terrain/ground.json
// (tool/prepare_terrain.py; --flat turns it off). Walls without a real
// facade are plain stucco; data/hero/coverage.json lists which are done.
//
// The pipeline frame is x east, y up, z north; three.js is right-handed, so
// the export mirrors z: web x = east, y = up, z = SOUTH (north is -z). Each
// triangle's winding is then chosen so its geometric normal agrees with the
// vertex normal, i.e. counter-clockwise from the front, as three.js expects.
//
// Writes:
//   web3d/public/city/zagreb.glb   one node per 200 m chunk and material
//                                  (facade, roof, ground, rails), props,
//                                  glass and the lamp (web3d/src/trees.ts
//                                  builds the trees);
//   web3d/public/city/city.json    extent, chunks, trees, lamps, café
//                                  tables (web3d/src/furniture.ts), trams,
//                                  place names, coverage, features, walls;
//   web3d/public/city/terrain.json, far.json   copies of data/terrain/;
//   data/hero/coverage.json        real-facade coverage per street wall.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:vector_math/vector_math.dart';

import 'src/buildings.dart';
import 'src/city.dart';
import 'src/facades.dart';
import 'src/mesh_writer.dart';
import 'src/geom.dart' show OrientedBox, centroid;
import 'src/geom.dart' as geom show orientedBox;
import 'src/ground.dart';
import 'src/hero.dart';
import 'src/levels.dart';
import 'src/osm.dart';
import 'src/passages.dart';
import 'src/props.dart';
import 'src/roofs.dart';
import 'src/street_props.dart';
import 'src/terrain_grid.dart';
import 'src/walk.dart';

const chunkSize = 200.0;

String chunkName(int i, int j) =>
    'chunk_${i < 0 ? 'w${-i}' : 'e$i'}_${j < 0 ? 's${-j}' : 'n$j'}';

double r2(double v) => (v * 100).roundToDouble() / 100;

void main(List<String> args) {
  final watch = Stopwatch()..start();
  var extent = coreExtent;
  final at = args.indexOf('--extent');
  if (at >= 0) {
    final v = args[at + 1].split(',').map(double.parse).toList();
    extent = Extent(v[0], v[1], v[2], v[3]);
  }
  final osm = OsmData.load('data/osm/zagreb_centre.json');
  // Hand-made corrections per building (the recreate-building skill):
  // OSM tag overrides (roof shape and height, levels...), the roof
  // covering, and 3D features on or in front of its walls.
  final buildingsFile = File('data/buildings.json');
  final overrides = buildingsFile.existsSync()
      ? (jsonDecode(buildingsFile.readAsStringSync()) as Map<String, dynamic>)
      : <String, dynamic>{};
  for (final MapEntry(key: id, value: entry) in overrides.entries) {
    if (id.startsWith('_')) continue;
    final tags = (entry as Map)['tags'] as Map?;
    if (tags == null) continue;
    final n = int.parse(id.substring(1).split('_').first);
    final target = id.startsWith('w') ? osm.ways[n]?.tags : osm.relations[n]?.tags;
    if (target == null) {
      stderr.writeln('data/buildings.json: no OSM element $id');
      exit(1);
    }
    target.addAll(tags.cast<String, String>());
  }
  // `omit`: a building the game models by hand (the Cathedral, web3d/src/cathedral.ts). Its outline
  // and every building:part whose centre lies inside it are left out of the city; `landmark` places
  // the game's model ({name, origin [x, z] tool frame, heading deg}, ground from the terrain).
  final landmarkSpecs = <Map>[];
  for (final MapEntry(key: id, value: entry) in overrides.entries) {
    if (id.startsWith('_') || entry is! Map || entry['omit'] != true) continue;
    final way = osm.ways[int.parse(id.substring(1))]!;
    final ring = osm.points(way);
    bool inside(Vector2 p) {
      var odd = false;
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        final a = ring[i], b = ring[j];
        if ((a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x)) odd = !odd;
      }
      return odd;
    }
    var parts = 0;
    for (final w in osm.ways.values) {
      if (w.tags['building:part'] == null) continue;
      final pts = osm.points(w);
      if (pts.isEmpty || !inside(centroid(pts))) continue;
      w.tags.remove('building:part');
      parts++;
    }
    way.tags.remove('building');
    stdout.writeln('Omitted $id and $parts parts (modelled in the game)');
    if (entry['landmark'] is Map) landmarkSpecs.add(entry['landmark'] as Map);
  }
  final styles = FacadeStyles.load('data/facade_styles.json');
  final hero = HeroAtlas.load('data/hero/atlas.json');
  final roofs = File('data/roofs.json').existsSync()
      ? RoofStyles.load('data/roofs.json')
      : null;
  for (final MapEntry(key: id, value: entry) in overrides.entries) {
    final cover = entry is Map ? entry['roof'] as String? : null;
    if (cover != null) roofs?.overrides[id] = cover;
  }
  // Walls without a real facade are plain light stucco (linear #D8D4CC):
  // no invented windows, so the photographed buildings are the only real
  // facades and the rest reads as still to do.
  final plainWalls = Vector4(.686, .658, .604, 1);
  final city = City(
    osm,
    extent,
    heroEaves: hero.eaves,
    separateSmallStructures: true,
  )..build();
  final ground = Ground(osm, city)..build();
  final flat = args.contains('--flat');
  final grid = flat ? null : TerrainGrid.load('data/terrain/ground.json');
  double bare(Vector2 p) => grid == null ? 0 : grid(p);
  // Hand-shaped levels (data/levels.json: Dolac's plateau, its stairs, the
  // rise to Opatovina) replace the grid inside their outlines. Props, walls
  // and trees stand on them and on the terraces.
  final levels = Levels.load('data/levels.json', (p) => bare(p) + ground.liftAt(p));
  ground.levels = levels;
  double terrain(Vector2 p) => levels.heightAt(p);

  final chunks = <(int, int), BuildingMeshes>{};
  for (var j = (extent.minZ / chunkSize).floor();
      j * chunkSize < extent.maxZ;
      j++) {
    for (var i = (extent.minX / chunkSize).floor();
        i * chunkSize < extent.maxX;
        i++) {
      chunks[(i, j)] = BuildingMeshes();
    }
  }
  // A building stands at its street: its ground is the lowest point along
  // its street-facing walls (the centre when it has none), so on a slope
  // the back goes into the hill instead of the whole block being lifted
  // and showing tall blank party walls.
  double streetGround(Building b) {
    if (grid == null) return 0;
    var low = double.infinity;
    var i = 0;
    for (final (a, c) in b.polygon.edges) {
      if (i < b.walls.length && b.walls[i] == WallKind.street) {
        for (final t in const [0.0, .5, 1.0]) {
          low = math.min(low, terrain(a + (c - a) * t));
        }
      }
      i++;
    }
    return low.isFinite ? low : terrain(b.center);
  }

  // The lowest terrain (levels included) under an outline, as
  // TerrainGrid.lowest does for the grid.
  double lowest(Polygon polygon) {
    var low = double.infinity;
    final ring = polygon.outer;
    for (var i = 0; i < ring.length; i++) {
      low = math.min(low, math.min(terrain(ring[i]), terrain((ring[i] + ring[(i + 1) % ring.length]) * .5)));
    }
    return low;
  }

  // Covered passages (data/passages.json): a doorway in every wall they
  // cross; the game builds the inside.
  final passages = Passages.load('data/passages.json', (p) => terrain(p) + kerbHeight)
    ..buildings = [for (final b in city.buildings) b.polygon];
  final doorways = <String>[];
  for (final b in city.buildings) {
    if (passages.isEmpty) break;
    var e = 0;
    for (final (a, c) in b.polygon.edges) {
      final holes = passages.openings(a, c);
      if (holes.isNotEmpty) {
        final len = a.distanceTo(c);
        doorways.add('${b.id}_e$e ${[for (final (t0, t1, _) in holes) '${(t0 * len).toStringAsFixed(1)}-${(t1 * len).toStringAsFixed(1)}/${len.toStringAsFixed(1)} m'].join(', ')}');
      }
      e++;
    }
  }
  if (doorways.isNotEmpty) stdout.writeln('Passage doorways:\n  ${doorways.join('\n  ')}');
  // Back walls that wear the courtyard style's repeating rows instead of plain stucco.
  final rearFile = File('data/rear_walls.json');
  final rearWalls = <String>{
    if (rearFile.existsSync())
      ...((jsonDecode(rearFile.readAsStringSync()) as Map)['walls'] as List).cast<String>(),
  };
  // Firewalls in weathered plaster (tile 49) in their own linear tint, and walls laid out in a
  // generic style: they replaced hero pictures (plaster `fw_`, `fill_`) to cut the download
  // (tool/shared_walls.py).
  Map<String, dynamic> wallMap(String path) => File(path).existsSync()
      ? (jsonDecode(File(path).readAsStringSync()) as Map)['walls'] as Map<String, dynamic>
      : const {};
  final plasterWalls = <String, Vector4>{
    for (final MapEntry(key: id, value: c) in wallMap('data/plaster_walls.json').entries)
      id: Vector4((c[0] as num).toDouble(), (c[1] as num).toDouble(), (c[2] as num).toDouble(), 1),
  };
  final genericWalls = wallMap('data/generic_walls.json').cast<String, String>();
  for (final name in genericWalls.values.toSet()) {
    if (!styles.styles.containsKey(name)) throw StateError('data/generic_walls.json: unknown style $name');
  }
  // Colonnades (data/arcades.json): walls that start above the ground, with a soffit under them.
  final arcadeFile = File('data/arcades.json');
  final arcades = <String, Arcade>{};
  if (arcadeFile.existsSync()) {
    final j = jsonDecode(arcadeFile.readAsStringSync()) as Map<String, dynamic>;
    for (final e in (j['arcades'] as Map<String, dynamic>).entries) {
      final v = e.value as Map<String, dynamic>;
      double n(Object? x) => (x as num).toDouble();
      final arch = v['arches'] as Map<String, dynamic>?;
      arcades[e.key] = Arcade(
        arches: arch == null
            ? null
            : Arches(
                (arch['edge'] as num).toInt(),
                [for (final o in (arch['openings'] as List).cast<List>()) (n(o[0]), n(o[1]))],
                n(arch['crown']),
                walk: (n(arch['walk'][0]), n(arch['walk'][1])),
                depth: n(arch['depth'] ?? 3),
                thick: n(arch['thick'] ?? .7),
                riser: n(arch['riser'] ?? .15),
                soffitColor: arch['soffitColor'] == null
                    ? null
                    : Vector4(n(arch['soffitColor'][0]), n(arch['soffitColor'][1]), n(arch['soffitColor'][2]), 1),
              ),
        {for (final i in (v['edges'] as List)) (i as num).toInt()},
        (v['base'] as num).toDouble(),
        [for (final p in (v['soffit'] as List).cast<List>()) Vector2((p[0] as num).toDouble(), (p[1] as num).toDouble())],
        spans: {
          for (final s in ((v['spans'] ?? const <String, dynamic>{}) as Map<String, dynamic>).entries)
            int.parse(s.key): ((s.value[0] as num).toDouble(), (s.value[1] as num).toDouble()),
        },
      );
    }
  }
  // `roofWings` (data/buildings.json): one roof per wing of a building whose single box roof
  // fits none of them (the archbishop's palace, an L with round corner towers). Each wing is
  // the rectangle of its `corners` (tool x, z); RoofModel takes the highest wing.
  final roofWings = <String, List<OrientedBox>>{
    for (final MapEntry(key: id, value: entry) in overrides.entries)
      if (entry is Map && entry['roofWings'] is List)
        id: [
          for (final wing in (entry['roofWings'] as List).cast<Map>())
            geom.orientedBox([
              for (final p in (wing['corners'] as List).cast<List>())
                Vector2((p[0] as num).toDouble(), (p[1] as num).toDouble()),
            ]),
        ],
  };
  for (final b in city.buildings) {
    final c = b.center;
    final key = ((c.x / chunkSize).floor(), (c.y / chunkSize).floor());
    emitBuilding(
      openings: passages.isEmpty ? null : passages.openings,
      b,
      chunks.putIfAbsent(key, BuildingMeshes.new),
      ground: streetGround(b),
      foot: grid == null ? null : math.min(grid.lowest(b.polygon), lowest(b.polygon)),
      terrain: grid == null ? null : terrain,
      plainWalls: plainWalls,
      rearWalls: rearWalls,
      plasterWalls: plasterWalls,
      genericWalls: genericWalls,
      arcade: arcades[b.id],
      roofWings: roofWings[b.id] ?? const [],
      roofCover: roofs?.pick(b),
      styles: styles,
      hero: hero,
    );
  }

  final glb = GlbWriter();
  final keys = chunks.keys.toList()
    ..sort((a, b) => a.$2 != b.$2 ? a.$2.compareTo(b.$2) : a.$1.compareTo(b.$1));
  final chunkList = <Map<String, Object?>>[];
  for (final key in keys) {
    final (i, j) = key;
    final name = chunkName(i, j);
    final minX = i * chunkSize, minZ = j * chunkSize;
    final surface = MeshWriter(), rails = MeshWriter();
    final steps = MeshWriter(), ramps = MeshWriter();
    final gx0 = math.max(minX, extent.minX), gz0 = math.max(minZ, extent.minZ);
    final gx1 = math.min(minX + chunkSize, extent.maxX);
    final gz1 = math.min(minZ + chunkSize, extent.maxZ);
    if (gx1 > gx0 && gz1 > gz0) {
      ground.emitGround(gx0, gz0, gx1, gz1, minX, minZ, surface, rails, bare,
          tessellate: flat ? 0 : 10, steps: steps, ramps: ramps);
    }
    final meshes = chunks[key]!;
    for (final (part, mesh) in [
      ('facade', meshes.facades),
      ('roof', meshes.roofs),
      ('ground', surface),
      ('rails', rails),
      // Stairs: the steps are drawn, the smooth ramp under them collides.
      ('steps', steps),
      ('ramp', ramps),
    ]) {
      glb.addMesh('$name/$part', part, mesh);
    }
    chunkList.add({'name': name, 'minX': minX, 'minZ': minZ});
  }

  // Props: small structures, the statue and the fountain in one mesh;
  // lamps as one instanced mesh.
  final propMesh = MeshWriter(), glassMesh = MeshWriter();
  final props = PropBuilder(propMesh, glassMesh);
  final kinds = <String, int>{};
  for (final (_, tags, polygon) in city.smallStructures) {
    final kind = tags['building'] ?? tags['building:part']!;
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    final g = terrain(centroid(polygon.outer));
    if (kind == 'kiosk') {
      emitKiosk(props, tags, polygon, g);
    } else {
      emitCanopy(props, polygon, g, pyramid: kind == 'gazebo');
    }
  }
  for (final area in osm.areas(
    (t) => t['memorial'] == 'statue' && (t['name'] ?? '').contains('Jelačić'),
  )) {
    for (final polygon in area.polygons) {
      emitJelacic(props, polygon, terrain(centroid(polygon.outer)));
    }
  }
  for (final area in osm.areas((t) => t['amenity'] == 'fountain')) {
    for (final polygon in area.polygons) {
      if (!extent.contains(centroid(polygon.outer))) continue;
      emitBasin(props, polygon, terrain(centroid(polygon.outer)), name: area.tags['name']);
    }
  }
  // Tram platforms (OSM lines beside the rails) with their shelters.
  var platforms = 0;
  for (final id in (osm.ways.keys.toList()..sort())) {
    final way = osm.ways[id]!;
    if (way.tags['railway'] != 'platform' || way.tags['area'] == 'yes') continue;
    final line = osm.points(way);
    if (line.length < 2 || !extent.contains(line.first)) continue;
    // Which side the rails are on: the nearest tram point to the middle.
    final mid = (line.first + line.last) * .5;
    Vector2? nearest;
    for (final t in ground.tramLines) {
      for (final q in t) {
        if (nearest == null || q.distanceTo(mid) < nearest.distanceTo(mid)) nearest = q;
      }
    }
    if (nearest == null) continue;
    emitPlatform(props, line, (nearest - mid).normalized(), terrain);
    platforms++;
  }
  // Café terraces: loose furniture the web simulates, so only placements.
  var terraces = 0;
  final terraceTableList = <List<Object>>[];
  for (final area in osm.areas((t) => t['leisure'] == 'outdoor_seating')) {
    for (final polygon in area.polygons) {
      if (!extent.contains(centroid(polygon.outer))) continue;
      terraceTableList.addAll(terraceTables(polygon, terrain));
      terraces++;
    }
  }
  // Market stalls (data/markets.json): loose furniture as well, a grid per
  // market with seeded gaps and umbrellas, never inside a building.
  final stallList = <List<Object>>[];
  final marketsFile = File('data/markets.json');
  if (marketsFile.existsSync()) {
    final markets = (jsonDecode(marketsFile.readAsStringSync()) as Map)['markets'] as List;
    Vector2 v2(Object? v) => Vector2(((v as List)[0] as num).toDouble(), (v[1] as num).toDouble());
    for (final m in markets.cast<Map<String, dynamic>>()) {
      final origin = v2(m['origin']), across = v2(m['across']).normalized(), along = v2(m['along']).normalized();
      final seed = m['seed'] as int, aisle = m['aisleEvery'] as int? ?? 0;
      final empty = (m['empty'] as num).toDouble(), umbrellas = (m['umbrellas'] as num).toDouble();
      // A stable pseudo-random 0..1 per stall.
      double hash(int i, int j, int salt) {
        final s = math.sin((i * 127.1 + j * 311.7 + seed * 74.7 + salt * 19.3)) * 43758.5453;
        return s - s.floorToDouble();
      }

      // The long side along the row: yaw turns the stall's +x onto `across`
      // (web frame, z mirrored).
      final yaw = math.atan2(across.y, across.x);
      for (var j = 0; j < (m['rows'] as int); j++) {
        for (var i = 0; i < (m['stalls'] as int); i++) {
          if (aisle > 0 && i % aisle == aisle - 1) continue;
          if (hash(i, j, 1) < empty) continue;
          final p = origin +
              across * (i * (m['stallSpacing'] as num).toDouble()) +
              along * (j * (m['rowSpacing'] as num).toDouble());
          if (!extent.contains(p) || city.buildings.any((b) => b.polygon.contains(p))) continue;
          final colour = hash(i, j, 2) < umbrellas ? m['colour'] as String : '';
          stallList.add([r2(p.x), r2(-p.y), r2(terrain(p) + kerbHeight), r2(yaw), colour]);
        }
      }
    }
  }
  // Monuments: nodes, and small areas by their centre.
  var monuments = 0;
  bool isMonument(Tags t) =>
      t['name'] != 'Ban Josip Jelačić 1801-1859' &&
      (t['tourism'] == 'artwork' || t['historic'] == 'memorial' || t['historic'] == 'monument');
  for (final id in (osm.nodeTags.keys.toList()..sort())) {
    final t = osm.nodeTags[id]!;
    final p = osm.nodes[id]!;
    if (!isMonument(t) || !extent.contains(p)) continue;
    if (emitMonument(props, t, p, terrain(p))) monuments++;
  }
  for (final area in osm.areas(isMonument)) {
    for (final polygon in area.polygons) {
      final c = centroid(polygon.outer);
      if (polygon.area > 80 || !extent.contains(c)) continue;
      if (emitMonument(props, area.tags, c, terrain(c))) monuments++;
    }
  }
  glb.addMesh('props', 'prop', propMesh);
  glb.addMesh('glass', 'glass', glassMesh);
  glb.addMesh('lamp', 'lamp', lampMesh());
  final lamps = <List<double>>[];
  final lampIds = osm.nodeTags.keys.toList()..sort();
  for (final id in lampIds) {
    if (osm.nodeTags[id]!['highway'] != 'street_lamp') continue;
    final p = osm.nodes[id]!;
    if (!extent.contains(p)) continue;
    // Lamps stand on the sidewalk or paving, never in the carriageway.
    lamps.add([r2(p.x), r2(-p.y), r2(terrain(p) + kerbHeight)]);
  }
  stdout.writeln(
    'Props: $kinds, ${lamps.length} street lamps, $platforms tram platforms, '
    '$terraces terraces (${terraceTableList.length} tables), ${stallList.length} market stalls, '
    '$monuments monuments',
  );

  // Real-facade coverage: every street wall of 4 m or more, done or to do.
  // data/hero/coverage.json is the work list for the next Street View pass.
  // Generic walls (plaster tile or a generic style, no picture of their own) count as covered: they are
  // not work for the next Street View pass, and mk_fill.py must not give them fillers again.
  final done = <Map<String, Object?>>[], todo = <Map<String, Object?>>[], generic = <Map<String, Object?>>[];
  // Every street wall's geometry for the web's zg.lookAtWall (web frame):
  // [ax, az, bx, bz, outward nx, nz, sidewalk y, eave y].
  final walls = <String, List<double>>{};
  var doneMetres = 0.0, todoMetres = 0.0;
  for (final b in city.buildings) {
    final spans = hero.spansFor(b.id, b.polygon);
    var i = 0;
    for (final (a, c) in b.polygon.edges) {
      final edge = i++;
      if (edge >= b.walls.length || b.walls[edge] != WallKind.street) continue;
      final length = a.distanceTo(c);
      if (length < 4) continue;
      final mid = (a + c) * .5;
      final dv = c - a;
      var nrm = Vector2(dv.y, -dv.x).normalized();
      if (b.polygon.contains(mid + nrm * .2)) nrm = -nrm;
      final lowW = math.min(terrain(a), math.min(terrain(c), terrain(mid)));
      walls['${b.id}_e$edge'] = [
        r2(a.x), r2(-a.y), r2(c.x), r2(-c.y), r2(nrm.x), r2(-nrm.y),
        r2(lowW + kerbHeight), r2(streetGround(b) + b.eave),
      ];
      // Fenced-off scenery (blockedAreas) is not part of the work list.
      if (blockedAreas.any((e) => e.contains(mid))) continue;
      final entry = {
        'wall': '${b.id}_e$edge',
        'name': b.tags['name'],
        'length': r2(length),
        'mid': [r2(mid.x), r2(mid.y)],
      };
      if (spans.containsKey(edge)) {
        done.add(entry);
        doneMetres += length;
      } else if (genericWalls.containsKey('${b.id}_e$edge') || plasterWalls.containsKey('${b.id}_e$edge')) {
        generic.add(entry);
        doneMetres += length;
      } else {
        todo.add(entry);
        todoMetres += length;
      }
    }
  }
  if (args.contains('--dump-walls')) {
    // Every wall edge of every building (any kind), with what it looks onto: the audit of plain walls
    // (.art/walls_all.json). A party wall shows only above its lower neighbour.
    final dump = <Map<String, Object?>>[];
    for (final b in city.buildings) {
      final spans = hero.spansFor(b.id, b.polygon);
      var i = 0;
      for (final (a, c) in b.polygon.edges) {
        final edge = i++;
        final length = a.distanceTo(c);
        if (length < .3) continue;
        final mid = (a + c) * .5;
        final dv = c - a;
        var nrm = Vector2(dv.y, -dv.x).normalized();
        if (b.polygon.contains(mid + nrm * .2)) nrm = -nrm;
        double? other;
        for (final o in city.buildings) {
          if (identical(o, b)) continue;
          if (o.polygon.contains(mid + nrm * .7)) {
            other = o.eave;
            break;
          }
        }
        dump.add({
          'wall': '${b.id}_e$edge',
          'kind': edge < b.walls.length ? b.walls[edge].name : 'street',
          'len': r2(length),
          'eave': r2(b.eave),
          'other': other == null ? null : r2(other),
          'hero': spans.containsKey(edge),
          'generic': genericWalls.containsKey('${b.id}_e$edge') || plasterWalls.containsKey('${b.id}_e$edge'),
          'outer': edge < b.polygon.outer.length,
          'mid': [r2(mid.x), r2(mid.y)],
          'n': [r2(nrm.x), r2(nrm.y)],
          'name': b.tags['name'],
          'paint': [b.paint.x, b.paint.y, b.paint.z],
          'ground': r2(streetGround(b)),
        });
      }
    }
    Directory('.art').createSync(recursive: true);
    File('.art/walls_all.json').writeAsStringSync(jsonEncode(dump));
  }
  File('data/hero/coverage.json').writeAsStringSync(
    '${const JsonEncoder.withIndent('  ').convert({
      'note': 'Street walls (>= 4 m) of the web export, frame x east / z north. '
          'Written by tool/export_web.dart; done = has a Street View facade, generic = a shared '
          'generic style or plaster tile (data/generic_walls.json, data/plaster_walls.json).',
      'done': done.length,
      'generic': generic.length,
      'todo': todo.length,
      'doneMetres': doneMetres.round(),
      'todoMetres': todoMetres.round(),
      'walls': {'done': done, 'generic': generic, 'todo': todo},
    })}\n',
  );
  stdout.writeln(
    'Real facades: ${done.length} of ${done.length + generic.length + todo.length} street walls, '
    '${generic.length} generic (${(doneMetres + todoMetres).round()} m, ${todoMetres.round()} m to do)',
  );

  // Features (data/buildings.json): each names a wall `<building>_e<edge>`;
  // the export resolves it to web-frame ends, outward normal, sidewalk and
  // eave heights, which web3d/src/features.ts builds from.
  final features = <Map<String, Object?>>[];
  final skippedFeatures = <String>{};
  final byId = {for (final b in city.buildings) b.id: b};
  for (final MapEntry(key: id, value: entry) in overrides.entries) {
    if (entry is! Map) continue;
    for (final f in (entry['features'] as List? ?? const [])) {
      final feature = Map<String, Object?>.from(f as Map);
      final wall = feature['wall'] as String? ?? '';
      final cut = wall.lastIndexOf('_e');
      final b = cut < 0 ? null : byId[wall.substring(0, cut)];
      final edge = cut < 0 ? -1 : int.tryParse(wall.substring(cut + 2)) ?? -1;
      final edges = b?.polygon.edges.toList() ?? const [];
      if (b == null && cut >= 0) {
        // The building is outside the extent (cut away): its features go with it.
        skippedFeatures.add(wall);
        continue;
      }
      if (b == null || edge < 0 || edge >= edges.length) {
        stderr.writeln('data/buildings.json ($id): no wall "$wall"');
        exit(1);
      }
      final (a, c) = edges[edge];
      final d = c - a;
      var n = Vector2(d.y, -d.x).normalized();
      if (b.polygon.contains((a + c) * .5 + n * .2)) n = -n;
      var low = math.min(terrain(a), math.min(terrain(c), terrain((a + c) * .5)));
      // A wall with arches starts its picture at its highest sidewalk (Arches): so do its features.
      if (arcades[b.id]?.arches?.edge == edge) {
        low = math.max(terrain(a), math.max(terrain(c), terrain((a + c) * .5)));
      }
      features.add({
        ...feature,
        'building': id,
        'a': [r2(a.x), r2(-a.y)],
        'b': [r2(c.x), r2(-c.y)],
        'n': [r2(n.x), r2(-n.y)],
        'ground': r2(low + kerbHeight),
        'eave': r2(streetGround(b) + b.eave),
      });
    }
  }
  if (features.isNotEmpty) stdout.writeln('Features: ${features.length}');
  if (skippedFeatures.isNotEmpty) {
    stdout.writeln(
      'Features skipped (building outside the extent): ${skippedFeatures.length} walls, '
      '${skippedFeatures.take(4).join(', ')}...',
    );
  }

  // Hand-placed park pieces (data/park.json, tool frame): extra `trees` [x, z] and `props` (same items
  // as data/props.json: the EU garden, the toilet stairwell by the Cesarca lawn).
  final parkFile = File('data/park.json');
  final park = parkFile.existsSync()
      ? jsonDecode(parkFile.readAsStringSync()) as Map<String, dynamic>
      : <String, dynamic>{};
  final trees = [
    for (final t in ground.trees)
      if (extent.contains(t)) treeInstance(t, terrain(t) + kerbHeight),
    for (final t in (park['trees'] as List? ?? const []).cast<List>())
      () {
        final p = Vector2((t[0] as num).toDouble(), (t[1] as num).toDouble());
        return treeInstance(p, terrain(p) + kerbHeight);
      }(),
  ];
  // Free-standing props placed by hand (data/props.json, tool frame): the game builds the textured
  // ones (web3d/src/squareprops.ts). Each gets its web position, ground height and heading.
  final propFile = File('data/props.json');
  final props2 = <Map<String, Object?>>[];
  if (propFile.existsSync()) {
    final j = jsonDecode(propFile.readAsStringSync()) as Map<String, dynamic>;
    for (final e in [...(j['items'] as List), ...(park['props'] as List? ?? const [])]) {
      final m = Map<String, Object?>.from(e as Map);
      final p = Vector2((m['x'] as num).toDouble(), (m['z'] as num).toDouble());
      if (!extent.contains(p)) continue;
      m['x'] = r2(p.x);
      m['z'] = r2(-p.y);
      m['y'] = r2(terrain(p) + kerbHeight);
      // An item with a far end (the funicular's `toX`, `toZ`) is given in the tool frame too.
      if (m['toZ'] is num) m['toZ'] = r2(-(m['toZ'] as num).toDouble());
      props2.add(m);
    }
    // A hand-modelled lamp (candelabra, medium or small ornate) replaces the plain lantern on its OSM node.
    final custom = [
      for (final m in props2)
        if ((m['type'] as String).startsWith('candelabra') || (m['type'] as String).startsWith('lamp_'))
          Vector2((m['x'] as num).toDouble(), (m['z'] as num).toDouble()),
    ];
    final before = lamps.length;
    lamps.removeWhere((l) => custom.any((c) => (c.x - l[0]).abs() < 1.6 && (c.y - l[1]).abs() < 1.6));
    if (before != lamps.length) stdout.writeln('Lamps replaced by props: ${before - lamps.length}');
  }
  // Fences that close off what the player may not enter (data/fences.json, tool frame): each
  // polyline is cut into panels of at most `panel` metres, every post as [x, y, z] in the web frame
  // (web3d/src/fences.ts builds and collides them).
  final fences = <Map<String, Object?>>[];
  final fenceFile = File('data/fences.json');
  if (fenceFile.existsSync()) {
    final j = jsonDecode(fenceFile.readAsStringSync()) as Map<String, dynamic>;
    for (final f in (j['fences'] as List).cast<Map>()) {
      final pts = [
        for (final p in (f['points'] as List).cast<List>())
          Vector2((p[0] as num).toDouble(), (p[1] as num).toDouble()),
      ];
      final panel = (f['panel'] as num?)?.toDouble() ?? 3.5;
      final posts = <List<double>>[];
      for (var k = 0; k + 1 < pts.length; k++) {
        final a = pts[k], b = pts[k + 1];
        final n = math.max(1, (a.distanceTo(b) / panel).ceil());
        for (var q = k == 0 ? 0 : 1; q <= n; q++) {
          final p = q == n ? b : a + (b - a) * (q / n);
          posts.add([r2(p.x), r2(terrain(p)), r2(-p.y)]);
        }
      }
      fences.add({...Map<String, Object?>.from(f)..remove('points'), 'posts': posts});
    }
  }
  // Hollows (data/levels.json kind "dip"): the web build sinks its bare terrain grid the same
  // way, or the grid would roof over the lowered ground. Web frame.
  final dips = [
    for (final r in levels.regions)
      if (r.kind == RegionKind.dip)
        {
          'rings': [
            for (final polygon in r.polygons) [for (final q in polygon.outer) [r2(q.x), r2(-q.y)]],
          ],
          'from': [r2(r.from!.x), r2(-r.from!.y)],
          'to': [r2(r.to!.x), r2(-r.to!.y)],
          'sinkFrom': r.sinkFrom,
          'sinkTo': r.sinkTo,
          'taper': r.taper,
        },
  ];
  // Open gates and the garden walls beside them (data/gates.json, tool frame): gates as
  // {name, x, y, z (web), heading deg, width, height, lanterns?, arch?, sideGate?}, walls as
  // {kind, height, thick, posts: [[x, y, z], ...]} with a post at least every 2 m (web frame).
  final gates = <Map<String, Object?>>[];
  final stoneWalls = <Map<String, Object?>>[];
  final gateFile = File('data/gates.json');
  if (gateFile.existsSync()) {
    final j = jsonDecode(gateFile.readAsStringSync()) as Map<String, dynamic>;
    for (final g in (j['gates'] as List).cast<Map>()) {
      final p = Vector2((g['x'] as num).toDouble(), (g['z'] as num).toDouble());
      gates.add({
        'name': g['name'],
        'x': r2(p.x),
        'y': r2(terrain(p)),
        'z': r2(-p.y),
        'heading': (g['heading'] as num).toDouble(),
        'width': (g['width'] as num?)?.toDouble() ?? 4.0,
        'height': (g['height'] as num?)?.toDouble() ?? 2.2,
        if (g['lanterns'] == true) 'lanterns': true,
        if (g['arch'] != null) 'arch': (g['arch'] as num).toDouble(),
        if (g['sideGate'] != null) 'sideGate': g['sideGate'],
      });
    }
    for (final w in ((j['walls'] as List?) ?? const []).cast<Map>()) {
      final pts = [
        for (final p in (w['points'] as List).cast<List>()) Vector2((p[0] as num).toDouble(), (p[1] as num).toDouble()),
      ];
      final posts = <List<double>>[];
      for (var k = 0; k + 1 < pts.length; k++) {
        final a = pts[k], b = pts[k + 1];
        final n = math.max(1, (a.distanceTo(b) / 2).ceil());
        for (var q = k == 0 ? 0 : 1; q <= n; q++) {
          final p = q == n ? b : a + (b - a) * (q / n);
          posts.add([r2(p.x), r2(terrain(p)), r2(-p.y)]);
        }
      }
      stoneWalls.add({
        'name': w['name'],
        'kind': w['kind'] ?? 'plaster',
        'height': (w['height'] as num?)?.toDouble() ?? 2.4,
        'thick': (w['thick'] as num?)?.toDouble() ?? .45,
        'posts': posts,
      });
    }
  }
  final landmarks = [
    for (final l in landmarkSpecs)
      () {
        final o = (l['origin'] as List).cast<num>();
        final p = Vector2(o[0].toDouble(), o[1].toDouble());
        return {'name': l['name'], 'x': r2(p.x), 'y': r2(terrain(p)), 'z': r2(-p.y), 'heading': l['heading']};
      }(),
  ];
  // Where the crowd may walk (web3d/src/people.ts).
  final walk = walkGrid(
    city,
    ground,
    extent,
    blockedAreas,
    levels,
    passages: passages.floors(),
    obstacles: [
      for (final t in ground.trees)
        if (extent.contains(t)) (t, .55),
      for (final t in (park['trees'] as List? ?? const []).cast<List>())
        (Vector2((t[0] as num).toDouble(), (t[1] as num).toDouble()), .55),
      for (final l in lamps) (Vector2(l[0], -l[1]), .35),
    ],
  );
  // Place names for the HUD: points along named streets every 8 m, and a
  // 10 m grid inside named squares and parks (which win where they overlap).
  final names = <List<Object>>[];
  double r1(double v) => (v * 10).roundToDouble() / 10;
  for (final s in city.streets) {
    final name = s.tags['name'];
    if (name == null) continue;
    for (var k = 0; k + 1 < s.points.length; k++) {
      final a = s.points[k], b = s.points[k + 1];
      final steps = math.max(1, (a.distanceTo(b) / 8).ceil());
      for (var q = 0; q < steps; q++) {
        final p = a + (b - a) * (q / steps);
        if (extent.contains(p)) names.add([r1(p.x), r1(-p.y), name, 0]);
      }
    }
  }
  // Covered passages, every 4 m inside (the streets' samples win at their doors).
  for (final p in passages.list) {
    for (var k = 0; k + 1 < p.points.length; k++) {
      final a = p.points[k], b = p.points[k + 1];
      final steps = math.max(1, (a.distanceTo(b) / 4).ceil());
      for (var q = 1; q < steps; q++) {
        final at = a + (b - a) * (q / steps);
        names.add([r1(at.x), r1(-at.y), p.name, 0]);
      }
    }
  }
  for (final area in osm.areas(
    (t) =>
        t['name'] != null &&
        (t['place'] == 'square' || t['leisure'] == 'park' || t['highway'] == 'pedestrian'),
  )) {
    for (final polygon in area.polygons) {
      var x0 = double.infinity, x1 = -double.infinity;
      var z0 = double.infinity, z1 = -double.infinity;
      for (final p in polygon.outer) {
        x0 = math.min(x0, p.x);
        x1 = math.max(x1, p.x);
        z0 = math.min(z0, p.y);
        z1 = math.max(z1, p.y);
      }
      for (var x = (x0 / 10).ceil() * 10.0; x <= x1; x += 10) {
        for (var z = (z0 / 10).ceil() * 10.0; z <= z1; z += 10) {
          final p = Vector2(x, z);
          if (extent.contains(p) && polygon.contains(p)) {
            names.add([x, -z, area.tags['name']!, 1]);
          }
        }
      }
    }
  }
  const out = 'web3d/public/city';
  Directory(out).createSync(recursive: true);
  for (final name in ['ground', 'far']) {
    final src = File('data/terrain/$name.json');
    final dst = File('$out/${name == 'ground' ? 'terrain' : 'far'}.json');
    if (flat) {
      if (dst.existsSync()) dst.deleteSync();
    } else {
      src.copySync(dst.path);
    }
  }
  File('$out/zagreb.glb').writeAsBytesSync(glb.bytes());
  File('$out/city.json').writeAsStringSync(
    '${jsonEncode({
      'note': 'web frame: x east, y up, z SOUTH',
      'extent': [extent.minX, -extent.maxZ, extent.maxX, -extent.minZ],
      // Areas the car cannot enter, [minX, minZ, maxX, maxZ] in the web frame (z mirrored).
      'blocked': [
        for (final e in blockedAreas) [e.minX, -e.maxZ, e.maxX, -e.minZ],
      ],
      'chunkSize': chunkSize,
      'chunks': chunkList,
      // [x, z, base y], z mirrored.
      'lamps': lamps,
      // Café tables (each with two chairs and a parasol): [x, z, base y,
      // yaw, parasol colour], z mirrored.
      'terraces': terraceTableList,
      // Market stalls: [x, z, base y, yaw, umbrella colour or ''], z mirrored.
      'stalls': stallList,
      'coverage': {'done': done.length + generic.length, 'walls': done.length + generic.length + todo.length},
      // Roofs index assets/textures/roof_atlas.png (else the surface atlas).
      'roofSet': roofs != null,
      'heroPages': hero.pages,
      'features': features,
      'walls': walls,
      // Walkable 1 m cells for pedestrians (see tool/src/walk.dart).
      'walk': walk,
      // Hand-placed free-standing props (data/props.json): {type, x, z (web), y, heading (rad clockwise from north), ...}.
      'props': props2,
      // Fences (data/fences.json): {style, height, ..., posts: [[x, y, z], ...]} in the web frame.
      'fences': fences,
      // Open gates (data/gates.json): {name, x, y, z (web), heading deg clockwise from north (direction of travel), width, height}.
      'gates': gates,
      'stoneWalls': stoneWalls,
      'dips': dips,
      // Buildings the game models itself (buildings.json `omit` + `landmark`): {name, x, y, z, heading deg}.
      'landmarks': landmarks,
      // Covered passages (data/passages.json, web3d/src/passages.ts): {name, style, width, height,
      // doorWidth, door, samples: [[x, floor y, z], ...], covered: [[s0, s1, facade dir at s0 (x, z), at s1], ...], hall?: {x, y, z, apothem, heading deg, height, dome}}.
      'passages': passages.toJson([for (final b in city.buildings) b.polygon]),
      // Tram tracks as polylines [[x, z], ...], z mirrored.
      'trams': [
        for (final line in ground.tramLines)
          [
            for (final p in line) [r2(p.x), r2(-p.y)],
          ],
      ],
      // [x, z, name, 1 for an area], z mirrored.
      'names': names,
      // [x, z, base y, scale, yaw] with z mirrored.
      'trees': [
        for (final t in trees) [t[0], -t[1], t[2], t[3], t[4]],
      ],
    })}\n',
  );
  stdout.writeln(
    'Exported ${city.buildings.length} buildings, ${trees.length} trees, '
    '${glb.vertices} vertices, ${glb.triangles} triangles to $out '
    '(${watch.elapsedMilliseconds} ms)',
  );
}

/// A minimal glTF 2.0 binary writer: one node per mesh, one primitive per
/// mesh, one placeholder material per name (the web app replaces them).
class GlbWriter {
  final _bin = BytesBuilder();
  final _bufferViews = <Map<String, Object?>>[];
  final _accessors = <Map<String, Object?>>[];
  final _meshes = <Map<String, Object?>>[];
  final _nodes = <Map<String, Object?>>[];
  final _materials = <String>[];
  int vertices = 0, triangles = 0;

  int _view(Uint8List data, {int? target}) {
    while (_bin.length % 4 != 0) {
      _bin.addByte(0);
    }
    final offset = _bin.length;
    _bin.add(data);
    _bufferViews.add({
      'buffer': 0,
      'byteOffset': offset,
      'byteLength': data.length,
      'target': ?target,
    });
    return _bufferViews.length - 1;
  }

  int _accessor(
    int view,
    int componentType,
    int count,
    String type, {
    List<double>? min,
    List<double>? max,
  }) {
    _accessors.add({
      'bufferView': view,
      'componentType': componentType,
      'count': count,
      'type': type,
      'min': ?min,
      'max': ?max,
    });
    return _accessors.length - 1;
  }

  void addMesh(String name, String material, MeshWriter mesh) {
    if (mesh.isEmpty) return;
    final n = mesh.vertexCount;
    // vertexBytes() is structure-of-arrays: position, normal, uv0, uv1,
    // colour, tangent (unused here).
    final src = mesh.vertexBytes().buffer.asFloat32List();
    final pos = Float32List.sublistView(src, 0, n * 3);
    final nrm = Float32List.sublistView(src, n * 3, n * 6);
    final uv0 = Float32List.sublistView(src, n * 6, n * 8);
    final uv1 = Float32List.sublistView(src, n * 8, n * 10);
    final col = Float32List.sublistView(src, n * 10, n * 14);
    final min = [double.infinity, double.infinity, double.infinity];
    final max = [-double.infinity, -double.infinity, -double.infinity];
    for (var i = 0; i < n; i++) {
      pos[i * 3 + 2] = -pos[i * 3 + 2];
      nrm[i * 3 + 2] = -nrm[i * 3 + 2];
      for (var k = 0; k < 3; k++) {
        min[k] = math.min(min[k], pos[i * 3 + k]);
        max[k] = math.max(max[k], pos[i * 3 + k]);
      }
    }
    final (indexBytes, _) = mesh.indexBytes();
    final wide = n > 0xffff;
    final idx = wide
        ? Uint32List.fromList(indexBytes.buffer.asUint32List())
        : Uint32List.fromList(indexBytes.buffer.asUint16List());
    for (var t = 0; t < idx.length; t += 3) {
      final a = idx[t], b = idx[t + 1], c = idx[t + 2];
      final ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      final e1 = Vector3(pos[b * 3] - ax, pos[b * 3 + 1] - ay, pos[b * 3 + 2] - az);
      final e2 = Vector3(pos[c * 3] - ax, pos[c * 3 + 1] - ay, pos[c * 3 + 2] - az);
      final geo = e1.cross(e2);
      final vn = Vector3(
        nrm[a * 3] + nrm[b * 3] + nrm[c * 3],
        nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1],
        nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2],
      );
      if (geo.dot(vn) < 0) {
        idx[t + 1] = c;
        idx[t + 2] = b;
      }
    }
    Uint8List bytesOf(TypedData d) =>
        d.buffer.asUint8List(d.offsetInBytes, d.lengthInBytes);
    const float = 5126;
    final attributes = {
      'POSITION': _accessor(
        _view(bytesOf(Float32List.fromList(pos)), target: 34962),
        float,
        n,
        'VEC3',
        min: min,
        max: max,
      ),
      'NORMAL': _accessor(
        _view(bytesOf(Float32List.fromList(nrm)), target: 34962),
        float,
        n,
        'VEC3',
      ),
      'TEXCOORD_0': _accessor(
        _view(bytesOf(Float32List.fromList(uv0)), target: 34962),
        float,
        n,
        'VEC2',
      ),
      'TEXCOORD_1': _accessor(
        _view(bytesOf(Float32List.fromList(uv1)), target: 34962),
        float,
        n,
        'VEC2',
      ),
      'COLOR_0': _accessor(
        _view(bytesOf(Float32List.fromList(col)), target: 34962),
        float,
        n,
        'VEC4',
      ),
    };
    final indices = wide
        ? _accessor(_view(bytesOf(idx), target: 34963), 5125, idx.length, 'SCALAR')
        : _accessor(
            _view(bytesOf(Uint16List.fromList(idx)), target: 34963),
            5123,
            idx.length,
            'SCALAR',
          );
    var m = _materials.indexOf(material);
    if (m < 0) {
      _materials.add(material);
      m = _materials.length - 1;
    }
    _meshes.add({
      'name': name,
      'primitives': [
        {'attributes': attributes, 'indices': indices, 'material': m},
      ],
    });
    _nodes.add({'name': name, 'mesh': _meshes.length - 1});
    vertices += n;
    triangles += idx.length ~/ 3;
  }

  Uint8List bytes() {
    while (_bin.length % 4 != 0) {
      _bin.addByte(0);
    }
    final bin = _bin.toBytes();
    final json = {
      'asset': {'version': '2.0', 'generator': 'zagreb_drive export_web'},
      'scene': 0,
      'scenes': [
        {
          'nodes': [for (var i = 0; i < _nodes.length; i++) i],
        },
      ],
      'nodes': _nodes,
      'meshes': _meshes,
      'materials': [
        for (final name in _materials)
          {
            'name': name,
            'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': .9},
          },
      ],
      'accessors': _accessors,
      'bufferViews': _bufferViews,
      'buffers': [
        {'byteLength': bin.length},
      ],
    };
    var jsonBytes = utf8.encode(jsonEncode(json));
    final pad = (4 - jsonBytes.length % 4) % 4;
    jsonBytes = Uint8List.fromList([...jsonBytes, ...List.filled(pad, 0x20)]);
    final total = 12 + 8 + jsonBytes.length + 8 + bin.length;
    final out = BytesBuilder();
    void u32(int v) =>
        out.add((ByteData(4)..setUint32(0, v, Endian.little)).buffer.asUint8List());
    u32(0x46546C67);
    u32(2);
    u32(total);
    u32(jsonBytes.length);
    u32(0x4E4F534A);
    out.add(jsonBytes);
    u32(bin.length);
    u32(0x004E4942);
    out.add(bin);
    return out.toBytes();
  }
}
