import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../models/attachment.dart';
import '../models/inbox_item.dart';
import '../models/rs_config.dart';
import '../services/offline_queue.dart';
import '../utils/mime.dart';
import '../widgets/send_button.dart';
import '../widgets/queue_badge.dart';
import '../widgets/media_preview.dart';
import '../widgets/audio_recorder.dart';
import '../widgets/media_picker.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  final RSConfig? config;
  final OfflineQueue queue;
  final void Function(RSConfig?) onConfigChanged;

  const HomeScreen({
    super.key,
    required this.config,
    required this.queue,
    required this.onConfigChanged,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _bodyController = TextEditingController();
  final _bodyFocusNode = FocusNode();
  final _uuid = const Uuid();

  SendState _sendState = SendState.idle;
  int _pendingCount = 0;
  Attachment? _attachment;
  StreamSubscription<int>? _pendingSub;

  @override
  void initState() {
    super.initState();
    _pendingCount = widget.queue.pendingCount;
    _pendingSub = widget.queue.pendingChanges.listen((count) {
      if (mounted) setState(() => _pendingCount = count);
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (widget.config != null) _bodyFocusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _pendingSub?.cancel();
    _bodyController.dispose();
    _bodyFocusNode.dispose();
    super.dispose();
  }

  bool _canSend(String text) {
    if (widget.config == null) return false;
    return text.trim().isNotEmpty || _attachment != null;
  }

  static const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  String _autoTitle(InboxItemType type) {
    final now = DateTime.now();
    final date = '${_months[now.month - 1]} ${now.day}';
    switch (type) {
      case InboxItemType.note:
        return 'Note - $date';
      case InboxItemType.audio:
        return 'Voice memo - $date';
      case InboxItemType.image:
        return 'Photo - $date';
      case InboxItemType.video:
        return 'Video - $date';
    }
  }

  static String _truncate(String s, int max) =>
      s.length > max ? '${s.substring(0, max)}...' : s;

  Future<void> _send() async {
    if (!_canSend(_bodyController.text)) return;

    setState(() => _sendState = SendState.sending);

    try {
      final id = _uuid.v4();
      final createdAt = DateTime.now().toUtc().toIso8601String();
      final body = _bodyController.text.trim();
      final att = _attachment;

      if (att != null) {
        final ext = extFromMime(att.mimeType);
        final filePath = 'files/$id.$ext';
        final attachPath = att.path;
        final fileBytes = await compute(_readFileBytes, attachPath);

        final item = InboxItem(
          id: id,
          type: att.type,
          title: body.isNotEmpty ? _truncate(body, 50) : _autoTitle(att.type),
          createdAt: createdAt,
          body: body.isNotEmpty ? body : null,
          filePath: filePath,
          mimeType: att.mimeType,
          duration: att.duration,
        );
        await widget.queue.enqueue(item: item.toJson(), fileData: fileBytes);
      } else {
        final item = InboxItem(
          id: id,
          type: InboxItemType.note,
          title: _truncate(body, 50),
          createdAt: createdAt,
          body: body,
        );
        await widget.queue.enqueue(item: item.toJson());
      }

      if (!mounted) return;
      setState(() => _sendState = SendState.sent);
      await Future.delayed(const Duration(milliseconds: 500));
      if (!mounted) return;
      _reset();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed: $e'),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
        setState(() => _sendState = SendState.idle);
      }
    }
  }

  static Uint8List _readFileBytes(String path) {
    return File(path).readAsBytesSync();
  }

  void _reset() {
    _bodyController.clear();
    setState(() {
      _sendState = SendState.idle;
      _attachment = null;
    });
    _bodyFocusNode.requestFocus();
  }

  void _onMediaPicked(String path, String mimeType, bool isVideo) {
    setState(() {
      _attachment = Attachment(
        path: path,
        mimeType: mimeType,
        type: isVideo ? InboxItemType.video : InboxItemType.image,
      );
    });
  }

  void _onRecordingComplete(String path, double duration) {
    setState(() {
      _attachment = Attachment(
        path: path,
        mimeType: 'audio/mp4',
        type: InboxItemType.audio,
        duration: duration,
      );
    });
  }

  void _openSettings() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SettingsScreen(
          currentConfig: widget.config,
          onConfigChanged: widget.onConfigChanged,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isConnected = widget.config != null;
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Inbox RS'),
        centerTitle: false,
        actions: [
          if (_pendingCount > 0)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Center(child: QueueBadge(count: _pendingCount)),
            ),
          IconButton(
            icon: Icon(
              Icons.settings,
              color: isConnected ? null : colorScheme.error,
            ),
            onPressed: _openSettings,
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            if (!isConnected)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                color: colorScheme.errorContainer,
                child: GestureDetector(
                  onTap: _openSettings,
                  child: Text(
                    'Tap to connect to your remoteStorage server',
                    style: TextStyle(color: colorScheme.onErrorContainer),
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            Expanded(
              child: TextField(
                controller: _bodyController,
                focusNode: _bodyFocusNode,
                maxLines: null,
                expands: true,
                textAlignVertical: TextAlignVertical.top,
                style: const TextStyle(fontSize: 16),
                decoration: const InputDecoration(
                  hintText: "What's on your mind?",
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                ),
              ),
            ),
            if (_attachment != null)
              MediaPreview(
                filePath: _attachment!.path,
                type: _attachment!.type,
                duration: _attachment!.duration,
                onRemove: () => setState(() => _attachment = null),
              ),
            const Divider(height: 1),
            MediaPickerBar(
              onMediaPicked: _onMediaPicked,
              enabled: _attachment == null,
              audioRecorder: AudioRecorderWidget(
                onRecordingComplete: _onRecordingComplete,
                enabled: _attachment == null,
              ),
            ),
            const Divider(height: 1),
            ValueListenableBuilder<TextEditingValue>(
              valueListenable: _bodyController,
              builder: (context, value, _) => SendButton(
                state: _sendState,
                enabled: _canSend(value.text),
                onPressed: _send,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
