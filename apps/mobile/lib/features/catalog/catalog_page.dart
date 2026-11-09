import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/sessao.dart';
import '../../widgets/estado.dart';
import '../../widgets/produto_cartao.dart';
import '../cart/cart_page.dart';
import '../cart/cart_store.dart';
import '../favorites/favorites_page.dart';

/// Ordenações do catálogo — as mesmas do site.
enum Ordem {
  relevancia('Relevância'),
  precoAsc('Preço ↑'),
  precoDesc('Preço ↓'),
  novidades('Novidades');

  const Ordem(this.rotulo);
  final String rotulo;
}

/// Faixas de preço do site, em kwanzas.
class Faixa {
  const Faixa(this.rotulo, this.min, this.max);
  final String rotulo;
  final int? min;
  final int? max;
}

const _faixas = <Faixa>[
  Faixa('Até 10 000 Kz', null, 10000),
  Faixa('10 000 – 20 000 Kz', 10000, 20000),
  Faixa('20 000 – 30 000 Kz', 20000, 30000),
  Faixa('Mais de 30 000 Kz', 30000, null),
];

/// Catálogo — a porta de entrada da aplicação.
///
/// Abre para todos, com ou sem conta: o visitante vê produtos, preços e
/// disponibilidade. Só as acções que mexem com dados pessoais (comprar,
/// favoritar, falar com a equipa) pedem sessão.
///
/// A pesquisa e os filtros correm no servidor. Filtrar 30 produtos no
/// telemóvel pareceria funcionar e falhava em silêncio assim que a loja
/// tivesse mais do que uma página.
class CatalogPage extends StatefulWidget {
  const CatalogPage({super.key, this.aoIrParaSeparador});

  /// Permite ao catálogo mandar o utilizador para o carrinho ou o perfil
  /// (o menu inferior é gerido pela moldura da app).
  final void Function(int indice)? aoIrParaSeparador;

  @override
  State<CatalogPage> createState() => _CatalogPageState();
}

class _CatalogPageState extends State<CatalogPage> {
  static const _porPagina = 24;

  final _pesquisaCtrl = TextEditingController();
  final _scroll = ScrollController();
  Timer? _debounce;

  List<Map<String, dynamic>> _produtos = [];
  List<Map<String, dynamic>> _categorias = [];
  Map<String, int?> _stock = {};
  Set<String> _comprados = {};
  Set<String> _nomesComprados = {};

  String? _categoriaId;
  String _pesquisa = '';
  Ordem _ordem = Ordem.relevancia;
  Faixa? _faixa;
  bool _soPromocao = false;

  int _pagina = 0;
  bool _temMais = false;
  bool _aCarregar = true;
  bool _aCarregarMais = false;
  String? _erro;

  bool get _temFiltro => _categoriaId != null || _faixa != null || _soPromocao;

  @override
  void initState() {
    super.initState();
    _carregarCategorias();
    _carregarProdutos();
    _carregarComprados();
    Sessao.instance.addListener(_aoMudarSessao);
  }

  @override
  void dispose() {
    Sessao.instance.removeListener(_aoMudarSessao);
    _debounce?.cancel();
    _pesquisaCtrl.dispose();
    _scroll.dispose();
    super.dispose();
  }

  /// Entrar ou sair da conta muda o que o cartão mostra («Já comprou») e o
  /// stock visível — vale a pena recarregar em vez de deixar dados velhos.
  ///
  /// Só quando o utilizador muda de facto: o perfil avisa duas vezes por
  /// leitura (a começar e a terminar) e não se repete a consulta por isso.
  String? _uidAnterior;

  void _aoMudarSessao() {
    if (!mounted) return;
    final uid = Sessao.instance.uid;
    if (uid == _uidAnterior) return;
    _uidAnterior = uid;
    _carregarComprados();
  }

