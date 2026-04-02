import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import '../models/rs_config.dart';

class DirectRS {
  final RSConfig config;

  DirectRS(this.config);

  Map<String, String> get _headers => {
        'Authorization': 'Bearer ${config.token}',
      };

  Uri _uri(String path) => Uri.parse('${config.href}/inbox/$path');

  Future<void> storeObject(String path, Map<String, dynamic> obj) async {
    final resp = await http.put(
      _uri(path),
      headers: {..._headers, 'Content-Type': 'application/json'},
      body: jsonEncode(obj),
    );
    if (resp.statusCode >= 300) {
      throw Exception('Store failed: ${resp.statusCode} ${resp.body}');
    }
  }

  Future<void> storeFile(String path, Uint8List data, String mimeType) async {
    final resp = await http.put(
      _uri(path),
      headers: {..._headers, 'Content-Type': mimeType},
      body: data,
    );
    if (resp.statusCode >= 300) {
      throw Exception('Store file failed: ${resp.statusCode}');
    }
  }

  Future<void> store(Map<String, dynamic> item, [Uint8List? fileData]) async {
    if (fileData != null && item['filePath'] != null) {
      await storeFile(
          item['filePath'] as String, fileData, item['mimeType'] as String);
    }
    await storeObject('items/${item['id']}', item);
  }
}
