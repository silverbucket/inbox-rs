import 'inbox_item.dart';

class Attachment {
  final String path;
  final String mimeType;
  final InboxItemType type;
  final double? duration;

  const Attachment({
    required this.path,
    required this.mimeType,
    required this.type,
    this.duration,
  });
}
