import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';

/// Histórico de encomendas do cliente autenticado.
///
/// A consulta é a mesma que a do site (`orders` com `order_items` e o nome do
/// produto embutidos): a política de SELECT já limita as linhas ao dono, por
/// isso não é preciso filtrar duas vezes nem chamar `my_orders()`.
class OrdersPage extends StatefulWidget {
  const OrdersPage({super.key});

  @override
  State<OrdersPage> createState() => _OrdersPageState();
}

class _OrdersPageState extends State<OrdersPage> {
  List<Map<String, dynamic>> _encomendas = [];
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
          .from('orders')
          .select('*, items:order_items(*, product:products(name, sku))')
          .eq('customer_id', eu)
          .order('created_at', ascending: false);

      if (!mounted) return;
      setState(() {
        _encomendas = (resposta as List)
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
        _erro = 'Sem ligação. Não foi possível carregar as encomendas.';
        _aCarregar = false;
      });
    }
  }

  Color _corEstado(Object? estado) {
    switch (estado?.toString()) {
      case 'completed':
        return AppConfig.success;
      case 'cancelled':
        return AppConfig.danger;
      case 'ready_pickup':
      case 'in_delivery':
        return AppConfig.gold;
      default:
        return AppConfig.muted;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('As minhas encomendas'),
        actions: [
          IconButton(onPressed: _carregar, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: _aCarregar
          ? const Center(child: CircularProgressIndicator(color: AppConfig.gold))
          : _erro != null
              ? _Erro(mensagem: _erro!, aoRepetir: _carregar)
              : RefreshIndicator(
                  onRefresh: _carregar,
                  child: _encomendas.isEmpty
                      ? ListView(
                          children: const [
                            SizedBox(height: 120),
                            Icon(Icons.shopping_bag_outlined,
                                size: 48, color: AppConfig.muted),
                            SizedBox(height: 12),
                            Center(
                              child: Text('Ainda não tem encomendas.',
                                  style: TextStyle(color: AppConfig.muted)),
                            ),
                          ],
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.all(12),
                          itemCount: _encomendas.length,
                          itemBuilder: (context, i) =>
                              _CartaoEncomenda(
                            encomenda: _encomendas[i],
                            corEstado: _corEstado,
                          ),
                        ),
                ),
    );
  }
}

class _CartaoEncomenda extends StatelessWidget {
  const _CartaoEncomenda({required this.encomenda, required this.corEstado});

  final Map<String, dynamic> encomenda;
  final Color Function(Object?) corEstado;

  @override
  Widget build(BuildContext context) {
    final itens = (encomenda['items'] as List? ?? []);
    final estado = encomenda['status'];
    final cor = corEstado(estado);
    final entrega = encomenda['delivery_method'] == 'delivery';

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        encomenda['reference'] as String? ?? '—',
                        style: const TextStyle(
                          color: AppConfig.text,
                          fontSize: 15,
                          letterSpacing: 0.4,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        dataHora(encomenda['created_at']),
                        style: const TextStyle(color: AppConfig.muted, fontSize: 11),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: cor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    estadoEncomenda(estado),
                    style: TextStyle(color: cor, fontSize: 11),
                  ),
                ),
              ],
            ),
            if (itens.isNotEmpty) ...[
              const SizedBox(height: 12),
              for (final item in itens)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${item['quantity']} × ${(item['product'] as Map?)?['name'] ?? 'Produto'}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: AppConfig.muted, fontSize: 12),
                        ),
                      ),
                      Text(
                        kz((item['total_price'] as num?)),
                        style: const TextStyle(color: AppConfig.muted, fontSize: 12),
                      ),
                    ],
                  ),
                ),
            ],
            const Divider(height: 20, color: AppConfig.surface),
            Row(
              children: [
                Icon(
                  entrega ? Icons.local_shipping_outlined : Icons.storefront_outlined,
                  size: 15,
                  color: AppConfig.muted,
                ),
                const SizedBox(width: 6),
                Text(
                  entrega ? 'Entrega' : 'Levantamento',
                  style: const TextStyle(color: AppConfig.muted, fontSize: 12),
                ),
                const Spacer(),
                Text(
                  kz(encomenda['total_amount'] as num?),
                  style: const TextStyle(
                    color: AppConfig.gold,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            if (encomenda['payment_status'] != null) ...[
              const SizedBox(height: 4),
              Text(
                estadoPagamento(encomenda['payment_status']),
                style: const TextStyle(color: AppConfig.muted, fontSize: 11),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Erro extends StatelessWidget {
  const _Erro({required this.mensagem, required this.aoRepetir});

  final String mensagem;
  final Future<void> Function() aoRepetir;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.wifi_off, size: 44, color: AppConfig.muted),
            const SizedBox(height: 12),
            Text(mensagem,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppConfig.muted)),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => aoRepetir(),
              child: const Text('Tentar novamente'),
            ),
          ],
        ),
      ),
    );
  }
}