  Future<void> _carregarCategorias() async {
    try {
      final resposta = await Supabase.instance.client
          .from('categories')
          .select('id, name')
          .eq('is_active', true)
          .order('sort_order');
      if (!mounted) return;
      setState(() {
        _categorias = (resposta as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
      });
    } catch (_) {
      // Sem categorias o catálogo continua a funcionar.
    }
  }

  /// Produtos que este cliente já comprou. Sem sessão não há nada a marcar.
  ///
  /// Duas fontes, porque a base as separa: as encomendas do site dão o
  /// `product_id` (e o cliente pode lê-las); as vendas de balcão só são
  /// legíveis pelo colaborador, por isso `minhas_compras` devolve o **nome**
  /// do artigo — compara-se pelo nome, que é o que existe.
  Future<void> _carregarComprados() async {
    if (!Sessao.instance.autenticado) {
      if (mounted && (_comprados.isNotEmpty || _nomesComprados.isNotEmpty)) {
        setState(() {
          _comprados = {};
          _nomesComprados = {};
        });
      }
      return;
    }

    final ids = <String>{};
    final nomes = <String>{};

    try {
      final encomendas = await Supabase.instance.client
          .from('order_items')
          .select('product_id, order:orders!inner(customer_id)')
          .eq('order.customer_id', Sessao.instance.uid!);
      for (final linha in (encomendas as List)) {
        final id = (linha as Map)['product_id'] as String?;
        if (id != null) ids.add(id);
      }
    } catch (_) {
      // Sem histórico de encomendas não se marca nada.
    }

    try {
      final compras = await Supabase.instance.client
          .rpc('minhas_compras', params: {'p_limit': 50});
      for (final compra in (compras as List? ?? [])) {
        final itens = (compra as Map)['items'];
        if (itens is List) {
          for (final item in itens) {
            final nome = (item as Map)['name'] as String?;
            if (nome != null && nome.trim().isNotEmpty) nomes.add(nome.trim());
          }
        }
      }
    } catch (_) {
      // Idem: a marca de recompra é um extra, não um requisito do ecrã.
    }

    if (!mounted) return;
    setState(() {
      _comprados = ids;
      _nomesComprados = nomes;
    });
  }

  /// Já comprou este produto — por identificador ou pelo nome da venda.
  bool _jaComprou(Map<String, dynamic> produto) {
    if (_comprados.contains(produto['id'])) return true;
    final nome = produto['name'] as String?;
    return nome != null && _nomesComprados.contains(nome.trim());
  }

  /// `ilike` usa `%` e `_` como curingas; vírgulas e parênteses partem a
  /// sintaxe do PostgREST. Um nome com esses caracteres não pode derrubar a
  /// pesquisa.
  String _limparTermo(String bruto) =>
      bruto.replaceAll(RegExp(r'[%_,()\\]'), ' ').trim();

  Future<void> _carregarProdutos({bool mais = false}) async {
    if (mais && !_temMais) return;

    setState(() {
      if (mais) {
        _aCarregarMais = true;
      } else {
        _aCarregar = true;
        _pagina = 0;
      }
      _erro = null;
    });

    try {
      var consulta = Supabase.instance.client
          .from('products')
          .select('id, name, description, sku, official_price, promotional_price, '
              'is_featured, is_bestseller, is_new, created_at, category_id, '
              'category:categories(id, name, slug), '
              'images:product_images(url, is_primary, sort_order)')
          .eq('is_active', true);

      if (_categoriaId != null) {
        consulta = consulta.eq('category_id', _categoriaId!);
      }
      if (_soPromocao) {
        consulta = consulta.not('promotional_price', 'is', null);
      }
      final termo = _limparTermo(_pesquisa);
      if (termo.isNotEmpty) {
        consulta = consulta.ilike('name', '%$termo%');
      }

      // O preço que o cliente paga é a promoção quando existe. Filtrar só por
      // `official_price` mostrava produtos fora do intervalo escolhido.
      final minimo = _faixa?.min;
      final maximo = _faixa?.max;
      if (minimo != null) {
        consulta = consulta.or(
          'and(promotional_price.is.null,official_price.gte.$minimo),'
          'and(promotional_price.not.is.null,promotional_price.gte.$minimo)',
        );
      }
      if (maximo != null) {
        consulta = consulta.or(
          'and(promotional_price.is.null,official_price.lte.$maximo),'
          'and(promotional_price.not.is.null,promotional_price.lte.$maximo)',
        );
      }

      final inicio = mais ? (_pagina + 1) * _porPagina : 0;
      // Destaques primeiro em «Relevância»; nas restantes ordens vale a data.
      final ordenada = _ordem == Ordem.relevancia
          ? consulta.order('is_featured', ascending: false).order('created_at', ascending: false)
          : consulta.order('created_at', ascending: false);

      final resposta = await ordenada.range(inicio, inicio + _porPagina - 1);

      var lista = (resposta as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();

      // Ordenar por preço no cliente: o PostgREST não ordena pelo preço
      // efectivo (que é a promoção quando existe). A lista já vem da página
      // pedida, por isso a ordem é coerente dentro do que está à vista.
      if (_ordem == Ordem.precoAsc) {
        lista.sort((a, b) => precoEfetivo(a).compareTo(precoEfetivo(b)));
      } else if (_ordem == Ordem.precoDesc) {
        lista.sort((a, b) => precoEfetivo(b).compareTo(precoEfetivo(a)));
      }

      if (!mounted) return;
      setState(() {
        if (mais) {
          _produtos.addAll(lista);
          _pagina += 1;
        } else {
          _produtos = lista;
        }
        _temMais = lista.length == _porPagina;
        _aCarregar = false;
        _aCarregarMais = false;
      });

      await _carregarStock(mais ? lista : _produtos);
    } on PostgrestException catch (e) {
      if (!mounted) return;
      setState(() {
        _erro = e.message;
        _aCarregar = false;
        _aCarregarMais = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _erro = 'Sem ligação. Catálogo indisponível offline.';
        _aCarregar = false;
        _aCarregarMais = false;
      });
    }
  }

  /// Disponibilidade numa só chamada, pela função pública `stock_produtos`:
  /// `inventory` só é legível com sessão e o catálogo é para todos.
  Future<void> _carregarStock(List<Map<String, dynamic>> produtos) async {
    if (produtos.isEmpty) return;
    try {
      final resposta = await Supabase.instance.client.rpc(
        'stock_produtos',
        params: {'p_ids': produtos.map((p) => p['id']).toList()},
      );
      final linhas = (resposta as List? ?? []);
      final mapa = <String, int?>{};
      for (final linha in linhas) {
        final m = Map<String, dynamic>.from(linha as Map);
        final id = m['product_id'] as String?;
        if (id != null) mapa[id] = (m['disponivel'] as num?)?.toInt();
      }
      if (!mounted) return;
      setState(() => _stock = {..._stock, ...mapa});
    } catch (_) {
      // Sem stock conhecido não se marca «Esgotado» — o servidor recusa na
      // encomenda. Mostrar «esgotado» por falha de rede seria pior.
    }
  }

  void _aoEscrever(String valor) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (!mounted) return;
      setState(() => _pesquisa = valor);
      _carregarProdutos();
    });
  }

  void _escolherCategoria(String? id) {
    setState(() => _categoriaId = id);
    _carregarProdutos();
  }

  Future<void> _abrirFiltros() async {
    final resultado = await showModalBottomSheet<_FiltroEscolhido>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppConfig.charcoal,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (_) => _FiltrosSheet(faixa: _faixa, soPromocao: _soPromocao, ordem: _ordem),
    );
    if (resultado == null || !mounted) return;
    setState(() {
      _faixa = resultado.faixa;
      _soPromocao = resultado.soPromocao;
      _ordem = resultado.ordem;
    });
    _carregarProdutos();
  }

  void _limparFiltros() {
    setState(() {
      _faixa = null;
      _soPromocao = false;
      _categoriaId = null;
    });
    _carregarProdutos();
  }

  Future<void> _abrirFavoritos() async {
    if (!await Sessao.exigirSessao(context,
        motivo: 'Entre para guardar os produtos de que gosta.')) {
      return;
    }
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const FavoritesPage()),
    );
  }

  List<Map<String, dynamic>> get _promocoes => _produtos
      .where((p) => percentagemDesconto(p) > 0)
      .take(8)
      .toList(growable: false);

  @override
  Widget build(BuildContext context) {
    final provincia = Sessao.instance.provincia;

    return Scaffold(
      body: RefreshIndicator(
        color: AppConfig.gold,
        onRefresh: () async {
          await Future.wait([
            _carregarCategorias(),
            _carregarProdutos(),
            _carregarComprados(),
          ]);
        },
        child: CustomScrollView(
          controller: _scroll,
          slivers: [
            // ---------------------------------------------------- cabeçalho
            SliverAppBar(
              pinned: true,
              backgroundColor: AppConfig.dark,
              surfaceTintColor: Colors.transparent,
              elevation: 0,
              titleSpacing: 16,
              title: Row(
                children: [
                  Text(
                    'INUKA',
                    style: TextStyle(
                      color: AppConfig.gold,
                      fontSize: 17,
                      letterSpacing: 5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    width: 1,
                    height: 14,
                    color: AppConfig.surface,
                  ),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      (provincia ?? 'Angola').toUpperCase(),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppConfig.muted,
                        fontSize: 9,
                        letterSpacing: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
              actions: [
                AnimatedBuilder(
                  animation: CartStore.instance,
                  builder: (context, _) {
                    final n = CartStore.instance.quantidadeTotal;
                    return IconButton(
                      tooltip: 'Carrinho',
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const CartPage()),
                      ),
                      icon: Badge(
                        isLabelVisible: n > 0,
                        label: Text('$n'),
                        backgroundColor: AppConfig.gold,
                        textColor: AppConfig.dark,
                        child: const Icon(Icons.shopping_bag_outlined),
                      ),
                    );
                  },
                ),
                IconButton(
                  tooltip: 'Favoritos',
                  onPressed: _abrirFavoritos,
                  icon: const Icon(Icons.favorite_border),
                ),
                const SizedBox(width: 4),
              ],
            ),

            // --------------------------------------------------------- hero
            SliverToBoxAdapter(
              child: Container(
                margin: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFF2A2A2A)),
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFF181818), Color(0xFF0C0C0C)],
                  ),
                ),
                child: Stack(
                  children: [
                    Positioned(
                      right: -40,
                      top: -40,
                      child: Container(
                        width: 120,
                        height: 120,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: AppConfig.gold.withValues(alpha: 0.08),
                        ),
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.auto_awesome, size: 12, color: AppConfig.gold),
                            const SizedBox(width: 6),
                            Text(
                              'INUKA · ALWAYS WITH YOU',
                              style: TextStyle(
                                color: AppConfig.gold,
                                fontSize: 9,
                                letterSpacing: 1.6,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        RichText(
                          text: TextSpan(
                            style: const TextStyle(
                              color: AppConfig.text,
                              fontSize: 21,
                              height: 1.2,
                              fontWeight: FontWeight.w300,
                            ),
                            children: [
                              const TextSpan(text: 'Tua autoestima é a '),
                              TextSpan(
                                text: 'nossa prioridade',
                                style: TextStyle(color: AppConfig.gold),
                              ),
                              const TextSpan(text: '.'),
                            ],
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Perfumes e beleza originais, entregues em casa.',
                          style: TextStyle(color: AppConfig.muted, fontSize: 11.5),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),

            // --------------------------------------------------- pesquisa
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _pesquisaCtrl,
                        onChanged: _aoEscrever,
                        textInputAction: TextInputAction.search,
                        onSubmitted: (v) {
                          _debounce?.cancel();
                          setState(() => _pesquisa = v);
                          _carregarProdutos();
                        },
                        style: const TextStyle(color: AppConfig.text, fontSize: 13.5),
                        decoration: InputDecoration(
                          hintText: 'Procurar perfume, creme…',
                          hintStyle:
                              const TextStyle(color: AppConfig.muted, fontSize: 13),
                          prefixIcon: const Icon(Icons.search, size: 19),
                          isDense: true,
                          contentPadding:
                              const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
                          suffixIcon: _pesquisaCtrl.text.isEmpty
                              ? null
                              : IconButton(
                                  icon: const Icon(Icons.close, size: 17),
                                  onPressed: () {
                                    _pesquisaCtrl.clear();
                                    setState(() => _pesquisa = '');
                                    _carregarProdutos();
                                  },
                                ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    _BotaoFiltro(activo: _temFiltro, aoTocar: _abrirFiltros),
                  ],
                ),
              ),
            ),

            // ------------------------------------------------ categorias
            if (_categorias.isNotEmpty)
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 52,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    children: [
                      _Chip(
                        texto: 'Tudo',
                        activo: _categoriaId == null,
                        aoTocar: () => _escolherCategoria(null),
                      ),
                      for (final c in _categorias)
                        _Chip(
                          texto: c['name'] as String? ?? '',
                          activo: _categoriaId == c['id'],
                          aoTocar: () => _escolherCategoria(c['id'] as String?),
                        ),
                    ],
                  ),
                ),
              ),

            // ------------------------------------------- faixa de promoções
            if (_promocoes.length > 1 && !_soPromocao && _categoriaId == null)
              SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 18, 16, 8),
                      child: Row(
                        children: [
                          const Icon(Icons.local_offer_outlined,
                              size: 13, color: AppConfig.gold),
                          const SizedBox(width: 6),
                          const Text(
                            'EM PROMOÇÃO',
                            style: TextStyle(
                              color: AppConfig.gold,
                              fontSize: 10,
                              letterSpacing: 1.6,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            '${_promocoes.length}',
                            style: const TextStyle(
                                color: AppConfig.muted, fontSize: 10),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(
                      height: 196,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        itemCount: _promocoes.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 10),
                        itemBuilder: (_, i) => SizedBox(
                          width: 132,
                          child: ProdutoCartao(
                            produto: _promocoes[i],
                            disponivel: _stock[_promocoes[i]['id']],
                            jaComprou: _jaComprou(_promocoes[i]),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),

            // -------------------------------------------- contagem e limpar
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        _aCarregar
                            ? 'A carregar…'
                            : _produtos.isEmpty
                                ? 'Nenhum produto encontrado'
                                : _produtos.length == 1
                                    ? '1 produto'
                                    : '${_produtos.length}${_temMais ? "+" : ""} produtos',
                        style: const TextStyle(color: AppConfig.muted, fontSize: 11.5),
                      ),
                    ),
                    if (_temFiltro)
                      TextButton(
                        onPressed: _limparFiltros,
                        style: TextButton.styleFrom(
                          padding: EdgeInsets.zero,
                          minimumSize: const Size(0, 30),
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        child: const Text(
                          'Limpar filtros',
                          style: TextStyle(color: AppConfig.gold, fontSize: 11.5),
                        ),
                      ),
                  ],
                ),
              ),
            ),

            // ------------------------------------------------------ grelha
            _grelha(),

            const SliverToBoxAdapter(child: SizedBox(height: 24)),
          ],
        ),
      ),
    );
  }

  Widget _grelha() {
    if (_aCarregar) {
      return const SliverFillRemaining(
        hasScrollBody: false,
        child: EstadoCarregando(),
      );
    }

    if (_erro != null) {
      return SliverFillRemaining(
        hasScrollBody: false,
        child: EstadoErro(mensagem: _erro!, aoRepetir: () => _carregarProdutos()),
      );
    }

    if (_produtos.isEmpty) {
      return SliverFillRemaining(
        hasScrollBody: false,
        child: EstadoVazio(
          icone: Icons.search_off,
          titulo: _temFiltro
              ? 'Nenhum produto corresponde aos filtros.'
              : 'Nenhum produto disponível de momento.',
          detalhe: _temFiltro
              ? 'Experimente alargar o intervalo de preço ou escolher outra categoria.'
              : 'Os produtos aparecem aqui assim que a gestão os cadastrar.',
          acao: _temFiltro
              ? OutlinedButton(
                  onPressed: _limparFiltros,
                  child: const Text('Limpar filtros'),
                )
              : null,
        ),
      );
    }

    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
      sliver: SliverLayoutBuilder(
        builder: (context, restricoes) {
          final largura = restricoes.crossAxisExtent;
          final colunas = largura >= 900
              ? 4
              : largura >= 600
                  ? 3
                  : 2;
          const espaco = 10.0;
          final larguraCartao = (largura - espaco * (colunas - 1)) / colunas;

          // A altura é calculada, não imposta por uma proporção fixa: com
          // `childAspectRatio` o cartão era cortado no fundo em ecrãs
          // estreitos ou com a letra do sistema maior. A escala do texto do
          // sistema entra na conta.
          final escala = MediaQuery.textScalerOf(context).scale(1.0);
          final alturaTexto = 9 + 3 + (32 * escala) + 5 + (20 * escala) + 9;

          return SliverGrid(
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: colunas,
              mainAxisExtent: larguraCartao + alturaTexto,
              crossAxisSpacing: espaco,
              mainAxisSpacing: espaco,
            ),
            delegate: SliverChildBuilderDelegate(
              (context, index) {
                if (index >= _produtos.length) return _botaoMais();
                final p = _produtos[index];
                return ProdutoCartao(
                  produto: p,
                  disponivel: _stock[p['id']],
                  jaComprou: _jaComprou(p),
                );
              },
              childCount: _produtos.length + (_temMais ? 1 : 0),
            ),
          );
        },
      ),
    );
  }

  Widget _botaoMais() {
    return Center(
      child: _aCarregarMais
          ? const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2, color: AppConfig.gold),
            )
          : TextButton(
              onPressed: () => _carregarProdutos(mais: true),
              child: const Text('Ver mais', style: TextStyle(color: AppConfig.gold)),
            ),
    );
  }
}

