import 'package:flutter_test/flutter_test.dart';
import 'package:inbox_rs_mobile/main.dart';

void main() {
  testWidgets('App launches', (WidgetTester tester) async {
    await tester.pumpWidget(const InboxRSApp());
    await tester.pump();
    // Settings screen shows when not connected
    expect(find.text('Connect to remoteStorage'), findsOneWidget);
  });
}
