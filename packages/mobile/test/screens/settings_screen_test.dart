import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inbox_rs_mobile/models/rs_config.dart';
import 'package:inbox_rs_mobile/screens/settings_screen.dart';

void main() {
  Widget wrap(Widget child) => MaterialApp(home: child);

  group('SettingsScreen - not connected', () {
    testWidgets('shows login form', (tester) async {
      await tester.pumpWidget(wrap(
        SettingsScreen(currentConfig: null, onConfigChanged: (_) {}),
      ));

      expect(find.text('Connect to remoteStorage'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Connect'), findsOneWidget);
    });

    testWidgets('shows hint text in address field', (tester) async {
      await tester.pumpWidget(wrap(
        SettingsScreen(currentConfig: null, onConfigChanged: (_) {}),
      ));

      expect(find.text('user@example.com'), findsOneWidget);
    });

    testWidgets('has Settings as title', (tester) async {
      await tester.pumpWidget(wrap(
        SettingsScreen(currentConfig: null, onConfigChanged: (_) {}),
      ));

      expect(find.text('Settings'), findsOneWidget);
    });
  });

  group('SettingsScreen - connected', () {
    final config = RSConfig(
      userAddress: 'testuser@example.com',
      token: 'tok',
      href: 'https://storage.example.com',
    );

    testWidgets('shows connected state with user address', (tester) async {
      await tester.pumpWidget(wrap(
        SettingsScreen(currentConfig: config, onConfigChanged: (_) {}),
      ));

      expect(find.text('Connected'), findsOneWidget);
      expect(find.text('testuser@example.com'), findsOneWidget);
    });

    testWidgets('shows disconnect button', (tester) async {
      await tester.pumpWidget(wrap(
        SettingsScreen(currentConfig: config, onConfigChanged: (_) {}),
      ));

      expect(find.text('Disconnect'), findsOneWidget);
    });

    testWidgets('shows green connection indicator', (tester) async {
      await tester.pumpWidget(wrap(
        SettingsScreen(currentConfig: config, onConfigChanged: (_) {}),
      ));

      // There should be a small circle container for the indicator
      final containers = tester.widgetList<Container>(find.byType(Container));
      final indicator = containers.where((c) {
        final decoration = c.decoration;
        return decoration is BoxDecoration &&
            decoration.shape == BoxShape.circle &&
            c.constraints?.maxWidth == 10;
      });
      expect(indicator.isNotEmpty, true);
    });
  });
}
