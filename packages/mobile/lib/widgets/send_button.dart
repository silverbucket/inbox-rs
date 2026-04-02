import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

enum SendState { idle, sending, sent }

class SendButton extends StatelessWidget {
  final SendState state;
  final bool enabled;
  final VoidCallback onPressed;

  const SendButton({
    super.key,
    required this.state,
    required this.enabled,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: SizedBox(
        width: double.infinity,
        height: 52,
        child: FilledButton(
          onPressed: state == SendState.idle && enabled
              ? () {
                  HapticFeedback.mediumImpact();
                  onPressed();
                }
              : null,
          style: FilledButton.styleFrom(
            backgroundColor: state == SendState.sent
                ? Colors.green
                : Theme.of(context).colorScheme.primary,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
          ),
          child: _buildChild(),
        ),
      ),
    );
  }

  Widget _buildChild() {
    switch (state) {
      case SendState.idle:
        return const Text(
          'SEND TO INBOX',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
          ),
        );
      case SendState.sending:
        return const SizedBox(
          width: 22,
          height: 22,
          child: CircularProgressIndicator(
            strokeWidth: 2.5,
            color: Colors.white,
          ),
        );
      case SendState.sent:
        return const Icon(Icons.check, size: 28, color: Colors.white);
    }
  }
}
