import 'package:flutter_test/flutter_test.dart';
import 'package:zagreb_drive/drive/domain/geo.dart';

void main() {
  test('the statue is the origin', () {
    final p = geoToLocal(originLatitude, originLongitude);
    expect(p.x, 0);
    expect(p.z, 0);
  });

  test('x runs east and z runs north at street-map scale', () {
    // The Cathedral's west front is about 210 m east and 160 m north of the
    // statue.
    final cathedral = geoToLocal(45.81448, 15.97980);
    expect(cathedral.x, closeTo(207.6, 1));
    expect(cathedral.z, closeTo(161.2, 1));
  });

  test('localToGeo inverts geoToLocal', () {
    final p = geoToLocal(45.8047, 15.9781);
    final back = localToGeo(p.x, p.z);
    expect(back.latitude, closeTo(45.8047, 1e-9));
    expect(back.longitude, closeTo(15.9781, 1e-9));
  });
}
