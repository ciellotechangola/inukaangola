import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';

/// Feed de notícias do cliente.
///
/// Uma só chamada (`conteudo_feed`) traz o cartão completo: texto, imagem,
/// produtos, contagem de reacções e comentários, e a reacção de quem está a
/// ver. A visibilidade é decidida no servidor — o cliente recebe comunicados,
/// testemunhos e promoções publicadas; a formação continua interna.
class FeedPage extends StatefulWidget {
  const FeedPage({super.key});

  @override
  State<FeedPage> createState() => _FeedPageState();
}

class _FeedPageState extends State<FeedPage> {
  List<Map<String, dynamic>> _itens = [];
  bool _aCarregar = true;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() => _erro = null);
    try {
      final resposta = await Supabase.instance.client.rpc(
        'conteudo_feed',
        params: {'p_kind': null, 'p_limit': 30},
      );

      final lista = (resposta as List? ?? [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();

      if (!mounted) return;
      setState(() {
        _itens = lista;
        _aCarregar = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _erro = e is PostgrestException
            ? 'Não foi possível carregar as notícias.'
            : 'Sem ligação. Tente novamente.';
        _aCarregar = false;
      });
    }
  }

  Future<void> _alternarGosto(Map<String, dynamic> item) async {
    final cliente = Supabase.instance.client;
    final uid = cliente.auth.currentUser?.id;
    if (uid == null) return;

    final id = item['id'] as String;
    final jaGostei = item['minha_reacao'] != null;
    final reacoes = (item['reacoes'] as num?)?.toInt() ?? 0;

    // Optimista: o utilizador vê a mudança antes da resposta da rede.
    setState(() {
      item['minha_reacao'] = jaGostei ? null : 'gosto';
      item['reacoes'] = (reacoes + (jaGostei ? -1 : 1)).clamp(0, 1 << 30);
    });

    try {
      if (jaGostei) {
        await cliente
            .from('content_reactions')
            .delete()
            .eq('item_id', id)
            .eq('user_id', uid);
      } else {
        await cliente.from('content_reactions').upsert(
          {'item_id': id, 'user_id': uid, 'reaction': 'gosto'},
          onConflict: 'item_id,user_id',
        );
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        item['minha_reacao'] = jaGostei ? 'gosto' : null;
        item['reacoes'] = reacoes;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível reagir. Tente novamente.')),
      );
    }
  }

  void _abrirComentarios(Map<String, dynamic> item) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppConfig.charcoal,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => _Comentarios(item: item),
    ).then((_) => _carregar());
  }

  @override
  Widget build(BuildContext context) {
    if (_aCarregar) {
      return const Center(child: CircularProgressIndicator(color: AppConfig.gold));
    }

    if (_erro != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.wifi_off, color: AppConfig.muted, size: 32),
              const SizedBox(height: 12),
              Text(_erro!, textAlign: TextAlign.center, style: const TextStyle(color: AppConfig.muted)),
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: () {
                  setState(() => _aCarregar = true);
                  _carregar();
                },
                child: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      color: AppConfig.gold,
      onRefresh: _carregar,
      child: _itens.isEmpty
          ? ListView(
              children: const [
                SizedBox(height: 120),
                Icon(Icons.newspaper, color: AppConfig.muted, size: 36),
                SizedBox(height: 12),
                Center(
                  child: Text(
                    'Ainda não há notícias publicadas.',
                    style: TextStyle(color: AppConfig.muted),
                  ),
                ),
              ],
            )
          : ListView.builder(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 20),
              itemCount: _itens.length,
              itemBuilder: (_, i) => _CartaoNoticia(
                item: _itens[i],
                aoGostar: () => _alternarGosto(_itens[i]),
                aoComentar: () => _abrirComentarios(_itens[i]),
              ),
            ),
    );
  }
}

class _CartaoNoticia extends StatelessWidget {
  const _CartaoNoticia({
    required this.item,
    required this.aoGostar,
    required this.aoComentar,
  });

  final Map<String, dynamic> item;
  final VoidCallback aoGostar;
  final VoidCallback aoComentar;

