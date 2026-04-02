import 'package:flutter/material.dart';

class QueueBadge extends StatelessWidget {
  final int count;

  const QueueBadge({super.key, required this.count});

  @override
  Widget build(BuildContext context) {
    if (count == 0) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.orange.shade100,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.cloud_upload_outlined,
              size: 14, color: Colors.orange.shade800),
          const SizedBox(width: 4),
          Text(
            '$count pending',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: Colors.orange.shade800,
            ),
          ),
        ],
      ),
    );
  }
}
