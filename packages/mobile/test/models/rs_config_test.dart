import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:inbox_rs_mobile/models/rs_config.dart';

void main() {
  group('RSConfig', () {
    final config = RSConfig(
      userAddress: 'user@example.com',
      token: 'test-token-123',
      href: 'https://storage.example.com',
      storageApi: 'draft-dejong-remotestorage-22',
    );

    test('toJson includes all fields', () {
      final json = config.toJson();
      expect(json['userAddress'], 'user@example.com');
      expect(json['token'], 'test-token-123');
      expect(json['href'], 'https://storage.example.com');
      expect(json['storageApi'], 'draft-dejong-remotestorage-22');
    });

    test('fromJson restores all fields', () {
      final json = config.toJson();
      final restored = RSConfig.fromJson(json);
      expect(restored.userAddress, config.userAddress);
      expect(restored.token, config.token);
      expect(restored.href, config.href);
      expect(restored.storageApi, config.storageApi);
    });

    test('encode/decode roundtrip', () {
      final encoded = config.encode();
      final decoded = RSConfig.decode(encoded);
      expect(decoded.userAddress, config.userAddress);
      expect(decoded.token, config.token);
      expect(decoded.href, config.href);
      expect(decoded.storageApi, config.storageApi);
    });

    test('storageApi is nullable', () {
      final noApi = RSConfig(
        userAddress: 'user@example.com',
        token: 'tok',
        href: 'https://example.com',
      );
      expect(noApi.storageApi, isNull);
      expect(noApi.toJson()['storageApi'], isNull);

      final encoded = noApi.encode();
      final decoded = RSConfig.decode(encoded);
      expect(decoded.storageApi, isNull);
    });

    test('encode produces valid JSON', () {
      final encoded = config.encode();
      expect(() => jsonDecode(encoded), returnsNormally);
    });
  });
}
