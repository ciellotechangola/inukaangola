import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../config/app_config.dart';

class SyncService {
  static final _client = Supabase.instance.client;

  static Future<void> syncPendingOperations() async {
    final user = _client.auth.currentUser;
    if (user == null) return;

    // Lógica de sincronização será expandida conforme as operações offline
    // são implementadas nas features de vendas, encomendas e mensagens.
  }
}

class SyncStatusWidget extends StatefulWidget {
  const SyncStatusWidget({super.key});

  @override
  State<SyncStatusWidget> createState() => _SyncStatusWidgetState();
}

class _SyncStatusWidgetState extends State<SyncStatusWidget> {
  final bool _isOnline = true;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: _isOnline ? AppConfig.success.withValues(alpha: 0.15) : AppConfig.danger.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            _isOnline ? Icons.cloud_done : Icons.cloud_off,
            size: 14,
            color: _isOnline ? AppConfig.success : AppConfig.danger,
          ),
          const SizedBox(width: 6),
          Text(
            _isOnline ? 'Online' : 'Offline',
            style: TextStyle(
              color: _isOnline ? AppConfig.success : AppConfig.danger,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}
