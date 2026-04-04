import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inbox_rs_mobile/models/inbox_item.dart';
import 'package:inbox_rs_mobile/widgets/media_preview.dart';

void main() {
  Widget wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

  group('MediaPreview', () {
    testWidgets('shows audio preview with duration', (tester) async {
      await tester.pumpWidget(wrap(
        MediaPreview(
          filePath: '/tmp/test.wav',
          type: InboxItemType.audio,
          duration: 12.0,
          onRemove: () {},
        ),
      ));

      expect(find.text('Recording (12s)'), findsOneWidget);
      expect(find.byIcon(Icons.mic), findsOneWidget);
    });

    testWidgets('shows audio preview without duration', (tester) async {
      await tester.pumpWidget(wrap(
        MediaPreview(
          filePath: '/tmp/test.wav',
          type: InboxItemType.audio,
          onRemove: () {},
        ),
      ));

      expect(find.text('Audio recording'), findsOneWidget);
    });

    testWidgets('shows video preview with duration', (tester) async {
      await tester.pumpWidget(wrap(
        MediaPreview(
          filePath: '/tmp/test.mp4',
          type: InboxItemType.video,
          duration: 30.0,
          onRemove: () {},
        ),
      ));

      expect(find.text('Video (30s)'), findsOneWidget);
      expect(find.byIcon(Icons.videocam), findsOneWidget);
    });

    testWidgets('shows close button', (tester) async {
      await tester.pumpWidget(wrap(
        MediaPreview(
          filePath: '/tmp/test.wav',
          type: InboxItemType.audio,
          onRemove: () {},
        ),
      ));

      expect(find.byIcon(Icons.close), findsOneWidget);
    });

    testWidgets('calls onRemove when close is tapped', (tester) async {
      var removed = false;
      await tester.pumpWidget(wrap(
        MediaPreview(
          filePath: '/tmp/test.wav',
          type: InboxItemType.audio,
          onRemove: () => removed = true,
        ),
      ));

      await tester.tap(find.byIcon(Icons.close));
      expect(removed, true);
    });

    testWidgets('renders empty for note type', (tester) async {
      await tester.pumpWidget(wrap(
        MediaPreview(
          filePath: '/tmp/test.txt',
          type: InboxItemType.note,
          onRemove: () {},
        ),
      ));

      expect(find.byType(SizedBox), findsWidgets);
    });
  });
}
