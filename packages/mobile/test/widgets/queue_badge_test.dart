import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inbox_rs_mobile/widgets/queue_badge.dart';

void main() {
  Widget wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

  group('QueueBadge', () {
    testWidgets('renders nothing when count is 0', (tester) async {
      await tester.pumpWidget(wrap(const QueueBadge(count: 0)));
      expect(find.byType(SizedBox), findsOneWidget);
      expect(find.text('0 pending'), findsNothing);
    });

    testWidgets('shows count and upload icon when count > 0', (tester) async {
      await tester.pumpWidget(wrap(const QueueBadge(count: 3)));
      expect(find.text('3 pending'), findsOneWidget);
      expect(find.byIcon(Icons.cloud_upload_outlined), findsOneWidget);
    });

    testWidgets('updates when count changes', (tester) async {
      await tester.pumpWidget(wrap(const QueueBadge(count: 1)));
      expect(find.text('1 pending'), findsOneWidget);

      await tester.pumpWidget(wrap(const QueueBadge(count: 5)));
      expect(find.text('5 pending'), findsOneWidget);
    });
  });
}
