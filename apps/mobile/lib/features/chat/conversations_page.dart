import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import 'chat_page.dart';

/// Lista de conversas do utilizador autenticado.
class ConversationsPage extends StatefulWidget {
  const ConversationsPage({super.key});

  @override
  State<ConversationsPage> createState() => _ConversationsPageState();
}

class _ConversationsPageState extends State<ConversationsPage> {
  List<Map<String, dynamic>> _conversas = [];
  bool _aCarregar = true;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _aCarregar = true;
      _erro = null;
    });
    try {
      final eu = Supabase.instance.client.auth.currentUser?.id;
      if (eu == null) {
        setState(() => _erro = 'Sessão expirada. Volte a entrar.');
        return;
      }

      final membros = await Supabase.instance.client
          .from('conversation_members')
          .select('conversation_id, conversation:conversations(id, type, title, updated_at, '
              'members:conversation_members(user_id, profile:profiles(full_name)))')
          .eq('user_id', eu)
          .order('conversation(updated_at)', ascending: false);

      final lista = <Map<String, dynamic>>[];
      for (final m in membros as List) {
        final conv = (m as Map)['conversation'] as Map?;
        if (conv == null) continue;
        lista.add(Map<String, dynamic>.from(conv));
      }

      if (mounted) setState(() => _conversas = lista);
    } on PostgrestException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem ligação. Não foi possível carregar as conversas.');
    } finally {
      if (mounted) setState(() => _aCarregar = false);
    }
  }

  String _nome(Map<String, dynamic> conv) {
    final titulo = conv['title'] as String?;
    if (titulo != null && titulo.trim().isNotEmpty) return titulo;

    final eu = Supabase.instance.client.auth.currentUser?.id;
    final membros = conv['members'] as List? ?? [];
    for (final m in membros) {
      final mapa = m as Map;
      if (mapa['user_id'] == eu) continue;
      final perfil = mapa['profile'] as Map?;
      final nome = perfil?['full_name'] as String?;
      if (nome != null && nome.isNotEmpty) return nome;
    }
    return 'Conversa';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mensagens'),
        actions: [
          IconButton(onPressed: _carregar, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: _aCarregar
          ? const Center(child: CircularProgressIndicator(color: AppConfig.gold))
          : _erro != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.wifi_off, size: 48, color: AppConfig.muted),
                        const SizedBox(height: 12),
                        Text(_erro!, textAlign: TextAlign.center,
                            style: const TextStyle(color: AppConfig.muted)),
                        const SizedBox(height: 16),
                        OutlinedButton(onPressed: _carregar, child: const Text('Tentar novamente')),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _carregar,
                  child: _conversas.isEmpty
                      ? ListView(
                          children: const [
                            SizedBox(height: 120),
                            Center(
                              child: Text('Ainda não tem conversas.',
                                  style: TextStyle(color: AppConfig.muted)),
                            ),
                            SizedBox(height: 4),
                            Center(
                              child: Text(
                                'As conversas começam quando fala com o seu colaborador.',
                                style: TextStyle(color: AppConfig.muted, fontSize: 12),
                                textAlign: TextAlign.center,
                              ),
                            ),
                          ],
                        )
                      : ListView.separated(
                          itemCount: _conversas.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (context, i) {
                            final conv = _conversas[i];
                            return ListTile(
                              leading: const CircleAvatar(
                                backgroundColor: AppConfig.surface,
                                child: Icon(Icons.person_outline, color: AppConfig.gold),
                              ),
                              title: Text(_nome(conv),
                                  style: const TextStyle(color: AppConfig.text)),
                              subtitle: Text(
                                conv['type'] == 'group' ? 'Grupo' : 'Conversa direta',
                                style: const TextStyle(color: AppConfig.muted, fontSize: 12),
                              ),
                              trailing: const Icon(Icons.chevron_right, color: AppConfig.muted),
                              onTap: () => Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => ChatPage(
                                    conversationId: conv['id'] as String,
                                    titulo: _nome(conv),
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}
