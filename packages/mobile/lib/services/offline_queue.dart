import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;
import 'direct_rs.dart';

class QueuedItem {
  final String id;
  final Map<String, dynamic> item;
  final bool hasFile;
  int retryCount;

  static const maxRetries = 5;

  QueuedItem({
    required this.id,
    required this.item,
    required this.hasFile,
    this.retryCount = 0,
  });
}

class OfflineQueue {
  DirectRS? _rs;
  final List<QueuedItem> _pending = [];
  bool _processing = false;
  String? _cachedQueueDir;
  final _pendingController = StreamController<int>.broadcast();

  int get pendingCount => _pending.length;
  Stream<int> get pendingChanges => _pendingController.stream;

  void setDirectRS(DirectRS? rs) {
    _rs = rs;
    if (rs != null) _processQueue();
  }

  Future<String> get _queueDir async {
    if (_cachedQueueDir != null) return _cachedQueueDir!;
    final appDir = await getApplicationSupportDirectory();
    final dir = p.join(appDir.path, 'queue');
    await Directory(dir).create(recursive: true);
    _cachedQueueDir = dir;
    return dir;
  }

  void dispose() {
    _pendingController.close();
  }

  void _notifyListeners() {
    if (!_pendingController.isClosed) {
      _pendingController.add(_pending.length);
    }
  }

  Future<void> enqueue({
    required Map<String, dynamic> item,
    Uint8List? fileData,
  }) async {
    final id = item['id'] as String;
    final dir = await _queueDir;
    final itemDir = p.join(dir, id);
    await Directory(itemDir).create(recursive: true);

    try {
      await File(p.join(itemDir, 'item.json'))
          .writeAsString(jsonEncode(item));

      if (fileData != null) {
        await File(p.join(itemDir, 'file.bin')).writeAsBytes(fileData);
      }
    } catch (e) {
      try {
        await Directory(itemDir).delete(recursive: true);
      } catch (_) {}
      rethrow;
    }

    _pending.add(QueuedItem(id: id, item: item, hasFile: fileData != null));
    _notifyListeners();

    // Attempt upload in background — don't block the caller
    _processQueue();
  }

  Future<void> loadFromDisk() async {
    final dir = await _queueDir;
    final queueDir = Directory(dir);
    if (!await queueDir.exists()) return;

    final entries = await queueDir.list().toList();
    for (final entry in entries) {
      if (entry is Directory) {
        final itemFile = File(p.join(entry.path, 'item.json'));
        if (await itemFile.exists()) {
          try {
            final item = jsonDecode(await itemFile.readAsString())
                as Map<String, dynamic>;
            final id = item['id'] as String;
            final hasFile =
                await File(p.join(entry.path, 'file.bin')).exists();
            if (!_pending.any((q) => q.id == id)) {
              _pending.add(
                  QueuedItem(id: id, item: item, hasFile: hasFile));
            }
          } catch (e) {
            debugPrint('[offline_queue] Corrupted item at ${entry.path}, removing: $e');
            try {
              await entry.delete(recursive: true);
            } catch (_) {}
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
    _notifyListeners();
    await _processQueue();
  }

  Future<void> _processQueue() async {
    if (_processing || _rs == null || _pending.isEmpty) return;

    final connectivity = await Connectivity().checkConnectivity();
    if (connectivity.contains(ConnectivityResult.none)) return;

    _processing = true;
    try {
      while (_pending.isNotEmpty) {
        final queued = _pending.first;

        if (queued.retryCount >= QueuedItem.maxRetries) {
          debugPrint('[offline_queue] Skipping ${queued.id} after ${queued.retryCount} retries');
          _pending.removeAt(0);
          await _removeFromDisk(queued.id);
          _notifyListeners();
          continue;
        }

        try {
          Uint8List? fileData;
          if (queued.hasFile) {
            final dir = await _queueDir;
            final filePath = p.join(dir, queued.id, 'file.bin');
            fileData = await File(filePath).readAsBytes();
          }

          await _rs!.store(queued.item, fileData);

          _pending.removeAt(0);
          await _removeFromDisk(queued.id);
          _notifyListeners();
        } catch (e) {
          debugPrint('[offline_queue] Upload failed for ${queued.id} (attempt ${queued.retryCount + 1}): $e');
          queued.retryCount++;
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

  void onConnectivityChanged() {
    _processQueue();
  }
}
