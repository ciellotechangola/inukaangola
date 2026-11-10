import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';
import '../../core/sessao.dart';
import '../../widgets/estado.dart';
import '../../widgets/produto_cartao.dart';

/// Registo de venda de um colaborador, no telemóvel.
///
/// Usa `register_sale_by_phone`: o telefone é o cadastro do cliente. Se o
/// número já tiver conta, a pessoa entra na carteira do colaborador como
/// cliente conquistado e a venda fica com o `customer_id` dela; se ainda não
/// tiver, fica uma reserva com o nome escrito aqui. O preço vem sempre da base
/// e o stock é verificado no servidor; aqui só se escolhe o quê e quanto.
class RegistarVendaPage extends StatefulWidget {
  const RegistarVendaPage({super.key});

  @override
  State<RegistarVendaPage> createState() => _RegistarVendaPageState();
}

class _RegistarVendaPageState extends State<RegistarVendaPage> {
  final _pesquisa = TextEditingController();
  final _nome = TextEditingController();
  final _telefone = TextEditingController();
  final _notas = TextEditingController();

  List<Map<String, dynamic>> _produtos = [];
  Map<String, int?> _stock = {};
  final Map<String, int> _carrinho = {};

  String _termo = '';
  String _pagamento = 'dinheiro';
  String _estadoPagamento = 'paid';

  bool _aCarregar = true;
  bool _aEnviar = false;
  String? _erro;
  String? _recibo;
  String? _destino;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  @override
  void dispose() {
    _pesquisa.dispose();
    _nome.dispose();
    _telefone.dispose();
    _notas.dispose();
    super.dispose();
  }

