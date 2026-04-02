import 'dart:convert';

class RSConfig {
  final String userAddress;
  final String token;
  final String href;
  final String? storageApi;

  RSConfig({
    required this.userAddress,
    required this.token,
    required this.href,
    this.storageApi,
  });

  Map<String, dynamic> toJson() => {
        'userAddress': userAddress,
        'token': token,
        'href': href,
        'storageApi': storageApi,
      };

  factory RSConfig.fromJson(Map<String, dynamic> json) => RSConfig(
        userAddress: json['userAddress'] as String,
        token: json['token'] as String,
        href: json['href'] as String,
        storageApi: json['storageApi'] as String?,
      );

  String encode() => jsonEncode(toJson());

  static RSConfig decode(String data) =>
      RSConfig.fromJson(jsonDecode(data) as Map<String, dynamic>);
}
