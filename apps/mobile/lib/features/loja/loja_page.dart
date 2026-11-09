import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';
import '../../core/sessao.dart';
import '../../widgets/estado.dart';
import '../../widgets/produto_cartao.dart';

/// Loja — a área do vendedor de loja.
///
/// Tudo o que aqui aparece é da província de quem entrou: o servidor já
/// filtra (`can_manage_stock`, políticas de `orders`), e a consulta reforça
/// com `provincia_id` para não somar províncias que não são esta loja.
///
/// Quatro separadores, os mesmos do site: pulso da loja, stock, balcão e
/// encomendas. As operações passam todas por funções do servidor — a app não
/// calcula preços nem mexe em stock por conta própria.
class LojaPage extends StatefulWidget {
  const LojaPage({super.key});

  @override
  State<LojaPage> createState() => _LojaPageState();
}

class _LojaPageState extends State<LojaPage> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 4, vsync: this);

  List<Map<String, dynamic>> _produtos = [];
  Map<String, Map<String, dynamic>> _stock = {};
  List<Map<String, dynamic>> _vendasHoje = [];
  List<Map<String, dynamic>> _encomendas = [];

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
    final inicioDoDia = DateTime.now();
    final meiaNoite = DateTime(inicioDoDia.year, inicioDoDia.month, inicioDoDia.day);

    try {
      // Produtos activos: servem o balcão e a contagem de stock.
      final produtosRes = await cliente
          .from('products')
          .select('id, name, sku, official_price, promotional_price, is_active, '
              'category:categories(id, name), '
              'images:product_images(url, is_primary, sort_order)')
          .eq('is_active', true)
          .order('name')
          .limit(500);

      // Inventário desta província. `inventory_read` deixa qualquer conta
      // autenticada ler; o filtro é que garante que é a loja certa.
      var inventarioQuery = cliente
          .from('inventory')
          .select('product_id, quantity, reserved_quantity, low_stock_threshold');
      inventarioQuery = prov == null
          ? inventarioQuery.filter('provincia_id', 'is', null)
          : inventarioQuery.eq('provincia_id', prov);
      final inventarioRes = await inventarioQuery.limit(1000);

      var vendasQuery = cliente
          .from('sales')
          .select('id, reference, total_amount, created_at, payment_method, '
              // `sale_items` não tem coluna `product_name`: o nome vive no
              // instantâneo (`product_snapshot`), que é o que o histórico
              // guarda mesmo depois de o produto sair do catálogo.
              'items:sale_items(quantity, unit_price, product_snapshot)')
          .gte('created_at', meiaNoite.toIso8601String());
      vendasQuery = prov == null
          ? vendasQuery.filter('provincia_id', 'is', null)
          : vendasQuery.eq('provincia_id', prov);
      final vendasRes =
          await vendasQuery.order('created_at', ascending: false).limit(200);

      var encomendasQuery = cliente
          .from('orders')
          .select('id, reference, status, total_amount, delivery_method, '
              'contact_phone, created_at, notes')
          .inFilter('status',
              ['pending', 'confirmed', 'preparing', 'ready_pickup', 'in_delivery']);
      encomendasQuery = prov == null
          ? encomendasQuery.filter('provincia_id', 'is', null)
          : encomendasQuery.eq('provincia_id', prov);
      final encomendasRes = await encomendasQuery
          .order('created_at', ascending: false)
          .limit(300);

      if (!mounted) return;
      setState(() {
        _produtos = (produtosRes as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        _stock = {
          for (final linha in (inventarioRes as List))
            (linha as Map)['product_id'] as String: Map<String, dynamic>.from(linha)
        };
        _vendasHoje = (vendasRes as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        _encomendas = (encomendasRes as List)
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
        _erro = 'Sem ligação. Não foi possível carregar a loja.';
        _aCarregar = false;
      });
    }
  }

  /// Unidades disponíveis nesta província; `null` = produto sem registo.
  int? _disponivel(Map<String, dynamic> produto) {
    final linha = _stock[produto['id']];
    if (linha == null) return null;
    final q = (linha['quantity'] as num?)?.toInt() ?? 0;
    final r = (linha['reserved_quantity'] as num?)?.toInt() ?? 0;
    return (q - r).clamp(0, 1 << 30);
  }

  int? _quantidade(Map<String, dynamic> produto) =>
      (_stock[produto['id']]?['quantity'] as num?)?.toInt();

  @override
  Widget build(BuildContext context) {
    final nome = (Sessao.instance.nome ?? '').split(' ').first;
    final provincia = Sessao.instance.provincia;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Loja', style: TextStyle(fontSize: 17)),
            Text(
              nome.isEmpty
                  ? (provincia ?? 'Sede')
                  : '$nome · ${provincia ?? 'Sede'}',
              style: const TextStyle(color: AppConfig.muted, fontSize: 11),
            ),
          ],
        ),
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
          tabs: const [
            Tab(text: 'Painel'),
            Tab(text: 'Stock'),
            Tab(text: 'Balcão'),
            Tab(text: 'Encomendas'),
          ],
        ),
      ),
      body: _aCarregar
          ? const EstadoCarregando(mensagem: 'A carregar a loja…')
          : _erro != null
              ? EstadoErro(mensagem: _erro!, aoRepetir: _carregar)
              : TabBarView(
                  controller: _tabs,
                  children: [
                    _painel(),
                    _PainelStock(
                      produtos: _produtos,
                      quantidade: _quantidade,
                      disponivel: _disponivel,
                      aoGravar: _gravarStock,
                    ),
                    _Balcao(
                      produtos: _produtos,
                      disponivel: _disponivel,
                      provinciaId: _provincia,
                      aoConcluir: _carregar,
                    ),
                    _Encomendas(
                      encomendas: _encomendas,
                      aoMudarEstado: _mudarEstado,
                    ),
                  ],
                ),
    );
  }

  Future<void> _gravarStock(Map<String, dynamic> produto, int quantidade) async {
    await Supabase.instance.client.rpc('set_product_stock', params: {
      'p_product_id': produto['id'],
      'p_quantity': quantidade,
      'p_reason': 'Contagem na app',
      'p_provincia_id': _provincia,
    });
    await _carregar();
  }

  Future<void> _mudarEstado(Map<String, dynamic> encomenda, String estado) async {
    await Supabase.instance.client.rpc('update_order_status', params: {
      'p_order_id': encomenda['id'],
      'p_status': estado,
      'p_notes': null,
    });
    await _carregar();
  }

  Widget _painel() {
    final totalHoje = _vendasHoje.fold<double>(
      0,
      (soma, v) => soma + (v['total_amount'] as num? ?? 0).toDouble(),
    );
    final comStock = _produtos.where((p) => (_disponivel(p) ?? 0) > 0).length;
    final baixos = _produtos.where((p) {
      final d = _disponivel(p);
      if (d == null) return false;
      final limiar = (_stock[p['id']]?['low_stock_threshold'] as num?)?.toInt() ?? 5;
      return d <= limiar;
    }).toList()
      ..sort((a, b) => (_disponivel(a) ?? 0).compareTo(_disponivel(b) ?? 0));

    final porPreparar = _encomendas
        .where((e) => e['status'] != 'ready_pickup' && e['status'] != 'in_delivery')
        .length;
    final prontas =
        _encomendas.where((e) => e['status'] == 'ready_pickup').length;

    return RefreshIndicator(
      color: AppConfig.gold,
      onRefresh: _carregar,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 30),
        children: [
          Row(
            children: [
              _Indicador(
                rotulo: 'Vendas hoje',
                valor: kz(totalHoje),
                nota: '${_vendasHoje.length} venda(s)',
                icone: Icons.point_of_sale_outlined,
              ),
              const SizedBox(width: 10),
              _Indicador(
                rotulo: 'Com stock',
                valor: '$comStock',
                nota: '${_produtos.length} referências',
                icone: Icons.inventory_2_outlined,
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              _Indicador(
                rotulo: 'Stock baixo',
                valor: '${baixos.length}',
                nota: 'No limiar ou abaixo',
                icone: Icons.warning_amber_outlined,
                alerta: baixos.isNotEmpty,
              ),
              const SizedBox(width: 10),
              _Indicador(
                rotulo: 'Por preparar',
                valor: '$porPreparar',
                nota: '$prontas pronta(s)',
                icone: Icons.assignment_outlined,
              ),
            ],
          ),
          const TituloSeccao('Repor primeiro'),
          if (baixos.isEmpty)
            const Text(
              'Nada em falta. Todas as referências estão acima do limiar.',
              style: TextStyle(color: AppConfig.muted, fontSize: 12),
            )
          else
            for (final p in baixos.take(8))
              Cartao(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                aoTocar: () {
                  _tabs.animateTo(1);
                },
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            p['name'] as String? ?? 'Produto',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: AppConfig.text, fontSize: 12.5),
                          ),
                          Text(
                            p['sku'] as String? ?? '—',
                            style: const TextStyle(
                                color: Color(0xFF525252), fontSize: 10),
                          ),
                        ],
                      ),
                    ),
                    Text(
                      '${_disponivel(p) ?? 0} un.',
                      style: TextStyle(
                        color: (_disponivel(p) ?? 0) == 0
                            ? const Color(0xFFF87171)
                            : AppConfig.goldLight,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
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

class _Indicador extends StatelessWidget {
  const _Indicador({
    required this.rotulo,
    required this.valor,
    required this.nota,
    required this.icone,
    this.alerta = false,
  });

  final String rotulo;
  final String valor;
  final String nota;
  final IconData icone;
  final bool alerta;

  @override
  Widget build(BuildContext context) {
    final cor = alerta ? const Color(0xFFF87171) : AppConfig.gold;
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
            Row(
              children: [
                Icon(icone, size: 12, color: cor),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    rotulo.toUpperCase(),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        color: Color(0xFF525252), fontSize: 8.5, letterSpacing: 0.8),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 7),
            Text(
              valor,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: cor, fontSize: 15, fontWeight: FontWeight.w600),
            ),
            Text(
              nota,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Color(0xFF6F6F6F), fontSize: 9.5),
            ),
          ],
        ),
      ),
    );
  }
}

