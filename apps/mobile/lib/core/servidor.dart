import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/app_config.dart';

/// Endereço do servidor web (Next.js).
///
/// A app fala diretamente com o Supabase para tudo o que é dados, mas o
/// **registo** tem de passar pelo servidor web: criar utilizadores exige a
/// `service_role`, que nunca pode viver dentro do binário.
///
/// Esse endereço não pode ser fixo no código. O APK é instalado em telemóveis
/// que estão na rede da loja — não num emulador — e o servidor é o portátil do
/// gestor, cujo IP muda. Por isso o endereço é configurável em execução e
/// guardado localmente; o valor compilado serve apenas de sugestão inicial.
class Servidor extends ChangeNotifier {
  Servidor._();
  static final Servidor instance = Servidor._();

  static const _chave = 'inuka.servidor.v1';

  String _baseUrl = AppConfig.apiBaseUrlPadrao;
  bool _pronto = false;

  String get baseUrl => _baseUrl;
  bool get pronto => _pronto;

  /// Código de acesso do alojamento (ver `AppConfig.acessoPadrao`).
  String get codigoAcesso => AppConfig.acessoPadrao;

  /// Endereço completo de um caminho da API, já com o código de acesso quando
  /// o alojamento o exige. Sem código, o resultado é o mesmo de antes.
  Uri url(String caminho) {
    final completo = '$_baseUrl$caminho';
    if (codigoAcesso.isEmpty) return Uri.parse(completo);
    final separador = completo.contains('?') ? '&' : '?';
    return Uri.parse('$completo${separador}sharecode=$codigoAcesso');
  }

  /// `true` quando o endereço ainda é o de emulador — a app avisa que num
  /// telemóvel real é preciso mudar.
  bool get pareceEmulador =>
      _baseUrl.contains('10.0.2.2') || _baseUrl.contains('localhost');

  Future<void> carregar() async {
    final prefs = await SharedPreferences.getInstance();
    final guardado = prefs.getString(_chave);
    if (guardado != null && guardado.trim().isNotEmpty) {
      _baseUrl = guardado.trim();
    }
    _pronto = true;
    notifyListeners();
  }

  Future<void> definir(String endereco) async {
    final normalizado = normalizar(endereco);
    _baseUrl = normalizado;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_chave, normalizado);
    notifyListeners();
  }

  Future<void> repor() async {
    _baseUrl = AppConfig.apiBaseUrlPadrao;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_chave);
    notifyListeners();
  }

  /// Aceita `192.168.1.5`, `192.168.1.5:3000`, `http://…` ou `https://…`.
  /// Sem esquema assume `http` (é o caso do servidor local); sem porta mantém
  /// a que o utilizador escreveu, porque 3000 não é o único sítio possível.
  static String normalizar(String bruto) {
    var texto = bruto.trim();
    if (texto.isEmpty) return AppConfig.apiBaseUrlPadrao;
    if (!texto.startsWith('http://') && !texto.startsWith('https://')) {
      texto = 'http://$texto';
    }
    while (texto.endsWith('/')) {
      texto = texto.substring(0, texto.length - 1);
    }
    return texto;
  }
}
