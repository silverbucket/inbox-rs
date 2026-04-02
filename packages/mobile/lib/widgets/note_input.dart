import 'package:flutter/material.dart';

class NoteInput extends StatelessWidget {
  final TextEditingController titleController;
  final TextEditingController bodyController;
  final FocusNode bodyFocusNode;

  const NoteInput({
    super.key,
    required this.titleController,
    required this.bodyController,
    required this.bodyFocusNode,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        TextField(
          controller: titleController,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w500,
          ),
          decoration: const InputDecoration(
            hintText: 'Title (optional)',
            border: InputBorder.none,
            contentPadding: EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          ),
          textInputAction: TextInputAction.next,
        ),
        const Divider(height: 1, indent: 20, endIndent: 20),
        Expanded(
          child: TextField(
            controller: bodyController,
            focusNode: bodyFocusNode,
            maxLines: null,
            expands: true,
            textAlignVertical: TextAlignVertical.top,
            style: const TextStyle(fontSize: 15),
            decoration: const InputDecoration(
              hintText: "What's on your mind?",
              border: InputBorder.none,
              contentPadding: EdgeInsets.symmetric(horizontal: 20, vertical: 12),
            ),
          ),
        ),
      ],
    );
  }
}
