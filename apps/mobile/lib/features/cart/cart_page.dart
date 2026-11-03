import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';
import 'cart_store.dart';

class CartPage extends StatefulWidget {
  const CartPage({super.key});

  @override
  State<CartPage> createState() => _CartPageState();
}

class _CartPageState extends State<CartPage> {
  final _telefoneCtrl = TextEditingController();
  final _notasCtrl = TextEditingController();
  bool _aEnviar = false;
  String? _erro;
  String? _referencia;

  @override
  void initState() {
    super.initState();
    CartStore.instance.addListener(_redesenhar);
  }

  @override
  void dispose() {
    CartStore.instance.removeListener(_redesenhar);
    _telefoneCtrl.dispose();
    _notasCtrl.dispose();
    super.dispose();
  }

  void _redesenhar() {
    if (mounted) setState(() {});
  }

  Future<void> _finalizar() async {
    final carrinho = CartStore.instance;
    if (carrinho.vazio) return;

    setState(() {
      _aEnviar = true;
      _erro = null;
    });

    try {
      // client_ref garante idempotência: se a rede falhar e o utilizador
      // tentar de novo, o servidor devolve a MESMA encomenda em vez de criar
      // uma segunda.
      final resposta = await Supabase.instance.client.rpc('place_order', params: {
        'p_items': carrinho.payload,
        'p_delivery_method': 'pickup',
        'p_contact_phone': _telefoneCtrl.text.trim().isEmpty ? null : _telefoneCtrl.text.trim(),
        'p_notes': _notasCtrl.text.trim().isEmpty ? null : _notasCtrl.text.trim(),
        'p_client_ref': const Uuid().v4(),
      });

      final mapa = Map<String, dynamic>.from(resposta as Map);
      await carrinho.limpar();
      if (mounted) {
        setState(() => _referencia = mapa['reference'] as String?);
      }
    } on PostgrestException catch (e) {
      setState(() => _erro = e.message);
    } catch (_) {
      setState(() => _erro = 'Sem ligação. A encomenda não foi enviada — o carrinho está guardado.');
    } finally {
      if (mounted) setState(() => _aEnviar = false);
    }
  }

  String _dinheiro(double v) => kz(v);

  @override
  Widget build(BuildContext context) {
    final carrinho = CartStore.instance;

    if (_referencia != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Encomenda criada')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.check_circle_outline, size: 64, color: AppConfig.gold),
                const SizedBox(height: 16),
                const Text('Encomenda registada', style: TextStyle(fontSize: 20)),
                const SizedBox(height: 8),
                Text('Referência: $_referencia',
                    style: const TextStyle(color: AppConfig.gold, fontSize: 16)),
                const SizedBox(height: 8),
                const Text(
                  'Pode acompanhar o estado na sua área de cliente.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppConfig.muted),
                ),
                const SizedBox(height: 24),
                ElevatedButton(
                  onPressed: () => setState(() => _referencia = null),
                  child: const Text('Continuar a comprar'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Carrinho')),
      body: carrinho.vazio
          ? const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.shopping_bag_outlined, size: 48, color: AppConfig.muted),
                  SizedBox(height: 12),
                  Text('O carrinho está vazio.', style: TextStyle(color: AppConfig.muted)),
                  SizedBox(height: 4),
                  Text('Adicione produtos a partir do catálogo.',
                      style: TextStyle(color: AppConfig.muted, fontSize: 12)),
                ],
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(12),
              children: [
                for (final linha in carrinho.linhas)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(linha.name,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(color: AppConfig.text)),
                                const SizedBox(height: 4),
                                Text(_dinheiro(linha.price),
                                    style: const TextStyle(color: AppConfig.gold, fontSize: 13)),
                              ],
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.remove_circle_outline, size: 20),
                            onPressed: () => carrinho.definirQuantidade(
                                linha.productId, linha.quantity - 1),
                          ),
                          Text('${linha.quantity}'),
                          IconButton(
                            icon: const Icon(Icons.add_circle_outline, size: 20),
                            onPressed: () => carrinho.definirQuantidade(
                                linha.productId, linha.quantity + 1),
                          ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: 8),
                TextField(
                  controller: _telefoneCtrl,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'Telefone de contacto (opcional)'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _notasCtrl,
                  maxLines: 2,
                  decoration: const InputDecoration(labelText: 'Notas (opcional)'),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Total', style: TextStyle(color: AppConfig.muted)),
                    Text(_dinheiro(carrinho.total),
                        style: const TextStyle(
                            color: AppConfig.gold, fontSize: 18, fontWeight: FontWeight.w600)),
                  ],
                ),
                const SizedBox(height: 4),
                const Text(
                  'O total final é confirmado pelo servidor com os preços e o stock atuais.',
                  style: TextStyle(color: AppConfig.muted, fontSize: 11),
                ),
                if (_erro != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppConfig.danger.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(_erro!, style: const TextStyle(color: Colors.red, fontSize: 13)),
                  ),
                ],
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: _aEnviar ? null : _finalizar,
                  child: Text(_aEnviar ? 'A enviar…' : 'Finalizar encomenda'),
                ),
              ],
            ),
    );
  }
}
