import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import 'app.dart';
import 'drive/debug/scene_probe.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Before the first frame: the engine compiles the capture branch out unless
  // it is opted in at startup.
  if (kDebugMode) SceneProbe.arm();
  unawaited(
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]),
  );
  unawaited(SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky));
  runApp(const ZagrebDriveApp());
}
