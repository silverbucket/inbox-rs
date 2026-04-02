import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../models/inbox_item.dart';
import '../models/rs_config.dart';
import '../services/offline_queue.dart';
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

  // Attachment state
  String? _attachmentPath;
  String? _attachmentMimeType;
  InboxItemType? _attachmentType;
  double? _attachmentDuration;

  @override
  void initState() {
    super.initState();
    _pendingCount = widget.queue.pendingCount;
    widget.queue.onPendingChanged = (count) {
      if (mounted) setState(() => _pendingCount = count);
    };
    // Re-evaluate _canSend whenever text changes
    _bodyController.addListener(() => setState(() {}));
    // Auto-focus body field after build
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (widget.config != null) _bodyFocusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _bodyController.dispose();
    _bodyFocusNode.dispose();
    super.dispose();
  }

  bool get _canSend {
    if (widget.config == null) return false;
    return _bodyController.text.trim().isNotEmpty || _attachmentPath != null;
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

  String _extFromMime(String mime) {
    switch (mime) {
      case 'image/jpeg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/heic':
        return 'heic';
      case 'image/webp':
        return 'webp';
      case 'video/mp4':
        return 'mp4';
      case 'video/quicktime':
        return 'mov';
      case 'audio/wav':
      case 'audio/x-wav':
        return 'wav';
      case 'audio/mp4':
      case 'audio/aac':
        return 'm4a';
      default:
        return mime.split('/').last;
    }
  }

  Future<void> _send() async {
    if (!_canSend) return;

    setState(() => _sendState = SendState.sending);

    try {
      final id = _uuid.v4();
      final createdAt = DateTime.now().toUtc().toIso8601String();
      final body = _bodyController.text.trim();

      if (_attachmentPath != null) {
        final type = _attachmentType!;
        final mime = _attachmentMimeType!;
        final ext = _extFromMime(mime);
        final filePath = 'files/$id.$ext';
        final fileBytes = await File(_attachmentPath!).readAsBytes();

        final item = <String, dynamic>{
          'id': id,
          'type': type.value,
          'title': body.isNotEmpty
              ? (body.length > 50 ? '${body.substring(0, 50)}...' : body)
              : _autoTitle(type),
          'filePath': filePath,
          'mimeType': mime,
          'createdAt': createdAt,
        };
        if (body.isNotEmpty) item['body'] = body;
        if (_attachmentDuration != null) item['duration'] = _attachmentDuration;

        await widget.queue.enqueue(item: item, fileData: Uint8List.fromList(fileBytes));
      } else {
        final title = body.length > 50 ? '${body.substring(0, 50)}...' : body;
        final item = <String, dynamic>{
          'id': id,
          'type': 'note',
          'title': title,
          'body': body,
          'createdAt': createdAt,
        };
        await widget.queue.enqueue(item: item);
      }

      setState(() => _sendState = SendState.sent);
      await Future.delayed(const Duration(milliseconds: 500));
      _reset();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: $e'), backgroundColor: Colors.red),
        );
      }
      setState(() => _sendState = SendState.idle);
    }
  }

  void _reset() {
    _bodyController.clear();
    setState(() {
      _sendState = SendState.idle;
      _attachmentPath = null;
      _attachmentMimeType = null;
      _attachmentType = null;
      _attachmentDuration = null;
    });
    _bodyFocusNode.requestFocus();
  }

  void _onMediaPicked(String path, String mimeType, bool isVideo) {
    setState(() {
      _attachmentPath = path;
      _attachmentMimeType = mimeType;
      _attachmentType = isVideo ? InboxItemType.video : InboxItemType.image;
      _attachmentDuration = null;
    });
  }

  void _onRecordingComplete(String path, double duration) {
    setState(() {
      _attachmentPath = path;
      _attachmentMimeType = 'audio/wav';
      _attachmentType = InboxItemType.audio;
      _attachmentDuration = duration;
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
              color: isConnected ? null : Colors.red,
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
                color: Colors.orange.shade50,
                child: GestureDetector(
                  onTap: _openSettings,
                  child: Text(
                    'Tap to connect to your remoteStorage server',
                    style: TextStyle(color: Colors.orange.shade900),
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
            if (_attachmentPath != null)
              MediaPreview(
                filePath: _attachmentPath!,
                type: _attachmentType!,
                duration: _attachmentDuration,
                onRemove: () => setState(() {
                  _attachmentPath = null;
                  _attachmentMimeType = null;
                  _attachmentType = null;
                  _attachmentDuration = null;
                }),
              ),
            const Divider(height: 1),
            MediaPickerBar(
              onMediaPicked: _onMediaPicked,
              audioRecorder: AudioRecorderWidget(
                onRecordingComplete: _onRecordingComplete,
              ),
            ),
            const Divider(height: 1),
            SendButton(
              state: _sendState,
              enabled: _canSend,
              onPressed: _send,
            ),
          ],
        ),
      ),
    );
  }
}
