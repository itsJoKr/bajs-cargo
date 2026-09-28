// Structural checks over the baked city, run by the scene-assets gate.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_scene/fscene.dart' show readFsceneb;
import 'package:zagreb_drive/drive/domain/city_index.dart';

void main() {
  final index = CityIndex.fromJson(
    jsonDecode(File('assets/data/city_index.json').readAsStringSync())
        as Map<String, Object?>,
  );

  test('the index names at least the 16 core chunks', () {
    expect(index.chunks.length, greaterThanOrEqualTo(16));
    expect(index.chunks.map((c) => c.name).toSet().length, index.chunks.length);
  });

  test('every chunk document parses and its payload sidecar matches', () {
    for (final chunk in index.chunks) {
      final doc =
          jsonDecode(File(chunk.path).readAsStringSync())
              as Map<String, dynamic>;
      expect(doc['fscene'], 5, reason: chunk.name);
      final sidecar = readFsceneb(
        File(
          '${File(chunk.path).parent.path}/${doc['payloadSource']}',
        ).readAsBytesSync(),
      );
      final payloads = doc['payloads'] as Map<String, dynamic>;
      expect(sidecar.payloads.length, payloads.length, reason: chunk.name);
      final byToken = {
        for (final e in payloads.entries) e.key.split(':').last: e.value,
      };
      for (final entry in sidecar.payloads.entries) {
        final token = entry.key.toString().replaceAll(RegExp(r'.*\('), '');
        final declared = byToken[token.replaceAll(')', '')] as Map?;
        expect(declared, isNotNull, reason: '${chunk.name} ${entry.key}');
        expect(entry.value.length, declared!['length'], reason: chunk.name);
      }
      // Single parent: every node is a root or exactly one node's child.
      final nodes = doc['nodes'] as Map<String, dynamic>;
      final parents = <String, int>{};
      for (final node in nodes.values) {
        for (final child in (node as Map)['children'] as List? ?? const []) {
          parents[child as String] = (parents[child] ?? 0) + 1;
        }
      }
      for (final root in doc['roots'] as List) {
        expect(parents.containsKey(root), isFalse, reason: chunk.name);
      }
      expect(parents.values.every((n) => n == 1), isTrue, reason: chunk.name);
    }
  });

  test('every baked chunk file is listed in the index (the hook builds all)', () {
    final baked = Directory('assets/city')
        .listSync()
        .whereType<File>()
        .map((f) => f.uri.pathSegments.last)
        .where((n) => n.endsWith('.fscene'))
        .map((n) => n.replaceAll('.fscene', ''))
        .toSet();
    expect(baked, index.chunks.map((c) => c.name).toSet());
  });
}
