import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:record/record.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;

class AudioRecorderWidget extends StatefulWidget {
  final void Function(String path, double duration) onRecordingComplete;

  const AudioRecorderWidget({super.key, required this.onRecordingComplete});

  @override
  State<AudioRecorderWidget> createState() => _AudioRecorderWidgetState();
}

class _AudioRecorderWidgetState extends State<AudioRecorderWidget> {
  static const _sampleRate = 16000;
  static const _numChannels = 1;
  static const _bitsPerSample = 16;

  final _recorder = AudioRecorder();
  bool _recording = false;
  int _seconds = 0;
  Timer? _timer;

  StreamSubscription<List<int>>? _streamSub;
  final List<int> _audioBytes = [];
  String? _outputPath;

  @override
  void dispose() {
    _timer?.cancel();
    _streamSub?.cancel();
    _recorder.dispose();
    super.dispose();
  }

  /// Build a WAV file header for raw PCM data.
  Uint8List _buildWavHeader(int pcmDataLength) {
    final byteRate = _sampleRate * _numChannels * (_bitsPerSample ~/ 8);
    final blockAlign = _numChannels * (_bitsPerSample ~/ 8);
    final fileSize = 36 + pcmDataLength;

    final header = ByteData(44);
    // RIFF header
    header.setUint8(0, 0x52); // R
    header.setUint8(1, 0x49); // I
    header.setUint8(2, 0x46); // F
    header.setUint8(3, 0x46); // F
    header.setUint32(4, fileSize, Endian.little);
    header.setUint8(8, 0x57);  // W
    header.setUint8(9, 0x41);  // A
    header.setUint8(10, 0x56); // V
    header.setUint8(11, 0x45); // E
    // fmt chunk
    header.setUint8(12, 0x66); // f
    header.setUint8(13, 0x6D); // m
    header.setUint8(14, 0x74); // t
    header.setUint8(15, 0x20); // (space)
    header.setUint32(16, 16, Endian.little); // chunk size
    header.setUint16(20, 1, Endian.little);  // PCM format
    header.setUint16(22, _numChannels, Endian.little);
    header.setUint32(24, _sampleRate, Endian.little);
    header.setUint32(28, byteRate, Endian.little);
    header.setUint16(32, blockAlign, Endian.little);
    header.setUint16(34, _bitsPerSample, Endian.little);
    // data chunk
    header.setUint8(36, 0x64); // d
    header.setUint8(37, 0x61); // a
    header.setUint8(38, 0x74); // t
    header.setUint8(39, 0x61); // a
    header.setUint32(40, pcmDataLength, Endian.little);

    return header.buffer.asUint8List();
  }

  Future<void> _toggleRecording() async {
    debugPrint('[audio_recorder] _toggleRecording called, _recording=$_recording');
    if (_recording) {
      final callback = widget.onRecordingComplete;
      final duration = _seconds.toDouble();
      final outputPath = _outputPath;

      _timer?.cancel();
      await _streamSub?.cancel();
      _streamSub = null;

      setState(() {
        _recording = false;
        _seconds = 0;
      });

      try {
        await _recorder.cancel();
      } catch (e) {
        debugPrint('[audio_recorder] cancel error: $e');
      }

      if (outputPath != null && _audioBytes.isNotEmpty) {
        debugPrint('[audio_recorder] writing ${_audioBytes.length} PCM bytes to WAV');
        final wavHeader = _buildWavHeader(_audioBytes.length);
        final file = File(outputPath);
        await file.parent.create(recursive: true);
        await file.writeAsBytes([...wavHeader, ..._audioBytes]);
        _audioBytes.clear();

        final size = await file.length();
        debugPrint('[audio_recorder] wrote WAV file, size=$size bytes');
        if (size > 44) {
          callback(outputPath, duration);
        }
      } else {
        debugPrint('[audio_recorder] no audio data captured');
        _audioBytes.clear();
      }
    } else {
      try {
        if (!await _recorder.hasPermission()) {
          debugPrint('[audio_recorder] no permission');
          return;
        }

        final dir = await getTemporaryDirectory();
        _outputPath = p.join(dir.path, 'recording_${DateTime.now().millisecondsSinceEpoch}.wav');
        _audioBytes.clear();

        final stream = await _recorder.startStream(
          const RecordConfig(
            encoder: AudioEncoder.pcm16bits,
            numChannels: _numChannels,
            sampleRate: _sampleRate,
            bitRate: _sampleRate * _numChannels * _bitsPerSample,
          ),
        );

        _streamSub = stream.listen(
          (data) => _audioBytes.addAll(data),
          onError: (e) => debugPrint('[audio_recorder] stream error: $e'),
        );

        debugPrint('[audio_recorder] started PCM stream recording');
        setState(() => _recording = true);
        _timer = Timer.periodic(const Duration(seconds: 1), (_) {
          setState(() => _seconds++);
        });
      } catch (e) {
        debugPrint('[audio_recorder] start failed: $e');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: _toggleRecording,
      borderRadius: BorderRadius.circular(30),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _recording ? Colors.red.shade50 : Colors.grey.shade100,
              shape: BoxShape.circle,
            ),
            child: Icon(
              _recording ? Icons.stop : Icons.mic,
              size: 26,
              color: _recording ? Colors.red : Colors.grey.shade700,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            _recording ? _formatTime(_seconds) : 'Record',
            style: TextStyle(
              fontSize: 11,
              color: _recording ? Colors.red : Colors.grey.shade600,
            ),
          ),
        ],
      ),
    );
  }

  String _formatTime(int seconds) {
    final m = seconds ~/ 60;
    final s = seconds % 60;
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }
}
