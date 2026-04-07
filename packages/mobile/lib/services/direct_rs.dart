import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../models/rs_config.dart';

/// Maps item type to the remoteStorage schema alias used by rs-module.
/// Must stay in sync with schemaAlias() in packages/rs-module/src/index.ts.
const _schemaAliases = <String, String>{
  'audio': 'audio-meta',
  'image': 'image-meta',
  'video': 'video-meta',
  'document': 'document-meta',
};

String _schemaAlias(String type) => _schemaAliases[type] ?? type;

class DirectRS {
  static const _timeout = Duration(seconds: 60);

  final RSConfig config;

  DirectRS(this.config);

  Map<String, String> get _headers => {
        'Authorization': 'Bearer ${config.token}',
      };

  Uri _uri(String path) => Uri.parse('${config.href}/inbox/$path');

  Future<void> storeObject(String path, Map<String, dynamic> obj) async {
    final uri = _uri(path);
    debugPrint('[DirectRS] PUT $uri (${obj['type'] ?? 'object'})');
    final resp = await http
        .put(
          uri,
          headers: {..._headers, 'Content-Type': 'application/json; charset=UTF-8'},
          body: jsonEncode(obj),
        )
        .timeout(_timeout);
    debugPrint('[DirectRS] PUT $uri → ${resp.statusCode}');
    if (resp.statusCode >= 300) {
      throw Exception('Store failed: ${resp.statusCode} ${resp.body}');
    }
  }

  Future<void> storeFile(String path, Uint8List data, String mimeType) async {
    final uri = _uri(path);
    debugPrint('[DirectRS] PUT file $uri ($mimeType, ${data.length} bytes)');
    final resp = await http
        .put(
          uri,
          headers: {..._headers, 'Content-Type': '$mimeType; charset=binary'},
          body: data,
        )
        .timeout(_timeout);
    debugPrint('[DirectRS] PUT file $uri → ${resp.statusCode}');
    if (resp.statusCode >= 300) {
      throw Exception('Store file failed: ${resp.statusCode}');
    }
  }

  Future<void> store(Map<String, dynamic> item, [Uint8List? fileData]) async {
    if (fileData != null && item['filePath'] != null) {
      await storeFile(
          item['filePath'] as String, fileData, item['mimeType'] as String);
    }
    // Add @context so remoteStorageJS recognises the item type.
    // This mirrors what baseclient._attachType() does when storing via the JS SDK.
    final type = item['type'] as String? ?? 'note';
    final alias = _schemaAlias(type);
    final enriched = {
      ...item,
      '@context': 'http://remotestorage.io/spec/modules/inbox/$alias',
    };
    await storeObject('items/${item['id']}', enriched);
  }
}
