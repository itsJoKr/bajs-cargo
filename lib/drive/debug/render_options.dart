/// Render switches read from the page URL, for measuring the web build from
/// a browser (no VM service there, so the probe can't reach it):
///
///     http://127.0.0.1:8080/?bench=1&scale=.5&shadows=0&ao=0&aa=none
///
/// `scale` the render scale, `shadows`/`ao`/`trees` 0 or 1, `aa` one of
/// none/fxaa/msaa/auto, `shadowres` the shadow map size, `cascades` the
/// cascade count, `fps=1` a frame-time readout, `bench=1` flies the camera
/// around the square and prints frame times to the console. On Android the
/// URL has no query, so everything keeps its default.
class RenderOptions {
  RenderOptions._(this._query);

  static final RenderOptions current = RenderOptions._(
    Uri.base.queryParameters,
  );

  final Map<String, String> _query;

  double? _number(String key) => double.tryParse(_query[key] ?? '');
  bool _flag(String key, bool fallback) => switch (_query[key]) {
    '0' || 'false' || 'off' => false,
    '1' || 'true' || 'on' => true,
    _ => fallback,
  };

  double? get scale => _number('scale');
  bool get shadows => _flag('shadows', true);
  bool get ambientOcclusion => _flag('ao', true);
  bool get trees => _flag('trees', true);
  String? get antiAliasing => _query['aa'];
  int? get shadowResolution => _number('shadowres')?.round();
  int? get shadowCascades => _number('cascades')?.round();
  bool get bench => _flag('bench', false);
  bool get showFrameTime => bench || _flag('fps', false);

  /// Every switch that was set, for the bench log.
  String describe() => _query.isEmpty
      ? 'defaults'
      : (_query.entries.map((e) => '${e.key}=${e.value}').toList()..sort())
            .join(' ');
}
