/// Testes do cliente MOBILE contra a base Supabase real.
///
/// Os testes de normalização de telefone correm sempre. Os testes de
/// integração só correm quando existem credenciais de uma conta real:
///
///   INUKA_TEST_PHONE="+244900000001" INUKA_TEST_PASSWORD="..." \
///     flutter test test/live_integration_test.dart
///
/// Usam o mesmo contrato que a app usa em produção (`AppConfig`,
/// `phoneToEmail`, PostgREST), por isso validam o que o binário faz.

library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:inuka_mobile/config/app_config.dart';
import 'package:inuka_mobile/core/phone.dart';

const String _url = AppConfig.supabaseUrl;
const String _anon = AppConfig.supabaseAnonKey;

final String _telefone = Platform.environment['INUKA_TEST_PHONE'] ?? '';
final String _palavraPasse = Platform.environment['INUKA_TEST_PASSWORD'] ?? '';
final bool _temCredenciais = _telefone.isNotEmpty && _palavraPasse.isNotEmpty;

Map<String, String> _headers([String? jwt]) => {
      'apikey': _anon,
      'Authorization': 'Bearer ${jwt ?? _anon}',
      'Content-Type': 'application/json',
    };

Future<http.Response> _get(String path, {String? jwt}) =>
    http.get(Uri.parse('$_url$path'), headers: _headers(jwt));

Future<http.Response> _post(String path, Object body, {String? jwt}) => http.post(
      Uri.parse('$_url$path'),
      headers: _headers(jwt),
      body: jsonEncode(body),
    );

void main() {
  group('telefone — contrato partilhado com o web', () {
    test('aceita número local de 9 dígitos', () {
      expect(normalizePhone('923456789'), '+244923456789');
      expect(normalizePhone('923 456 789'), '+244923456789');
      expect(normalizePhone('+244 923 456 789'), '+244923456789');
      expect(normalizePhone('00244923456789'), '+244923456789');
      expect(normalizePhone('244923456789'), '+244923456789');
    });

    test('rejeita números inválidos', () {
      expect(normalizePhone(''), '');
      expect(normalizePhone('123'), '');
      expect(normalizePhone('abc'), '');
      expect(normalizePhone('+244'), '');
    });

    test('email interno é determinístico', () {
      expect(phoneToEmail('923456789'), 'u244923456789@inuka.ao');
      expect(phoneToEmail('+244 923 456 789'), 'u244923456789@inuka.ao');
      expect(phoneToEmail('lixo'), '');
    });

    test('domínio interno coincide com o do backend', () {
      expect(AppConfig.internalEmailDomain, 'inuka.ao');
      expect(phoneToEmail('900000001'), endsWith('@inuka.ao'));
    });
  });

  group(
    'integração ao vivo',
    skip: _temCredenciais
        ? false
        : 'definir INUKA_TEST_PHONE e INUKA_TEST_PASSWORD para correr',
    () {
      late String jwt;
      late String userId;

      test('login com email derivado do telefone', () async {
        final email = phoneToEmail(_telefone);
        expect(email, isNotEmpty, reason: 'telefone de teste inválido');

        final res = await _post(
          '/auth/v1/token?grant_type=password',
          {'email': email, 'password': _palavraPasse},
        );

        expect(res.statusCode, 200, reason: res.body);
        final corpo = jsonDecode(res.body) as Map<String, dynamic>;
        jwt = corpo['access_token'] as String;
        userId = (corpo['user'] as Map<String, dynamic>)['id'] as String;

        expect(jwt, isNotEmpty);
        expect(userId, isNotEmpty);
      });

      test('palavra-passe errada é recusada', () async {
        final res = await _post(
          '/auth/v1/token?grant_type=password',
          {'email': phoneToEmail(_telefone), 'password': 'errada-${DateTime.now().millisecondsSinceEpoch}'},
        );
        expect(res.statusCode, 400, reason: res.body);
      });

      test('catálogo público devolve produtos com preço', () async {
        final res = await _get(
          '/rest/v1/products?select=id,name,official_price,promotional_price,'
          'category:categories(name),images:product_images(url)'
          '&is_active=eq.true&limit=5',
        );
        expect(res.statusCode, 200, reason: res.body);
        final lista = jsonDecode(res.body) as List<dynamic>;
        expect(lista, isNotEmpty, reason: 'catálogo vazio');
        for (final p in lista.cast<Map<String, dynamic>>()) {
          expect(p['name'], isNotEmpty);
          expect(p['official_price'], isNotNull);
        }
      });

      test('perfil autenticado é legível e tem papel', () async {
        final res = await _get(
          '/rest/v1/profiles?select=id,full_name,phone,role&id=eq.$userId',
          jwt: jwt,
        );
        expect(res.statusCode, 200, reason: res.body);
        final lista = jsonDecode(res.body) as List<dynamic>;
        expect(lista, hasLength(1));
        final perfil = lista.first as Map<String, dynamic>;
        expect(perfil['phone'], isNotNull);
        expect(['customer', 'seller', 'manager'], contains(perfil['role']));
      });

      test('RLS esconde perfis a anónimos', () async {
        final res = await _get('/rest/v1/profiles?select=id&limit=5');
        expect(res.statusCode, 200);
        expect(jsonDecode(res.body), isEmpty);
      });

      test('minhas encomendas responde sem erro', () async {
        final res = await _post('/rest/v1/rpc/my_orders', {}, jwt: jwt);
        expect(res.statusCode, 200, reason: res.body);
        expect(jsonDecode(res.body), isA<List<dynamic>>());
      });

      test('dashboard é negado a quem não é gestor', () async {
        final perfil = await _get(
          '/rest/v1/profiles?select=role&id=eq.$userId',
          jwt: jwt,
        );
        final papel = (jsonDecode(perfil.body) as List).first['role'] as String;
        if (papel == 'manager') return; // conta de gestão pode ver

        final res = await _post('/rest/v1/rpc/dashboard_stats', {}, jwt: jwt);
        expect(res.statusCode, 403, reason: res.body);
      });

      test('realtime aceita subscrição autenticada', () async {
        final res = await _get('/realtime/v1/api/broadcast', jwt: jwt);
        // Só verificamos que o endpoint responde (não é 5xx).
        expect(res.statusCode, lessThan(500));
      });
    },
  );
}
