import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';

/// As compras do cliente.
///
/// Inclui as que foram registadas **antes** de ele ter conta: o colaborador
/// vendeu e anotou o telefone, e no registo `ligar_reserva_ao_cliente` entregou
/// essas vendas a esta conta. A consulta é a RPC `minhas_compras()` — não se lê
/// `sales`/`sale_items` directamente porque o RLS não dá ao cliente acesso ao
/// perfil do colaborador, e a função devolve só o que é do próprio.
class PurchasesPage extends StatefulWidget {
  const PurchasesPage({super.key});

  @override
  State<PurchasesPage> createState() => _PurchasesPageState();
}

class _PurchasesPageState extends State<PurchasesPage> {
  List<Map<String, dynamic>> _compras = [];
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
      final resposta = await Supabase.instance.client.rpc('minhas_compras');

      if (!mounted) return;
      setState(() {
        _compras = (resposta as List? ?? [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        _aCarregar = false;
      });
    } on PostgrestException catch (e) {
      if (!mounted) return;
      setState(() {
        // PGRST202 = função inexistente: falta aplicar o PATCH_RESERVAS.sql.
        _erro = e.code == 'PGRST202'
            ? 'A base de dados ainda não foi actualizada. Peça à equipa para aplicar o PATCH_RESERVAS.sql.'
            : e.message;
        _aCarregar = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _erro = 'Sem ligação. Não foi possível carregar as compras.';
        _aCarregar = false;
      });
    }
  }

  Color _corEstado(Object? estado) {
    switch (estado?.toString()) {
      case 'paid':
        return AppConfig.success;
      case 'partial':
        return AppConfig.gold;
      case 'refunded':
        return AppConfig.muted;
      default:
        return AppConfig.danger;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('As minhas compras'),
        actions: [
          IconButton(onPressed: _carregar, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: _aCarregar
          ? const Center(child: CircularProgressIndicator(color: AppConfig.gold))
          : _erro != null
              ? _Erro(mensagem: _erro!, aoRepetir: _carregar)
              : _compras.isEmpty
                  ? const _Vazio()
                  : RefreshIndicator(
                      color: AppConfig.gold,
                      onRefresh: _carregar,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _compras.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 12),
                        itemBuilder: (context, i) => _CartaoCompra(
                          compra: _compras[i],
                          corEstado: _corEstado(_compras[i]['payment_status']),
                        ),
                      ),
                    ),
    );
  }
}

class _CartaoCompra extends StatelessWidget {
  const _CartaoCompra({required this.compra, required this.corEstado});

  final Map<String, dynamic> compra;
  final Color corEstado;

  @override
  Widget build(BuildContext context) {
    final itens = (compra['items'] as List? ?? [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    final vendedor = compra['seller_name']?.toString();
    final provincia = compra['provincia']?.toString();

    return Card(
      margin: EdgeInsets.zero,
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
                        compra['reference']?.toString() ?? 'Compra',
                        style: const TextStyle(
                          color: AppConfig.gold,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.4,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        dataCurta(compra['created_at']),
                        style: const TextStyle(color: AppConfig.muted, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      kz((compra['total'] as num?)?.toDouble()),
                      style: const TextStyle(
                        color: AppConfig.gold,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        border: Border.all(color: corEstado.withValues(alpha: 0.5)),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        estadoPagamento(compra['payment_status']),
                        style: TextStyle(color: corEstado, fontSize: 10, letterSpacing: 0.5),
                      ),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                const Icon(Icons.storefront_outlined, size: 13, color: AppConfig.gold),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    vendedor == null || vendedor.isEmpty
                        ? 'Vendido pela loja INUKA'
                        : 'Vendido por $vendedor${provincia != null ? ' · $provincia' : ''}',
                    style: const TextStyle(color: AppConfig.muted, fontSize: 11),
                  ),
                ),
              ],
            ),
            if (itens.isNotEmpty) ...[
              const Divider(height: 18, color: AppConfig.surface),
              ...itens.map((it) {
                final quantidade = (it['quantity'] as num?)?.toInt() ?? 0;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 5),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '$quantidade× ${it['name'] ?? 'Produto'}',
                          style: const TextStyle(color: AppConfig.text, fontSize: 13),
                        ),
                      ),
                      Text(
                        kz((it['total_price'] as num?)?.toDouble()),
                        style: const TextStyle(color: AppConfig.muted, fontSize: 12),
                      ),
                    ],
                  ),
                );
              }),
            ],
          ],
        ),
      ),
    );
  }
}

class _Vazio extends StatelessWidget {
  const _Vazio();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.receipt_long_outlined, size: 40, color: AppConfig.surface),
            const SizedBox(height: 14),
            const Text(
              'Sem compras por enquanto',
              style: TextStyle(color: AppConfig.text, fontSize: 15),
            ),
            const SizedBox(height: 6),
            const Text(
              'Quando comprar na loja ou a um colaborador INUKA, a compra aparece aqui.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppConfig.muted, fontSize: 12, height: 1.4),
            ),
          ],
        ),
      ),
    );
  }
}

class _Erro extends StatelessWidget {
  const _Erro({required this.mensagem, required this.aoRepetir});

  final String mensagem;
  final VoidCallback aoRepetir;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_outlined, size: 36, color: AppConfig.muted),
            const SizedBox(height: 12),
            Text(
              mensagem,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppConfig.muted, fontSize: 13, height: 1.4),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: aoRepetir,
              style: OutlinedButton.styleFrom(foregroundColor: AppConfig.gold),
              child: const Text('Tentar outra vez'),
            ),
          ],
        ),
      ),
    );
  }
}
