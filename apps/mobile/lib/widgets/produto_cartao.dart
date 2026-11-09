import 'package:flutter/material.dart';

import '../config/app_config.dart';
import '../core/formato.dart';
import '../features/catalog/product_page.dart';

/// Fotografias de um produto, capa primeiro.
///
/// Um produto pode ter várias: a marcada `is_primary` é a capa; as restantes
/// seguem por `sort_order`. Sem marca (dados antigos) vale a primeira.
List<String> imagensDoProduto(Map<String, dynamic> produto) {
  final imagens = produto['images'] as List?;
  if (imagens == null || imagens.isEmpty) return const [];

  final lista = imagens.map((e) => Map<String, dynamic>.from(e as Map)).toList()
    ..sort((a, b) {
      final capaA = a['is_primary'] == true ? 0 : 1;
      final capaB = b['is_primary'] == true ? 0 : 1;
      if (capaA != capaB) return capaA - capaB;
      return ((a['sort_order'] as num?) ?? 0).compareTo((b['sort_order'] as num?) ?? 0);
    });

  return lista
      .map((e) => e['url'] as String?)
      .whereType<String>()
      .where((u) => u.isNotEmpty)
      .toList(growable: false);
}

String? fotoPrincipal(Map<String, dynamic> produto) {
  final lista = imagensDoProduto(produto);
  return lista.isEmpty ? null : lista.first;
}

/// Preço que o cliente paga: a promoção manda, quando existe.
num precoEfetivo(Map<String, dynamic> produto) {
  final promo = produto['promotional_price'] as num?;
  final oficial = produto['official_price'] as num?;
  return promo ?? oficial ?? 0;
}

/// Desconto em percentagem inteira. 0 quando não há promoção válida.
int percentagemDesconto(Map<String, dynamic> produto) {
  final oficial = produto['official_price'] as num?;
  final promo = produto['promotional_price'] as num?;
  if (oficial == null || promo == null || oficial <= 0 || promo >= oficial) return 0;
  return ((1 - promo / oficial) * 100).round();
}

/// Cartão de produto — o mesmo desenho na grelha do catálogo, nos favoritos e
/// nos relacionados.
///
/// `disponivel`: `null` = sem inventário registado (não é o mesmo que
/// esgotado); `0` = esgotado.
class ProdutoCartao extends StatelessWidget {
  const ProdutoCartao({
    super.key,
    required this.produto,
    this.disponivel,
    this.jaComprou = false,
    this.aoTocar,
  });

  final Map<String, dynamic> produto;
  final int? disponivel;
  final bool jaComprou;
  final VoidCallback? aoTocar;

  @override
  Widget build(BuildContext context) {
    final imagens = imagensDoProduto(produto);
    final imagem = imagens.isEmpty ? null : imagens.first;
    final preco = precoEfetivo(produto);
    final oficial = produto['official_price'] as num?;
    final desconto = percentagemDesconto(produto);
    final esgotado = disponivel == 0;
    final categoria = (produto['category'] as Map?)?['name'] as String?;
    final novo = produto['is_new'] == true;

    return Material(
      color: AppConfig.charcoal,
      borderRadius: BorderRadius.circular(14),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: aoTocar ??
            () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => ProductPage(produto: produto)),
            ),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppConfig.surface),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    // `contain` e não `cover`: numa coluna estreita o `cover`
                    // cortava as laterais das fotografias não quadradas — o
                    // frasco aparecia sem tampa ou sem rótulo.
                    Container(
                      color: const Color(0xFF0F0F0F),
                      padding: const EdgeInsets.all(6),
                      child: imagem != null
                          ? Image.network(
                              imagem,
                              fit: BoxFit.contain,
                              errorBuilder: (_, __, ___) => const _SemImagem(),
                            )
                          : const _SemImagem(),
                    ),
                    Positioned(
                      top: 6,
                      left: 6,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (desconto > 0)
                            _Selo(
                              texto: '-$desconto%',
                              fundo: AppConfig.gold,
                              cor: AppConfig.dark,
                            ),
                          if (novo) ...[
                            const SizedBox(height: 4),
                            _Selo(
                              texto: 'Novo',
                              fundo: const Color(0xE60A0A0A),
                              cor: AppConfig.gold,
                              borda: AppConfig.gold.withValues(alpha: 0.5),
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (jaComprou && !esgotado)
                      Positioned(
                        top: 6,
                        right: 6,
                        child: _Selo(
                          texto: 'Já comprou',
                          fundo: const Color(0xE60A0A0A),
                          cor: AppConfig.gold,
                          borda: AppConfig.gold.withValues(alpha: 0.4),
                        ),
                      ),
                    if (imagens.length > 1)
                      Positioned(
                        bottom: 6,
                        right: 6,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: const Color(0xCC0A0A0A),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            '${imagens.length} fotos',
                            style: const TextStyle(color: AppConfig.text, fontSize: 9),
                          ),
                        ),
                      ),
                    if (esgotado)
                      Container(
                        color: const Color(0xB80A0A0A),
                        alignment: Alignment.center,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: const Color(0xFF4A4A4A)),
                          ),
                          child: const Text(
                            'Esgotado',
                            style: TextStyle(color: Color(0xFFC9C9C9), fontSize: 11),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(9, 8, 9, 9),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (categoria != null && categoria.isNotEmpty)
                      Text(
                        categoria.toUpperCase(),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFF7A7A7A),
                          fontSize: 9,
                          letterSpacing: 0.7,
                        ),
                      ),
                    const SizedBox(height: 3),
                    Text(
                      produto['name'] as String? ?? '',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppConfig.text,
                        fontSize: 12.5,
                        height: 1.25,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: [
                        // Os dois preços podem encolher: um valor alto
                        // («12.500.000 Kz») empurrava a linha para fora.
                        Flexible(
                          child: Text(
                            kz(preco),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppConfig.gold,
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        if (desconto > 0 && oficial != null) ...[
                          const SizedBox(width: 5),
                          Flexible(
                            child: Text(
                              kz(oficial),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Color(0xFF6F6F6F),
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
      ),
    );
  }
}

class _Selo extends StatelessWidget {
  const _Selo({
    required this.texto,
    required this.fundo,
    required this.cor,
    this.borda,
  });

  final String texto;
  final Color fundo;
  final Color cor;
  final Color? borda;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: fundo,
        borderRadius: BorderRadius.circular(20),
        border: borda == null ? null : Border.all(color: borda!),
      ),
      child: Text(
        texto,
        style: TextStyle(color: cor, fontSize: 9.5, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _SemImagem extends StatelessWidget {
  const _SemImagem();

  @override
  Widget build(BuildContext context) {
    return const ColoredBox(
      color: Color(0xFF141414),
      child: Center(
        child: Text(
          'INUKA',
          style: TextStyle(color: Color(0xFF3A3A3A), fontSize: 10, letterSpacing: 3),
        ),
      ),
    );
  }
}
