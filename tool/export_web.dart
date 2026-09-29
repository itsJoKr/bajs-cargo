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
//                                  glass, the tree and the lamp;
//   web3d/public/city/city.json    extent, chunks, trees, lamps, trams,
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
import 'src/geom.dart' show centroid;
import 'src/ground.dart';
import 'src/hero.dart';
import 'src/osm.dart';
import 'src/props.dart';
import 'src/roofs.dart';
import 'src/street_props.dart';
import 'src/terrain_grid.dart';

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
  double terrain(Vector2 p) => grid == null ? 0 : grid(p);

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

  for (final b in city.buildings) {
    final c = b.center;
    final key = ((c.x / chunkSize).floor(), (c.y / chunkSize).floor());
    emitBuilding(
      b,
      chunks.putIfAbsent(key, BuildingMeshes.new),
      ground: streetGround(b),
      foot: grid?.lowest(b.polygon),
      terrain: grid == null ? null : terrain,
      plainWalls: plainWalls,
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
    final gx0 = math.max(minX, extent.minX), gz0 = math.max(minZ, extent.minZ);
    final gx1 = math.min(minX + chunkSize, extent.maxX);
    final gz1 = math.min(minZ + chunkSize, extent.maxZ);
    if (gx1 > gx0 && gz1 > gz0) {
      ground.emitGround(gx0, gz0, gx1, gz1, minX, minZ, surface, rails, terrain,
          tessellate: flat ? 0 : 10);
    }
    final meshes = chunks[key]!;
    for (final (part, mesh) in [
      ('facade', meshes.facades),
      ('roof', meshes.roofs),
      ('ground', surface),
      ('rails', rails),
    ]) {
      glb.addMesh('$name/$part', part, mesh);
    }
    chunkList.add({'name': name, 'minX': minX, 'minZ': minZ});
  }
  glb.addMesh('tree', 'tree', treeMesh());

  // Props: small structures, the statue and the fountain in one mesh;
  // lamps as one instanced mesh.
  final propMesh = MeshWriter(), glassMesh = MeshWriter();
  final props = PropBuilder(propMesh, glassMesh);
  final kinds = <String, int>{};
  for (final (_, tags, polygon) in city.smallStructures) {
    final kind = tags['building']!;
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
  // Café terraces.
  var terraces = 0;
  for (final area in osm.areas((t) => t['leisure'] == 'outdoor_seating')) {
    for (final polygon in area.polygons) {
      if (!extent.contains(centroid(polygon.outer))) continue;
      emitTerrace(props, polygon, terrain);
      terraces++;
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
    '$terraces terraces, $monuments monuments',
  );

  // Real-facade coverage: every street wall of 4 m or more, done or to do.
  // data/hero/coverage.json is the work list for the next Street View pass.
  final done = <Map<String, Object?>>[], todo = <Map<String, Object?>>[];
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
      final entry = {
        'wall': '${b.id}_e$edge',
        'name': b.tags['name'],
        'length': r2(length),
        'mid': [r2(mid.x), r2(mid.y)],
      };
      if (spans.containsKey(edge)) {
        done.add(entry);
        doneMetres += length;
      } else {
        todo.add(entry);
        todoMetres += length;
      }
    }
  }
  File('data/hero/coverage.json').writeAsStringSync(
    '${const JsonEncoder.withIndent('  ').convert({
      'note': 'Street walls (>= 4 m) of the web export, frame x east / z north. '
          'Written by tool/export_web.dart; done = has a Street View facade.',
      'done': done.length,
      'todo': todo.length,
      'doneMetres': doneMetres.round(),
      'todoMetres': todoMetres.round(),
      'walls': {'done': done, 'todo': todo},
    })}\n',
  );
  stdout.writeln(
    'Real facades: ${done.length} of ${done.length + todo.length} street walls '
    '(${doneMetres.round()} of ${(doneMetres + todoMetres).round()} m)',
  );

  // Features (data/buildings.json): each names a wall `<building>_e<edge>`;
  // the export resolves it to web-frame ends, outward normal, sidewalk and
  // eave heights, which web3d/src/features.ts builds from.
  final features = <Map<String, Object?>>[];
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
      if (b == null || edge < 0 || edge >= edges.length) {
        stderr.writeln('data/buildings.json ($id): no wall "$wall"');
        exit(1);
      }
      final (a, c) = edges[edge];
      final d = c - a;
      var n = Vector2(d.y, -d.x).normalized();
      if (b.polygon.contains((a + c) * .5 + n * .2)) n = -n;
      final low = math.min(terrain(a), math.min(terrain(c), terrain((a + c) * .5)));
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

  final trees = [
    for (final t in ground.trees)
      if (extent.contains(t)) treeInstance(t, terrain(t) + kerbHeight),
  ];
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
      'chunkSize': chunkSize,
      'chunks': chunkList,
      // [x, z, base y], z mirrored.
      'lamps': lamps,
      'coverage': {'done': done.length, 'walls': done.length + todo.length},
      // Roofs index assets/textures/roof_atlas.png (else the surface atlas).
      'roofSet': roofs != null,
      'features': features,
      'walls': walls,
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