  Future<void> _carregar() async {
    setState(() {
      _aCarregar = true;
      _erro = null;
    });
    try {
      final resposta = await Supabase.instance.client
          .from('products')
          .select('id, name, sku, official_price, promotional_price, '
              'category:categories(id, name), '
              'images:product_images(url, is_primary, sort_order)')
          .eq('is_active', true)
          .order('name')
          .limit(300);

      final lista = (resposta as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();

      Map<String, int?> stock = {};
      if (lista.isNotEmpty) {
        try {
          final s = await Supabase.instance.client.rpc(
            'stock_produtos',
            params: {'p_ids': lista.map((p) => p['id']).toList()},
          );
          for (final linha in (s as List)) {
            final m = Map<String, dynamic>.from(linha as Map);
            stock[m['product_id'] as String] = (m['disponivel'] as num?)?.toInt();
          }
        } catch (_) {
          stock = {};
        }
      }

      if (!mounted) return;
      setState(() {
        _produtos = lista;
        _stock = stock;
        _aCarregar = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _erro = 'Sem ligação. Não foi possível carregar os produtos.';
        _aCarregar = false;
      });
    }
  }

  Map<String, dynamic> _produto(String id) => _produtos.firstWhere(
        (p) => p['id'] == id,
        orElse: () => <String, dynamic>{'id': id, 'name': 'Produto', 'official_price': 0},
      );

  double get _total => _carrinho.entries.fold<double>(
        0,
        (soma, e) => soma + precoEfetivo(_produto(e.key)).toDouble() * e.value,
      );

  void _adicionar(Map<String, dynamic> produto) {
    final id = produto['id'] as String;
    final disponivel = _stock[id];
    final actual = _carrinho[id] ?? 0;
    if (disponivel != null && actual >= disponivel) {
      avisar(context, 'Só há $disponivel unidade(s) desta referência.', erro: true);
      return;
    }
    setState(() => _carrinho[id] = actual + 1);
  }

  void _menos(String id) {
    setState(() {
      final q = (_carrinho[id] ?? 0) - 1;
      if (q <= 0) {
        _carrinho.remove(id);
      } else {
        _carrinho[id] = q;
      }
    });
  }

  Future<void> _registar() async {
    if (_carrinho.isEmpty) {
      avisar(context, 'Escolha pelo menos um produto.', erro: true);
      return;
    }
    if (_telefone.text.trim().isEmpty) {
      avisar(context, 'Indique o telefone do cliente.', erro: true);
      return;
    }

    setState(() {
      _aEnviar = true;
      _erro = null;
    });

    try {
      final resposta = await Supabase.instance.client.rpc('register_sale_by_phone', params: {
        'p_items': [
          for (final e in _carrinho.entries)
            {'product_id': e.key, 'quantity': e.value}
        ],
        'p_customer_phone': _telefone.text.trim(),
        'p_payment_method': _pagamento,
        'p_payment_status': _estadoPagamento,
        'p_notes': _notas.text.trim().isEmpty ? null : _notas.text.trim(),
        'p_client_ref': const Uuid().v4(),
        'p_customer_name': _nome.text.trim().isEmpty ? null : _nome.text.trim(),
      });

      final mapa = Map<String, dynamic>.from(resposta as Map);
      final conquistado = mapa['conquistado'] == true;
      final nome = _nome.text.trim();

      setState(() {
        _recibo = mapa['reference'] as String? ?? '—';
        _destino = conquistado
            ? '${nome.isEmpty ? 'O cliente' : nome} entrou nos seus clientes conquistados.'
            : '${nome.isEmpty ? 'O cliente' : nome} ficou na sua carteira por activar — '
                'recebe esta compra quando abrir conta com este número.';
        _carrinho.clear();
        _nome.clear();
        _telefone.clear();
        _notas.clear();
      });
    } on PostgrestException catch (e) {
      if (!mounted) return;
      setState(() => _erro = e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _erro = 'Sem ligação. A venda não foi registada.');
    } finally {
      if (mounted) setState(() => _aEnviar = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_recibo != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Venda registada')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(26),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.check_circle_outline, size: 56, color: AppConfig.gold),
                const SizedBox(height: 14),
                const Text('Venda registada', style: TextStyle(fontSize: 18)),
                const SizedBox(height: 6),
                Text('Recibo $_recibo',
                    style: const TextStyle(color: AppConfig.gold, fontSize: 14)),
                const SizedBox(height: 8),
                Text(
                  _destino ??
                      'A comissão entra no seu painel e o cliente vê a compra na '
                          'conta dele assim que se registar com este telefone.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppConfig.muted, fontSize: 12, height: 1.5),
                ),
                const SizedBox(height: 22),
                ElevatedButton(
                  onPressed: () => setState(() {
                    _recibo = null;
                    _destino = null;
                  }),
                  child: const Text('Registar outra venda'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final lista = _produtos.where((p) {
      if (_termo.isEmpty) return true;
      final nome = (p['name'] as String? ?? '').toLowerCase();
      final sku = (p['sku'] as String? ?? '').toLowerCase();
      return nome.contains(_termo) || sku.contains(_termo);
    }).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Registar venda'),
        actions: [
          IconButton(
            tooltip: 'Actualizar',
            onPressed: _carregar,
            icon: const Icon(Icons.refresh, size: 20),
          ),
        ],
      ),
      body: _aCarregar
          ? const EstadoCarregando()
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: TextField(
                    controller: _pesquisa,
                    onChanged: (v) => setState(() => _termo = v.toLowerCase()),
                    style: const TextStyle(color: AppConfig.text, fontSize: 13),
                    decoration: const InputDecoration(
                      hintText: 'Procurar produto',
                      prefixIcon: Icon(Icons.search, size: 18),
                      isDense: true,
                      contentPadding:
                          EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    ),
                  ),
                ),
                Expanded(
                  child: lista.isEmpty
                      ? const EstadoVazio(
                          icone: Icons.search_off,
                          titulo: 'Nenhum produto encontrado.',
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                          itemCount: lista.length,
                          itemBuilder: (_, i) {
                            final p = lista[i];
                            final disp = _stock[p['id']];
                            final noCarrinho = _carrinho[p['id']] ?? 0;
                            return Cartao(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 12, vertical: 10),
                              aoTocar: disp == 0 ? null : () => _adicionar(p),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          p['name'] as String? ?? '',
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                              color: AppConfig.text, fontSize: 12.5),
                                        ),
                                        Text(
                                          '${kz(precoEfetivo(p))}'
                                          '${disp == null ? '' : ' · $disp em stock'}',
                                          style: const TextStyle(
                                              color: Color(0xFF525252), fontSize: 10),
                                        ),
                                      ],
                                    ),
                                  ),
                                  if (noCarrinho > 0) ...[
                                    IconButton(
                                      visualDensity: VisualDensity.compact,
                                      icon: const Icon(Icons.remove_circle_outline,
                                          size: 18),
                                      onPressed: () => _menos(p['id'] as String),
                                    ),
                                    Text('$noCarrinho',
                                        style: const TextStyle(fontSize: 12.5)),
                                  ],
                                  IconButton(
                                    visualDensity: VisualDensity.compact,
                                    icon: const Icon(Icons.add_circle_outline, size: 19),
                                    color: AppConfig.gold,
                                    onPressed: disp == 0 ? null : () => _adicionar(p),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                ),
                Container(
                  decoration: const BoxDecoration(
                    border: Border(top: BorderSide(color: Color(0xFF232323))),
                  ),
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        children: [
                          const Text('Total',
                              style:
                                  TextStyle(color: AppConfig.muted, fontSize: 12)),
                          const Spacer(),
                          Text(
                            kz(_total),
                            style: const TextStyle(
                                color: AppConfig.gold,
                                fontSize: 17,
                                fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      TextField(
                        controller: _nome,
                        style: const TextStyle(color: AppConfig.text, fontSize: 13),
                        decoration: const InputDecoration(
                          labelText: 'Nome do cliente (opcional)',
                          hintText: 'Como está na carteira',
                          isDense: true,
                          contentPadding:
                              EdgeInsets.symmetric(horizontal: 12, vertical: 13),
                        ),
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _telefone,
                        keyboardType: TextInputType.phone,
                        style: const TextStyle(color: AppConfig.text, fontSize: 13),
                        decoration: const InputDecoration(
                          labelText: 'Telefone do cliente *',
                          hintText: '+244 9xx xxx xxx',
                          isDense: true,
                          contentPadding:
                              EdgeInsets.symmetric(horizontal: 12, vertical: 13),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: DropdownButtonFormField<String>(
                              value: _pagamento,
                              isDense: true,
                              style:
                                  const TextStyle(color: AppConfig.text, fontSize: 12),
                              decoration: const InputDecoration(
                                labelText: 'Pagamento',
                                isDense: true,
                                contentPadding: EdgeInsets.symmetric(
                                    horizontal: 10, vertical: 12),
                              ),
                              items: const [
                                DropdownMenuItem(
                                    value: 'dinheiro', child: Text('Dinheiro')),
                                DropdownMenuItem(
                                    value: 'transferencia',
                                    child: Text('Transferência')),
                                DropdownMenuItem(
                                    value: 'multicaixa', child: Text('Multicaixa')),
                              ],
                              onChanged: (v) =>
                                  setState(() => _pagamento = v ?? 'dinheiro'),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: DropdownButtonFormField<String>(
                              value: _estadoPagamento,
                              isDense: true,
                              style:
                                  const TextStyle(color: AppConfig.text, fontSize: 12),
                              decoration: const InputDecoration(
                                labelText: 'Estado',
                                isDense: true,
                                contentPadding: EdgeInsets.symmetric(
                                    horizontal: 10, vertical: 12),
                              ),
                              items: const [
                                DropdownMenuItem(value: 'paid', child: Text('Paga')),
                                DropdownMenuItem(
                                    value: 'pending', child: Text('Por pagar')),
                                DropdownMenuItem(
                                    value: 'partial', child: Text('Parcial')),
                              ],
                              onChanged: (v) =>
                                  setState(() => _estadoPagamento = v ?? 'paid'),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _notas,
                        maxLines: 2,
                        style: const TextStyle(color: AppConfig.text, fontSize: 12.5),
                        decoration: const InputDecoration(
                          labelText: 'Notas (opcional)',
                          isDense: true,
                        ),
                      ),
                      if (_erro != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          _erro!,
                          style: const TextStyle(
                              color: Color(0xFFF87171), fontSize: 11.5),
                        ),
                      ],
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: _aEnviar || _carrinho.isEmpty ? null : _registar,
                          child: Text(_aEnviar ? 'A registar…' : 'Registar venda'),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
    );
  }
}
