import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/phone.dart';
import 'register_page.dart';

/// Entrada na conta.
///
/// A app abre no catálogo: este ecrã só aparece quando uma acção exige conta
/// (comprar, guardar favorito, falar com a equipa) ou quando o utilizador a
/// pede no perfil. Por isso aceita `motivo` — dizer *porque* é que se está a
/// pedir a entrada evita a sensação de bloqueio — e `podeVoltar`, que mostra
/// «continuar a ver o catálogo» em vez de prender o visitante.
class LoginPage extends StatefulWidget {
  const LoginPage({
    super.key,
    this.motivo,
    this.podeVoltar = false,
  });

  final String? motivo;
  final bool podeVoltar;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _phoneCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  bool _loading = false;
  String? _error;
  bool _verPassword = false;

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

      if (!mounted) return;
      // Devolve `true` a quem pediu a sessão, para retomar a acção.
      if (Navigator.of(context).canPop()) {
        Navigator.of(context).pop(true);
      }
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message.toLowerCase().contains('invalid')
          ? 'Telefone ou palavra-passe incorretos.'
          : e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Erro ao entrar. Verifique a ligação.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _abrirRegisto() async {
    final criou = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const RegisterPage()),
    );
    if (!mounted) return;
    if (criou == true && Navigator.of(context).canPop()) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: widget.podeVoltar
          ? AppBar(
              backgroundColor: AppConfig.dark,
              elevation: 0,
              leading: IconButton(
                icon: const Icon(Icons.close),
                tooltip: 'Continuar sem conta',
                onPressed: () => Navigator.of(context).pop(false),
              ),
            )
          : null,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 12),
              // Marca: o mesmo dourado e o mesmo espaçamento do site.
              Center(
                child: Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: AppConfig.gold.withValues(alpha: 0.5)),
                    color: AppConfig.gold.withValues(alpha: 0.08),
                  ),
                  alignment: Alignment.center,
                  child: const Text(
                    'INUKA',
                    style: TextStyle(
                      color: AppConfig.gold,
                      fontSize: 11,
                      letterSpacing: 2.4,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              const Text(
                'Bem-vindo de volta',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 22, color: AppConfig.text),
              ),
              const SizedBox(height: 6),
              Text(
                widget.motivo ?? 'Entre com o seu número de telefone.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppConfig.muted, fontSize: 13, height: 1.4),
              ),
              const SizedBox(height: 28),
              if (_error != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 16),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppConfig.danger.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(_error!,
                      style: const TextStyle(color: Color(0xFFF87171), fontSize: 13)),
                ),
              TextField(
                controller: _phoneCtrl,
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: 'Telefone',
                  hintText: '+244 9xx xxx xxx',
                  prefixIcon: Icon(Icons.phone_outlined, size: 20),
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _passCtrl,
                obscureText: !_verPassword,
                textInputAction: TextInputAction.done,
                decoration: InputDecoration(
                  labelText: 'Palavra-passe',
                  prefixIcon: const Icon(Icons.lock_outline, size: 20),
                  suffixIcon: IconButton(
                    icon: Icon(
                      _verPassword ? Icons.visibility_off : Icons.visibility,
                      size: 20,
                      color: AppConfig.muted,
                    ),
                    onPressed: () => setState(() => _verPassword = !_verPassword),
                  ),
                ),
                onSubmitted: (_) => _loading ? null : _login(),
              ),
              const SizedBox(height: 22),
              ElevatedButton(
                onPressed: _loading ? null : _login,
                child: Text(_loading ? 'A entrar…' : 'Entrar'),
              ),
              const SizedBox(height: 10),
              TextButton(
                onPressed: _loading ? null : _abrirRegisto,
                child: const Text(
                  'Ainda não tem conta? Criar conta',
                  style: TextStyle(color: AppConfig.gold),
                ),
              ),
              if (widget.podeVoltar) ...[
                const SizedBox(height: 4),
                TextButton(
                  onPressed: _loading ? null : () => Navigator.of(context).pop(false),
                  child: const Text(
                    'Continuar a ver o catálogo',
                    style: TextStyle(color: AppConfig.muted, fontSize: 13),
                  ),
                ),
              ],
              const SizedBox(height: 24),
              const Text(
                'Os visitantes podem ver o catálogo e os preços sem conta. '
                'A conta é necessária para comprar, guardar favoritos e falar com a equipa.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppConfig.muted, fontSize: 11, height: 1.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
