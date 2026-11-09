import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';
import '../../core/sessao.dart';
import '../../widgets/estado.dart';
import '../../widgets/produto_cartao.dart';
import '../cart/cart_store.dart';
import '../chat/chat_page.dart';

/// Página de produto — a mesma informação que o site mostra.
///
/// Recebe o registo do catálogo (para abrir sem espera) e volta a pedi-lo ao
/// servidor: preço, stock e fotografias podem ter mudado desde que a grelha
/// foi carregada, e é o servidor que manda.
class ProductPage extends StatefulWidget {
  const ProductPage({super.key, required this.produto});

  final Map<String, dynamic> produto;

  @override
  State<ProductPage> createState() => _ProductPageState();
}

class _ProductPageState extends State<ProductPage> {
  late Map<String, dynamic> _produto = widget.produto;

  int _quantidade = 1;
  bool _adicionado = false;
  bool _favorito = false;
  bool _aGuardarFavorito = false;
  bool _aReservar = false;
  bool _aAbrirChat = false;

  int? _disponivel;
  bool _aCarregarStock = true;

  List<Map<String, dynamic>> _relacionados = [];

  String get _id => _produto['id'] as String;

  num get _preco => precoEfetivo(_produto);

  num? get _precoOficial {
    if (_produto['promotional_price'] == null) return null;
    return _produto['official_price'] as num?;
  }

  int get _desconto => percentagemDesconto(_produto);

  List<String> get _imagens => imagensDoProduto(_produto);

  bool get _esgotado => _disponivel == 0;

  @override
  void initState() {
    super.initState();
    _carregarDetalhe();
    _carregarStock();
    _verificarFavorito();
  }

  /// Versão fresca do produto, com categoria e fotografias.
  Future<void> _carregarDetalhe() async {
    try {
      final resposta = await Supabase.instance.client
          .from('products')
          .select('id, name, description, sku, official_price, promotional_price, '
              'is_featured, is_bestseller, is_new, created_at, category_id, '
              'category:categories(id, name, slug), '
              'images:product_images(url, is_primary, sort_order)')
          .eq('id', _id)
          .single();
      if (!mounted) return;
      setState(() => _produto = Map<String, dynamic>.from(resposta));

      final categoriaId = _produto['category_id'] as String?;
      if (categoriaId != null) _carregarRelacionados(categoriaId);
    } catch (_) {
      // Fica o registo que veio do catálogo — já tem nome, preço e fotos.
      final categoriaId = _produto['category_id'] as String?;
      if (categoriaId != null) _carregarRelacionados(categoriaId);
    }
  }

  Future<void> _carregarRelacionados(String categoriaId) async {
    try {
      final resposta = await Supabase.instance.client
          .from('products')
          .select('id, name, official_price, promotional_price, is_new, '
              'category:categories(id, name), '
              'images:product_images(url, is_primary, sort_order)')
          .eq('is_active', true)
          .eq('category_id', categoriaId)
          .neq('id', _id)
          .limit(4);
      final lista = (resposta as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      if (!mounted) return;
      setState(() => _relacionados = lista);
    } catch (_) {
      // Sem relacionados a página continua completa.
    }
  }

  /// Disponibilidade pela função pública `stock_produtos`: `null` = sem
  /// inventário registado (não é o mesmo que esgotado).
  Future<void> _carregarStock() async {
    try {
      final resposta = await Supabase.instance.client
          .rpc('stock_produtos', params: {'p_ids': [_id]});
      final linhas = (resposta as List?) ?? const [];
      final valor = linhas.isEmpty ? null : (linhas.first as Map)['disponivel'];
      if (!mounted) return;
      setState(() => _disponivel = (valor as num?)?.toInt());
    } catch (_) {
      // Sem stock conhecido deixa-se seguir; o servidor recusa na encomenda.
    } finally {
      if (mounted) setState(() => _aCarregarStock = false);
    }
  }

  Future<void> _verificarFavorito() async {
    final eu = Sessao.instance.uid;
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
      // Sem rede o botão fica como «não favorito» e resolve-se ao tocar.
    }
  }

