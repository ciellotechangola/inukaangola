import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/phone.dart';
import '../../core/servidor.dart';
import '../settings/servidor_page.dart';

/// Registo de conta.
///
/// O registo é delegado ao servidor (`POST /api/auth/registo`) porque a
/// criação de utilizadores exige a `service_role`, que nunca pode estar
/// dentro do binário da app. Ver `apps/web/src/app/api/auth/registo/route.ts`.
class RegisterPage extends StatefulWidget {
  const RegisterPage({super.key});

  @override
  State<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends State<RegisterPage> {
  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _neighborhoodCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  final _confirmCtrl = TextEditingController();

  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _neighborhoodCtrl.dispose();
    _passCtrl.dispose();
    _confirmCtrl.dispose();
    super.dispose();
  }

  Future<void> _register() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      if (_nameCtrl.text.trim().length < 3) {
        setState(() => _error = 'Indique o nome completo.');
        return;
      }
      if (normalizePhone(_phoneCtrl.text).isEmpty) {
        setState(() => _error = 'Telefone inválido. Use +244 9xx xxx xxx.');
        return;
      }
      if (_passCtrl.text.length < 6) {
        setState(() => _error = 'A palavra-passe deve ter pelo menos 6 caracteres.');
        return;
      }
      if (_passCtrl.text != _confirmCtrl.text) {
        setState(() => _error = 'As palavras-passe não coincidem.');
        return;
      }

      final response = await http
          .post(
            Servidor.instance.url('/api/auth/registo'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'full_name': _nameCtrl.text.trim(),
              'phone': _phoneCtrl.text.trim(),
              'neighborhood': _neighborhoodCtrl.text.trim(),
              'password': _passCtrl.text,
            }),
          )
          .timeout(const Duration(seconds: 25));

      final body = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body) as Map<String, dynamic>;

      if (response.statusCode != 200 && response.statusCode != 201) {
        setState(() => _error = (body['error'] as String?) ??
            'Não foi possível criar a conta.');
        return;
      }

      // Conta criada: iniciar sessão imediatamente.
      await Supabase.instance.client.auth.signInWithPassword(
        email: phoneToEmail(_phoneCtrl.text),
        password: _passCtrl.text,
      );

      // `true` diz ao ecrã de entrada que já há sessão — ele fecha-se e a
      // acção que estava pendente (comprar, favoritar) continua.
      if (mounted) Navigator.of(context).pop(true);
    } on AuthException catch (e) {
      setState(() => _error = 'Conta criada, mas o login falhou: ${e.message}');
    } catch (_) {
      setState(() => _error =
          'Não foi possível contactar o servidor (${Servidor.instance.baseUrl}).');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Criar conta')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_error != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 16),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppConfig.danger.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(_error!, style: const TextStyle(color: Colors.red)),
                ),
              TextField(
                controller: _nameCtrl,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(labelText: 'Nome completo'),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _phoneCtrl,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  labelText: 'Telefone',
                  hintText: '+244 9xx xxx xxx',
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _neighborhoodCtrl,
                decoration: const InputDecoration(labelText: 'Bairro (opcional)'),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _passCtrl,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Palavra-passe'),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _confirmCtrl,
                obscureText: true,
                decoration:
                    const InputDecoration(labelText: 'Confirmar palavra-passe'),
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: _loading ? null : _register,
                child: Text(_loading ? 'A criar...' : 'Criar conta'),
              ),
              // O registo é a única operação que precisa do servidor web.
              // Deixá-lo visível aqui evita o beco sem saída de "não consigo
              // criar conta" sem forma de corrigir o endereço.
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: _loading
                    ? null
                    : () async {
                        await Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => const ServidorPage()),
                        );
                        if (mounted) setState(() {});
                      },
                icon: const Icon(Icons.dns_outlined, size: 16, color: AppConfig.muted),
                label: Text(
                  'Servidor: ${Servidor.instance.baseUrl}',
                  style: const TextStyle(color: AppConfig.muted, fontSize: 12),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
