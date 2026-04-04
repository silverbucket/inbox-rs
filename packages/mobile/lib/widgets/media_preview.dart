import 'dart:io';
import 'package:flutter/material.dart';
import '../models/inbox_item.dart';

class MediaPreview extends StatelessWidget {
  final String filePath;
  final InboxItemType type;
  final double? duration;
  final VoidCallback onRemove;

  const MediaPreview({
    super.key,
    required this.filePath,
    required this.type,
    this.duration,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
      ),
      child: Stack(
        children: [
          _buildPreview(),
          Positioned(
            top: 6,
            right: 6,
            child: GestureDetector(
              onTap: onRemove,
              child: Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.6),
                  shape: BoxShape.circle,
                ),
                child:
                    const Icon(Icons.close, size: 16, color: Colors.white),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPreview() {
    switch (type) {
      case InboxItemType.image:
        return ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Image.file(
            File(filePath),
            width: double.infinity,
            height: 200,
            fit: BoxFit.cover,
          ),
        );
      case InboxItemType.audio:
        return Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            children: [
              const Icon(Icons.mic, size: 28, color: Colors.deepPurple),
              const SizedBox(width: 12),
              Text(
                duration != null
                    ? 'Recording (${duration!.toStringAsFixed(0)}s)'
                    : 'Audio recording',
                style: const TextStyle(fontSize: 15),
              ),
            ],
          ),
        );
      case InboxItemType.video:
        return Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            children: [
              const Icon(Icons.videocam, size: 28, color: Colors.blue),
              const SizedBox(width: 12),
              Text(
                duration != null
                    ? 'Video (${duration!.toStringAsFixed(0)}s)'
                    : 'Video',
                style: const TextStyle(fontSize: 15),
              ),
            ],
          ),
        );
      case InboxItemType.note:
        return const SizedBox.shrink();
    }
  }
}
