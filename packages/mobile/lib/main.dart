import 'package:flutter/material.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'models/rs_config.dart';
import 'services/storage_service.dart';
import 'services/direct_rs.dart';
import 'services/offline_queue.dart';
import 'screens/home_screen.dart';
import 'screens/settings_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const InboxRSApp());
}

class InboxRSApp extends StatefulWidget {
  const InboxRSApp({super.key});

  @override
  State<InboxRSApp> createState() => _InboxRSAppState();
}

class _InboxRSAppState extends State<InboxRSApp> with WidgetsBindingObserver {
  final _storageService = StorageService();
  final _queue = OfflineQueue();
  final _navigatorKey = GlobalKey<NavigatorState>();
  RSConfig? _config;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _init();
    _listenConnectivity();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _queue.onConnectivityChanged();
    }
  }

  Future<void> _init() async {
    final config = await _storageService.getConfig();
    setState(() {
      _config = config;
      _loading = false;
    });
    if (config != null) {
      _queue.setDirectRS(DirectRS(config));
    }
    await _queue.loadFromDisk();
  }

  void _listenConnectivity() {
    Connectivity().onConnectivityChanged.listen((_) {
      _queue.onConnectivityChanged();
    });
  }

  void _onConfigChanged(RSConfig? config) {
    setState(() => _config = config);
    if (config != null) {
      _queue.setDirectRS(DirectRS(config));
    } else {
      _queue.setDirectRS(null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: _theme,
      navigatorKey: _navigatorKey,
      home: _loading
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : _config == null
              ? SettingsScreen(
                  currentConfig: null,
                  onConfigChanged: _onConfigChanged,
                )
              : HomeScreen(
                  config: _config,
                  queue: _queue,
                  onConfigChanged: _onConfigChanged,
                ),
    );
  }

  ThemeData get _theme => ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: Colors.indigo,
          brightness: Brightness.light,
        ),
        useMaterial3: true,
        appBarTheme: const AppBarTheme(
          elevation: 0,
          scrolledUnderElevation: 0,
        ),
      );
}