class _BotaoFiltro extends StatelessWidget {
  const _BotaoFiltro({required this.activo, required this.aoTocar});

  final bool activo;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: activo ? AppConfig.gold.withValues(alpha: 0.14) : AppConfig.charcoal,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: aoTocar,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: activo ? AppConfig.gold : AppConfig.surface),
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              Icon(
                Icons.tune,
                size: 19,
                color: activo ? AppConfig.gold : AppConfig.muted,
              ),
              if (activo)
                Positioned(
                  top: 8,
                  right: 9,
                  child: Container(
                    width: 6,
                    height: 6,
                    decoration: const BoxDecoration(
                      color: AppConfig.gold,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.texto, required this.activo, required this.aoTocar});

  final String texto;
  final bool activo;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: GestureDetector(
        onTap: aoTocar,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: activo ? AppConfig.gold : AppConfig.charcoal,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: activo ? AppConfig.gold : AppConfig.surface),
          ),
          child: Text(
            texto,
            style: TextStyle(
              color: activo ? AppConfig.dark : AppConfig.muted,
              fontSize: 12,
              fontWeight: activo ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ),
      ),
    );
  }
}

class _FiltroEscolhido {
  const _FiltroEscolhido(this.faixa, this.soPromocao, this.ordem);
  final Faixa? faixa;
  final bool soPromocao;
  final Ordem ordem;
}

