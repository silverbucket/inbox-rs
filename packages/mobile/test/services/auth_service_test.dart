import 'package:flutter_test/flutter_test.dart';
import 'package:inbox_rs_mobile/services/auth_service.dart';

void main() {
  group('AuthService', () {
    late AuthService authService;

    setUp(() {
      authService = AuthService();
    });

    test('rejects empty address', () async {
      await expectLater(
        () async => authService.connect(''),
        throwsA(isA<Exception>().having(
          (e) => e.toString(),
          'message',
          contains('Invalid remoteStorage address'),
        )),
      );
    });

    test('rejects address without @', () async {
      await expectLater(
        () async => authService.connect('nope'),
        throwsA(isA<Exception>().having(
          (e) => e.toString(),
          'message',
          contains('Invalid remoteStorage address'),
        )),
      );
    });

    test('rejects address with empty user part', () async {
      await expectLater(
        () async => authService.connect('@example.com'),
        throwsA(isA<Exception>().having(
          (e) => e.toString(),
          'message',
          contains('Invalid remoteStorage address'),
        )),
      );
    });

    test('rejects address with empty host part', () async {
      await expectLater(
        () async => authService.connect('user@'),
        throwsA(isA<Exception>().having(
          (e) => e.toString(),
          'message',
          contains('Invalid remoteStorage address'),
        )),
      );
    });

    test('rejects address with multiple @', () async {
      await expectLater(
        () async => authService.connect('user@host@extra'),
        throwsA(isA<Exception>().having(
          (e) => e.toString(),
          'message',
          contains('Invalid remoteStorage address'),
        )),
      );
    });
  });
}
