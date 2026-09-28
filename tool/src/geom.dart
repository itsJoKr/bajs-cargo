// 2D geometry for the city generator: rings, triangulation, convex clipping,
// oriented boxes. Points are (x east, y = z north) in local metres, carried
// in vector_math's Vector2 so `v.y` is north.
// ignore_for_file: depend_on_referenced_packages
library;

import 'dart:math' as math;

import 'package:vector_math/vector_math.dart';

typedef Ring = List<Vector2>;

/// Signed area, positive when [ring] runs counter-clockwise (east->north).
double signedArea(Ring ring) {
  var sum = 0.0;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return sum / 2;
}

Ring ccw(Ring ring) => signedArea(ring) >= 0 ? ring : ring.reversed.toList();
Ring cw(Ring ring) => signedArea(ring) <= 0 ? ring : ring.reversed.toList();

Vector2 centroid(Ring ring) {
  var a = 0.0, cx = 0.0, cy = 0.0;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    final f = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
    a += f;
    cx += (ring[j].x + ring[i].x) * f;
    cy += (ring[j].y + ring[i].y) * f;
  }
  if (a.abs() < 1e-9) {
    final s = ring.fold(Vector2.zero(), (s, p) => s + p);
    return s / ring.length.toDouble();
  }
  return Vector2(cx / (3 * a), cy / (3 * a));
}

