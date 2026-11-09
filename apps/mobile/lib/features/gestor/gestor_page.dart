import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';
import '../../core/sessao.dart';
import '../../widgets/estado.dart';
import '../../widgets/produto_cartao.dart';

/// Gestão — o painel do gestor no telemóvel.
///
/// Não substitui o site: o catálogo completo, os colaboradores, os conteúdos e
/// o estúdio continuam a ser trabalho de secretária. Aqui ficam as decisões
/// que acontecem fora do escritório — ver os números, corrigir stock, mudar o
/// estado de uma encomenda e responder a um pedido de desconto. Tudo por
/// funções do servidor, com as mesmas regras de permissão do site.
class GestorPage extends StatefulWidget {
  const GestorPage({super.key});

  @override
  State<GestorPage> createState() => _GestorPageState();
}

class _GestorPageState extends State<GestorPage> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 4, vsync: this);

  Map<String, dynamic>? _stats;
  List<Map<String, dynamic>> _produtos = [];
  Map<String, Map<String, dynamic>> _stock = {};
  List<Map<String, dynamic>> _encomendas = [];
  List<Map<String, dynamic>> _descontos = [];

  bool _aCarregar = true;
  String? _erro;

  String? get _provincia => Sessao.instance.perfil?['provincia_id'] as String?;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _carregar() async {
    setState(() {
      _aCarregar = true;
      _erro = null;
    });
    final cliente = Supabase.instance.client;
    final prov = _provincia;

    try {
      final statsRes = await cliente.rpc('dashboard_stats');

      final produtosRes = await cliente
          .from('products')
          .select('id, name, sku, official_price, promotional_price, is_active, '
              'category:categories(id, name), '
              'images:product_images(url, is_primary, sort_order)')
          .order('name')
          .limit(500);

      var inventarioQuery = cliente
          .from('inventory')
          .select('product_id, quantity, reserved_quantity, low_stock_threshold');
      inventarioQuery = prov == null
          ? inventarioQuery.filter('provincia_id', 'is', null)
          : inventarioQuery.eq('provincia_id', prov);
      final inventarioRes = await inventarioQuery.limit(1000);

      final encomendasRes = await cliente
          .from('orders')
          .select('id, reference, status, total_amount, delivery_method, '
              'contact_phone, created_at')
          .order('created_at', ascending: false)
          .limit(150);

      final descontosRes = await cliente
          .from('discount_requests')
          .select('id, official_price, requested_price, justification, status, '
              'created_at, product:products(name)')
          .eq('status', 'pending')
          .order('created_at', ascending: false)
          .limit(60);

      if (!mounted) return;
      setState(() {
        _stats = statsRes == null ? null : Map<String, dynamic>.from(statsRes as Map);
        _produtos = (produtosRes as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        _stock = {
          for (final linha in (inventarioRes as List))
            (linha as Map)['product_id'] as String: Map<String, dynamic>.from(linha)
        };
        _encomendas = (encomendasRes as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        _descontos = (descontosRes as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        _aCarregar = false;
      });
    } on PostgrestException catch (e) {
      if (!mounted) return;
      setState(() {
        _erro = e.message.contains('42501')
            ? 'Esta área é reservada à gestão.'
            : e.message;
        _aCarregar = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _erro = 'Sem ligação. Não foi possível carregar a gestão.';
        _aCarregar = false;
      });
    }
  }

  int? _quantidade(Map<String, dynamic> p) =>
      (_stock[p['id']]?['quantity'] as num?)?.toInt();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Gestão'),
        actions: [
          IconButton(
            tooltip: 'Actualizar',
            onPressed: _carregar,
            icon: const Icon(Icons.refresh, size: 20),
          ),
        ],
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          labelColor: AppConfig.gold,
          unselectedLabelColor: AppConfig.muted,
          indicatorColor: AppConfig.gold,
          indicatorSize: TabBarIndicatorSize.label,
          labelStyle: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
          unselectedLabelStyle: const TextStyle(fontSize: 12.5),
          tabs: [
            const Tab(text: 'Painel'),
            const Tab(text: 'Produtos'),
            const Tab(text: 'Encomendas'),
            Tab(text: 'Descontos${_descontos.isEmpty ? '' : ' (${_descontos.length})'}'),
          ],
        ),
      ),
      body: _aCarregar
          ? const EstadoCarregando(mensagem: 'A carregar a gestão…')
          : _erro != null
              ? EstadoErro(mensagem: _erro!, aoRepetir: _carregar)
              : TabBarView(
                  controller: _tabs,
                  children: [
                    _painel(),
                    _produtosTab(),
                    _encomendasTab(),
                    _descontosTab(),
                  ],
                ),
    );
  }

  // ------------------------------------------------------------------ painel
  Widget _painel() {
    final s = _stats ?? const <String, dynamic>{};
    final vendas = (s['sales_total_value'] as num?)?.toDouble() ?? 0;
    final nVendas = (s['sales_count'] as num?)?.toInt() ?? 0;
    final nEncomendas = (s['orders_count'] as num?)?.toInt() ?? 0;
    final clientes = (s['customers_count'] as num?)?.toInt() ?? 0;
    final colaboradores = (s['sellers_count'] as num?)?.toInt() ?? 0;
    final reservas = (s['active_reservations'] as num?)?.toInt() ?? 0;
    final baixos = (s['low_stock_products'] as List? ?? [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();

    return RefreshIndicator(
      color: AppConfig.gold,
      onRefresh: _carregar,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 30),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xFF2A2A2A)),
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF181818), Color(0xFF0C0C0C)],
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'VENDAS DO MÊS',
                  style: TextStyle(
                    color: AppConfig.gold.withValues(alpha: 0.9),
                    fontSize: 9,
                    letterSpacing: 1.6,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  kz(vendas),
                  style: const TextStyle(
                    color: AppConfig.text,
                    fontSize: 27,
                    fontWeight: FontWeight.w300,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '$nVendas venda(s) registada(s) · $nEncomendas encomenda(s)',
                  style: const TextStyle(color: AppConfig.muted, fontSize: 11),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _Numero(rotulo: 'Clientes', valor: '$clientes'),
              const SizedBox(width: 10),
              _Numero(rotulo: 'Colaboradores', valor: '$colaboradores'),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              _Numero(rotulo: 'Reservas activas', valor: '$reservas'),
              const SizedBox(width: 10),
              _Numero(
                rotulo: 'Stock baixo',
                valor: '${baixos.length}',
                alerta: baixos.isNotEmpty,
              ),
            ],
          ),
          const TituloSeccao('Repor primeiro'),
          if (baixos.isEmpty)
            const Text(
              'Nenhum produto no limiar de stock.',
              style: TextStyle(color: AppConfig.muted, fontSize: 12),
            )
          else
            for (final b in baixos.take(10))
              Cartao(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        b['name'] as String? ?? 'Produto',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppConfig.text, fontSize: 12.5),
                      ),
                    ),
                    Text(
                      '${(b['quantity'] as num?)?.toInt() ?? 0} un.',
                      style: const TextStyle(
                        color: Color(0xFFF87171),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
          const SizedBox(height: 8),
          const Text(
            'O catálogo completo, colaboradores, conteúdos e o estúdio de '
            'criação continuam no site — aqui ficam as decisões do dia-a-dia.',
            style: TextStyle(color: Color(0xFF525252), fontSize: 11, height: 1.5),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------- produtos
  Widget _produtosTab() {
    return _ListaProdutos(
      produtos: _produtos,
      quantidade: _quantidade,
      provincia: _provincia,
      aoRecarregar: _carregar,
    );
  }

  // -------------------------------------------------------------- encomendas
  Widget _encomendasTab() {
    return _ListaEncomendas(encomendas: _encomendas, aoRecarregar: _carregar);
  }

  // ---------------------------------------------------------------- descontos
  Widget _descontosTab() {
    if (_descontos.isEmpty) {
      return const EstadoVazio(
        icone: Icons.percent,
        titulo: 'Sem pedidos de desconto.',
        detalhe: 'Os pedidos dos clientes aparecem aqui para aprovar ou recusar.',
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
      itemCount: _descontos.length,
      itemBuilder: (_, i) {
        final d = _descontos[i];
        final oficial = (d['official_price'] as num?)?.toDouble() ?? 0;
        final pedido = (d['requested_price'] as num?)?.toDouble() ?? 0;
        final desconto = oficial > 0 ? ((1 - pedido / oficial) * 100).round() : 0;

        return Cartao(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                (d['product'] as Map?)?['name'] as String? ?? 'Produto',
                style: const TextStyle(
                    color: AppConfig.text, fontSize: 13, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 4),
              Text(
                'Pede ${kz(pedido)} em vez de ${kz(oficial)} · -$desconto%',
                style: const TextStyle(color: AppConfig.gold, fontSize: 11.5),
              ),
              if ((d['justification'] as String?)?.trim().isNotEmpty == true) ...[
                const SizedBox(height: 6),
                Text(
                  d['justification'] as String,
                  style: const TextStyle(
                      color: AppConfig.muted, fontSize: 11.5, height: 1.45),
                ),
              ],
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => _decidir(d, false, null),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 9),
                        side: const BorderSide(color: Color(0xFF7F1D1D)),
                        foregroundColor: AppConfig.danger,
                      ),
                      child: const Text('Recusar', style: TextStyle(fontSize: 12)),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () => _decidir(d, true, pedido),
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 9),
                      ),
                      child: const Text('Aprovar', style: TextStyle(fontSize: 12)),
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _decidir(
    Map<String, dynamic> pedido,
    bool aprovar,
    double? precoFinal,
  ) async {
    try {
      await Supabase.instance.client.rpc('decide_discount', params: {
        'p_request_id': pedido['id'],
        'p_approve': aprovar,
        'p_final_price': precoFinal,
      });
      if (!mounted) return;
      avisar(context, aprovar ? 'Desconto aprovado.' : 'Desconto recusado.');
      await _carregar();
    } catch (_) {
      if (!mounted) return;
      avisar(context, 'Não foi possível decidir o pedido.', erro: true);
    }
  }
}

class _Numero extends StatelessWidget {
  const _Numero({required this.rotulo, required this.valor, this.alerta = false});

  final String rotulo;
  final String valor;
  final bool alerta;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: AppConfig.charcoal,
          borderRadius: BorderRadius.circular(13),
          border: Border.all(color: AppConfig.surface),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              rotulo.toUpperCase(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  color: Color(0xFF525252), fontSize: 8.5, letterSpacing: 0.8),
            ),
            const SizedBox(height: 6),
            Text(
              valor,
              style: TextStyle(
                color: alerta ? const Color(0xFFF87171) : AppConfig.gold,
                fontSize: 18,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ListaProdutos extends StatefulWidget {
  const _ListaProdutos({
    required this.produtos,
    required this.quantidade,
    required this.provincia,
    required this.aoRecarregar,
  });

  final List<Map<String, dynamic>> produtos;
  final int? Function(Map<String, dynamic>) quantidade;
  final String? provincia;
  final Future<void> Function() aoRecarregar;

  @override
  State<_ListaProdutos> createState() => _ListaProdutosState();
}

class _ListaProdutosState extends State<_ListaProdutos> {
  final _pesquisa = TextEditingController();
  String _termo = '';

  @override
  void dispose() {
    _pesquisa.dispose();
    super.dispose();
  }

  Future<void> _editar(Map<String, dynamic> produto) async {
    final actual = widget.quantidade(produto) ?? 0;
    final controlador = TextEditingController(text: '$actual');

    final valor = await showDialog<int>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppConfig.charcoal,
        title: Text(produto['name'] as String? ?? 'Produto',
            style: const TextStyle(fontSize: 15)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.provincia == null
                  ? 'Stock nacional (sede).'
                  : 'Stock da sua província.',
              style: const TextStyle(color: AppConfig.muted, fontSize: 11.5),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controlador,
              keyboardType: TextInputType.number,
              autofocus: true,
              style: const TextStyle(fontSize: 18, color: AppConfig.text),
              decoration: const InputDecoration(labelText: 'Unidades'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancelar', style: TextStyle(color: AppConfig.muted)),
          ),
          TextButton(
            onPressed: () {
              final n = int.tryParse(controlador.text.trim());
              Navigator.of(context).pop(n != null && n >= 0 ? n : null);
            },
            child: const Text('Gravar'),
          ),
        ],
      ),
    );

    if (valor == null) return;
    try {
      await Supabase.instance.client.rpc('set_product_stock', params: {
        'p_product_id': produto['id'],
        'p_quantity': valor,
        'p_reason': 'Ajuste pela app (gestão)',
        'p_provincia_id': widget.provincia,
      });
      if (!mounted) return;
      avisar(context, 'Stock actualizado para $valor.');
      await widget.aoRecarregar();
    } catch (e) {
      if (!mounted) return;
      final texto = e is PostgrestException ? e.message : 'Não foi possível gravar.';
      avisar(context, texto, erro: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lista = widget.produtos.where((p) {
      if (_termo.isEmpty) return true;
      final nome = (p['name'] as String? ?? '').toLowerCase();
      final sku = (p['sku'] as String? ?? '').toLowerCase();
      return nome.contains(_termo) || sku.contains(_termo);
    }).toList();

    return Column(
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
              contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            ),
          ),
        ),
        Expanded(
          child: lista.isEmpty
              ? const EstadoVazio(icone: Icons.inventory_2_outlined, titulo: 'Sem produtos.')
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                  itemCount: lista.length,
                  itemBuilder: (_, i) {
                    final p = lista[i];
                    final qtd = widget.quantidade(p);
                    final activo = p['is_active'] != false;
                    return Cartao(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      aoTocar: () => _editar(p),
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
                                  style: TextStyle(
                                    color: activo ? AppConfig.text : AppConfig.muted,
                                    fontSize: 12.5,
                                  ),
                                ),
                                Text(
                                  '${p['sku'] ?? '—'} · ${kz(precoEfetivo(p))}'
                                  '${activo ? '' : ' · desactivado'}',
                                  style: const TextStyle(
                                      color: Color(0xFF525252), fontSize: 10),
                                ),
                              ],
                            ),
                          ),
                          Text(
                            qtd == null ? 'sem registo' : '$qtd un.',
                            style: TextStyle(
                              color: qtd == null
                                  ? AppConfig.muted
                                  : qtd == 0
                                      ? const Color(0xFFF87171)
                                      : AppConfig.goldLight,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(width: 4),
                          const Icon(Icons.edit_outlined,
                              size: 15, color: Color(0xFF4A4A4A)),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

class _ListaEncomendas extends StatefulWidget {
  const _ListaEncomendas({required this.encomendas, required this.aoRecarregar});

  final List<Map<String, dynamic>> encomendas;
  final Future<void> Function() aoRecarregar;

  @override
  State<_ListaEncomendas> createState() => _ListaEncomendasState();
}

class _ListaEncomendasState extends State<_ListaEncomendas> {
  String? _aMudar;

  static const _estados = [
    ('pending', 'Pendente'),
    ('confirmed', 'Confirmada'),
    ('preparing', 'Em preparação'),
    ('ready_pickup', 'Pronta'),
    ('in_delivery', 'Em entrega'),
    ('completed', 'Concluída'),
    ('cancelled', 'Cancelada'),
  ];

  @override
  Widget build(BuildContext context) {
    final messenger = ScaffoldMessenger.of(context);
    if (widget.encomendas.isEmpty) {
      return const EstadoVazio(
        icone: Icons.receipt_long_outlined,
        titulo: 'Sem encomendas registadas.',
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
      itemCount: widget.encomendas.length,
      itemBuilder: (_, i) {
        final e = widget.encomendas[i];
        final aMudar = _aMudar == e['id'];
        return Cartao(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      e['reference'] as String? ?? '—',
                      style: const TextStyle(
                          color: AppConfig.text,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600),
                    ),
                  ),
                  Text(
                    kz((e['total_amount'] as num?)?.toDouble()),
                    style: const TextStyle(color: AppConfig.gold, fontSize: 12.5),
                  ),
                ],
              ),
              const SizedBox(height: 3),
              Text(
                '${dataHora(e['created_at'])} · '
                '${e['delivery_method'] == 'delivery' ? 'entrega' : 'recolha'}'
                '${(e['contact_phone'] as String?)?.isNotEmpty == true ? ' · ${e['contact_phone']}' : ''}',
                style: const TextStyle(color: Color(0xFF6F6F6F), fontSize: 10.5),
              ),
              const SizedBox(height: 8),
              if (aMudar)
                const LinearProgressIndicator(minHeight: 2, color: AppConfig.gold)
              else
                DropdownButtonFormField<String>(
                  value: e['status'] as String?,
                  isDense: true,
                  style: const TextStyle(color: AppConfig.text, fontSize: 12),
                  decoration: const InputDecoration(
                    labelText: 'Estado',
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                  ),
                  items: [
                    for (final s in _estados)
                      DropdownMenuItem(value: s.$1, child: Text(s.$2)),
                  ],
                  onChanged: (novo) async {
                    if (novo == null || novo == e['status']) return;
                    setState(() => _aMudar = e['id'] as String);
                    try {
                      await Supabase.instance.client.rpc('update_order_status', params: {
                        'p_order_id': e['id'],
                        'p_status': novo,
                        'p_notes': null,
                      });
                      await widget.aoRecarregar();
                    } catch (err) {
                      if (!mounted) return;
                      final texto = err is PostgrestException
                          ? err.message
                          : 'Não foi possível mudar o estado.';
                      avisarEm(messenger, texto, erro: true);
                    } finally {
                      if (mounted) setState(() => _aMudar = null);
                    }
                  },
                ),
            ],
          ),
        );
      },
    );
  }
}
