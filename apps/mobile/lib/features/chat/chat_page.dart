import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';

/// Duas mensagens seguidas da mesma pessoa, com menos de cinco minutos, ficam
/// no mesmo bloco — é o que dá o ritmo do Telegram: sem repetir o nome nem a
/// cara em cada linha.
const Duration _janelaBloco = Duration(minutes: 5);

const List<String> _meses = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/// Chat de uma conversa, com Realtime e envio de mensagens.
///
/// A mensagem só aparece na lista depois de o servidor confirmar o INSERT.
/// Em caso de falha o texto é reposto no campo — nunca se perde o que o
/// utilizador escreveu.
class ChatPage extends StatefulWidget {
  const ChatPage({
    super.key,
    required this.conversationId,
    required this.titulo,
    this.grupo = false,
  });

  final String conversationId;
  final String titulo;

  /// Num grupo mostra-se quem falou; numa conversa directa o nome é o próprio
  /// título da página, por isso repeti-lo em cada bolha só ocupa espaço.
  final bool grupo;

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final _mensagemCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();

  List<Map<String, dynamic>> _mensagens = [];
  Map<String, String> _nomes = {};
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
      if (mounted) {
        setState(() => _erro = 'Sem ligação. Não foi possível carregar as mensagens.');
      }
    } finally {
      if (mounted) setState(() => _aCarregar = false);
    }
  }

  /// Nomes de quem fala. `messages.sender_id` aponta para `auth.users`, por
  /// isso o nome vem dos membros da conversa e não de um embed.
  Future<void> _carregarNomes() async {
    if (!widget.grupo) return;
    try {
      final res = await Supabase.instance.client
          .from('conversation_members')
          .select('user_id, profile:profiles(full_name)')
          .eq('conversation_id', widget.conversationId);

      final nomes = <String, String>{};
      for (final linha in res as List) {
        final mapa = linha as Map;
        final perfil = mapa['profile'] as Map?;
        final nome = (perfil?['full_name'] as String?)?.trim();
        final id = mapa['user_id'] as String?;
        if (id != null && nome != null && nome.isNotEmpty) nomes[id] = nome;
      }
      if (mounted) setState(() => _nomes = nomes);
    } catch (_) {
      // Sem nomes o chat continua a funcionar; só não mostra o autor.
    }
  }

  void _subscrever() {
    _carregarNomes();
    _canal =
        Supabase.instance.client
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
      await Supabase.instance.client.rpc(
        'mark_conversation_read',
        params: {'p_conversation_id': widget.conversationId},
      );
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

  // --- Datas e nomes ---------------------------------------------------------

  DateTime? _data(dynamic valor) {
    if (valor is String) return DateTime.tryParse(valor)?.toLocal();
    return null;
  }

  bool _mesmoDia(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  String _hora(DateTime d) =>
      '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

  String _rotuloDia(DateTime d) {
    final agora = DateTime.now();
    final hoje = DateTime(agora.year, agora.month, agora.day);
    final dia = DateTime(d.year, d.month, d.day);
    final diferenca = hoje.difference(dia).inDays;
    if (diferenca == 0) return 'Hoje';
    if (diferenca == 1) return 'Ontem';
    return '${d.day} de ${_meses[d.month - 1]}';
  }

  String _iniciais(String nome) {
    final partes =
        nome.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (partes.isEmpty) return '?';
    if (partes.length == 1) return partes.first.substring(0, 1).toUpperCase();
    return (partes.first.substring(0, 1) + partes.last.substring(0, 1))
        .toUpperCase();
  }

  // --- Construção ------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final eu = Supabase.instance.client.auth.currentUser?.id;
    final largura = MediaQuery.of(context).size.width;

    return Scaffold(
      appBar: AppBar(title: Text(widget.titulo)),
      body: Column(
        children: [
          Expanded(
            child:
                _aCarregar
                    ? const Center(
                      child: CircularProgressIndicator(color: AppConfig.gold),
                    )
                    : _erro != null
                    ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              _erro!,
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: AppConfig.muted),
                            ),
                            const SizedBox(height: 16),
                            OutlinedButton(
                              onPressed: _carregar,
                              child: const Text('Tentar novamente'),
                            ),
                          ],
                        ),
                      ),
                    )
                    : _mensagens.isEmpty
                    ? const Center(
                      child: Padding(
                        padding: EdgeInsets.symmetric(horizontal: 32),
                        child: Text(
                          'Ainda sem mensagens. Escreva a primeira.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: AppConfig.muted),
                        ),
                      ),
                    )
                    : ListView.builder(
                      controller: _scrollCtrl,
                      padding: const EdgeInsets.fromLTRB(12, 14, 12, 14),
                      itemCount: _mensagens.length,
                      itemBuilder: (context, i) {
                        final m = _mensagens[i];
                        final anterior = i > 0 ? _mensagens[i - 1] : null;
                        final seguinte =
                            i < _mensagens.length - 1
                                ? _mensagens[i + 1]
                                : null;

                        final data = _data(m['created_at']) ?? DateTime.now();
                        final dataAnterior =
                            anterior == null
                                ? null
                                : _data(anterior['created_at']);
                        final dataSeguinte =
                            seguinte == null
                                ? null
                                : _data(seguinte['created_at']);

                        final abreDia =
                            dataAnterior == null ||
                            !_mesmoDia(dataAnterior, data);

                        final junto =
                            !abreDia &&
                            anterior != null &&
                            anterior['sender_id'] == m['sender_id'] &&
                            data.difference(dataAnterior).inMinutes <
                                _janelaBloco.inMinutes;

                        final fechaBloco =
                            seguinte == null ||
                            seguinte['sender_id'] != m['sender_id'] ||
                            dataSeguinte == null ||
                            !_mesmoDia(dataSeguinte, data) ||
                            dataSeguinte.difference(data) >= _janelaBloco;

                        final minha = m['sender_id'] == eu;
                        final autor =
                            _nomes[m['sender_id'] as String? ?? ''] ??
                            'Participante';
                        final mostraAutor = widget.grupo && !minha && !junto;

                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            if (abreDia)
                              Padding(
                                padding: const EdgeInsets.only(
                                  top: 12,
                                  bottom: 10,
                                ),
                                child: Center(
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 12,
                                      vertical: 4,
                                    ),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFF1C1C1C),
                                      borderRadius: BorderRadius.circular(999),
                                    ),
                                    child: Text(
                                      _rotuloDia(data),
                                      style: const TextStyle(
                                        color: AppConfig.muted,
                                        fontSize: 11,
                                        letterSpacing: 0.6,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            Padding(
                              padding: EdgeInsets.only(top: junto ? 2 : 8),
                              child: Row(
                                mainAxisAlignment:
                                    minha
                                        ? MainAxisAlignment.end
                                        : MainAxisAlignment.start,
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  if (widget.grupo && !minha) ...[
                                    _Avatar(
                                      iniciais: _iniciais(autor),
                                      visivel: fechaBloco,
                                    ),
                                    const SizedBox(width: 8),
                                  ],
                                  Flexible(
                                    child: Container(
                                      constraints: BoxConstraints(
                                        maxWidth: largura * 0.78,
                                      ),
                                      padding: const EdgeInsets.fromLTRB(
                                        14,
                                        9,
                                        14,
                                        8,
                                      ),
                                      decoration: BoxDecoration(
                                        color:
                                            minha
                                                ? AppConfig.gold
                                                : AppConfig.surface,
                                        borderRadius: BorderRadius.only(
                                          topLeft: const Radius.circular(18),
                                          topRight: const Radius.circular(18),
                                          bottomLeft: Radius.circular(
                                            !minha && fechaBloco ? 4 : 18,
                                          ),
                                          bottomRight: Radius.circular(
                                            minha && fechaBloco ? 4 : 18,
                                          ),
                                        ),
                                      ),
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          if (mostraAutor)
                                            Padding(
                                              padding: const EdgeInsets.only(
                                                bottom: 2,
                                              ),
                                              child: Text(
                                                autor,
                                                style: const TextStyle(
                                                  color: AppConfig.gold,
                                                  fontSize: 12,
                                                  fontWeight: FontWeight.w600,
                                                ),
                                              ),
                                            ),
                                          Text(
                                            m['content'] as String? ?? '',
                                            style: TextStyle(
                                              color:
                                                  minha
                                                      ? AppConfig.dark
                                                      : AppConfig.text,
                                              fontSize: 15,
                                              height: 1.35,
                                            ),
                                          ),
                                          const SizedBox(height: 2),
                                          Align(
                                            alignment: Alignment.centerRight,
                                            child: Text(
                                              _hora(data),
                                              style: TextStyle(
                                                color:
                                                    minha
                                                        ? AppConfig.dark
                                                            .withValues(
                                                              alpha: 0.55,
                                                            )
                                                        : AppConfig.muted,
                                                fontSize: 10,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        );
                      },
                    ),
          ),
          _compositor(),
        ],
      ),
    );
  }

  Widget _compositor() {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
        decoration: const BoxDecoration(
          color: AppConfig.charcoal,
          border: Border(top: BorderSide(color: Color(0xFF232323))),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: const Color(0xFF161616),
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(color: AppConfig.surface),
                ),
                child: TextField(
                  controller: _mensagemCtrl,
                  minLines: 1,
                  maxLines: 5,
                  keyboardType: TextInputType.multiline,
                  textCapitalization: TextCapitalization.sentences,
                  style: const TextStyle(color: AppConfig.text, fontSize: 15),
                  decoration: const InputDecoration(
                    hintText: 'Escrever mensagem…',
                    hintStyle: TextStyle(
                      color: Color(0xFF6F6F6F),
                      fontSize: 15,
                    ),
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(vertical: 13),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 46,
              height: 46,
              child: Material(
                color: AppConfig.gold,
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: _aEnviar ? null : _enviar,
                  child: Center(
                    child:
                        _aEnviar
                            ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: AppConfig.dark,
                              ),
                            )
                            : const Icon(
                              Icons.send_rounded,
                              size: 20,
                              color: AppConfig.dark,
                            ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Cara de quem falou. Ocupa sempre o mesmo espaço: só fica invisível nos
/// blocos seguintes, senão o texto dançava para a esquerda.
class _Avatar extends StatelessWidget {
  const _Avatar({required this.iniciais, required this.visivel});

  final String iniciais;
  final bool visivel;

  @override
  Widget build(BuildContext context) {
    if (!visivel) return const SizedBox(width: 28);
    return Container(
      width: 28,
      height: 28,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: AppConfig.surface,
        shape: BoxShape.circle,
      ),
      child: Text(
        iniciais,
        style: const TextStyle(
          color: AppConfig.gold,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