  Future<void> _alternarFavorito() async {
    if (!await Sessao.exigirSessao(context,
        motivo: 'Entre para guardar este produto nos favoritos.')) {
      return;
    }
    final eu = Sessao.instance.uid;
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
      avisar(context, 'Não foi possível guardar o favorito.', erro: true);
    } finally {
      if (mounted) setState(() => _aGuardarFavorito = false);
    }
  }

  Future<void> _adicionar() async {
    await CartStore.instance.adicionar(
      productId: _id,
      name: _produto['name'] as String,
      price: _preco.toDouble(),
      image: _imagens.isEmpty ? null : _imagens.first,
      quantidade: _quantidade,
    );
    if (!mounted) return;
    setState(() => _adicionado = true);
    avisar(context, '$_quantidade× ${_produto['name']} no carrinho');
  }

  /// Reserva de produto esgotado: o mesmo caminho do site (`create_reservation`).
  Future<void> _reservar() async {
    if (!await Sessao.exigirSessao(context,
        motivo: 'Entre para deixar a sua reserva e ser avisado.')) {
      return;
    }
    setState(() => _aReservar = true);
    try {
      final resposta = await Supabase.instance.client.rpc('create_reservation', params: {
        'p_items': [
          {'product_id': _id, 'quantity': _quantidade}
        ],
        'p_expires_at': null,
        'p_notes': 'Reserva de produto esgotado — avisar quando houver stock.',
      });
      final mapa = Map<String, dynamic>.from(resposta as Map);
      if (!mounted) return;
      avisar(
        context,
        'Reserva registada. Avisamos quando houver stock '
        '(${dataCurta(mapa['expires_at'])}).',
      );
    } on PostgrestException catch (e) {
      if (!mounted) return;
      avisar(context, e.message, erro: true);
    } catch (_) {
      if (!mounted) return;
      avisar(context, 'Sem ligação. A reserva não foi enviada.', erro: true);
    } finally {
      if (mounted) setState(() => _aReservar = false);
    }
  }

  Future<void> _falarComEquipa() async {
    if (!await Sessao.exigirSessao(context,
        motivo: 'Entre para falar com a equipa INUKA.')) {
      return;
    }
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
    } catch (_) {
      if (!mounted) return;
      avisar(context, 'Não foi possível abrir a conversa.', erro: true);
    } finally {
      if (mounted) setState(() => _aAbrirChat = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _produto;
    final categoria = (p['category'] as Map?)?['name'] as String?;
    final sku = p['sku'] as String?;
    final poupa = (_precoOficial != null && _precoOficial! > _preco)
        ? _precoOficial! - _preco
        : 0;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          p['name'] as String? ?? 'Produto',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 16),
        ),
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
        padding: const EdgeInsets.only(bottom: 28),
        children: [
          _Galeria(imagens: _imagens, nome: p['name'] as String? ?? 'Produto', desconto: _desconto),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (categoria != null)
                  Text(
                    categoria.toUpperCase(),
                    style: const TextStyle(
                      color: AppConfig.gold,
                      fontSize: 10,
                      letterSpacing: 1.6,
                    ),
                  ),
                const SizedBox(height: 6),
                Text(
                  p['name'] as String? ?? '',
                  style: const TextStyle(
                    fontSize: 23,
                    color: AppConfig.text,
                    fontWeight: FontWeight.w300,
                    height: 1.2,
                  ),
                ),
                if (sku != null && sku.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    'Referência: $sku',
                    style: const TextStyle(color: Color(0xFF525252), fontSize: 11),
                  ),
                ],
                const SizedBox(height: 14),
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 10,
                  runSpacing: 6,
                  children: [
                    Text(
                      kz(_preco),
                      style: const TextStyle(
                        color: AppConfig.gold,
                        fontSize: 25,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (_precoOficial != null)
                      Text(
                        kz(_precoOficial),
                        style: const TextStyle(
                          color: Color(0xFF6F6F6F),
                          fontSize: 14,
                          decoration: TextDecoration.lineThrough,
                        ),
                      ),
                    if (poupa > 0)
                      Etiqueta(
                        texto: 'Poupa ${kz(poupa)}',
                        cor: AppConfig.gold,
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                _LinhaStock(
                  aCarregar: _aCarregarStock,
                  disponivel: _disponivel,
                ),
                const SizedBox(height: 22),
                if (_esgotado) ...[
                  // Sem stock não se vende: mostra-se a verdade e o caminho
                  // alternativo (reservar / falar com a equipa), em vez de
                  // deixar juntar ao carrinho para falhar na encomenda.
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: AppConfig.charcoal,
                      borderRadius: BorderRadius.circular(12),
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
                            fontSize: 13.5,
                          ),
                        ),
                        SizedBox(height: 6),
                        Text(
                          'Deixe a sua reserva: guardamos o pedido e avisamos assim '
                          'que o produto voltar ao stock.',
                          style: TextStyle(color: AppConfig.muted, fontSize: 12, height: 1.45),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _aReservar ? null : _reservar,
                      icon: _aReservar
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.bookmark_add_outlined),
                      label: Text(_aReservar ? 'A reservar…' : 'Reservar este produto'),
                    ),
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: _aAbrirChat ? null : _falarComEquipa,
                      icon: const Icon(Icons.chat_bubble_outline, size: 18),
                      label: const Text('Falar com a equipa'),
                    ),
                  ),
                ] else ...[
                  Row(
                    children: [
                      const Text('Quantidade', style: TextStyle(color: AppConfig.muted, fontSize: 13)),
                      const Spacer(),
                      _Passo(
                        icone: Icons.remove,
                        activo: _quantidade > 1,
                        aoTocar: () => setState(() => _quantidade--),
                      ),
                      SizedBox(
                        width: 38,
                        child: Text(
                          '$_quantidade',
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontSize: 16, color: AppConfig.text),
                        ),
                      ),
                      _Passo(
                        icone: Icons.add,
                        activo: _disponivel == null || _quantidade < _disponivel!,
                        aoTocar: () => setState(() => _quantidade++),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _adicionar,
                      icon: Icon(_adicionado ? Icons.check : Icons.shopping_bag_outlined),
                      label: Text(_adicionado ? 'Adicionado ao carrinho' : 'Adicionar ao carrinho'),
                    ),
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: _aAbrirChat ? null : _falarComEquipa,
                      icon: const Icon(Icons.chat_bubble_outline, size: 18),
                      label: const Text('Falar com a equipa'),
                    ),
                  ),
                ],
                const SizedBox(height: 24),
                // Garantias: as mesmas quatro do site.
                GridView.count(
                  crossAxisCount: 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  mainAxisSpacing: 8,
                  crossAxisSpacing: 8,
                  childAspectRatio: 2.35,
                  children: const [
                    _Garantia(icone: Icons.verified_outlined, titulo: 'Produto original',
                        detalhe: 'Distribuição oficial'),
                    _Garantia(icone: Icons.local_shipping_outlined, titulo: 'Entrega ao domicílio',
                        detalhe: 'Grátis no Uíge'),
                    _Garantia(icone: Icons.payments_outlined, titulo: 'Pagamento na entrega',
                        detalhe: 'Dinheiro ou transferência'),
                    _Garantia(icone: Icons.shield_outlined, titulo: 'Reserva garantida',
                        detalhe: 'Stock guardado'),
                  ],
                ),
                if ((p['description'] as String?)?.isNotEmpty == true) ...[
                  const SizedBox(height: 24),
                  const Text(
                    'DESCRIÇÃO',
                    style: TextStyle(
                      color: AppConfig.muted,
                      fontSize: 10,
                      letterSpacing: 1.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    p['description'] as String,
                    style: const TextStyle(
                      color: Color(0xFFA3A3A3),
                      fontSize: 13,
                      height: 1.55,
                    ),
                  ),
                ],
                const SizedBox(height: 18),
                const Text(
                  'O preço final e a disponibilidade são confirmados pelo servidor '
                  'ao finalizar a encomenda.',
                  style: TextStyle(color: Color(0xFF525252), fontSize: 11, height: 1.5),
                ),
              ],
            ),
          ),
          if (_relacionados.isNotEmpty) ...[
            const SizedBox(height: 26),
            const Divider(height: 1, color: Color(0xFF1F1F1F)),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 22, 18, 12),
              child: Text(
                'Também em ${categoria ?? 'catálogo'}',
                style: const TextStyle(fontSize: 16, color: AppConfig.text),
              ),
            ),
            SizedBox(
              height: 210,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 18),
                itemCount: _relacionados.length,
                separatorBuilder: (_, __) => const SizedBox(width: 10),
                itemBuilder: (_, i) => SizedBox(
                  width: 140,
                  child: ProdutoCartao(produto: _relacionados[i]),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _LinhaStock extends StatelessWidget {
  const _LinhaStock({required this.aCarregar, required this.disponivel});

  final bool aCarregar;
  final int? disponivel;

  @override
  Widget build(BuildContext context) {
    if (aCarregar) {
      return const Text(
        'A confirmar disponibilidade…',
        style: TextStyle(color: AppConfig.muted, fontSize: 12),
      );
    }
    if (disponivel == null) {
      // Sem linha de inventário não há stock a anunciar — é diferente de zero.
      return const Text(
        'Disponibilidade confirmada ao finalizar a encomenda',
        style: TextStyle(color: AppConfig.muted, fontSize: 12),
      );
    }
    if (disponivel! > 0) {
      return Row(
        children: [
          const Icon(Icons.check_circle, size: 13, color: AppConfig.success),
          const SizedBox(width: 5),
          Text(
            'Em stock · $disponivel ${disponivel == 1 ? "unidade" : "unidades"}',
            style: const TextStyle(color: AppConfig.success, fontSize: 12),
          ),
        ],
      );
    }
    return Row(
      children: [
        const Icon(Icons.cancel_outlined, size: 13, color: AppConfig.danger),
        const SizedBox(width: 5),
        const Text(
          'Esgotado — pode deixar reserva abaixo',
          style: TextStyle(color: AppConfig.danger, fontSize: 12),
        ),
      ],
    );
  }
}

class _Passo extends StatelessWidget {
  const _Passo({required this.icone, required this.activo, required this.aoTocar});

  final IconData icone;
  final bool activo;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppConfig.charcoal,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: activo ? aoTocar : null,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppConfig.surface),
          ),
          child: Icon(
            icone,
            size: 17,
            color: activo ? AppConfig.text : const Color(0xFF4A4A4A),
          ),
        ),
      ),
    );
  }
}