bool pointInRing(Vector2 p, Ring ring) {
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    final a = ring[i], b = ring[j];
    if ((a.y > p.y) != (b.y > p.y) &&
        p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/// Removes repeated points, a repeated closing point and near-collinear
/// vertices.
Ring cleanRing(Ring ring, {double epsilon = .05}) {
  var out = <Vector2>[];
  for (final p in ring) {
    if (out.isEmpty || out.last.distanceTo(p) > epsilon) out.add(p);
  }
  if (out.length > 1 && out.first.distanceTo(out.last) <= epsilon) {
    out.removeLast();
  }
  var changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (var i = 0; i < out.length; i++) {
      final a = out[(i - 1 + out.length) % out.length];
      final b = out[i], c = out[(i + 1) % out.length];
      final ab = b - a, bc = c - b;
      final cross = ab.x * bc.y - ab.y * bc.x;
      if (cross.abs() < epsilon * math.max(ab.length, bc.length) * .2 &&
          ab.dot(bc) > 0) {
        out = [...out]..removeAt(i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ earcut

class _Node {
  _Node(this.i, this.x, this.y);
  final int i;
  final double x, y;
  late _Node prev, next;
  bool steiner = false;
}

/// Triangulates a polygon with holes (a port of mapbox/earcut without the
/// z-order hash). Returns indices into `[...outer, ...holes.expand]`.
List<int> earcut(Ring outer, [List<Ring> holes = const []]) {
  final data = <double>[];
  for (final p in outer) {
    data.addAll([p.x, p.y]);
  }
  final holeIndices = <int>[];
  for (final hole in holes) {
    holeIndices.add(data.length ~/ 2);
    for (final p in hole) {
      data.addAll([p.x, p.y]);
    }
  }
  final triangles = <int>[];
  final outerLen = holeIndices.isEmpty ? data.length : holeIndices[0] * 2;
  var outerNode = _linkedList(data, 0, outerLen, true);
  if (outerNode == null || identical(outerNode.next, outerNode.prev)) {
    return triangles;
  }
  if (holeIndices.isNotEmpty) {
    outerNode = _eliminateHoles(data, holeIndices, outerNode);
  }
  _earcutLinked(outerNode, triangles, 0);
  return triangles;
}

_Node? _linkedList(List<double> data, int start, int end, bool clockwise) {
  _Node? last;
  if (clockwise == (_signedAreaData(data, start, end) > 0)) {
    for (var i = start; i < end; i += 2) {
      last = _insertNode(i, data[i], data[i + 1], last);
    }
  } else {
    for (var i = end - 2; i >= start; i -= 2) {
      last = _insertNode(i, data[i], data[i + 1], last);
    }
  }
  if (last != null && _equals(last, last.next)) {
    _removeNode(last);
    last = last.next;
  }
  return last;
}

_Node? _filterPoints(_Node? start, [_Node? end]) {
  if (start == null) return start;
  end ??= start;
  var p = start;
  bool again;
  do {
    again = false;
    if (!p.steiner && (_equals(p, p.next) || _area(p.prev, p, p.next) == 0)) {
      _removeNode(p);
      p = end = p.prev;
      if (identical(p, p.next)) break;
      again = true;
    } else {
      p = p.next;
    }
  } while (again || !identical(p, end));
  return end;
}

void _earcutLinked(_Node? ear, List<int> triangles, int pass) {
  if (ear == null) return;
  var stop = ear;
  var e = ear;
  while (!identical(e.prev, e.next)) {
    final prev = e.prev, next = e.next;
    if (_isEar(e)) {
      triangles
        ..add(prev.i ~/ 2)
        ..add(e.i ~/ 2)
        ..add(next.i ~/ 2);
      _removeNode(e);
      e = next.next;
      stop = next.next;
      continue;
    }
    e = next;
    if (identical(e, stop)) {
      if (pass == 0) {
        _earcutLinked(_filterPoints(e), triangles, 1);
      } else if (pass == 1) {
        final cured = _cureLocalIntersections(_filterPoints(e)!, triangles);
        _earcutLinked(cured, triangles, 2);
      } else if (pass == 2) {
        _splitEarcut(e, triangles);
      }
      break;
    }
  }
}

bool _isEar(_Node ear) {
  final a = ear.prev, b = ear, c = ear.next;
  if (_area(a, b, c) >= 0) return false;
  final x0 = math.min(a.x, math.min(b.x, c.x));
  final y0 = math.min(a.y, math.min(b.y, c.y));
  final x1 = math.max(a.x, math.max(b.x, c.x));
  final y1 = math.max(a.y, math.max(b.y, c.y));
  var p = c.next;
  while (!identical(p, a)) {
    if (p.x >= x0 &&
        p.x <= x1 &&
        p.y >= y0 &&
        p.y <= y1 &&
        _pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
        _area(p.prev, p, p.next) >= 0) {
      return false;
    }
    p = p.next;
  }
  return true;
}

_Node? _cureLocalIntersections(_Node start, List<int> triangles) {
  var p = start;
  var s = start;
  do {
    final a = p.prev, b = p.next.next;
    if (!_equals(a, b) &&
        _intersects(a, p, p.next, b) &&
        _locallyInside(a, b) &&
        _locallyInside(b, a)) {
      triangles
        ..add(a.i ~/ 2)
        ..add(p.i ~/ 2)
        ..add(b.i ~/ 2);
      _removeNode(p);
      _removeNode(p.next);
      p = s = b;
    }
    p = p.next;
  } while (!identical(p, s));
  return _filterPoints(p);
}

void _splitEarcut(_Node start, List<int> triangles) {
  var a = start;
  do {
    var b = a.next.next;
    while (!identical(b, a.prev)) {
      if (a.i != b.i && _isValidDiagonal(a, b)) {
        var c = _splitPolygon(a, b);
        final a2 = _filterPoints(a, a.next);
        c = _filterPoints(c, c.next)!;
        _earcutLinked(a2, triangles, 0);
        _earcutLinked(c, triangles, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (!identical(a, start));
}

_Node _eliminateHoles(List<double> data, List<int> holeIndices, _Node outer) {
  final queue = <_Node>[];
  for (var i = 0; i < holeIndices.length; i++) {
    final start = holeIndices[i] * 2;
    final end = i < holeIndices.length - 1
        ? holeIndices[i + 1] * 2
        : data.length;
    final list = _linkedList(data, start, end, false);
    if (list == null) continue;
    if (identical(list, list.next)) list.steiner = true;
    queue.add(_getLeftmost(list));
  }
  queue.sort((a, b) => a.x.compareTo(b.x));
  var outerNode = outer;
  for (final hole in queue) {
    outerNode = _eliminateHole(hole, outerNode);
  }
  return outerNode;
}

_Node _eliminateHole(_Node hole, _Node outerNode) {
  final bridge = _findHoleBridge(hole, outerNode);
  if (bridge == null) return outerNode;
  final bridgeReverse = _splitPolygon(bridge, hole);
  _filterPoints(bridgeReverse, bridgeReverse.next);
  return _filterPoints(bridge, bridge.next)!;
}

_Node? _findHoleBridge(_Node hole, _Node outerNode) {
  var p = outerNode;
  final hx = hole.x, hy = hole.y;
  var qx = double.negativeInfinity;
  _Node? m;
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y != p.y) {
      final x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x == hx) return m;
      }
    }
    p = p.next;
  } while (!identical(p, outerNode));
  if (m == null) return null;
  final stop = m;
  final mx = m.x, my = m.y;
  var tanMin = double.infinity;
  p = m;
  do {
    if (hx >= p.x &&
        p.x >= mx &&
        hx != p.x &&
        _pointInTriangle(
          hy < my ? hx : qx,
          hy,
          mx,
          my,
          hy < my ? qx : hx,
          hy,
          p.x,
          p.y,
        )) {
      final tan = (hy - p.y).abs() / (hx - p.x);
      if (_locallyInside(p, hole) &&
          (tan < tanMin ||
              (tan == tanMin &&
                  (p.x > m!.x ||
                      (p.x == m.x && _sectorContainsSector(m, p)))))) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next;
  } while (!identical(p, stop));
  return m;
}

bool _sectorContainsSector(_Node m, _Node p) =>
    _area(m.prev, m, p.prev) < 0 && _area(p.next, m, m.next) < 0;

_Node _getLeftmost(_Node start) {
  var p = start, leftmost = start;
  do {
    if (p.x < leftmost.x || (p.x == leftmost.x && p.y < leftmost.y)) {
      leftmost = p;
    }
    p = p.next;
  } while (!identical(p, start));
  return leftmost;
}

bool _pointInTriangle(
  double ax,
  double ay,
  double bx,
  double by,
  double cx,
  double cy,
  double px,
  double py,
) =>
    (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
    (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
    (bx - px) * (cy - py) >= (cx - px) * (by - py);

bool _isValidDiagonal(_Node a, _Node b) =>
    a.next.i != b.i &&
    a.prev.i != b.i &&
    !_intersectsPolygon(a, b) &&
    ((_locallyInside(a, b) &&
            _locallyInside(b, a) &&
            _middleInside(a, b) &&
            (_area(a.prev, a, b.prev) != 0 || _area(a, b.prev, b) != 0)) ||
        (_equals(a, b) &&
            _area(a.prev, a, a.next) > 0 &&
            _area(b.prev, b, b.next) > 0));

double _area(_Node p, _Node q, _Node r) =>
    (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);

bool _equals(_Node a, _Node b) => a.x == b.x && a.y == b.y;

int _sign(double v) => v > 0 ? 1 : (v < 0 ? -1 : 0);

bool _onSegment(_Node p, _Node q, _Node r) =>
    q.x <= math.max(p.x, r.x) &&
    q.x >= math.min(p.x, r.x) &&
    q.y <= math.max(p.y, r.y) &&
    q.y >= math.min(p.y, r.y);

bool _intersects(_Node p1, _Node q1, _Node p2, _Node q2) {
  final o1 = _sign(_area(p1, q1, p2));
  final o2 = _sign(_area(p1, q1, q2));
  final o3 = _sign(_area(p2, q2, p1));
  final o4 = _sign(_area(p2, q2, q1));
  if (o1 != o2 && o3 != o4) return true;
  if (o1 == 0 && _onSegment(p1, p2, q1)) return true;
  if (o2 == 0 && _onSegment(p1, q2, q1)) return true;
  if (o3 == 0 && _onSegment(p2, p1, q2)) return true;
  if (o4 == 0 && _onSegment(p2, q1, q2)) return true;
  return false;
}

bool _intersectsPolygon(_Node a, _Node b) {
  var p = a;
  do {
    if (p.i != a.i &&
        p.next.i != a.i &&
        p.i != b.i &&
        p.next.i != b.i &&
        _intersects(p, p.next, a, b)) {
      return true;
    }
    p = p.next;
  } while (!identical(p, a));
  return false;
}

bool _locallyInside(_Node a, _Node b) => _area(a.prev, a, a.next) < 0
    ? _area(a, b, a.next) >= 0 && _area(a, a.prev, b) >= 0
    : _area(a, b, a.prev) < 0 || _area(a, a.next, b) < 0;

bool _middleInside(_Node a, _Node b) {
  var p = a;
  var inside = false;
  final px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
  do {
    if ((p.y > py) != (p.next.y > py) &&
        p.next.y != p.y &&
        px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x) {
      inside = !inside;
    }
    p = p.next;
  } while (!identical(p, a));
  return inside;
}

_Node _splitPolygon(_Node a, _Node b) {
  final a2 = _Node(a.i, a.x, a.y), b2 = _Node(b.i, b.x, b.y);
  final an = a.next, bp = b.prev;
  a.next = b;
  b.prev = a;
  a2.next = an;
  an.prev = a2;
  b2.next = a2;
  a2.prev = b2;
  bp.next = b2;
  b2.prev = bp;
  return b2;
}

_Node _insertNode(int i, double x, double y, _Node? last) {
  final p = _Node(i, x, y);
  if (last == null) {
    p.prev = p;
    p.next = p;
  } else {
    p.next = last.next;
    p.prev = last;
    last.next.prev = p;
    last.next = p;
  }
  return p;
}

void _removeNode(_Node p) {
  p.next.prev = p.prev;
  p.prev.next = p.next;
}

double _signedAreaData(List<double> data, int start, int end) {
  var sum = 0.0;
  for (var i = start, j = end - 2; i < end; i += 2) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
    j = i;
  }
  return sum;
}

// ------------------------------------------------------------ convex clips

/// A half-plane `n . p >= d`.
class HalfPlane {
  const HalfPlane(this.nx, this.ny, this.d);

  /// The side of the line through [a] -> [b] on its left (counter-clockwise).
  factory HalfPlane.leftOf(Vector2 a, Vector2 b) {
    final n = Vector2(-(b.y - a.y), b.x - a.x)..normalize();
    return HalfPlane(n.x, n.y, n.x * a.x + n.y * a.y);
  }

  final double nx, ny, d;
  double eval(Vector2 p) => nx * p.x + ny * p.y - d;
  HalfPlane get flipped => HalfPlane(-nx, -ny, -d);
}

/// Sutherland-Hodgman: clips a convex (or any) polygon to [planes].
Ring clipToHalfPlanes(Ring polygon, List<HalfPlane> planes) {
  var out = polygon;
  for (final plane in planes) {
    if (out.isEmpty) break;
    final input = out;
    out = <Vector2>[];
    for (var i = 0; i < input.length; i++) {
      final a = input[i], b = input[(i + 1) % input.length];
      final da = plane.eval(a), db = plane.eval(b);
      if (da >= 0) out.add(a);
      if ((da >= 0) != (db >= 0)) {
        final t = da / (da - db);
        out.add(a + (b - a) * t);
      }
    }
  }
  return out;
}

// ------------------------------------------------------- oriented boxes

/// A minimum-area oriented rectangle: [axis] is the unit long axis,
/// [halfLength] along it and [halfWidth] across.
class OrientedBox {
  OrientedBox(this.center, this.axis, this.halfLength, this.halfWidth);
  final Vector2 center, axis;
  final double halfLength, halfWidth;
  Vector2 get across => Vector2(-axis.y, axis.x);

  /// Coordinates of [p] along the long axis and across it.
  (double, double) local(Vector2 p) {
    final d = p - center;
    return (d.dot(axis), d.dot(across));
  }
}

List<Vector2> convexHull(List<Vector2> points) {
  final pts = [...points]
    ..sort((a, b) => a.x != b.x ? a.x.compareTo(b.x) : a.y.compareTo(b.y));
  if (pts.length < 3) return pts;
  double cross(Vector2 o, Vector2 a, Vector2 b) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  final lower = <Vector2>[], upper = <Vector2>[];
  for (final p in pts) {
    while (lower.length >= 2 &&
        cross(lower[lower.length - 2], lower.last, p) <= 0) {
      lower.removeLast();
    }
    lower.add(p);
  }
  for (final p in pts.reversed) {
    while (upper.length >= 2 &&
        cross(upper[upper.length - 2], upper.last, p) <= 0) {
      upper.removeLast();
    }
    upper.add(p);
  }
  lower.removeLast();
  upper.removeLast();
  return [...lower, ...upper];
}

OrientedBox orientedBox(List<Vector2> points) {
  final hull = convexHull(points);
  OrientedBox? best;
  var bestArea = double.infinity;
  for (var i = 0; i < hull.length; i++) {
    final edge = hull[(i + 1) % hull.length] - hull[i];
    if (edge.length < 1e-6) continue;
    final u = edge.normalized(), v = Vector2(-u.y, u.x);
    var minU = double.infinity, maxU = -double.infinity;
    var minV = double.infinity, maxV = -double.infinity;
    for (final p in hull) {
      final a = p.dot(u), b = p.dot(v);
      minU = math.min(minU, a);
      maxU = math.max(maxU, a);
      minV = math.min(minV, b);
      maxV = math.max(maxV, b);
    }
    final area = (maxU - minU) * (maxV - minV);
    if (area < bestArea - 1e-6) {
      bestArea = area;
      final center = u * ((minU + maxU) / 2) + v * ((minV + maxV) / 2);
      final lu = (maxU - minU) / 2, lv = (maxV - minV) / 2;
      best = lu >= lv
          ? OrientedBox(center, u, lu, lv)
          : OrientedBox(center, v, lv, lu);
    }
  }
  return best ?? OrientedBox(points.first, Vector2(1, 0), .5, .5);
}

/// The bounding rectangle of [points] whose long axis is forced to
/// [axis] (a unit vector): the ridge follows [axis] even when the
/// rectangle is deeper than it is long.
OrientedBox boxAlong(List<Vector2> points, Vector2 axis) {
  final u = axis.normalized(), v = Vector2(-u.y, u.x);
  var minU = double.infinity, maxU = -double.infinity;
  var minV = double.infinity, maxV = -double.infinity;
  for (final p in points) {
    final a = p.dot(u), b = p.dot(v);
    minU = math.min(minU, a);
    maxU = math.max(maxU, a);
    minV = math.min(minV, b);
    maxV = math.max(maxV, b);
  }
  final center = u * ((minU + maxU) / 2) + v * ((minV + maxV) / 2);
  return OrientedBox(center, u, (maxU - minU) / 2, (maxV - minV) / 2);
}

/// Distance from [p] to segment [a]-[b].
double distanceToSegment(Vector2 p, Vector2 a, Vector2 b) {
  final ab = b - a;
  final t = ab.length2 == 0 ? 0.0 : ((p - a).dot(ab) / ab.length2).clamp(0, 1);
  return (a + ab * t.toDouble() - p).length;
}

/// Where segments [a]-[b] and [c]-[d] cross, as the parameter along a-b.
double? segmentIntersection(Vector2 a, Vector2 b, Vector2 c, Vector2 d) {
  final r = b - a, s = d - c;
  final denom = r.x * s.y - r.y * s.x;
  if (denom.abs() < 1e-12) return null;
  final t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  final u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}
