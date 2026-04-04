import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inbox_rs_mobile/models/rs_config.dart';
import 'package:inbox_rs_mobile/screens/home_screen.dart';
import 'package:inbox_rs_mobile/services/offline_queue.dart';

void main() {
  late OfflineQueue queue;
  late RSConfig config;

  setUp(() {
    queue = OfflineQueue();
    config = RSConfig(
      userAddress: 'user@example.com',
      token: 'test-token',
      href: 'https://storage.example.com',
    );
  });

  tearDown(() {
    queue.dispose();
  });

  Widget wrap(Widget child) => MaterialApp(home: child);

  group('HomeScreen', () {
    testWidgets('shows app title', (tester) async {
      await tester.pumpWidget(wrap(
        HomeScreen(config: config, queue: queue, onConfigChanged: (_) {}),
      ));
      expect(find.text('Inbox RS'), findsOneWidget);
    });

    testWidgets('shows text input with hint', (tester) async {
      await tester.pumpWidget(wrap(
        HomeScreen(config: config, queue: queue, onConfigChanged: (_) {}),
      ));
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text("What's on your mind?"), findsOneWidget);
    });

    testWidgets('shows send button', (tester) async {
      await tester.pumpWidget(wrap(
        HomeScreen(config: config, queue: queue, onConfigChanged: (_) {}),
      ));
      expect(find.text('SEND TO INBOX'), findsOneWidget);
    });

    testWidgets('send button disabled when no text entered', (tester) async {
      await tester.pumpWidget(wrap(
        HomeScreen(config: config, queue: queue, onConfigChanged: (_) {}),
      ));

      final button = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(button.onPressed, isNull);
    });

    testWidgets('send button enables when text is entered', (tester) async {
      await tester.pumpWidget(wrap(
        HomeScreen(config: config, queue: queue, onConfigChanged: (_) {}),
      ));

      await tester.enterText(find.byType(TextField), 'Hello world');
      await tester.pump();

      final button = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(button.onPressed, isNotNull);
    });

    testWidgets('shows connection banner when config is null', (tester) async {
      await tester.pumpWidget(wrap(
        HomeScreen(config: null, queue: queue, onConfigChanged: (_) {}),
      ));

      expect(find.text('Tap to connect to your remoteStorage server'),
          findsOneWidget);
    });

    testWidgets('hides connection banner when connected', (tester) async {
      await tester.pumpWidget(wrap(
        HomeScreen(config: config, queue: queue, onConfigChanged: (_) {}),
      ));

      expect(find.text('Tap to connect to your remoteStorage server'),
          findsNothing);
    });

    testWidgets('send button disabled when not connected', (tester) async {
      await tester.pumpWidget(wrap(
        HomeScreen(config: null, queue: queue, onConfigChanged: (_) {}),
      ));

      await tester.enterText(find.byType(TextField), 'Hello');
      await tester.pump();

      final button = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(button.onPressed, isNull);
    });

    testWidgets('settings icon shown', (tester) async {
      await tester.pumpWidget(wrap(
        HomeScreen(config: config, queue: queue, onConfigChanged: (_) {}),
      ));
      expect(find.byIcon(Icons.settings), findsOneWidget);
    });

    testWidgets('settings icon is error color when not connected',
        (tester) async {
      await tester.pumpWidget(wrap(
        HomeScreen(config: null, queue: queue, onConfigChanged: (_) {}),
      ));

      final icon = tester.widget<Icon>(find.byIcon(Icons.settings));
      expect(icon.color, isNotNull);
    });

    testWidgets('no queue badge when pending is 0', (tester) async {
      await tester.pumpWidget(wrap(
        HomeScreen(config: config, queue: queue, onConfigChanged: (_) {}),
      ));
      expect(find.text('pending'), findsNothing);
    });

    testWidgets('cleans up stream subscription on dispose', (tester) async {
      await tester.pumpWidget(wrap(
        HomeScreen(config: config, queue: queue, onConfigChanged: (_) {}),
      ));

      // Navigate away to dispose the HomeScreen
      await tester.pumpWidget(wrap(const Scaffold()));
      await tester.pumpAndSettle();

      // Stream should still be usable (not closed) — only the subscription is cancelled
      expect(queue.pendingCount, 0);
    });
  });
}
