import 'dart:async';
import 'package:flutter/material.dart';
import 'package:record/record.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;

class AudioRecorderWidget extends StatefulWidget {
  final void Function(String path, double duration) onRecordingComplete;
  final bool enabled;

  const AudioRecorderWidget({
    super.key,
    required this.onRecordingComplete,
    this.enabled = true,
  });

  @override
  State<AudioRecorderWidget> createState() => _AudioRecorderWidgetState();
}

class _AudioRecorderWidgetState extends State<AudioRecorderWidget> {
  final _recorder = AudioRecorder();
  bool _recording = false;
  int _seconds = 0;
  Timer? _timer;
  String? _outputPath;

  @override
  void dispose() {
    _timer?.cancel();
    _recorder.dispose();
    super.dispose();
  }

  Future<void> _startRecording() async {
    try {
      if (!await _recorder.hasPermission()) {
        debugPrint('[audio_recorder] no permission');
        return;
      }

      final dir = await getTemporaryDirectory();
      _outputPath = p.join(dir.path,
          'recording_${DateTime.now().millisecondsSinceEpoch}.m4a');

      await _recorder.start(
        const RecordConfig(
          encoder: AudioEncoder.aacLc,
          numChannels: 1,
          sampleRate: 44100,
          bitRate: 128000,
        ),
        path: _outputPath!,
      );

      debugPrint('[audio_recorder] started file-based recording');
      setState(() => _recording = true);
      _timer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() => _seconds++);
      });
    } catch (e) {
      debugPrint('[audio_recorder] start failed: $e');
    }
  }

  Future<void> _stopRecording() async {
    _timer?.cancel();
    final duration = _seconds.toDouble();
    final outputPath = _outputPath;

    setState(() {
      _recording = false;
      _seconds = 0;
    });

    try {
      final path = await _recorder.stop();
      debugPrint('[audio_recorder] stopped, path=$path');
      if (path != null && outputPath != null && duration > 0) {
        widget.onRecordingComplete(path, duration);
      }
    } catch (e) {
      debugPrint('[audio_recorder] stop error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final errorColor = colorScheme.error;
    final mutedColor = colorScheme.onSurfaceVariant;
    final bgColor = colorScheme.surfaceContainerHighest;
    final isDisabled = !widget.enabled && !_recording;

    return Opacity(
      opacity: isDisabled ? 0.35 : 1.0,
      child: InkWell(
        onTap: isDisabled
            ? null
            : (_recording ? _stopRecording : _startRecording),
        borderRadius: BorderRadius.circular(30),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: _recording ? errorColor.withValues(alpha: 0.1) : bgColor,
                shape: BoxShape.circle,
              ),
              child: Icon(
                _recording ? Icons.stop : Icons.mic,
                size: 26,
                color: _recording ? errorColor : mutedColor,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              _recording ? _formatTime(_seconds) : 'Record',
              style: TextStyle(
                fontSize: 11,
                color: _recording ? errorColor : mutedColor,
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatTime(int seconds) {
    final m = seconds ~/ 60;
    final s = seconds % 60;
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }
}
