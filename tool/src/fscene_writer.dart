// Shared helpers for tools that bake Zagreb Drive's scene documents.
//
// Adapted from Doomscrool's tool/src/fscene_writer.dart. Doomscrool's
// generators edit editor-authored documents in place, so they reclaim and
// re-mint ids; every Zagreb document is generator-owned and written whole,
// from scratch, so a fixed id range minted in a fixed order is enough for
// byte-identical reruns (no released ids to reuse).
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:scene/scene.dart'
    show
        DocumentId,
        LocalId,
        PayloadEncoding,
        PayloadSpec,
        SceneDocument,
        writeFsceneb;
import 'package:vector_math/vector_math.dart';

/// Root that generated assets are written under: `ZAGREB_ASSET_ROOT` when set
/// and non-empty, the current directory otherwise.
/// `tool/verify/gates/generator-determinism` points it at an empty scratch
/// directory so a determinism run never writes the tracked tree.
String assetPath(String relative) {
  final root = Platform.environment['ZAGREB_ASSET_ROOT'];
  if (root == null || root.isEmpty) return relative;
  return '$root/$relative';
}

/// Writes [bytes] to [relative] under [assetPath], creating directories.
void writeAsset(String relative, List<int> bytes) {
  final file = File(assetPath(relative))..parent.createSync(recursive: true);
  file.writeAsBytesSync(bytes);
}

/// Collects vertices and packs them in the `unskinned_soa_uv1_tangent`
/// layout: position, normal, UV0, UV1, colour (LINEAR, alpha free for the
/// material to use), tangent -- 72 bytes per vertex, concatenated streams.
class MeshWriter {
  final _positions = <double>[], _normals = <double>[];
  final _uvs = <double>[], _uv1s = <double>[], _colors = <double>[];
  final _indices = <int>[];

  int get vertexCount => _positions.length ~/ 3;
  int get triangleCount => _indices.length ~/ 3;
  bool get isEmpty => _indices.isEmpty;

  int vertex(
    Vector3 p,
    Vector3 n,
    double u,
    double v, {
    double u1 = 0,
    double v1 = 0,
    Vector4? color,
  }) {
    _positions.addAll([p.x, p.y, p.z]);
    _normals.addAll([n.x, n.y, n.z]);
    _uvs.addAll([u, v]);
    _uv1s.addAll([u1, v1]);
    final c = color ?? _white;
    _colors.addAll([c.x, c.y, c.z, c.w]);
    return vertexCount - 1;
  }

  static final _white = Vector4(1, 1, 1, 1);

  Vector3 position(int i) =>
      Vector3(_positions[i * 3], _positions[i * 3 + 1], _positions[i * 3 + 2]);

  /// Adds a triangle wound so its front face looks along [facing]. A
  /// triangle's front face points along `(b - a) x (c - a)`.
  void triangle(int a, int b, int c, Vector3 facing) {
    final pa = position(a);
    final front =
        (position(b) - pa).cross(position(c) - pa).dot(facing) >= 0;
    _indices.addAll(front ? [a, b, c] : [a, c, b]);
  }

  /// Appends raw indices whose winding is already right.
  void rawTriangle(int a, int b, int c) => _indices.addAll([a, b, c]);

  (List<double>, List<double>) get bounds {
    final min = [double.infinity, double.infinity, double.infinity];
    final max = [-double.infinity, -double.infinity, -double.infinity];
    for (var i = 0; i < _positions.length; i++) {
      min[i % 3] = math.min(min[i % 3], _positions[i]);
      max[i % 3] = math.max(max[i % 3], _positions[i]);
    }
    return (min, max);
  }

  Uint8List vertexBytes() {
    final count = vertexCount;
    final floats = Float32List(count * 18);
    var o = 0;
    for (final v in _positions) {
      floats[o++] = v;
    }
    for (final v in _normals) {
      floats[o++] = v;
    }
    for (final v in _uvs) {
      floats[o++] = v;
    }
    for (final v in _uv1s) {
      floats[o++] = v;
    }
    for (final v in _colors) {
      floats[o++] = v;
    }
    for (var i = 0; i < count; i++) {
      final n = Vector3(
        _normals[i * 3],
        _normals[i * 3 + 1],
        _normals[i * 3 + 2],
      );
      final axis = n.y.abs() < .99 ? Vector3(0, 1, 0) : Vector3(0, 0, 1);
      final t = axis.cross(n)..normalize();
      floats.setAll(o, [t.x, t.y, t.z, 1]);
      o += 4;
    }
    return floats.buffer.asUint8List();
  }

  (Uint8List, String) indexBytes() {
    if (vertexCount <= 0xffff) {
      return (Uint16List.fromList(_indices).buffer.asUint8List(), 'uint16');
    }
    return (Uint32List.fromList(_indices).buffer.asUint8List(), 'uint32');
  }
}

/// A material a baked document declares. The runtime swaps each one for the
/// shared instance with the same [name] (see `lib/drive/scene/city_materials
/// .dart`), so what is written here is only what the editor and a bare
/// `loadScene` show.
class MaterialSpec {
  const MaterialSpec(
    this.name, {
    this.baseColor = const [1.0, 1.0, 1.0, 1.0],
    this.roughness = .9,
    this.depthBias,
  });

  final String name;
  final List<double> baseColor;
  final double roughness;
  final double? depthBias;
}

/// Writes one generator-owned `.fscene` document plus its payload sidecar,
/// from scratch. Ids come from a fixed range in the order things are added,
/// so the same inputs always produce the same bytes.
class SceneDocBuilder {
  SceneDocBuilder({
    required this.relativePath,
    required int firstToken,
    required String seedName,
  }) : _next = firstToken,
       documentId = DocumentId.generate(
         math.Random(_stableHash(seedName)),
       ).toToken();