/// Contagem de stock: lista de referências com a quantidade desta província.
class _PainelStock extends StatefulWidget {
  const _PainelStock({
    required this.produtos,
    required this.quantidade,
    required this.disponivel,
    required this.aoGravar,
  });

  final List<Map<String, dynamic>> produtos;
  final int? Function(Map<String, dynamic>) quantidade;
  final int? Function(Map<String, dynamic>) disponivel;
  final Future<void> Function(Map<String, dynamic>, int) aoGravar;

  @override
  State<_PainelStock> createState() => _PainelStockState();
}

class _PainelStockState extends State<_PainelStock> {
  final _pesquisa = TextEditingController();
  String _termo = '';
  bool _soBaixo = false;
  String? _aGravar;

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
        title: Text(
          produto['name'] as String? ?? 'Produto',
          style: const TextStyle(fontSize: 15),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Quantidade contada nesta loja. O movimento fica registado no '
              'histórico com o seu nome.',
              style: TextStyle(color: AppConfig.muted, fontSize: 11.5, height: 1.45),
            ),
            const SizedBox(height: 14),
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
    setState(() => _aGravar = produto['id'] as String);
    try {
      await widget.aoGravar(produto, valor);
      if (!mounted) return;
      avisar(context, 'Stock de «${produto['name']}» actualizado para $valor.');
    } catch (e) {
      if (!mounted) return;
      avisar(context, _mensagem(e), erro: true);
    } finally {
      if (mounted) setState(() => _aGravar = null);
    }
  }

  String _mensagem(Object e) {
    final texto = e is PostgrestException ? e.message : '$e';
    if (texto.contains('42501') || texto.toLowerCase().contains('província')) {
      return 'Só pode alterar o stock da sua província.';
    }
    if (texto.contains('PGRST202') || texto.contains('Could not find the function')) {
      return 'Falta aplicar a actualização da base (PATCH_PERFIS_LOJA.sql).';
    }
    return 'Não foi possível gravar o stock.';
  }

  @override
  Widget build(BuildContext context) {
    final lista = widget.produtos.where((p) {
      if (_termo.isNotEmpty) {
        final nome = (p['name'] as String? ?? '').toLowerCase();
        final sku = (p['sku'] as String? ?? '').toLowerCase();
        if (!nome.contains(_termo) && !sku.contains(_termo)) return false;
      }
      if (_soBaixo) {
        final d = widget.disponivel(p);
        if (d == null || d > 5) return false;
      }
      return true;
    }).toList();

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _pesquisa,
                  onChanged: (v) => setState(() => _termo = v.toLowerCase()),
                  style: const TextStyle(color: AppConfig.text, fontSize: 13),
                  decoration: const InputDecoration(
                    hintText: 'Procurar por nome ou referência',
                    prefixIcon: Icon(Icons.search, size: 18),
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              _FiltroStock(
                activo: _soBaixo,
                aoTocar: () => setState(() => _soBaixo = !_soBaixo),
              ),
            ],
          ),
        ),
        Expanded(
          child: lista.isEmpty
              ? const EstadoVazio(
                  icone: Icons.inventory_2_outlined,
                  titulo: 'Sem referências para mostrar.',
                )
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                  itemCount: lista.length,
                  itemBuilder: (_, i) {
                    final p = lista[i];
                    final qtd = widget.quantidade(p);
                    final disp = widget.disponivel(p);
                    final aGravar = _aGravar == p['id'];
                    return Cartao(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
                      aoTocar: aGravar ? null : () => _editar(p),
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
                                  '${p['sku'] ?? '—'} · ${kz(precoEfetivo(p))}',
                                  style: const TextStyle(
                                      color: Color(0xFF525252), fontSize: 10),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              if (aGravar)
                                const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: AppConfig.gold),
                                )
                              else
                                Text(
                                  qtd == null ? 'sem registo' : '$qtd un.',
                                  style: TextStyle(
                                    color: qtd == null
                                        ? AppConfig.muted
                                        : (disp ?? 0) == 0
                                            ? const Color(0xFFF87171)
                                            : AppConfig.goldLight,
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              if (qtd != null && (disp ?? 0) != qtd)
                                Text(
                                  '$disp livres',
                                  style: const TextStyle(
                                      color: Color(0xFF6F6F6F), fontSize: 9.5),
                                ),
                            ],
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

class _FiltroStock extends StatelessWidget {
  const _FiltroStock({required this.activo, required this.aoTocar});

  final bool activo;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: activo ? AppConfig.gold.withValues(alpha: 0.14) : AppConfig.charcoal,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: aoTocar,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: activo ? AppConfig.gold : AppConfig.surface),
          ),
          child: Icon(
            Icons.warning_amber_outlined,
            size: 19,
            color: activo ? AppConfig.gold : AppConfig.muted,
          ),
        ),
      ),
    );
  }
}

