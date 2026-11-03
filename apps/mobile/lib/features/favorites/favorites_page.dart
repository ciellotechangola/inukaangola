import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';
import '../catalog/product_page.dart';

/// Produtos que o utilizador guardou.
///
/// A tabela `favorites` tem uma chave única `(user_id, product_id)` e RLS de
/// dono — guardar duas vezes o mesmo produto não duplica nada.
class FavoritesPage extends StatefulWidget {
  const FavoritesPage({super.key});

  @override
  State<FavoritesPage> createState() => _FavoritesPageState();
}

class _FavoritesPageState extends State<FavoritesPage> {
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
      final eu = Supabase.instance.client.auth.currentUser?.id;
      if (eu == null) {
        setState(() {
          _erro = 'Sessão expirada. Volte a entrar.';
          _aCarregar = false;
        });
        return;
      }

      final resposta = await Supabase.instance.client
          .from('favorites')
          .select('product_id, created_at, '
              'product:products(id, name, description, official_price, promotional_price, '
              'category:categories(name), images:product_images(url))')
          .eq('user_id', eu)
          .order('created_at', ascending: false);

      if (!mounted) return;
      setState(() {
        _itens = (resposta as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        _aCarregar = false;
      });
    } on PostgrestException catch (e) {
      if (!mounted) return;
      setState(() {
        _erro = e.message;
        _aCarregar = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _erro = 'Sem ligação. Não foi possível carregar os favoritos.';
        _aCarregar = false;
      });
    }
  }

  Future<void> _remover(String productId) async {
    final eu = Supabase.instance.client.auth.currentUser?.id;
    if (eu == null) return;

    // Optimista: sai do ecrã já. Se o servidor recusar, volta ao carregar.
    setState(() => _itens.removeWhere((i) => i['product_id'] == productId));
    try {
      await Supabase.instance.client
          .from('favorites')
          .delete()
          .eq('user_id', eu)
          .eq('product_id', productId);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Não foi possível remover dos favoritos.'),
          backgroundColor: AppConfig.charcoal,
        ),
      );
      await _carregar();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Favoritos'),
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
                        const Icon(Icons.wifi_off, size: 44, color: AppConfig.muted),
                        const SizedBox(height: 12),
                        Text(_erro!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: AppConfig.muted)),
                        const SizedBox(height: 16),
                        OutlinedButton(
                          onPressed: _carregar,
                          child: const Text('Tentar novamente'),
                        ),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _carregar,
                  child: _itens.isEmpty
                      ? ListView(
                          children: const [
                            SizedBox(height: 120),
                            Icon(Icons.favorite_border, size: 48, color: AppConfig.muted),
                            SizedBox(height: 12),
                            Center(
                              child: Text('Ainda não guardou produtos.',
                                  style: TextStyle(color: AppConfig.muted)),
                            ),
                            SizedBox(height: 4),
                            Center(
                              child: Text(
                                'Toque no coração na ficha de um produto.',
                                style: TextStyle(color: AppConfig.muted, fontSize: 12),
                              ),
                            ),
                          ],
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.all(12),
                          itemCount: _itens.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (context, i) {
                            final produto = _itens[i]['product'] as Map?;
                            if (produto == null) return const SizedBox.shrink();
                            final p = Map<String, dynamic>.from(produto);
                            final imagem = (p['images'] as List?)?.isNotEmpty == true
                                ? (p['images'] as List).first['url'] as String?
                                : null;
                            final preco =
                                (p['promotional_price'] ?? p['official_price']) as num?;

                            return Card(
                              clipBehavior: Clip.antiAlias,
                              child: InkWell(
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => ProductPage(produto: p),
                                  ),
                                ),
                                child: Padding(
                                  padding: const EdgeInsets.all(10),
                                  child: Row(
                                    children: [
                                      ClipRRect(
                                        borderRadius: BorderRadius.circular(8),
                                        child: SizedBox(
                                          width: 64,
                                          height: 64,
                                          child: imagem == null
                                              ? const ColoredBox(
                                                  color: AppConfig.surface,
                                                  child: Center(
                                                    child: Text('INUKA',
                                                        style: TextStyle(
                                                            color: AppConfig.muted,
                                                            fontSize: 9)),
                                                  ),
                                                )
                                              : Image.network(
                                                  imagem,
                                                  fit: BoxFit.cover,
                                                  errorBuilder: (_, __, ___) =>
                                                      const ColoredBox(
                                                    color: AppConfig.surface,
                                                  ),
                                                ),
                                        ),
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              p['name'] as String? ?? '',
                                              maxLines: 2,
                                              overflow: TextOverflow.ellipsis,
                                              style: const TextStyle(
                                                  color: AppConfig.text, fontSize: 14),
                                            ),
                                            const SizedBox(height: 4),
                                            Text(
                                              kz(preco),
                                              style: const TextStyle(
                                                  color: AppConfig.gold, fontSize: 13),
                                            ),
                                          ],
                                        ),
                                      ),
                                      IconButton(
                                        tooltip: 'Remover dos favoritos',
                                        icon: const Icon(Icons.favorite,
                                            color: AppConfig.gold, size: 20),
                                        onPressed: () => _remover(
                                            _itens[i]['product_id'] as String),
                                      ),
                                    ],
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
