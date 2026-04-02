enum InboxItemType {
  note,
  image,
  audio,
  video,
}

extension InboxItemTypeString on InboxItemType {
  String get value {
    switch (this) {
      case InboxItemType.note:
        return 'note';
      case InboxItemType.image:
        return 'image';
      case InboxItemType.audio:
        return 'audio';
      case InboxItemType.video:
        return 'video';
    }
  }
}

class InboxItem {
  final String id;
  final InboxItemType type;
  final String title;
  final String createdAt;
  final String? body;
  final String? description;
  final String? filePath;
  final String? mimeType;
  final double? duration;

  InboxItem({
    required this.id,
    required this.type,
    required this.title,
    required this.createdAt,
    this.body,
    this.description,
    this.filePath,
    this.mimeType,
    this.duration,
  });

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{
      'id': id,
      'type': type.value,
      'title': title,
      'createdAt': createdAt,
      '_migrateVersion': 1,
    };
    if (body != null) map['body'] = body;
    if (description != null) map['description'] = description;
    if (filePath != null) map['filePath'] = filePath;
    if (mimeType != null) map['mimeType'] = mimeType;
    if (duration != null) map['duration'] = duration;
    return map;
  }
}
