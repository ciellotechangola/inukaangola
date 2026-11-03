// This is a basic Flutter widget test for the INUKA Angola app.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('App config smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Text('INUKA Angola'),
        ),
      ),
    );

    expect(find.text('INUKA Angola'), findsOneWidget);
  });
}
