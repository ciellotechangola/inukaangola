import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';
import '../cart/cart_store.dart';
import '../chat/chat_page.dart';

class ProductPage extends StatefulWidget {
  const ProductPage({super.key, required this.produto});

  /// Registo vindo do PostgREST (`products` + `category` + `images`).
  final Map<String, dynamic> produto;

  @override
  State<ProductPage> createState() => _ProductPageState();
}

class _ProductPageState extends State<ProductPage> {
  int _quantidade = 1;
  bool _adicionado = false;
  bool _favorito = false;
  bool _aGuardarFavorito = false;

  String get _id => widget.produto['id'] as String;

  double get _preco {
    final promo = widget.produto['promotional_price'];
    final oficial = widget.produto['official_price'];
    return ((promo ?? oficial) as num).toDouble();
  }

  num? get _precoOficial {
    if (widget.produto['promotional_price'] == null) return null;
    return widget.produto['official_price'] as num?;
  }

  /// Todas as fotografias, capa primeiro.
  ///
  /// Um produto pode ter várias: a marcada `is_primary` é a capa; as restantes
  /// seguem por `sort_order`. A galeria desliza entre elas.
  List<String> get _imagens {
    final imagens = widget.produto['images'] as List?;
    if (imagens == null || imagens.isEmpty) return const [];

    final lista = imagens.map((e) => Map<String, dynamic>.from(e as Map)).toList()
      ..sort((a, b) {
        final capaA = a['is_primary'] == true ? 0 : 1;
        final capaB = b['is_primary'] == true ? 0 : 1;
        if (capaA != capaB) return capaA - capaB;
        return ((a['sort_order'] as num?) ?? 0)
            .compareTo((b['sort_order'] as num?) ?? 0);
      });

    return lista
        .map((e) => e['url'] as String?)
        .whereType<String>()
        .toList(growable: false);
  }

  String? get _imagem => _imagens.isEmpty ? null : _imagens.first;

  @override
  void initState() {
    super.initState();
    _verificarFavorito();
    _carregarStock();
  }

  /// Unidades disponíveis; `null` = não há inventário registado (≠ esgotado).
  ///
  /// Lê-se pela função pública `stock_produtos` e não pela tabela `inventory`
  /// porque o produto tanto pode chegar do catálogo como dos favoritos — e a
  /// lista de favoritos não traz o inventário. Assim há um só caminho.
  int? _disponivel;
  bool _aCarregarStock = true;
  bool _aAbrirChat = false;

  bool get _esgotado => _disponivel == 0;

  Future<void> _carregarStock() async {
    try {
      final resposta = await Supabase.instance.client
          .rpc('stock_produtos', params: {'p_ids': [_id]});
      if (!mounted) return;
      final linhas = (resposta as List?) ?? const [];
      final valor = linhas.isEmpty ? null : (linhas.first as Map)['disponivel'];
      setState(() => _disponivel = (valor as num?)?.toInt());
    } catch (_) {
      // Sem stock conhecido deixa-se seguir; o servidor recusa na encomenda.
    } finally {
      if (mounted) setState(() => _aCarregarStock = false);
    }
  }