/// Balcão: venda presencial com carrinho e recibo.
class _Balcao extends StatefulWidget {
  const _Balcao({
    required this.produtos,
    required this.disponivel,
    required this.provinciaId,
    required this.aoConcluir,
  });

  final List<Map<String, dynamic>> produtos;
  final int? Function(Map<String, dynamic>) disponivel;
  final String? provinciaId;
  final Future<void> Function() aoConcluir;

  @override
  State<_Balcao> createState() => _BalcaoState();
}

class _BalcaoState extends State<_Balcao> {
  final _pesquisa = TextEditingController();
  final _telefone = TextEditingController();
  final _notas = TextEditingController();

  final Map<String, int> _carrinho = {};
  String _pagamento = 'dinheiro';
  String _termo = '';
  bool _aEnviar = false;
  String? _recibo;

  @override
  void dispose() {
    _pesquisa.dispose();
    _telefone.dispose();
    _notas.dispose();
    super.dispose();
  }

  Map<String, dynamic> _produto(String id) => widget.produtos.firstWhere(
        (p) => p['id'] == id,
        orElse: () => <String, dynamic>{'id': id, 'name': 'Produto', 'official_price': 0},
      );

  double get _total => _carrinho.entries.fold<double>(
        0,
        (soma, e) => soma + precoEfetivo(_produto(e.key)).toDouble() * e.value,
      );

