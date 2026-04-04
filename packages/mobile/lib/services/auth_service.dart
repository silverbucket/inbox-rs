import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import '../models/rs_config.dart';

class AuthService {
  static const _callbackScheme = 'inboxrs';
  static const _redirectUri = '$_callbackScheme://auth-callback';

  /// Discover remoteStorage server info via WebFinger, then run OAuth flow.
  Future<RSConfig> connect(String userAddress) async {
    final parts = userAddress.split('@');
    if (parts.length != 2 || parts[0].isEmpty || parts[1].isEmpty) {
      throw Exception(
          'Invalid remoteStorage address. Expected format: user@host');
    }
    final host = parts[1];
    final scheme =
        (host == 'localhost' || host.startsWith('localhost:')) ? 'http' : 'https';

    // 1. WebFinger discovery
    final webfingerUrl =
        '$scheme://$host/.well-known/webfinger?resource=acct:${Uri.encodeComponent(userAddress)}';
    final wfResp = await http
        .get(Uri.parse(webfingerUrl))
        .timeout(const Duration(seconds: 30));
    if (wfResp.statusCode >= 300) {
      throw Exception('WebFinger failed: ${wfResp.statusCode}');
    }
    final wfData = jsonDecode(wfResp.body) as Map<String, dynamic>;

    // Find remoteStorage link
    final links = (wfData['links'] as List?)?.cast<Map<String, dynamic>>();
    if (links == null || links.isEmpty) {
      throw Exception('No links found in WebFinger response');
    }
    final rsLink = links.firstWhere(
      (l) =>
          l['rel'] == 'http://tools.ietf.org/id/draft-dejong-remotestorage' ||
          l['rel'] == 'remotestorage',
      orElse: () => throw Exception('No remoteStorage link found in WebFinger'),
    );

    final href = rsLink['href'] as String?;
    if (href == null) throw Exception('remoteStorage link missing href');
    final storageApi = (rsLink['type'] as String?) ??
        (rsLink['properties'] as Map<String, dynamic>?)?['http://remotestorage.io/spec/version'] as String?;

    final props = (rsLink['properties'] as Map<String, dynamic>?) ?? {};
    final authUrl = props['http://tools.ietf.org/html/rfc6749#section-4.2'] ??
        props['http://tools.ietf.org/html/rfc6749#section-4.2.1'] ??
        props['auth-endpoint'] ??
        props['auth-url'];
    if (authUrl == null) throw Exception('No OAuth endpoint found');

    // 2. Build OAuth URL
    final oauthParams = {
      'client_id': _redirectUri,
      'redirect_uri': _redirectUri,
      'response_type': 'token',
      'scope': 'inbox:rw',
    };
    final fullAuthUrl =
        '$authUrl?${oauthParams.entries.map((e) => '${Uri.encodeComponent(e.key)}=${Uri.encodeComponent(e.value)}').join('&')}';

    // 3. Launch OAuth flow
    final resultUrl = await FlutterWebAuth2.authenticate(
      url: fullAuthUrl,
      callbackUrlScheme: _callbackScheme,
    );

    // 4. Extract token from redirect URL
    final resultUri = Uri.parse(resultUrl);

    // Token can be in hash fragment or query params
    final hashParams = Uri.splitQueryString(resultUri.fragment);
    final queryParams = resultUri.queryParameters;

    final oauthError = hashParams['error'] ?? queryParams['error'];
    if (oauthError != null) {
      final desc =
          hashParams['error_description'] ?? queryParams['error_description'] ?? '';
      throw Exception('OAuth error: $oauthError${desc.isNotEmpty ? ' - $desc' : ''}');
    }

    final token = hashParams['access_token'] ?? queryParams['access_token'];
    if (token == null) throw Exception('No access token in OAuth response');

    return RSConfig(
      userAddress: userAddress,
      token: token,
      href: href,
      storageApi: storageApi,
    );
  }
}
