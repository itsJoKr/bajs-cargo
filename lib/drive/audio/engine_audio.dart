import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';

/// The engine: one seamless loop (`assets/audio/car-engine.wav`) whose
/// playback rate, and so pitch, follows the car's speed and load.
///
/// The loop runs in [PlayerMode.lowLatency], which on Android is a
/// SoundPool stream: its rate resamples, so a faster rate is a higher note
/// (a MediaPlayer rate would time-stretch at constant pitch). Every call is
/// safe to make every frame: changes are pushed at most 20 times a second
/// and only when they are audible. A platform without audio stays silent.
class EngineAudio {
  EngineAudio() {
    unawaited(_start());
  }

  AudioPlayer? _player;
  bool _disposed = false, _failed = false;
  double _rate = 1, _volume = 0;
  double _sentRate = -1, _sentVolume = -1;
  DateTime _lastPush = DateTime.fromMillisecondsSinceEpoch(0);

  Future<void> _start() async {
    try {
      final player = AudioPlayer();
      await player.setPlayerMode(PlayerMode.lowLatency);
      await player.setReleaseMode(ReleaseMode.loop);
      await player.setVolume(0);
      await player.setSource(AssetSource('audio/car-engine.wav'));
      if (_disposed) {
        await player.dispose();
        return;
      }
      _player = player;
      await player.resume();
    } catch (error) {
      _failed = true;
      debugPrint('Engine audio unavailable: $error');
    }
  }

  /// [speedFraction] is |speed| / top speed, [throttle] 0..1.
  void update({required double speedFraction, required double throttle}) {
    if (_failed || _disposed) return;
    // Idle near 0.65x, revving to about 1.9x at top speed; load adds a bit.
    _rate = (.65 + 1.1 * speedFraction + .15 * throttle).clamp(.5, 2.0);
    _volume = (.18 + .25 * throttle + .2 * speedFraction).clamp(0.0, .6);
    final player = _player;
    if (player == null) return;
    final now = DateTime.now();
    if (now.difference(_lastPush).inMilliseconds < 50) return;
    if ((_rate - _sentRate).abs() > .015) {
      _sentRate = _rate;
      unawaited(player.setPlaybackRate(_rate).catchError((_) {}));
      _lastPush = now;
    }
    if ((_volume - _sentVolume).abs() > .02) {
      _sentVolume = _volume;
      unawaited(player.setVolume(_volume).catchError((_) {}));
      _lastPush = now;
    }
  }

  void mute() {
    _volume = 0;
    _sentVolume = 0;
    unawaited(_player?.setVolume(0).catchError((_) {}));
  }

  Future<void> dispose() async {
    _disposed = true;
    await _player?.dispose();
  }
}
