import 'dart:ui';
import 'package:flutter/material.dart';

class AppConfig {
  // ------------------------------------------------------------
  // Supabase — projeto kvfovbdiaofgtaqopgeh
  // A chave abaixo é PÚBLICA (publishable / anon).
  // NUNCA colocar a service_role neste ficheiro: o binário
  // da app é distribuído ao utilizador final.
  // ------------------------------------------------------------
  static const String supabaseUrl = 'https://kvfovbdiaofgtaqopgeh.supabase.co';
  static const String supabaseAnonKey =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2Zm92YmRpYW9mZ3RhcW9wZ2VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5NTE1ODcsImV4cCI6MjEwODUyNzU4N30.xRI0ELJpnDbsYVUU_QJgKvyrZ2zxGvNDd-aTB4aycN0';
  static const String supabasePublishableKey =
      'sb_publishable_J9jyM0S1AG8pu5GUnm30NQ_tlRIzCbI';

  /// Domínio interno usado para transformar telefone em email.
  /// Deve coincidir com o do backend (`u<telefone>@inuka.ao`).
  static const String internalEmailDomain = 'inuka.ao';

  /// Base da API web (Next.js) usada apenas para o REGISTO.
  /// O registo passa pelo servidor porque a Admin API exige a service_role,
  /// que nunca pode estar dentro da app.
  ///
  /// Este valor é só o **ponto de partida**: em execução vale o que estiver
  /// guardado em `Servidor.instance.baseUrl`, que o utilizador pode mudar no
  /// ecrã "Servidor". Compilar com outro valor:
  ///
  ///   flutter build apk --dart-define=INUKA_API_BASE_URL=https://inuka.ao
  ///
  /// O valor por omissão é o servidor de produção. Antes era
  /// `http://10.0.2.2:3000`, que só funciona no emulador Android: um APK
  /// compilado sem `--dart-define` ficava a apontar para o nada e o registo
  /// falhava sem explicação num telemóvel verdadeiro.
  ///
  /// - Emulador Android: http://10.0.2.2:3000
  /// - Simulador iOS:    http://localhost:3000
  /// - Telemóvel físico: http://IP-DO-PC-NA-REDE:3000 (muda no ecrã Servidor)
  static const String apiBaseUrlPadrao = String.fromEnvironment(
    'INUKA_API_BASE_URL',
    defaultValue: 'https://inuka-angola.apps.workbuddy.host',
  );

  /// Código de acesso do alojamento, quando o servidor só responde a pedidos
  /// com `?sharecode=` (é o caso do WorkBuddy Sites). Vazio = servidor aberto,
  /// como em desenvolvimento. Compilar com:
  ///
  ///   flutter build apk --dart-define=INUKA_ACESSO=<código>
  ///
  /// Tem valor por omissão pela mesma razão que o endereço: sem ele o
  /// alojamento devolve 403 e o utilizador só via "não foi possível criar
  /// conta". Continua a poder ser sobreposto por `--dart-define`.
  static const String acessoPadrao = String.fromEnvironment(
    'INUKA_ACESSO',
    defaultValue: 'J27FVBMTIH',
  );

  // Identidade visual
  static const Color gold = Color(0xFFC9A962);
  static const Color goldLight = Color(0xFFE3D5A7);
  static const Color dark = Color(0xFF0A0A0A);
  static const Color charcoal = Color(0xFF1A1A1A);
  static const Color surface = Color(0xFF262626);
  static const Color text = Color(0xFFF5F5F5);
  static const Color muted = Color(0xFFA3A3A3);
  static const Color danger = Color(0xFFDC2626);
  static const Color success = Color(0xFF16A34A);

  static const String appName = 'INUKA Angola';
}