class _FiltrosSheet extends StatefulWidget {
  const _FiltrosSheet({
    required this.faixa,
    required this.soPromocao,
    required this.ordem,
  });

  final Faixa? faixa;
  final bool soPromocao;
  final Ordem ordem;

  @override
  State<_FiltrosSheet> createState() => _FiltrosSheetState();
}

class _FiltrosSheetState extends State<_FiltrosSheet> {
  late Faixa? _faixa = widget.faixa;
  late bool _soPromocao = widget.soPromocao;
  late Ordem _ordem = widget.ordem;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 38,
                height: 4,
                decoration: BoxDecoration(
                  color: AppConfig.surface,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 18),
            const Text(
              'Filtrar e ordenar',
              style: TextStyle(color: AppConfig.text, fontSize: 16),
            ),
            const SizedBox(height: 20),
            const _Rotulo('Preço'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _Escolha(
                  texto: 'Todos',
                  activo: _faixa == null,
                  aoTocar: () => setState(() => _faixa = null),
                ),
                for (final f in _faixas)
                  _Escolha(
                    texto: f.rotulo,
                    activo: _faixa?.rotulo == f.rotulo,
                    aoTocar: () => setState(() => _faixa = f),
                  ),
              ],
            ),
            const SizedBox(height: 20),
            const _Rotulo('Ordenar por'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final o in Ordem.values)
                  _Escolha(
                    texto: o.rotulo,
                    activo: _ordem == o,
                    aoTocar: () => setState(() => _ordem = o),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _soPromocao,
              onChanged: (v) => setState(() => _soPromocao = v),
              activeColor: AppConfig.gold,
              title: const Text(
                'Só com desconto',
                style: TextStyle(color: AppConfig.text, fontSize: 13.5),
              ),
              subtitle: const Text(
                'Produtos com promoção activa',
                style: TextStyle(color: AppConfig.muted, fontSize: 11),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => setState(() {
                      _faixa = null;
                      _soPromocao = false;
                      _ordem = Ordem.relevancia;
                    }),
                    child: const Text('Limpar'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 2,
                  child: ElevatedButton(
                    onPressed: () => Navigator.of(context)
                        .pop(_FiltroEscolhido(_faixa, _soPromocao, _ordem)),
                    child: const Text('Aplicar'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Rotulo extends StatelessWidget {
  const _Rotulo(this.texto);
  final String texto;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(
        texto.toUpperCase(),
        style: const TextStyle(
          color: AppConfig.muted,
          fontSize: 10,
          letterSpacing: 1.4,
        ),
      ),
    );
  }
}

class _Escolha extends StatelessWidget {
  const _Escolha({
    required this.texto,
    required this.activo,
    required this.aoTocar,
  });

  final String texto;
  final bool activo;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: aoTocar,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 7),
        decoration: BoxDecoration(
          color: activo ? AppConfig.gold.withValues(alpha: 0.14) : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: activo ? AppConfig.gold : const Color(0xFF333333),
          ),
        ),
        child: Text(
          texto,
          style: TextStyle(
            color: activo ? AppConfig.gold : const Color(0xFF8A8A8A),
            fontSize: 11.5,
          ),
        ),
      ),
    );
  }
}
