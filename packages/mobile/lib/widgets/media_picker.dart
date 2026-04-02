import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

class MediaPickerBar extends StatelessWidget {
  final void Function(String path, String mimeType, bool isVideo) onMediaPicked;
  final Widget audioRecorder;

  const MediaPickerBar({
    super.key,
    required this.onMediaPicked,
    required this.audioRecorder,
  });

  bool get _isDesktop =>
      defaultTargetPlatform == TargetPlatform.macOS ||
      defaultTargetPlatform == TargetPlatform.linux ||
      defaultTargetPlatform == TargetPlatform.windows;

  Future<void> _pickFromCamera(BuildContext context) async {
    // On desktop, camera capture isn't available -- go straight to gallery
    if (_isDesktop) {
      return _pickFromGallery(context);
    }

    final source = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera),
              title: const Text('Take Photo'),
              onTap: () => Navigator.pop(ctx, 'photo'),
            ),
            ListTile(
              leading: const Icon(Icons.videocam),
              title: const Text('Record Video'),
              onTap: () => Navigator.pop(ctx, 'video'),
            ),
          ],
        ),
      ),
    );

    if (source == null) return;

    try {
      final picker = ImagePicker();
      final XFile? file;
      if (source == 'photo') {
        file = await picker.pickImage(source: ImageSource.camera, imageQuality: 85);
      } else {
        file = await picker.pickVideo(
          source: ImageSource.camera,
          maxDuration: const Duration(seconds: 60),
        );
      }

      if (file != null) {
        final mimeType = _guessMime(file.path, source == 'video');
        onMediaPicked(file.path, mimeType, source == 'video');
      }
    } catch (e) {
      debugPrint('[media_picker] camera error: $e');
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Camera not available on this device')),
        );
      }
    }
  }

  Future<void> _pickFromGallery(BuildContext context) async {
    try {
      final picker = ImagePicker();
      final file = await picker.pickMedia();
      if (file != null) {
        final isVideo = _isVideoPath(file.path);
        final mimeType = _guessMime(file.path, isVideo);
        onMediaPicked(file.path, mimeType, isVideo);
      }
    } catch (e) {
      debugPrint('[media_picker] gallery error: $e');
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to pick media: $e')),
        );
      }
    }
  }

  String _guessMime(String path, bool isVideo) {
    final ext = path.split('.').last.toLowerCase();
    if (isVideo) {
      switch (ext) {
        case 'mp4':
          return 'video/mp4';
        case 'mov':
          return 'video/quicktime';
        default:
          return 'video/mp4';
      }
    }
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'heic':
        return 'image/heic';
      case 'webp':
        return 'image/webp';
      default:
        return 'image/jpeg';
    }
  }

  bool _isVideoPath(String path) {
    final ext = path.split('.').last.toLowerCase();
    return ['mp4', 'mov', 'avi', 'mkv', 'm4v'].contains(ext);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          audioRecorder,
          if (!_isDesktop) GestureDetector(
              onTap: () => _pickFromCamera(context),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.grey.shade100,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(Icons.camera_alt, size: 26, color: Colors.grey.shade700),
                  ),
                  const SizedBox(height: 4),
                  Text('Camera', style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
                ],
              ),
            ),
          GestureDetector(
            onTap: () => _pickFromGallery(context),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.grey.shade100,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(Icons.photo_library, size: 26, color: Colors.grey.shade700),
                ),
                const SizedBox(height: 4),
                Text('Gallery', style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