class _Garantia extends StatelessWidget {
  const _Garantia({required this.icone, required this.titulo, required this.detalhe});

  final IconData icone;
  final String titulo;
  final String detalhe;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(9),
      decoration: BoxDecoration(
        color: const Color(0xFF111111),
        borderRadius: BorderRadius.circular(9),
        border: Border.all(color: const Color(0xFF1F1F1F)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icone, size: 15, color: AppConfig.gold),
          const SizedBox(width: 7),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  titulo,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Color(0xFFE5E5E5), fontSize: 10.5),
                ),
                Text(
                  detalhe,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Color(0xFF6F6F6F), fontSize: 9),
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
  const _Galeria({required this.imagens, required this.nome, required this.desconto});

  final List<String> imagens;
  final String nome;
  final int desconto;

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
                      semanticLabel: '${widget.nome} — fotografia ${i + 1} de $total',
                      errorBuilder: (_, __, ___) => const _SemImagem(),
                    ),
                  ),
                ),
              ),
              if (widget.desconto > 0)
                Positioned(
                  left: 14,
                  top: 14,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppConfig.gold,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      '-${widget.desconto}%',
                      style: const TextStyle(
                        color: AppConfig.dark,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              if (total > 1)
                Positioned(
                  right: 14,
                  top: 14,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
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
            height: 78,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
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
