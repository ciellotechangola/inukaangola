import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../../config/app_config.dart';
import '../../core/servidor.dart';

/// Configuração do endereço do servidor web.
///
/// Só o **registo** usa este servidor — o resto da app fala diretamente com o
/// Supabase. Ainda assim, sem ele ninguém consegue criar conta, por isso o
/// ecrã tem de ser alcançável antes do login (está ligado ao ecrã de registo).
class ServidorPage extends StatefulWidget {
  const ServidorPage({super.key});

  @override
  State<ServidorPage> createState() => _ServidorPageState();
}

class _ServidorPageState extends State<ServidorPage> {
  late final TextEditingController _ctrl =
      TextEditingController(text: Servidor.instance.baseUrl);

  bool _aTestar = false;
  String? _resultado;
  bool _ok = false;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _guardar() async {
    await Servidor.instance.definir(_ctrl.text);
    if (!mounted) return;
    setState(() {
      _ctrl.text = Servidor.instance.baseUrl;
      _resultado = null;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Servidor guardado: ${Servidor.instance.baseUrl}'),
        backgroundColor: AppConfig.charcoal,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  Future<void> _testar() async {
    setState(() {
      _aTestar = true;
      _resultado = null;
    });

    final endereco = Servidor.normalizar(_ctrl.text);
    try {
      final resposta = await http
          .get(Uri.parse('$endereco/api/saude'))
          .timeout(const Duration(seconds: 8));
      final corpo = resposta.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(resposta.body) as Map<String, dynamic>;

      if (resposta.statusCode == 200) {
        setState(() {
          _ok = true;
          _resultado = 'Servidor a responder'
              '${corpo['app'] != null ? ' (${corpo['app']})' : ''}.';
        });
      } else {
        setState(() {
          _ok = false;
          _resultado = 'O servidor respondeu ${resposta.statusCode}. '
              'Confirme que é o endereço do site INUKA.';
        });
      }
    } catch (_) {
      setState(() {
        _ok = false;
        _resultado = 'Sem resposta em $endereco. '
            'O telemóvel e o computador têm de estar na mesma rede Wi-Fi.';
      });
    } finally {
      if (mounted) setState(() => _aTestar = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Servidor')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'Endereço do servidor',
            style: TextStyle(color: AppConfig.text, fontSize: 16),
          ),
          const SizedBox(height: 6),
          const Text(
            'Usado apenas para criar conta. No computador onde o site está a '
            'correr, o endereço aparece como "Network" ao arrancar — por '
            'exemplo http://192.168.1.5:3000.',
            style: TextStyle(color: AppConfig.muted, fontSize: 12, height: 1.4),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _ctrl,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Servidor',
              hintText: 'http://192.168.1.5:3000',
            ),
            onSubmitted: (_) => _guardar(),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: ElevatedButton(
                  onPressed: _aTestar ? null : _testar,
                  child: Text(_aTestar ? 'A testar…' : 'Testar ligação'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton(
                  onPressed: _aTestar ? null : _guardar,
                  child: const Text('Guardar'),
                ),
              ),
            ],
          ),
          if (_resultado != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: (_ok ? AppConfig.success : AppConfig.danger)
                    .withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    _ok ? Icons.check_circle_outline : Icons.error_outline,
                    size: 18,
                    color: _ok ? AppConfig.success : AppConfig.danger,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _resultado!,
                      style: TextStyle(
                        color: _ok ? AppConfig.success : AppConfig.danger,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 24),
          const Divider(color: AppConfig.surface),
          const SizedBox(height: 8),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.settings_backup_restore, color: AppConfig.muted),
            title: const Text('Repor endereço de origem',
                style: TextStyle(color: AppConfig.text, fontSize: 14)),
            subtitle: Text(
              AppConfig.apiBaseUrlPadrao,
              style: const TextStyle(color: AppConfig.muted, fontSize: 12),
            ),
            onTap: () async {
              await Servidor.instance.repor();
              if (!mounted) return;
              setState(() {
                _ctrl.text = Servidor.instance.baseUrl;
                _resultado = null;
              });
            },
          ),
        ],
      ),
    );
  }
}