  /// Abre a conversa privada com a gestão — a mesma porta do site.
  Future<void> _falarComEquipa() async {
    if (_aAbrirChat) return;
    setState(() => _aAbrirChat = true);
    try {
      final id = await Supabase.instance.client.rpc('abrir_conversa_equipa') as String;
      if (!mounted) return;
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => ChatPage(conversationId: id, titulo: 'Equipa INUKA'),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Não foi possível abrir a conversa: $e'),
          backgroundColor: AppConfig.charcoal,
        ),
      );
    } finally {
      if (mounted) setState(() => _aAbrirChat = false);
    }
  }

  Future<void> _verificarFavorito() async {
    final eu = Supabase.instance.client.auth.currentUser?.id;
    if (eu == null) return;
    try {
      final resposta = await Supabase.instance.client
          .from('favorites')
          .select('id')
          .eq('user_id', eu)
          .eq('product_id', _id)
          .limit(1);
      if (!mounted) return;
      setState(() => _favorito = (resposta as List).isNotEmpty);
    } catch (_) {
      // Sem rede: o botão fica como "não favorito" e resolve-se ao tocar.
    }
  }

  Future<void> _alternarFavorito() async {
    final eu = Supabase.instance.client.auth.currentUser?.id;
    if (eu == null || _aGuardarFavorito) return;

    setState(() => _aGuardarFavorito = true);
    final antes = _favorito;
    setState(() => _favorito = !antes);

    try {
      if (antes) {
        await Supabase.instance.client
            .from('favorites')
            .delete()
            .eq('user_id', eu)
            .eq('product_id', _id);
      } else {
        await Supabase.instance.client.from('favorites').upsert(
          {'user_id': eu, 'product_id': _id},
          onConflict: 'user_id,product_id',
        );
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _favorito = antes);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Não foi possível guardar o favorito.'),
          backgroundColor: AppConfig.charcoal,
        ),
      );
    } finally {
      if (mounted) setState(() => _aGuardarFavorito = false);
    }
  }

  Future<void> _adicionar() async {
    await CartStore.instance.adicionar(
      productId: _id,
      name: widget.produto['name'] as String,
      price: _preco,
      image: _imagem,
      quantidade: _quantidade,
    );
    if (!mounted) return;
    setState(() => _adicionado = true);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$_quantidade× ${widget.produto['name']} no carrinho'),
        backgroundColor: AppConfig.charcoal,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.produto;
    final categoria = (p['category'] as Map?)?['name'] as String?;
    final desconto = (_precoOficial != null && _precoOficial! > 0)
        ? ((1 - _preco / _precoOficial!) * 100).round()
        : 0;

    return Scaffold(
      appBar: AppBar(
        title: Text(p['name'] as String? ?? 'Produto',
            maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(
            tooltip: _favorito ? 'Remover dos favoritos' : 'Guardar nos favoritos',
            onPressed: _aGuardarFavorito ? null : _alternarFavorito,
            icon: Icon(
              _favorito ? Icons.favorite : Icons.favorite_border,
              color: _favorito ? AppConfig.gold : AppConfig.text,
            ),
          ),
        ],
      ),
      body: ListView(
        children: [
          _Galeria(imagens: _imagens, nome: p['name'] as String? ?? 'Produto'),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (categoria != null)
                  Text(categoria.toUpperCase(),
                      style: const TextStyle(
                        color: AppConfig.muted,
                        fontSize: 10,
                        letterSpacing: 1.4,
                      )),
                const SizedBox(height: 6),
                Text(p['name'] as String? ?? '',
                    style: const TextStyle(fontSize: 20, color: AppConfig.text)),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Text(
                      kz(_preco),
                      style: const TextStyle(
                        color: AppConfig.gold,
                        fontSize: 22,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (_precoOficial != null) ...[
                      const SizedBox(width: 10),
                      Text(
                        kz(_precoOficial),
                        style: const TextStyle(
                          color: AppConfig.muted,
                          fontSize: 14,
                          decoration: TextDecoration.lineThrough,
                        ),
                      ),
                    ],
                    if (desconto > 0) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding:
                            const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppConfig.gold,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          '-$desconto%',
                          style: const TextStyle(
                            color: AppConfig.dark,
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 16),
                if ((p['description'] as String?)?.isNotEmpty == true)
                  Text(p['description'] as String,
                      style: const TextStyle(color: AppConfig.muted, height: 1.5)),
                const SizedBox(height: 24),
                if (_esgotado) ...[
                  // Sem stock não se vende: mostra-se a verdade e o caminho
                  // alternativo (reservar / falar com a equipa), em vez de
                  // deixar juntar ao carrinho para falhar na encomenda.
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: AppConfig.charcoal,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppConfig.gold.withValues(alpha: 0.35)),
                    ),
                    child: const Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Esgotado de momento',
                          style: TextStyle(
                            color: AppConfig.text,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        SizedBox(height: 6),
                        Text(
                          'Deixe a sua reserva com a equipa: avisamos assim que '
                          'o produto voltar ao stock.',
                          style: TextStyle(color: AppConfig.muted, fontSize: 12, height: 1.4),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: _aAbrirChat ? null : _falarComEquipa,
                      icon: const Icon(Icons.chat_bubble_outline),
                      label: Text(_aAbrirChat ? 'A abrir…' : 'Reservar — falar com a equipa'),
                    ),
                  ),
                ] else ...[
                  Row(
                    children: [
                      const Text('Quantidade', style: TextStyle(color: AppConfig.muted)),
                      const Spacer(),
                      IconButton(
                        icon: const Icon(Icons.remove_circle_outline),
                        onPressed: _quantidade > 1
                            ? () => setState(() => _quantidade--)
                            : null,
                      ),
                      SizedBox(
                        width: 32,
                        child: Text(
                          '$_quantidade',
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontSize: 16),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.add_circle_outline),
                        // Não se passa do que existe, quando se sabe quanto é.
                        onPressed: _disponivel != null && _quantidade >= _disponivel!
                            ? null
                            : () => setState(() => _quantidade++),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _adicionar,
                      icon: Icon(_adicionado ? Icons.check : Icons.shopping_bag_outlined),
                      label: Text(_adicionado ? 'Adicionado' : 'Adicionar ao carrinho'),
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                Text(
                  _aCarregarStock
                      ? 'A confirmar disponibilidade…'
                      : _disponivel == null
                          ? 'Preço e disponibilidade confirmados pelo servidor ao finalizar.'
                          : _esgotado
                              ? 'Preço confirmado pelo servidor. Reserva sujeita a reposição.'
                              : 'Em stock · $_disponivel ${_disponivel == 1 ? "unidade" : "unidades"}',
                  style: const TextStyle(color: AppConfig.muted, fontSize: 11),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Galeria do produto: desliza entre as fotografias disponíveis.
///
/// `PageView` dá o deslize nativo; as miniaturas servem de atalho e o
/// contador «2/4» diz onde se está. Com uma só fotografia não aparece nada
/// disto — fica apenas a imagem.
class _Galeria extends StatefulWidget {
  const _Galeria({required this.imagens, required this.nome});

  final List<String> imagens;
  final String nome;

  @override
  State<_Galeria> createState() => _GaleriaState();
}

class _GaleriaState extends State<_Galeria> {
  final _controlador = PageController();
  int _indice = 0;

  @override
  void dispose() {
    _controlador.dispose();
    super.dispose();
  }

  void _irPara(int i) {
    _controlador.animateToPage(
      i,
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    final total = widget.imagens.length;

    if (total == 0) {
      return const AspectRatio(aspectRatio: 1, child: _SemImagem());
    }

    return Column(
      children: [
        AspectRatio(
          aspectRatio: 1,
          child: Stack(
            children: [
              Positioned.fill(
                child: ColoredBox(
                  color: AppConfig.dark,
                  child: PageView.builder(
                    controller: _controlador,
                    itemCount: total,
                    onPageChanged: (i) => setState(() => _indice = i),
                    itemBuilder: (_, i) => Image.network(
                      widget.imagens[i],
                      fit: BoxFit.contain,
                      semanticLabel:
                          '${widget.nome} — fotografia ${i + 1} de $total',
                      errorBuilder: (_, __, ___) => const _SemImagem(),
                    ),
                  ),
                ),
              ),
              if (total > 1)
                Positioned(
                  right: 12,
                  top: 12,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.65),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      '${_indice + 1}/$total',
                      style: const TextStyle(
                        color: AppConfig.text,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              if (total > 1)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 10,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      for (var i = 0; i < total; i++)
                        GestureDetector(
                          onTap: () => _irPara(i),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            margin: const EdgeInsets.symmetric(horizontal: 3),
                            width: i == _indice ? 18 : 6,
                            height: 6,
                            decoration: BoxDecoration(
                              color: i == _indice
                                  ? AppConfig.gold
                                  : Colors.white.withValues(alpha: 0.35),
                              borderRadius: BorderRadius.circular(3),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        if (total > 1)
          SizedBox(
            height: 76,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              itemCount: total,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, i) => GestureDetector(
                onTap: () => _irPara(i),
                child: Container(
                  width: 60,
                  height: 60,
                  clipBehavior: Clip.antiAlias,
                  decoration: BoxDecoration(
                    color: AppConfig.surface,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: i == _indice ? AppConfig.gold : AppConfig.charcoal,
                      width: i == _indice ? 1.5 : 1,
                    ),
                  ),
                  child: Image.network(
                    widget.imagens[i],
                    fit: BoxFit.contain,
                    errorBuilder: (_, __, ___) => const _SemImagem(),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _SemImagem extends StatelessWidget {
  const _SemImagem();

  @override
  Widget build(BuildContext context) {
    return const ColoredBox(
      color: AppConfig.surface,
      child: Center(
        child: Text(
          'INUKA',
          style: TextStyle(color: AppConfig.muted, fontSize: 14, letterSpacing: 3),
        ),
      ),
    );
  }
}
