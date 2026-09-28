import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'drive/widgets/loading_screen.dart';

class ZagrebDriveApp extends StatelessWidget {
  const ZagrebDriveApp({super.key, this.home});

  /// Replaces the loading screen; widget tests inject a plain widget here so
  /// they never touch Flutter GPU.
  final Widget? home;

  @override
  Widget build(BuildContext context) => ProviderScope(
    child: MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Zagreb Drive',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1F4E9C),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: home ?? const LoadingScreen(),
    ),
  );
}
