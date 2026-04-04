import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../utils/mime.dart' show guessMime;

class MediaPickerBar extends StatelessWidget {
  final void Function(String path, String mimeType, bool isVideo) onMediaPicked;
  final Widget audioRecorder;
  final bool enabled;

  const MediaPickerBar({
    super.key,
    required this.onMediaPicked,
    required this.audioRecorder,
    this.enabled = true,
  });

  bool get _isDesktop =>
      defaultTargetPlatform == TargetPlatform.macOS ||
      defaultTargetPlatform == TargetPlatform.linux ||
      defaultTargetPlatform == TargetPlatform.windows;

  Future<void> _pickFromCamera(BuildContext context) async {
    if (!enabled) return;

    if (_isDesktop) {
      return _pickFromGallery(context);
    }

    try {
      final picker = ImagePicker();
      final file = await picker.pickImage(source: ImageSource.camera, imageQuality: 85);
      if (file != null) {
        final mimeType = guessMime(file.path);
        onMediaPicked(file.path, mimeType, false);
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
    if (!enabled) return;

    try {
      final picker = ImagePicker();
      final file = await picker.pickImage(source: ImageSource.gallery);
      if (file != null) {
        final mimeType = guessMime(file.path);
        onMediaPicked(file.path, mimeType, false);
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

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final iconColor = colorScheme.onSurfaceVariant;
    final bgColor = colorScheme.surfaceContainerHighest;

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          audioRecorder,
          if (!_isDesktop) _MediaButton(
            icon: Icons.camera_alt,
            label: 'Camera',
            iconColor: iconColor,
            bgColor: bgColor,
            enabled: enabled,
            onTap: () => _pickFromCamera(context),
          ),
          _MediaButton(
            icon: Icons.photo_library,
            label: 'Gallery',
            iconColor: iconColor,
            bgColor: bgColor,
            enabled: enabled,
            onTap: () => _pickFromGallery(context),
          ),
        ],
      ),
    );
  }
}

class _MediaButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color iconColor;
  final Color bgColor;
  final bool enabled;
  final VoidCallback onTap;

  const _MediaButton({
    required this.icon,
    required this.label,
    required this.iconColor,
    required this.bgColor,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled ? 1.0 : 0.35,
      child: GestureDetector(
        onTap: enabled ? onTap : null,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: bgColor,
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 26, color: iconColor),
            ),
            const SizedBox(height: 4),
            Text(label, style: TextStyle(fontSize: 11, color: iconColor)),
          ],
        ),
      ),
    );
  }
}
