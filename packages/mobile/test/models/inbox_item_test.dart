import 'package:flutter_test/flutter_test.dart';
import 'package:inbox_rs_mobile/models/inbox_item.dart';

void main() {
  group('InboxItemType', () {
    test('value returns correct strings', () {
      expect(InboxItemType.note.value, 'note');
      expect(InboxItemType.image.value, 'image');
      expect(InboxItemType.audio.value, 'audio');
      expect(InboxItemType.video.value, 'video');
    });
  });

  group('InboxItem', () {
    test('toJson includes required fields and _migrateVersion', () {
      final item = InboxItem(
        id: 'abc-123',
        type: InboxItemType.note,
        title: 'Test note',
        createdAt: '2026-04-04T00:00:00.000Z',
      );
      final json = item.toJson();

      expect(json['id'], 'abc-123');
      expect(json['type'], 'note');
      expect(json['title'], 'Test note');
      expect(json['createdAt'], '2026-04-04T00:00:00.000Z');
      expect(json['_migrateVersion'], 1);
    });

    test('toJson omits null optional fields', () {
      final item = InboxItem(
        id: 'abc-123',
        type: InboxItemType.note,
        title: 'Test',
        createdAt: '2026-04-04T00:00:00.000Z',
      );
      final json = item.toJson();

      expect(json.containsKey('body'), false);
      expect(json.containsKey('description'), false);
      expect(json.containsKey('filePath'), false);
      expect(json.containsKey('mimeType'), false);
      expect(json.containsKey('duration'), false);
    });

    test('toJson includes optional fields when set', () {
      final item = InboxItem(
        id: 'abc-123',
        type: InboxItemType.audio,
        title: 'Voice memo',
        createdAt: '2026-04-04T00:00:00.000Z',
        body: 'Some text',
        filePath: 'files/abc-123.wav',
        mimeType: 'audio/wav',
        duration: 15.0,
      );
      final json = item.toJson();

      expect(json['body'], 'Some text');
      expect(json['filePath'], 'files/abc-123.wav');
      expect(json['mimeType'], 'audio/wav');
      expect(json['duration'], 15.0);
    });
  });
}
