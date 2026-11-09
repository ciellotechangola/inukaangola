/// Regras de vitrine que a app tem de acertar.
///
/// São as mesmas que o site usa: o preço que o cliente paga é a promoção
/// quando existe, a capa é a marcada `is_primary`, e um produto com zero
/// unidades aparece como «Esgotado» — nunca como «sem informação».
///
/// Correm sem rede: exercitam a lógica que decide o que o cliente vê, que é
/// onde um erro custa dinheiro (preço errado) ou uma venda perdida (produto
/// marcado como esgotado sem o estar).
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:inuka_mobile/core/formato.dart';
import 'package:inuka_mobile/core/sessao.dart';
import 'package:inuka_mobile/widgets/produto_cartao.dart';

Map<String, dynamic> _produto({
  num oficial = 10000,
  num? promo,
  List<Map<String, dynamic>>? imagens,
  bool novo = false,
}) =>
    {
      'id': 'p1',
      'name': 'Perfume INUKA',
      'official_price': oficial,
      'promotional_price': promo,
      'is_new': novo,
      'category': {'id': 'c1', 'name': 'Perfumaria'},
      'images': imagens ??
          [
            {'url': 'https://exemplo/a.jpg', 'is_primary': false, 'sort_order': 2},
            {'url': 'https://exemplo/capa.jpg', 'is_primary': true, 'sort_order': 9},
            {'url': 'https://exemplo/b.jpg', 'is_primary': false, 'sort_order': 1},
          ],
    };

void main() {
  group('preço efectivo', () {
    test('sem promoção vale o preço oficial', () {
      expect(precoEfetivo(_produto()), 10000);
    });

    test('com promoção vale a promoção', () {
      expect(precoEfetivo(_produto(promo: 7500)), 7500);
    });

    test('promoção a zero não é ignorada (é grátis, não é ausência)', () {
      expect(precoEfetivo(_produto(promo: 0)), 0);
    });
  });

  group('desconto', () {
    test('calcula a percentagem inteira', () {
      expect(percentagemDesconto(_produto(promo: 8000)), 20);
      expect(percentagemDesconto(_produto(promo: 3333)), 67);
    });

    test('sem promoção não há desconto', () {
      expect(percentagemDesconto(_produto()), 0);
    });

    test('promoção igual ou acima do oficial não é desconto', () {
      expect(percentagemDesconto(_produto(promo: 10000)), 0);
      expect(percentagemDesconto(_produto(promo: 12000)), 0);
    });
  });

  group('fotografias', () {
    test('a capa é a marcada is_primary, mesmo com sort_order maior', () {
      expect(fotoPrincipal(_produto()), 'https://exemplo/capa.jpg');
    });

    test('sem capa marcada, vale a primeira por sort_order', () {
      final p = _produto(imagens: [
        {'url': 'https://exemplo/3.jpg', 'is_primary': false, 'sort_order': 3},
        {'url': 'https://exemplo/1.jpg', 'is_primary': false, 'sort_order': 1},
      ]);
      expect(fotoPrincipal(p), 'https://exemplo/1.jpg');
      expect(imagensDoProduto(p), ['https://exemplo/1.jpg', 'https://exemplo/3.jpg']);
    });

    test('sem fotografias devolve null, não uma lista com um vazio', () {
      expect(fotoPrincipal(_produto(imagens: [])), isNull);
      expect(imagensDoProduto(_produto(imagens: [])), isEmpty);
    });
  });

  group('cartão de produto', () {
    Future<void> montar(WidgetTester tester, Map<String, dynamic> produto, int? disponivel) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 180,
              height: 260,
              child: ProdutoCartao(produto: produto, disponivel: disponivel),
            ),
          ),
        ),
      );
      await tester.pump();
    }

    testWidgets('mostra o preço que se paga e o selo do desconto', (tester) async {
      await montar(tester, _produto(promo: 8000), 5);
      expect(find.text('8 000 Kz'), findsOneWidget);
      expect(find.text('-20%'), findsOneWidget);
      expect(find.text('10 000 Kz'), findsOneWidget);
    });

    testWidgets('zero unidades diz «Esgotado»', (tester) async {
      await montar(tester, _produto(), 0);
      expect(find.text('Esgotado'), findsOneWidget);
    });

    testWidgets('sem inventário registado não diz «Esgotado»', (tester) async {
      // `null` é diferente de zero: a base não tem controlo de stock deste
      // produto, e marcar isso como rutura afastava vendas.
      await montar(tester, _produto(), null);
      expect(find.text('Esgotado'), findsNothing);
    });

    testWidgets('marca «Já comprou» e «Novo»', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 180,
              height: 260,
              child: ProdutoCartao(
                produto: _produto(novo: true),
                disponivel: 3,
                jaComprou: true,
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Já comprou'), findsOneWidget);
      expect(find.text('Novo'), findsOneWidget);
    });
  });

  group('formatação', () {
    test('kwanza com separador de milhares e sem cêntimos', () {
      expect(kz(12500), '12 500 Kz');
      expect(kz(1234567), '1 234 567 Kz');
      expect(kz(0), '0 Kz');
      expect(kz(null), '—');
    });

    test('estados de encomenda usam os valores da base', () {
      expect(estadoEncomenda('ready_pickup'), 'Pronta para recolha');
      expect(estadoEncomenda('in_delivery'), 'Em entrega');
      expect(estadoEncomenda('inventado'), '—');
    });
  });

  group('perfis', () {
    test('só a equipa tem área de trabalho', () {
      expect(Papel.visitante.eEquipa, isFalse);
      expect(Papel.cliente.eEquipa, isFalse);
      expect(Papel.colaborador.eEquipa, isTrue);
      expect(Papel.loja.eEquipa, isTrue);
      expect(Papel.gestor.eEquipa, isTrue);
    });

    test('só o gestor é gestor', () {
      expect(Papel.gestor.eGestor, isTrue);
      expect(Papel.colaborador.eGestor, isFalse);
      expect(Papel.loja.eGestor, isFalse);
    });
  });
}