  static const _tipos = {
    'comunicado': ('Comunicado', AppConfig.gold),
    'promocao': ('Promoção', Color(0xFF5FBF8F)),
    'testemunho': ('Testemunho', Color(0xFF7BA7D9)),
    'formacao': ('Formação', AppConfig.muted),
  };

  String _quando() {
    final bruto = item['published_at'] ?? item['starts_at'];
    final d = DateTime.tryParse(bruto?.toString() ?? '')?.toLocal();
    if (d == null) return '';
    final diff = DateTime.now().difference(d);
    if (diff.inMinutes < 1) return 'agora';
    if (diff.inMinutes < 60) return 'há ${diff.inMinutes} min';
    if (diff.inHours < 24) return 'há ${diff.inHours} h';
    if (diff.inDays == 1) return 'ontem';
    if (diff.inDays < 7) return 'há ${diff.inDays} dias';
    return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
  }

  String _iniciais(String nome) {
    final partes = nome.trim().split(RegExp(r'\s+'));
    if (partes.isEmpty) return 'IN';
    final primeira = partes.first.isEmpty ? '' : partes.first[0];
    final ultima = partes.length > 1 && partes.last.isNotEmpty ? partes.last[0] : '';
    return (primeira + ultima).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final tipo = _tipos[item['kind']?.toString()] ?? ('Notícia', AppConfig.muted);
    final autor = (item['author_name'] as String?)?.trim();
    final nome = (autor == null || autor.isEmpty) ? 'INUKA Angola' : autor;
    final titulo = item['title']?.toString() ?? '';
    final subtitulo = item['subtitle']?.toString();
    final corpo = item['body']?.toString();
    final imagem = item['image_url']?.toString();
    final reacoes = (item['reacoes'] as num?)?.toInt() ?? 0;
    final comentarios = (item['comentarios'] as num?)?.toInt() ?? 0;
    final gostei = item['minha_reacao'] != null;
    final fixado = item['is_pinned'] == true;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppConfig.charcoal,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppConfig.surface),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 0),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: AppConfig.dark,
                  child: Text(
                    _iniciais(nome),
                    style: const TextStyle(color: AppConfig.gold, fontSize: 11),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(
                            nome,
                            style: const TextStyle(
                              color: AppConfig.text,
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                              color: tipo.$2.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: tipo.$2.withValues(alpha: 0.35)),
                            ),
                            child: Text(
                              tipo.$1,
                              style: TextStyle(color: tipo.$2, fontSize: 10),
                            ),
                          ),
                          if (fixado)
                            const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.push_pin, size: 11, color: AppConfig.gold),
                                SizedBox(width: 2),
                                Text('fixado', style: TextStyle(color: AppConfig.gold, fontSize: 10)),
                              ],
                            ),
                        ],
                      ),
                      Text(
                        _quando(),
                        style: const TextStyle(color: AppConfig.muted, fontSize: 11),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  titulo,
                  style: const TextStyle(
                    color: AppConfig.text,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    height: 1.3,
                  ),
                ),
                if (subtitulo != null && subtitulo.trim().isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    subtitulo,
                    style: const TextStyle(color: AppConfig.muted, fontSize: 12),
                  ),
                ],
                if (corpo != null && corpo.trim().isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    corpo,
                    maxLines: 6,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppConfig.text, fontSize: 13, height: 1.45),
                  ),
                ],
              ],
            ),
          ),
          if (imagem != null && imagem.isNotEmpty) ...[
            const SizedBox(height: 12),
            AspectRatio(
              aspectRatio: 4 / 3,
              child: Image.network(
                imagem,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => Container(
                  color: AppConfig.dark,
                  alignment: Alignment.center,
                  child: const Icon(Icons.image_not_supported_outlined, color: AppConfig.muted),
                ),
              ),
            ),
          ],
          const SizedBox(height: 6),
          const Divider(height: 1, color: AppConfig.surface),
          Row(
            children: [
              if (item['allow_reactions'] != false)
                TextButton.icon(
                  onPressed: aoGostar,
                  icon: Icon(
                    gostei ? Icons.favorite : Icons.favorite_border,
                    size: 18,
                    color: gostei ? const Color(0xFFF87171) : AppConfig.muted,
                  ),
                  label: Text(
                    reacoes > 0 ? '$reacoes' : 'Gosto',
                    style: TextStyle(
                      color: gostei ? const Color(0xFFF87171) : AppConfig.muted,
                      fontSize: 12,
                    ),
                  ),
                ),
              if (item['allow_comments'] != false)
                TextButton.icon(
                  onPressed: aoComentar,
                  icon: const Icon(Icons.mode_comment_outlined, size: 17, color: AppConfig.muted),
                  label: Text(
                    comentarios > 0 ? '$comentarios' : 'Comentar',
                    style: const TextStyle(color: AppConfig.muted, fontSize: 12),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Comentários de uma publicação, com o nome de quem escreveu.
class _Comentarios extends StatefulWidget {
  const _Comentarios({required this.item});

  final Map<String, dynamic> item;

  @override
  State<_Comentarios> createState() => _ComentariosState();
}

class _ComentariosState extends State<_Comentarios> {
  final _textoCtrl = TextEditingController();
  List<Map<String, dynamic>>? _lista;
  bool _aEnviar = false;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  @override
  void dispose() {
    _textoCtrl.dispose();
    super.dispose();
  }

  Future<void> _carregar() async {
    try {
      final resposta = await Supabase.instance.client.rpc(
        'conteudo_comentarios',
        params: {'p_item_id': widget.item['id']},
      );
      if (!mounted) return;
      setState(() {
        _lista = (resposta as List? ?? [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _lista = [];
        _erro = 'Não foi possível carregar os comentários.';
      });
    }
  }

  Future<void> _enviar() async {
    final corpo = _textoCtrl.text.trim();
    final uid = Supabase.instance.client.auth.currentUser?.id;
    if (corpo.isEmpty || uid == null || _aEnviar) return;

    setState(() => _aEnviar = true);
    try {
      await Supabase.instance.client.from('content_comments').insert({
        'item_id': widget.item['id'],
        'user_id': uid,
        'body': corpo,
      });
      _textoCtrl.clear();
      await _carregar();
    } catch (_) {
      if (!mounted) return;
      setState(() => _erro = 'Não foi possível comentar.');
    } finally {
      if (mounted) setState(() => _aEnviar = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final altura = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: altura),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.6,
        child: Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppConfig.surface,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const Padding(
              padding: EdgeInsets.all(14),
              child: Text(
                'Comentários',
                style: TextStyle(color: AppConfig.text, fontWeight: FontWeight.w600),
              ),
            ),
            Expanded(
              child: _lista == null
                  ? const Center(child: CircularProgressIndicator(color: AppConfig.gold))
                  : _lista!.isEmpty
                      ? const Center(
                          child: Text(
                            'Ainda sem comentários. Seja o primeiro.',
                            style: TextStyle(color: AppConfig.muted, fontSize: 12),
                          ),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.symmetric(horizontal: 14),
                          itemCount: _lista!.length,
                          itemBuilder: (_, i) {
                            final m = _lista![i];
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    m['autor']?.toString() ?? 'Cliente',
                                    style: const TextStyle(
                                      color: AppConfig.text,
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    m['body']?.toString() ?? '',
                                    style: const TextStyle(
                                      color: AppConfig.text,
                                      fontSize: 13,
                                      height: 1.35,
                                    ),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
            ),
            if (_erro != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                child: Text(_erro!, style: const TextStyle(color: Color(0xFFF87171), fontSize: 11)),
              ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _textoCtrl,
                        style: const TextStyle(color: AppConfig.text, fontSize: 13),
                        decoration: InputDecoration(
                          hintText: 'Escreva um comentário',
                          hintStyle: const TextStyle(color: AppConfig.muted, fontSize: 13),
                          filled: true,
                          fillColor: AppConfig.dark,
                          contentPadding:
                              const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(24),
                            borderSide: BorderSide.none,
                          ),
                        ),
                        onSubmitted: (_) => _enviar(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      onPressed: _aEnviar ? null : _enviar,
                      style: IconButton.styleFrom(backgroundColor: AppConfig.gold),
                      icon: _aEnviar
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.send, size: 18, color: AppConfig.dark),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