  void _adicionar(Map<String, dynamic> produto) {
    final id = produto['id'] as String;
    final disp = widget.disponivel(produto);
    final noCarrinho = _carrinho[id] ?? 0;
    if (disp != null && noCarrinho >= disp) {
      avisar(context, 'Só há $disp unidade(s) desta referência.', erro: true);
      return;
    }
    setState(() => _carrinho[id] = noCarrinho + 1);
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

  Future<void> _finalizar() async {
    if (_carrinho.isEmpty) return;
    setState(() {
      _aEnviar = true;
      _recibo = null;
    });
    try {
      final resposta = await Supabase.instance.client.rpc('registar_venda_loja', params: {
        'p_items': [
          for (final e in _carrinho.entries)
            {'product_id': e.key, 'quantity': e.value}
        ],
        'p_payment_method': _pagamento,
        'p_customer_phone':
            _telefone.text.trim().isEmpty ? null : _telefone.text.trim(),
        'p_notes': _notas.text.trim().isEmpty ? null : _notas.text.trim(),
        'p_client_ref': const Uuid().v4(),
        'p_provincia_id': widget.provinciaId,
        'p_payment_status': 'paid',
      });
      final mapa = Map<String, dynamic>.from(resposta as Map);
      setState(() {
        _recibo = mapa['reference'] as String? ?? '—';
        _carrinho.clear();
        _telefone.clear();
        _notas.clear();
      });
      await widget.aoConcluir();
    } on PostgrestException catch (e) {
      if (!mounted) return;
      avisar(context, e.message, erro: true);
    } catch (_) {
      if (!mounted) return;
      avisar(context, 'Sem ligação. A venda não foi registada.', erro: true);
    } finally {
      if (mounted) setState(() => _aEnviar = false);
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

    if (_recibo != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(26),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.check_circle_outline, size: 54, color: AppConfig.gold),
              const SizedBox(height: 14),
              const Text('Venda registada', style: TextStyle(fontSize: 18)),
              const SizedBox(height: 6),
              Text('Recibo $_recibo',
                  style: const TextStyle(color: AppConfig.gold, fontSize: 14)),
              const SizedBox(height: 6),
              const Text(
                'O stock desta loja já foi actualizado.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppConfig.muted, fontSize: 12),
              ),
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: () => setState(() => _recibo = null),
                child: const Text('Nova venda'),
              ),
            ],
          ),
        ),
      );
    }

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: TextField(
            controller: _pesquisa,
            onChanged: (v) => setState(() => _termo = v.toLowerCase()),
            style: const TextStyle(color: AppConfig.text, fontSize: 13),
            decoration: const InputDecoration(
              hintText: 'Procurar produto para vender',
              prefixIcon: Icon(Icons.search, size: 18),
              isDense: true,
              contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            ),
          ),
        ),
        Expanded(
          flex: 3,
          child: lista.isEmpty
              ? const EstadoVazio(
                  icone: Icons.search_off,
                  titulo: 'Nenhum produto encontrado.',
                )
              : GridView.builder(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    mainAxisExtent: 74,
                  ),
                  itemCount: lista.length,
                  itemBuilder: (_, i) {
                    final p = lista[i];
                    final disp = widget.disponivel(p);
                    final noCarrinho = _carrinho[p['id']] ?? 0;
                    return Material(
                      color: AppConfig.charcoal,
                      borderRadius: BorderRadius.circular(11),
                      child: InkWell(
                        onTap: disp == 0 ? null : () => _adicionar(p),
                        borderRadius: BorderRadius.circular(11),
                        child: Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(11),
                            border: Border.all(
                              color: noCarrinho > 0
                                  ? AppConfig.gold.withValues(alpha: 0.6)
                                  : AppConfig.surface,
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(
                                p['name'] as String? ?? '',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    color: AppConfig.text, fontSize: 11.5, height: 1.25),
                              ),
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      kz(precoEfetivo(p)),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                          color: AppConfig.gold, fontSize: 11.5),
                                    ),
                                  ),
                                  Text(
                                    disp == null ? '—' : '$disp',
                                    style: TextStyle(
                                      color: disp == 0
                                          ? const Color(0xFFF87171)
                                          : const Color(0xFF6F6F6F),
                                      fontSize: 10,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
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
              if (_carrinho.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    'Toque num produto para começar a venda.',
                    style: TextStyle(color: AppConfig.muted, fontSize: 11.5),
                  ),
                )
              else ...[
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 132),
                  child: ListView(
                    shrinkWrap: true,
                    children: [
                      for (final e in _carrinho.entries)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  '${e.value}× ${_produto(e.key)['name']}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      color: Color(0xFFD4D4D4), fontSize: 11.5),
                                ),
                              ),
                              IconButton(
                                visualDensity: VisualDensity.compact,
                                icon: const Icon(Icons.remove_circle_outline, size: 17),
                                onPressed: () => _menos(e.key),
                              ),
                              Text('${e.value}',
                                  style: const TextStyle(fontSize: 11.5)),
                              IconButton(
                                visualDensity: VisualDensity.compact,
                                icon: const Icon(Icons.add_circle_outline, size: 17),
                                onPressed: () => _adicionar(_produto(e.key)),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        value: _pagamento,
                        isDense: true,
                        style: const TextStyle(color: AppConfig.text, fontSize: 12),
                        decoration: const InputDecoration(
                          labelText: 'Pagamento',
                          isDense: true,
                          contentPadding:
                              EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                        ),
                        items: const [
                          DropdownMenuItem(value: 'dinheiro', child: Text('Dinheiro')),
                          DropdownMenuItem(
                              value: 'transferencia', child: Text('Transferência')),
                          DropdownMenuItem(
                              value: 'multicaixa', child: Text('Multicaixa')),
                        ],
                        onChanged: (v) => setState(() => _pagamento = v ?? 'dinheiro'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: _telefone,
                        keyboardType: TextInputType.phone,
                        style: const TextStyle(color: AppConfig.text, fontSize: 12),
                        decoration: const InputDecoration(
                          labelText: 'Telefone (opcional)',
                          isDense: true,
                          contentPadding:
                              EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    const Text('Total', style: TextStyle(color: AppConfig.muted, fontSize: 12)),
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
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _aEnviar ? null : _finalizar,
                    child: Text(_aEnviar ? 'A registar…' : 'Registar venda'),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// Encomendas da província, com mudança de estado.
class _Encomendas extends StatefulWidget {
  const _Encomendas({required this.encomendas, required this.aoMudarEstado});

  final List<Map<String, dynamic>> encomendas;
  final Future<void> Function(Map<String, dynamic>, String) aoMudarEstado;

  @override
  State<_Encomendas> createState() => _EncomendasState();
}

class _EncomendasState extends State<_Encomendas> {
  String _filtro = 'preparar';
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
    final lista = widget.encomendas.where((e) {
      final s = e['status'];
      return switch (_filtro) {
        'preparar' => s != 'ready_pickup' && s != 'in_delivery',
        'prontas' => s == 'ready_pickup',
        'todas' => true,
        _ => true,
      };
    }).toList();

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Row(
            children: [
              for (final f in const [
                ('preparar', 'Por preparar'),
                ('prontas', 'Prontas'),
                ('todas', 'Todas'),
              ])
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: GestureDetector(
                    onTap: () => setState(() => _filtro = f.$1),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                      decoration: BoxDecoration(
                        color: _filtro == f.$1
                            ? AppConfig.gold.withValues(alpha: 0.14)
                            : AppConfig.charcoal,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: _filtro == f.$1 ? AppConfig.gold : AppConfig.surface,
                        ),
                      ),
                      child: Text(
                        f.$2,
                        style: TextStyle(
                          color: _filtro == f.$1 ? AppConfig.gold : AppConfig.muted,
                          fontSize: 11.5,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: lista.isEmpty
              ? const EstadoVazio(
                  icone: Icons.assignment_turned_in_outlined,
                  titulo: 'Sem encomendas neste filtro.',
                )
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                  itemCount: lista.length,
                  itemBuilder: (_, i) {
                    final e = lista[i];
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
                                style: const TextStyle(
                                    color: AppConfig.gold, fontSize: 12.5),
                              ),
                            ],
                          ),
                          const SizedBox(height: 3),
                          Text(
                            '${dataHora(e['created_at'])} · '
                            '${e['delivery_method'] == 'delivery' ? 'entrega' : 'recolha'}'
                            '${(e['contact_phone'] as String?)?.isNotEmpty == true ? ' · ${e['contact_phone']}' : ''}',
                            style: const TextStyle(
                                color: Color(0xFF6F6F6F), fontSize: 10.5),
                          ),
                          const SizedBox(height: 10),
                          if (aMudar)
                            const LinearProgressIndicator(
                                minHeight: 2, color: AppConfig.gold)
                          else
                            DropdownButtonFormField<String>(
                              value: e['status'] as String?,
                              isDense: true,
                              style: const TextStyle(
                                  color: AppConfig.text, fontSize: 12),
                              decoration: const InputDecoration(
                                labelText: 'Estado',
                                isDense: true,
                                contentPadding: EdgeInsets.symmetric(
                                    horizontal: 10, vertical: 10),
                              ),
                              items: [
                                for (final s in _estados)
                                  DropdownMenuItem(value: s.$1, child: Text(s.$2)),
                              ],
                              onChanged: (novo) async {
                                if (novo == null || novo == e['status']) return;
                                setState(() => _aMudar = e['id'] as String);
                                try {
                                  await widget.aoMudarEstado(e, novo);
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
                ),
        ),
      ],
    );
  }
}
