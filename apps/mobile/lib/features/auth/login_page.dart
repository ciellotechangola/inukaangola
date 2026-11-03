import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../config/app_config.dart';
import '../../core/phone.dart';
import 'register_page.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _phoneCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _phoneCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      // O email é derivado do telefone de forma determinística.
      // Não consultamos `profiles`: o RLS esconde os perfis a anónimos
      // e essa consulta revelaria que telefones estão registados.
      final email = phoneToEmail(_phoneCtrl.text);

      if (email.isEmpty) {
        setState(() => _error = 'Telefone inválido. Use +244 9xx xxx xxx.');
        return;
      }

      await Supabase.instance.client.auth.signInWithPassword(
        email: email,
        password: _passCtrl.text,
      );
      // A navegação é feita pelo RootPage via onAuthStateChange.
    } on AuthException catch (e) {
      setState(() => _error = e.message.toLowerCase().contains('invalid')
          ? 'Telefone ou palavra-passe incorretos.'
          : e.message);
    } catch (e) {
      setState(() => _error = 'Erro ao entrar. Verifique a ligação.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 60),
              const Center(
                child: Text(
                  AppConfig.appName,
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w300,
                    color: AppConfig.gold,
                  ),
                ),
              ),
              const Center(
                child: Text(
                  'Iniciar sessão',
                  style: TextStyle(color: AppConfig.muted),
                ),
              ),
              const SizedBox(height: 40),
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
                controller: _phoneCtrl,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Telefone'),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _passCtrl,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Palavra-passe'),
                onSubmitted: (_) => _loading ? null : _login(),
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: _loading ? null : _login,
                child: Text(_loading ? 'A entrar...' : 'Entrar'),
              ),
              const SizedBox(height: 12),
              TextButton(
                onPressed: _loading
                    ? null
                    : () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => const RegisterPage(),
                          ),
                        ),
                child: const Text(
                  'Ainda não tem conta? Criar conta',
                  style: TextStyle(color: AppConfig.gold),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
