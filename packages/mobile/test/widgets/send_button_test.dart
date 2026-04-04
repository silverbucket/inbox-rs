import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inbox_rs_mobile/widgets/send_button.dart';

void main() {
  Widget wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

  group('SendButton', () {
    testWidgets('shows SEND TO INBOX when idle', (tester) async {
      await tester.pumpWidget(wrap(
        SendButton(state: SendState.idle, enabled: true, onPressed: () {}),
      ));
      expect(find.text('SEND TO INBOX'), findsOneWidget);
    });

    testWidgets('shows progress indicator when sending', (tester) async {
      await tester.pumpWidget(wrap(
        SendButton(state: SendState.sending, enabled: true, onPressed: () {}),
      ));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('SEND TO INBOX'), findsNothing);
    });

    testWidgets('shows check icon when sent', (tester) async {
      await tester.pumpWidget(wrap(
        SendButton(state: SendState.sent, enabled: true, onPressed: () {}),
      ));
      expect(find.byIcon(Icons.check), findsOneWidget);
    });

    testWidgets('button is disabled when enabled=false', (tester) async {
      var pressed = false;
      await tester.pumpWidget(wrap(
        SendButton(
          state: SendState.idle,
          enabled: false,
          onPressed: () => pressed = true,
        ),
      ));

      await tester.tap(find.byType(FilledButton));
      expect(pressed, false);
    });

    testWidgets('button is disabled when sending', (tester) async {
      var pressed = false;
      await tester.pumpWidget(wrap(
        SendButton(
          state: SendState.sending,
          enabled: true,
          onPressed: () => pressed = true,
        ),
      ));

      await tester.tap(find.byType(FilledButton));
      expect(pressed, false);
    });

    testWidgets('calls onPressed when idle and enabled', (tester) async {
      var pressed = false;
      await tester.pumpWidget(wrap(
        SendButton(
          state: SendState.idle,
          enabled: true,
          onPressed: () => pressed = true,
        ),
      ));

      await tester.tap(find.byType(FilledButton));
      expect(pressed, true);
    });
  });
}
