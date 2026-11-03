import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'config/app_config.dart';
import 'core/app.dart';
import 'core/servidor.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Supabase.initialize(
    url: AppConfig.supabaseUrl,
    publishableKey: AppConfig.supabaseAnonKey,
  );

  // O endereço do servidor web é guardado localmente; tem de estar lido antes
  // de o ecrã de registo aparecer.
  await Servidor.instance.carregar();

  runApp(const InukaApp());
}
