import 'package:flutter_test/flutter_test.dart';
import 'package:inbox_rs_mobile/main.dart';

void main() {
  testWidgets('App launches with loading indicator', (WidgetTester tester) async {
    await tester.pumpWidget(const InboxRSApp());
    // App shows loading spinner while async init runs
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
