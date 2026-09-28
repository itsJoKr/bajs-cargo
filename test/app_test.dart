import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:zagreb_drive/app.dart';

void main() {
  testWidgets('the app shell builds without touching Flutter GPU', (
    tester,
  ) async {
    await tester.pumpWidget(
      const ZagrebDriveApp(home: Text('home', key: ValueKey('home'))),
    );
    expect(find.byKey(const ValueKey('home')), findsOneWidget);
  });
}