  /// Path relative to the asset root, e.g. `assets/city/chunk_e0_n0.fscene`.
  final String relativePath;
  final String documentId;
  int _next;

  final _resources = <String, Object?>{};
  final _nodes = <String, Object?>{};
  final _roots = <String>[];
  final _payloadJson = <String, Object?>{};
  final _payloads = <LocalId, PayloadSpec>{};
  final _materials = <String, String>{};

  static int _stableHash(String text) {
    // FNV-1a, 31-bit so it stays a valid Random seed on every platform.
    var hash = 0x811c9dc5;
    for (final unit in utf8.encode(text)) {
      hash ^= unit;
      hash = (hash * 0x01000193) & 0x7fffffff;
    }
    return hash;
  }

  String _mint(String prefix) {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    var value = _next++ << 1;
    var token = '';
    while (value > 0) {
      token = alphabet[value % 32] + token;
      value ~/= 32;
    }
    return '$prefix:${token.padLeft(13, '0')}';
  }

  /// The id of [spec]'s material in this document, created on first use.
  String material(MaterialSpec spec) {
    return _materials.putIfAbsent(spec.name, () {
      final id = _mint('mat');
      _resources[id] = {
        'kind': 'material',
        'type': 'physicallyBased',
        'properties': {
          'baseColor': {'c': spec.baseColor},
          'emissive': {
            'c': [0.0, 0.0, 0.0, 0.0],
          },
          'emissiveStrength': {'d': 1.0},
          'metallic': {'d': 0.0},
          'roughness': {'d': spec.roughness},
          'occlusionStrength': {'d': 1.0},
          'normalScale': {'d': 1.0},
          'doubleSided': {'b': false},
          'alphaMode': {'s': 'opaque'},
          'alphaCutoff': {'d': .5},
          if (spec.depthBias != null) 'depthBias': {'d': spec.depthBias},
        },
        'name': spec.name,
      };
      return id;
    });
  }

  void _putPayload(String id, Uint8List bytes, Map<String, Object> spec) {
    _payloadJson[id] = {...spec, 'length': bytes.length};
    final localId = LocalId.parse(id);
    _payloads[localId] = PayloadSpec(
      localId,
      encoding: spec['encoding'] == 'vertexBuffer'
          ? PayloadEncoding.vertexBuffer
          : PayloadEncoding.indexBuffer,
      layout: spec['layout'] as String?,
      format: spec['format'] as String?,
      length: bytes.length,
      bytes: bytes,
    );
  }

  /// Adds a root node named [name] holding one mesh child per non-empty part.
  /// Returns the root's id, or null when every part was empty.
  String? addGroup(
    String name,
    List<(String, MaterialSpec, MeshWriter)> parts, {
    Vector3? position,
  }) {
    final live = parts.where((p) => !p.$3.isEmpty).toList();
    if (live.isEmpty) return null;
    final id = _mint('n');
    final children = <String>[];
    final t = position ?? Vector3.zero();
    _nodes[id] = {
      'name': name,
      'transform': {
        'trs': {
          't': [t.x, t.y, t.z],
          'r': [0, 0, 0, 1],
          's': [1, 1, 1],
        },
      },
      'children': children,
    };
    _roots.add(id);
    for (final (partName, spec, mesh) in live) {
      final materialId = material(spec);
      final childId = _mint('n');
      final geometryId = _mint('geo');
      final vertices = _mint('chunk'), indices = _mint('chunk');
      final (min, max) = mesh.bounds;
      _resources[geometryId] = {
        'kind': 'geometry',
        'vertices': vertices,
        'indices': indices,
        'bounds': {'min': min, 'max': max},
      };
      _putPayload(vertices, mesh.vertexBytes(), {
        'encoding': 'vertexBuffer',
        'layout': 'unskinned_soa_uv1_tangent',
      });
      final (indexBytes, format) = mesh.indexBytes();
      _putPayload(indices, indexBytes, {
        'encoding': 'indexBuffer',
        'format': format,
      });
      children.add(childId);
      _nodes[childId] = {
        'name': partName,
        'transform': {
          'trs': {
            't': [0, 0, 0],
            'r': [0, 0, 0, 1],
            's': [1, 1, 1],
          },
        },
        'components': [
          {
            'type': 'mesh',
            'properties': {
              'geometry': {'rref': geometryId},
              'material': {'rref': materialId},
            },
          },
        ],
      };
    }
    return id;
  }

  /// Writes the document and its `.payloads.fsceneb` sidecar.
  void save() {
    final name = relativePath.split('/').last;
    final payloadName = name.replaceAll('.fscene', '.payloads.fsceneb');
    final document = <String, Object?>{
      'fscene': 5,
      'documentId': documentId,
      'payloadSource': payloadName,
      'stage': <String, Object?>{},
      'resources': _resources,
      'nodes': _nodes,
      'roots': _roots,
      'payloads': _payloadJson,
      'editor': <String, Object?>{},
    };
    writeAsset(
      relativePath,
      utf8.encode('${const JsonEncoder.withIndent('  ').convert(document)}\n'),
    );
    final sidecar = SceneDocument(documentId: DocumentId.parse(documentId));
    sidecar.payloads.addAll(_payloads);
    final dir = relativePath.substring(0, relativePath.lastIndexOf('/'));
    writeAsset('$dir/$payloadName', writeFsceneb(sidecar));
  }
}
