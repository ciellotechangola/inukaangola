import '../config/app_config.dart';

/// Normaliza um número angolano para o formato +244XXXXXXXXX.
/// Devolve string vazia se o número não for válido.
String normalizePhone(String raw) {
  var cleaned = raw.replaceAll(RegExp(r'[^0-9+]'), '');

  // 00244... -> +244...
  if (cleaned.startsWith('00')) cleaned = '+${cleaned.substring(2)}';

  if (cleaned.startsWith('+')) {
    final digits = cleaned.substring(1);
    if (!RegExp(r'^\d{9,15}$').hasMatch(digits)) return '';
    return '+$digits';
  }

  if (!RegExp(r'^\d{9,15}$').hasMatch(cleaned)) return '';

  if (cleaned.startsWith('244') && cleaned.length == 12) return '+$cleaned';

  return '+244$cleaned';
}

/// Email interno determinístico usado para autenticar por telefone.
///
///   +244 900 000 009  ->  u244900000009@inuka.ao
///
/// Deve ser idêntico ao do backend (`apps/web/src/lib/phone-email.ts`).
String phoneToEmail(String phone) {
  final normalized = normalizePhone(phone);
  if (normalized.isEmpty) return '';
  return 'u${normalized.replaceFirst('+', '')}@${AppConfig.internalEmailDomain}';
}
