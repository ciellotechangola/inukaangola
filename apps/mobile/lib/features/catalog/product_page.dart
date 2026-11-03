import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';
import '../cart/cart_store.dart';

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

  String? get _imagem {
    final imagens = widget.produto['images'] as List?;
    if (imagens == null || imagens.isEmpty) return null;
    return (imagens.first as Map)['url'] as String?;
  }

  @override
  void initState() {
    super.initState();
    _verificarFavorito();
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
          AspectRatio(
            aspectRatio: 1,
            child: _imagem != null
                ? Image.network(
                    _imagem!,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const _SemImagem(),
                  )
                : const _SemImagem(),
          ),
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
                Row(
                  children: [
                    const Text('Quantidade', style: TextStyle(color: AppConfig.muted)),
                    const Spacer(),
                    IconButton(
                      icon: const Icon(Icons.remove_circle_outline),
                      onPressed:
                          _quantidade > 1 ? () => setState(() => _quantidade--) : null,
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
                      onPressed: () => setState(() => _quantidade++),
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
                const SizedBox(height: 8),
                const Text(
                  'Preço e disponibilidade confirmados pelo servidor ao finalizar.',
                  style: TextStyle(color: AppConfig.muted, fontSize: 11),
                ),
              ],
            ),
          ),
        ],
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
          style: TextStyle(color: AppConfig.muted, fontSize: 14, letterSpacing: 3),
        ),
      ),
    );
  }
}
