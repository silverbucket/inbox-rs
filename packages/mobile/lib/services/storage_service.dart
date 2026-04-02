import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;
import '../models/rs_config.dart';

class StorageService {
  static const _key = 'rs-config';

  // On macOS, flutter_secure_storage requires keychain entitlements that
  // need a development team. Use file-based storage on macOS instead.
  // On iOS/Android, use the proper secure storage.
  bool get _useFallback =>
      defaultTargetPlatform == TargetPlatform.macOS ||
      defaultTargetPlatform == TargetPlatform.linux;

  final _secureStorage = const FlutterSecureStorage();

  Future<String> get _filePath async {
    final dir = await getApplicationSupportDirectory();
    return p.join(dir.path, 'rs_config.json');
  }

  Future<RSConfig?> getConfig() async {
    if (_useFallback) {
      return _readFile();
    }
    final data = await _secureStorage.read(key: _key);
    if (data == null) return null;
    return RSConfig.decode(data);
  }

  Future<void> saveConfig(RSConfig config) async {
    if (_useFallback) {
      await _writeFile(config);
      return;
    }
    await _secureStorage.write(key: _key, value: config.encode());
  }

  Future<void> clearConfig() async {
    if (_useFallback) {
      final file = File(await _filePath);
      if (await file.exists()) await file.delete();
      return;
    }
    await _secureStorage.delete(key: _key);
  }

  Future<RSConfig?> _readFile() async {
    final file = File(await _filePath);
    if (!await file.exists()) return null;
    final data = await file.readAsString();
    return RSConfig.decode(data);
  }

  Future<void> _writeFile(RSConfig config) async {
    final file = File(await _filePath);
    await file.parent.create(recursive: true);
    await file.writeAsString(config.encode());
  }
}
