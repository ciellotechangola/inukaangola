import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';

/// Chat de uma conversa, com Realtime e envio de mensagens.
///
/// A mensagem só aparece na lista depois de o servidor confirmar o INSERT.
/// Em caso de falha o texto é reposto no campo — nunca se perde o que o
/// utilizador escreveu.
class ChatPage extends StatefulWidget {
  const ChatPage({super.key, required this.conversationId, required this.titulo});

  final String conversationId;
  final String titulo;

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final _mensagemCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();

  List<Map<String, dynamic>> _mensagens = [];
  bool _aCarregar = true;
  bool _aEnviar = false;
  String? _erro;
  RealtimeChannel? _canal;

  @override
  void initState() {
    super.initState();
    _carregar();
    _subscrever();
    _marcarLida();
  }

  @override
  void dispose() {
    _canal?.unsubscribe();
    _mensagemCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  Future<void> _carregar() async {
    setState(() {
      _aCarregar = true;
      _erro = null;
    });
    try {
      final res = await Supabase.instance.client
          .from('messages')
          .select('id, sender_id, content, created_at')
          .eq('conversation_id', widget.conversationId)
          .order('created_at', ascending: true)
          .limit(200);

      if (mounted) {
        setState(() => _mensagens = (res as List).cast<Map<String, dynamic>>());
      }
      _descer();
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem ligação. Não foi possível carregar as mensagens.');
    } finally {
      if (mounted) setState(() => _aCarregar = false);
    }
  }

  void _subscrever() {
    _canal = Supabase.instance.client
        .channel('mensagens:${widget.conversationId}')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'messages',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'conversation_id',
            value: widget.conversationId,
          ),
          callback: (payload) {
            final nova = payload.newRecord;
            if (_mensagens.any((m) => m['id'] == nova['id'])) return;
            setState(() => _mensagens.add(nova));
            _descer();
          },
        )
        .subscribe();
  }

  Future<void> _marcarLida() async {
    try {
      await Supabase.instance.client
          .rpc('mark_conversation_read', params: {'p_conversation_id': widget.conversationId});
    } catch (_) {
      // Não é crítico: a leitura volta a ser marcada na próxima abertura.
    }
  }

  void _descer() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _enviar() async {
    final texto = _mensagemCtrl.text.trim();
    if (texto.isEmpty || _aEnviar) return;

    final eu = Supabase.instance.client.auth.currentUser?.id;
    if (eu == null) return;

    setState(() => _aEnviar = true);
    _mensagemCtrl.clear();

    try {
      await Supabase.instance.client.from('messages').insert({
        'conversation_id': widget.conversationId,
        'sender_id': eu,
        'content': texto,
      });
      // O Realtime traz a mensagem; se estiver desligado, recarregamos.
      await Future<void>.delayed(const Duration(milliseconds: 300));
      if (_mensagens.every((m) => m['content'] != texto)) await _carregar();
    } on PostgrestException catch (e) {
      _mensagemCtrl.text = texto;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message), backgroundColor: AppConfig.danger),
        );
      }
    } catch (_) {
      _mensagemCtrl.text = texto;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Sem ligação. A mensagem não foi enviada.'),
            backgroundColor: AppConfig.danger,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _aEnviar = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final eu = Supabase.instance.client.auth.currentUser?.id;

    return Scaffold(
      appBar: AppBar(title: Text(widget.titulo)),
      body: Column(
        children: [
          Expanded(
            child: _aCarregar
                ? const Center(child: CircularProgressIndicator(color: AppConfig.gold))
                : _erro != null
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(_erro!, textAlign: TextAlign.center,
                                  style: const TextStyle(color: AppConfig.muted)),
                              const SizedBox(height: 16),
                              OutlinedButton(onPressed: _carregar, child: const Text('Tentar novamente')),
                            ],
                          ),
                        ),
                      )
                    : _mensagens.isEmpty
                        ? const Center(
                            child: Text('Sem mensagens nesta conversa.',
                                style: TextStyle(color: AppConfig.muted)),
                          )
                        : ListView.builder(
                            controller: _scrollCtrl,
                            padding: const EdgeInsets.all(12),
                            itemCount: _mensagens.length,
                            itemBuilder: (context, i) {
                              final m = _mensagens[i];
                              final minha = m['sender_id'] == eu;
                              return Align(
                                alignment:
                                    minha ? Alignment.centerRight : Alignment.centerLeft,
                                child: Container(
                                  margin: const EdgeInsets.only(bottom: 8),
                                  padding:
                                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                  constraints: BoxConstraints(
                                    maxWidth: MediaQuery.of(context).size.width * 0.75,
                                  ),
                                  decoration: BoxDecoration(
                                    color: minha ? AppConfig.gold : AppConfig.charcoal,
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Text(
                                    m['content'] as String? ?? '',
                                    style: TextStyle(
                                      color: minha ? AppConfig.dark : AppConfig.text,
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
          ),
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: const BoxDecoration(
                color: AppConfig.charcoal,
                border: Border(top: BorderSide(color: AppConfig.surface)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _mensagemCtrl,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _enviar(),
                      decoration: const InputDecoration(
                        hintText: 'Escrever mensagem…',
                        isDense: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    onPressed: _aEnviar ? null : _enviar,
                    icon: _aEnviar
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send, color: AppConfig.gold),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
