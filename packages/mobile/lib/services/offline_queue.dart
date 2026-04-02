import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;
import 'direct_rs.dart';

class QueuedItem {
  final String id;
  final Map<String, dynamic> item;
  final bool hasFile;

  QueuedItem({required this.id, required this.item, required this.hasFile});
}

class OfflineQueue {
  DirectRS? _rs;
  final List<QueuedItem> _pending = [];
  bool _processing = false;
  void Function(int pendingCount)? onPendingChanged;

  int get pendingCount => _pending.length;

  void setDirectRS(DirectRS? rs) {
    _rs = rs;
    if (rs != null) _processQueue();
  }

  Future<String> get _queueDir async {
    final appDir = await getApplicationDocumentsDirectory();
    final dir = p.join(appDir.path, 'queue');
    await Directory(dir).create(recursive: true);
    return dir;
  }

  /// Enqueue an item for sending. Saves locally first, then attempts upload.
  Future<void> enqueue({
    required Map<String, dynamic> item,
    Uint8List? fileData,
  }) async {
    final id = item['id'] as String;
    final dir = await _queueDir;
    final itemDir = p.join(dir, id);
    await Directory(itemDir).create(recursive: true);

    // Write item JSON
    await File(p.join(itemDir, 'item.json')).writeAsString(jsonEncode(item));

    // Write file data if present
    if (fileData != null) {
      await File(p.join(itemDir, 'file.bin')).writeAsBytes(fileData);
    }

    _pending.add(QueuedItem(id: id, item: item, hasFile: fileData != null));
    onPendingChanged?.call(_pending.length);

    // Attempt immediate upload
    await _processQueue();
  }

  /// Load any unprocessed items from disk on app startup.
  Future<void> loadFromDisk() async {
    final dir = await _queueDir;
    final queueDir = Directory(dir);
    if (!await queueDir.exists()) return;

    final entries = await queueDir.list().toList();
    for (final entry in entries) {
      if (entry is Directory) {
        final itemFile = File(p.join(entry.path, 'item.json'));
        if (await itemFile.exists()) {
          final item =
              jsonDecode(await itemFile.readAsString()) as Map<String, dynamic>;
          final id = item['id'] as String;
          final hasFile = await File(p.join(entry.path, 'file.bin')).exists();
          // Avoid duplicates
          if (!_pending.any((q) => q.id == id)) {
            _pending.add(QueuedItem(id: id, item: item, hasFile: hasFile));
          }
        }
      }
    }
    // Sort by createdAt to maintain FIFO order across restarts
    _pending.sort((a, b) {
      final aTime = a.item['createdAt'] as String? ?? '';
      final bTime = b.item['createdAt'] as String? ?? '';
      return aTime.compareTo(bTime);
    });
    onPendingChanged?.call(_pending.length);
    await _processQueue();
  }

  /// Process all pending items in FIFO order.
  Future<void> _processQueue() async {
    if (_processing || _rs == null || _pending.isEmpty) return;

    // Check connectivity
    final connectivity = await Connectivity().checkConnectivity();
    if (connectivity.contains(ConnectivityResult.none)) return;

    _processing = true;
    try {
      while (_pending.isNotEmpty) {
        final queued = _pending.first;
        try {
          Uint8List? fileData;
          if (queued.hasFile) {
            final dir = await _queueDir;
            final filePath = p.join(dir, queued.id, 'file.bin');
            fileData = await File(filePath).readAsBytes();
          }

          await _rs!.store(queued.item, fileData);

          // Success -- remove from queue and disk
          _pending.removeAt(0);
          await _removeFromDisk(queued.id);
          onPendingChanged?.call(_pending.length);
        } catch (e) {
          // Upload failed -- stop processing, will retry later
          break;
        }
      }
    } finally {
      _processing = false;
    }
  }

  Future<void> _removeFromDisk(String id) async {
    final dir = await _queueDir;
    final itemDir = Directory(p.join(dir, id));
    if (await itemDir.exists()) {
      await itemDir.delete(recursive: true);
    }
  }

  /// Call when connectivity changes to retry pending items.
  void onConnectivityChanged() {
    _processQueue();
  }
}
