import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../scene/drive_game.dart';
import 'drive_view.dart';

/// Loads and warms up the game once per app run.
final driveGameProvider = FutureProvider<DriveGame>((ref) async {
  // Put the static loading screen on the display before warm-up blocks the
  // UI thread for a few seconds.
  await WidgetsBinding.instance.endOfFrame;
  await Future<void>.delayed(const Duration(milliseconds: 100));
  return DriveGame.load();
});

/// A static loading screen while the city loads and its pipelines compile,
/// then the game. Deliberately without animation: `Scene.warmUp` blocks the
/// UI thread, so a spinner would visibly freeze.
class LoadingScreen extends ConsumerWidget {
  const LoadingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final game = ref.watch(driveGameProvider);
    return switch (game) {
      AsyncData(:final value) => DriveView(game: value),
      AsyncError(:final error) => _Message(
        key: const ValueKey('startup_error'),
        title: 'ZAGREB DRIVE',
        detail: 'Could not load the city: $error',
      ),
      _ => const _Message(
        key: ValueKey('startup_loading'),
        title: 'ZAGREB DRIVE',
        detail: 'Loading the city…',
      ),
    };
  }
}

class _Message extends StatelessWidget {
  const _Message({super.key, required this.title, required this.detail});

  final String title, detail;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0E1116),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              title,
              style: const TextStyle(
                color: Color(0xFFF4EBDD),
                fontSize: 30,
                fontWeight: FontWeight.w900,
                letterSpacing: 3,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              detail,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0x99F4EBDD), fontSize: 14),
            ),
          ],
        ),
      ),
    );
  }
}
