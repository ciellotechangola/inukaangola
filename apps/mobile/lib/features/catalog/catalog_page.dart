import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';
import 'product_page.dart';

/// Catálogo da loja.
///
/// Só produtos ativos, e a pesquisa é feita no servidor (`ilike`) — filtrar
/// 30 produtos no telemóvel pareceria funcionar e depois falhava em silêncio
/// assim que a loja tivesse mais do que uma página.
class CatalogPage extends StatefulWidget {
  const CatalogPage({super.key});

  @override
  State<CatalogPage> createState() => _CatalogPageState();
}

class _CatalogPageState extends State<CatalogPage> {
  static const _porPagina = 24;

  final _pesquisaCtrl = TextEditingController();
  Timer? _debounce;

  List<Map<String, dynamic>> _produtos = [];
  List<Map<String, dynamic>> _categorias = [];
  String? _categoriaId;
  String _pesquisa = '';
  int _pagina = 0;
  bool _temMais = false;

  bool _aCarregar = true;
  bool _aCarregarMais = false;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _carregarCategorias();
    _carregarProdutos();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _pesquisaCtrl.dispose();
    super.dispose();
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
      // Sem categorias o catálogo continua a funcionar — não vale a pena
      // mostrar um erro por causa dos filtros.
    }
  }

  /// `ilike` usa `%` e `_` como curingas; vírgulas e parênteses partem a
  /// sintaxe do PostgREST. Um nome com esses caracteres não pode derrubar a
  /// pesquisa.
  String _limparTermo(String bruto) {
    return bruto
        .replaceAll(RegExp(r'[%_,()\\]'), ' ')
        .trim();
  }

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
          .select('id, name, description, official_price, promotional_price, '
              'is_featured, category:categories(id, name), images:product_images(url)')
          .eq('is_active', true);

      if (_categoriaId != null) {
        consulta = consulta.eq('category_id', _categoriaId!);
      }
      final termo = _limparTermo(_pesquisa);
      if (termo.isNotEmpty) {
        consulta = consulta.ilike('name', '%$termo%');
      }

      final inicio = mais ? (_pagina + 1) * _porPagina : 0;
      final resposta = await consulta
          .order('is_featured', ascending: false)
          .order('created_at', ascending: false)
          .range(inicio, inicio + _porPagina - 1);

      final lista = (resposta as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();

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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Catálogo INUKA'),
        actions: [
          IconButton(
            tooltip: 'Actualizar',
            onPressed: () => _carregarProdutos(),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: TextField(
              controller: _pesquisaCtrl,
              onChanged: _aoEscrever,
              textInputAction: TextInputAction.search,
              onSubmitted: (v) {
                _debounce?.cancel();
                setState(() => _pesquisa = v);
                _carregarProdutos();
              },
              decoration: InputDecoration(
                hintText: 'Procurar perfume, creme…',
                prefixIcon: const Icon(Icons.search, size: 20),
                isDense: true,
                suffixIcon: _pesquisaCtrl.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () {
                          _pesquisaCtrl.clear();
                          setState(() => _pesquisa = '');
                          _carregarProdutos();
                        },
                      ),
              ),
            ),
          ),
          if (_categorias.isNotEmpty)
            SizedBox(
              height: 46,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
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
          Expanded(child: _corpo()),
        ],
      ),
    );
  }

  Widget _corpo() {
    if (_aCarregar) {
      return const Center(child: CircularProgressIndicator(color: AppConfig.gold));
    }

    if (_erro != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.wifi_off, size: 48, color: AppConfig.muted),
              const SizedBox(height: 16),
              Text(_erro!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppConfig.muted)),
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: () => _carregarProdutos(),
                child: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }

    if (_produtos.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => _carregarProdutos(),
        child: ListView(
          children: const [
            SizedBox(height: 120),
            Icon(Icons.search_off, size: 44, color: AppConfig.muted),
            SizedBox(height: 12),
            Center(
              child: Text('Nenhum produto encontrado.',
                  style: TextStyle(color: AppConfig.muted)),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => _carregarProdutos(),
      child: GridView.builder(
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 16),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          // 2 colunas num telemóvel normal, 3 num tablet — sem números mágicos.
          maxCrossAxisExtent: 220,
          childAspectRatio: 0.66,
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
        ),
        itemCount: _produtos.length + (_temMais ? 1 : 0),
        itemBuilder: (context, index) {
          if (index >= _produtos.length) return _botaoMais();
          return _CartaoProduto(produto: _produtos[index]);
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

class _CartaoProduto extends StatelessWidget {
  const _CartaoProduto({required this.produto});

  final Map<String, dynamic> produto;

  String? get _imagem {
    final imagens = produto['images'] as List?;
    if (imagens == null || imagens.isEmpty) return null;
    return (imagens.first as Map)['url'] as String?;
  }

  @override
  Widget build(BuildContext context) {
    final promo = produto['promotional_price'] as num?;
    final oficial = produto['official_price'] as num?;
    final preco = promo ?? oficial;
    final desconto = (promo != null && oficial != null && oficial > 0)
        ? ((1 - promo / oficial) * 100).round()
        : 0;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => ProductPage(produto: produto)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  _imagem != null
                      ? Image.network(
                          _imagem!,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const _SemImagem(),
                        )
                      : const _SemImagem(),
                  if (desconto > 0)
                    Positioned(
                      top: 6,
                      left: 6,
                      child: Container(
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
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    produto['name'] as String? ?? '',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppConfig.text, fontSize: 12.5),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Text(
                        kz(preco),
                        style: const TextStyle(color: AppConfig.gold, fontSize: 13),
                      ),
                      if (promo != null && oficial != null) ...[
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            kz(oficial),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppConfig.muted,
                              fontSize: 10,
                              decoration: TextDecoration.lineThrough,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
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
          style: TextStyle(color: AppConfig.muted, fontSize: 11, letterSpacing: 2),
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
            border: Border.all(
              color: activo ? AppConfig.gold : AppConfig.surface,
            ),
          ),
          child: Text(
            texto,
            style: TextStyle(
              color: activo ? AppConfig.dark : AppConfig.muted,
              fontSize: 12,
            ),
          ),
        ),
      ),
    );
  }
}
