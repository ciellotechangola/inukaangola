import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';

/// «RETIRAR DINHEIRO» na app do colaborador.
///
/// Os números vêm todos de `levantamento_resumo()` — a mesma função que o site
/// usa. O telemóvel não soma comissões: um valor pago a alguém não pode
/// depender do que a app calculou. Aqui só se mostra, se pede e se lê o estado.
class LevantamentosPage extends StatefulWidget {
  const LevantamentosPage({super.key});

  @override
  State<LevantamentosPage> createState() => _LevantamentosPageState();
}

class _LevantamentosPageState extends State<LevantamentosPage> {
  Map<String, dynamic> _resumo = const {};
  List<Map<String, dynamic>> _comissoes = const [];
  List<Map<String, dynamic>> _historico = const [];
  Map<String, dynamic> _recebimento = const {};
  bool _aCarregar = true;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() => _erro = null);
    final cliente = Supabase.instance.client;
    final uid = cliente.auth.currentUser?.id;
    try {
      final resultados = await Future.wait([
        // O id vai explícito: um parâmetro em falta muda a assinatura que o
        // PostgREST procura e devolve PGRST202 em vez do saldo.
        cliente.rpc('levantamento_resumo', params: {'p_seller': uid}),
        cliente.rpc('minhas_comissoes', params: {'p_limite': 200}),
        cliente.rpc('meus_levantamentos', params: {'p_limite': 50}),
        cliente.rpc('dados_recebimento'),
      ]);

      if (!mounted) return;
      setState(() {
        _resumo = _mapa(resultados[0]);
        _comissoes = _lista(resultados[1]);
        _historico = _lista(resultados[2]);
        _recebimento = _mapa(resultados[3]);
        _aCarregar = false;
      });
    } on PostgrestException catch (e) {
      if (!mounted) return;
      setState(() {
        _erro = _traduzir(e.message);
        _aCarregar = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _erro = 'Sem ligação. Não foi possível carregar as comissões.';
        _aCarregar = false;
      });
    }
  }

  /// `PGRST202` quer dizer «falta aplicar a migração» — dizê-lo por palavras.
  String _traduzir(String mensagem) {
    if (mensagem.contains('PGRST202') ||
        mensagem.contains('Could not find the function')) {
      return 'Esta funcionalidade precisa de uma actualização da base de dados '
          'que ainda não foi aplicada.';
    }
    return mensagem;
  }

  static Map<String, dynamic> _mapa(Object? bruto) {
    if (bruto is Map) return Map<String, dynamic>.from(bruto);
    return const {};
  }

  static List<Map<String, dynamic>> _lista(Object? bruto) {
    if (bruto is List) {
      return bruto
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
    }
    return const [];
  }

  double _num(Object? valor) {
    if (valor is num) return valor.toDouble();
    return double.tryParse(valor?.toString() ?? '') ?? 0;
  }

  bool get _habilitado => _resumo['habilitado'] == true;

  double get _disponivel => _num(_resumo['disponivel']);

  /// Pedido ainda a decorrer: o saldo já está preso, não se pede outro.
  Map<String, dynamic>? get _pedidoAberto {
    for (final l in _historico) {
      final estado = l['estado']?.toString();
      if (estado == 'pendente' ||
          estado == 'aprovado' ||
          estado == 'em_processamento') {
        return l;
      }
    }
    return null;
  }

  Future<void> _abrirSaque() async {
    final pedido = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppConfig.charcoal,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (_) => _FormularioSaque(
        disponivel: _disponivel,
        recebimento: _recebimento,
      ),
    );

    if (pedido == true && mounted) {
      await _carregar();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Pedido enviado para a gestão.'),
          backgroundColor: AppConfig.success,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_aCarregar) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator(color: AppConfig.gold)),
      );
    }

    if (_erro != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Retirar dinheiro')),
        body: Center(
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
                    onPressed: _carregar, child: const Text('Tentar novamente')),
              ],
            ),
          ),
        ),
      );
    }

    final vendasPagas = _num(_resumo['vendas_pagas']).toInt();
    final vendasMinimas = _num(_resumo['vendas_minimas']).toInt();
    final faltam = _num(_resumo['vendas_faltam']).toInt();
    final progresso = vendasMinimas <= 0
        ? 1.0
        : (vendasPagas / vendasMinimas).clamp(0.0, 1.0).toDouble();
    final aberto = _pedidoAberto;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Retirar dinheiro'),
        actions: [
          IconButton(onPressed: _carregar, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _carregar,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(14, 16, 14, 40),
          children: [
            const Text(
              'RETIRAR DINHEIRO',
              style: TextStyle(
                color: AppConfig.muted,
                fontSize: 10,
                letterSpacing: 1.6,
              ),
            ),
            const SizedBox(height: 10),

            // ---------------------------------------------------- saldo
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Disponível para levantar',
                        style:
                            TextStyle(color: AppConfig.muted, fontSize: 11)),
                    const SizedBox(height: 4),
                    Text(
                      kz(_disponivel),
                      style: const TextStyle(
                        color: AppConfig.goldLight,
                        fontSize: 28,
                        fontWeight: FontWeight.w300,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _habilitado
                          ? (aberto != null
                              ? '${kz(_num(_resumo['reservado']))} reservado num pedido em curso'
                              : '$vendasPagas produto(s) vendido(s) e pago(s)')
                          : 'Faltam $faltam produto(s) vendido(s) e pago(s) para desbloquear',
                      style: const TextStyle(
                          color: AppConfig.muted, fontSize: 11),
                    ),
                    if (!_habilitado) ...[
                      const SizedBox(height: 10),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(
                          value: progresso,
                          minHeight: 6,
                          backgroundColor: AppConfig.surface,
                          valueColor: const AlwaysStoppedAnimation<Color>(
                              AppConfig.gold),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${(progresso * 100).round()} % · $vendasPagas / $vendasMinimas',
                        style: const TextStyle(
                            color: AppConfig.muted, fontSize: 10),
                      ),
                    ],
                  ],
                ),
              ),
            ),

            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: _Cartao(
                    rotulo: 'Comissões ganhas',
                    valor: kz(_num(_resumo['comissoes_ganhas'])),
                    nota: 'vendas pagas',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _Cartao(
                    rotulo: 'Já levantado',
                    valor: kz(_num(_resumo['total_pago'])),
                    nota: 'pago pela gestão',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            _Cartao(
              rotulo: 'Por confirmar',
              valor: kz(_num(_resumo['comissoes_pendentes'])),
              nota: 'vendas ainda não pagas',
            ),

            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: (_habilitado && _disponivel > 0 && aberto == null)
                    ? _abrirSaque
                    : null,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 15),
                ),
                child: const Text('SACAR',
                    style: TextStyle(
                        fontWeight: FontWeight.w700, letterSpacing: 1.2)),
              ),
            ),
            if (aberto != null) ...[
              const SizedBox(height: 8),
              Text(
                'Tem o pedido ${aberto['referencia'] ?? ''} em curso '
                '(${_rotuloEstado(aberto['estado']?.toString())}). '
                'O saldo fica reservado até à decisão.',
                style: const TextStyle(color: AppConfig.muted, fontSize: 11),
              ),
            ],

            // ------------------------------------------------ histórico
            const SizedBox(height: 24),
            const Text('Histórico de levantamentos',
                style: TextStyle(
                    color: AppConfig.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            if (_historico.isEmpty)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Text('Ainda não pediu nenhum levantamento.',
                      style:
                          TextStyle(color: AppConfig.muted, fontSize: 12)),
                ),
              )
            else
              for (final l in _historico) _LinhaLevantamento(levantamento: l),

            // ------------------------------------------------ comissões
            const SizedBox(height: 24),
            Text('Comissões produto a produto (${_comissoes.length})',
                style: const TextStyle(
                    color: AppConfig.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            if (_comissoes.isEmpty)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Text('Ainda não tem vendas com comissão.',
                      style:
                          TextStyle(color: AppConfig.muted, fontSize: 12)),
                ),
              )
            else
              for (final c in _comissoes) _LinhaComissao(comissao: c),
            const SizedBox(height: 12),
            const Text(
              'Cada produto vendido é uma venda: leva 10 % do valor de cada um, '
              'mesmo quando saem vários na mesma operação. Uma venda cancelada '
              'não gera comissão; uma venda por confirmar fica «por pagar» até a '
              'gestão a marcar como paga.',
              style: TextStyle(color: Color(0xFF525252), fontSize: 10),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- formulário

/// Escolha do método e dos dados de recebimento.
///
/// Devolve `true` ao `Navigator.pop` quando o pedido fica registado — a página
/// que o abriu recarrega os saldos.
class _FormularioSaque extends StatefulWidget {
  const _FormularioSaque({required this.disponivel, required this.recebimento});

  final double disponivel;
  final Map<String, dynamic> recebimento;

  @override
  State<_FormularioSaque> createState() => _FormularioSaqueState();
}

class _FormularioSaqueState extends State<_FormularioSaque> {
  String? _metodo;
  late final TextEditingController _valor;
  final _titular = TextEditingController();
  final _telefone = TextEditingController();
  final _conta = TextEditingController();
  final _banco = TextEditingController();
  final _iban = TextEditingController();
  final _agencia = TextEditingController();
  final _notas = TextEditingController();
  bool _aEnviar = false;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _valor = TextEditingController(
      text: widget.disponivel > 0 ? widget.disponivel.floor().toString() : '',
    );
  }

  @override
  void dispose() {
    _valor.dispose();
    _titular.dispose();
    _telefone.dispose();
    _conta.dispose();
    _banco.dispose();
    _iban.dispose();
    _agencia.dispose();
    _notas.dispose();
    super.dispose();
  }

  /// Preenche o formulário com o que já está guardado no perfil.
  void _escolher(String metodo) {
    final guardados = widget.recebimento[metodo];
    final dados = guardados is Map ? Map<String, dynamic>.from(guardados) : const <String, dynamic>{};

    setState(() {
      _metodo = metodo;
      _erro = null;
      _titular.text = dados['titular']?.toString() ?? '';
      _telefone.text = dados['telefone']?.toString() ?? '';
      _conta.text = dados['conta']?.toString() ?? '';
      _banco.text = dados['banco']?.toString() ?? '';
      _iban.text = dados['iban']?.toString() ?? '';
      _agencia.text = dados['agencia']?.toString() ?? '';
    });
  }

  double _valorPedido() {
    final texto = _valor.text.trim().replaceAll(' ', '').replaceAll(',', '.');
    return double.tryParse(texto) ?? 0;
  }

  Map<String, dynamic> _dadosDoMetodo() {
    final mapa = <String, dynamic>{
      'titular': _titular.text.trim(),
    };
    if (_metodo == 'xpress') {
      mapa['telefone'] = _telefone.text.trim();
      mapa['conta'] = _conta.text.trim();
    } else {
      mapa['banco'] = _banco.text.trim();
      mapa['conta'] = _conta.text.trim();
      mapa['iban'] = _iban.text.trim();
      mapa['agencia'] = _agencia.text.trim();
    }
    mapa.removeWhere((_, v) => v is String && v.isEmpty);
    return mapa;
  }

  String? _validar() {
    if (_metodo == null) return 'Escolha como quer receber.';
    final valor = _valorPedido();
    if (valor <= 0) return 'Indique o valor que quer levantar.';
    if (valor > widget.disponivel) {
      return 'O valor pedido é superior ao disponível (${kz(widget.disponivel)}).';
    }
    if (_titular.text.trim().isEmpty) {
      return 'Indique o nome do titular da conta.';
    }
    if (_metodo == 'xpress') {
      if (_telefone.text.trim().isEmpty && _conta.text.trim().isEmpty) {
        return 'Indique o número XPRESS ou o telefone associado.';
      }
    } else {
      if (_banco.text.trim().isEmpty) return 'Indique o banco.';
      if (_conta.text.trim().isEmpty) return 'Indique o número de conta.';
    }
    return null;
  }

  Future<void> _confirmar() async {
    final problema = _validar();
    if (problema != null) {
      setState(() => _erro = problema);
      return;
    }

    setState(() {
      _aEnviar = true;
      _erro = null;
    });

    try {
      await Supabase.instance.client.rpc('solicitar_levantamento', params: {
        'p_valor': _valorPedido(),
        'p_metodo': _metodo,
        'p_dados': _dadosDoMetodo(),
        'p_notas':
            _notas.text.trim().isEmpty ? null : _notas.text.trim(),
      });
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on PostgrestException catch (e) {
      if (!mounted) return;
      setState(() {
        _erro = e.message;
        _aEnviar = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _erro = 'Sem ligação. O pedido não foi enviado.';
        _aEnviar = false;
      });
    }
  }

  Future<void> _guardarDados() async {
    if (_metodo == null) {
      setState(() => _erro = 'Escolha primeiro o método de recebimento.');
      return;
    }
    if (_titular.text.trim().isEmpty) {
      setState(() => _erro = 'Indique o nome do titular da conta.');
      return;
    }

    setState(() {
      _aEnviar = true;
      _erro = null;
    });

    try {
      await Supabase.instance.client.rpc('guardar_dados_recebimento', params: {
        'p_metodo': _metodo,
        'p_dados': _dadosDoMetodo(),
      });
      if (!mounted) return;
      setState(() => _aEnviar = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Dados guardados. Na próxima vez já aparecem aqui.'),
          backgroundColor: AppConfig.success,
        ),
      );
    } on PostgrestException catch (e) {
      if (!mounted) return;
      setState(() {
        _erro = e.message;
        _aEnviar = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _erro = 'Sem ligação. Os dados não foram guardados.';
        _aEnviar = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final teclado = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + teclado),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _metodo == null
                        ? 'Como quer receber?'
                        : (_metodo == 'xpress'
                            ? 'XPRESS'
                            : 'Transferência bancária'),
                    style: const TextStyle(
                        color: AppConfig.gold,
                        fontSize: 13,
                        letterSpacing: 1.2),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  icon: const Icon(Icons.close, size: 18),
                ),
              ],
            ),

            if (_erro != null) ...[
              Container(
                width: double.infinity,
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppConfig.danger.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                      color: AppConfig.danger.withValues(alpha: 0.4)),
                ),
                child: Text(_erro!,
                    style:
                        const TextStyle(color: Color(0xFFF87171), fontSize: 12)),
              ),
            ],

            if (_metodo == null) ...[
              _OpcaoMetodo(
                titulo: 'XPRESS',
                descricao:
                    'Recebe numa conta XPRESS. Indique o número da conta ou o telefone.',
                onTap: () => _escolher('xpress'),
              ),
              const SizedBox(height: 10),
              _OpcaoMetodo(
                titulo: 'Transferência bancária',
                descricao:
                    'Recebe numa conta bancária. Titular, banco e número de conta.',
                onTap: () => _escolher('transferencia'),
              ),
            ] else ...[
              TextButton.icon(
                onPressed: () => setState(() => _metodo = null),
                icon: const Icon(Icons.arrow_back, size: 14),
                label: const Text('escolher outro método',
                    style: TextStyle(fontSize: 11)),
              ),
              const SizedBox(height: 4),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: _Campo(
                      rotulo: 'Valor a levantar (Kz)',
                      controlador: _valor,
                      teclado: TextInputType.number,
                    ),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton(
                    onPressed: () => setState(() =>
                        _valor.text = widget.disponivel.floor().toString()),
                    child: const Text('Tudo',
                        style: TextStyle(fontSize: 11)),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text('Disponível: ${kz(widget.disponivel)}',
                  style: const TextStyle(
                      color: Color(0xFF525252), fontSize: 10)),
              const SizedBox(height: 12),
              _Campo(rotulo: 'Titular da conta', controlador: _titular),
              const SizedBox(height: 10),
              if (_metodo == 'xpress') ...[
                _Campo(
                    rotulo: 'Telefone XPRESS',
                    controlador: _telefone,
                    teclado: TextInputType.phone),
                const SizedBox(height: 10),
                _Campo(
                    rotulo: 'Número da conta XPRESS (opcional)',
                    controlador: _conta),
              ] else ...[
                _Campo(rotulo: 'Banco', controlador: _banco),
                const SizedBox(height: 10),
                _Campo(rotulo: 'Número de conta', controlador: _conta),
                const SizedBox(height: 10),
                _Campo(rotulo: 'IBAN (opcional)', controlador: _iban),
                const SizedBox(height: 10),
                _Campo(rotulo: 'Agência (opcional)', controlador: _agencia),
              ],
              const SizedBox(height: 10),
              _Campo(
                  rotulo: 'Nota para a gestão (opcional)',
                  controlador: _notas),
              const SizedBox(height: 10),
              const Text(
                'Estes dados ficam guardados no seu perfil e aparecem '
                'preenchidos no próximo pedido. Só a gestão os vê.',
                style: TextStyle(color: Color(0xFF6F6F6F), fontSize: 10),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _aEnviar ? null : _confirmar,
                  style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14)),
                  child: Text(_aEnviar ? 'A enviar…' : 'CONFIRMAR SAQUE',
                      style: const TextStyle(
                          fontWeight: FontWeight.w700, letterSpacing: 1.1)),
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: _aEnviar ? null : _guardarDados,
                  child: const Text('Guardar dados'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ auxiliares

String _rotuloEstado(String? estado) {
  switch (estado) {
    case 'pendente':
      return 'pendente';
    case 'aprovado':
      return 'aprovado';
    case 'em_processamento':
      return 'em processamento';
    case 'pago':
      return 'pago';
    case 'rejeitado':
      return 'rejeitado';
    default:
      return estado ?? '—';
  }
}

Color _corEstado(String? estado) {
  switch (estado) {
    case 'pendente':
      return AppConfig.gold;
    case 'aprovado':
      return AppConfig.goldLight;
    case 'em_processamento':
      return const Color(0xFF7DD3FC);
    case 'pago':
      return AppConfig.success;
    case 'rejeitado':
      return AppConfig.danger;
    default:
      return AppConfig.muted;
  }
}

String _rotuloComissao(String? estado) {
  switch (estado) {
    case 'cancelada':
      return 'Cancelada';
    case 'pendente':
      return 'Por pagar';
    case 'paga':
      return 'Paga';
    case 'disponivel':
      return 'Disponível';
    default:
      return estado ?? '—';
  }
}

Color _corComissao(String? estado) {
  switch (estado) {
    case 'cancelada':
      return const Color(0xFFF87171);
    case 'paga':
      return AppConfig.success;
    case 'disponivel':
      return AppConfig.gold;
    default:
      return AppConfig.muted;
  }
}

class _Cartao extends StatelessWidget {
  const _Cartao({required this.rotulo, required this.valor, this.nota});

  final String rotulo;
  final String valor;
  final String? nota;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(rotulo,
                style: const TextStyle(color: AppConfig.muted, fontSize: 10)),
            const SizedBox(height: 3),
            Text(valor,
                style: const TextStyle(
                    color: AppConfig.gold,
                    fontSize: 14,
                    fontWeight: FontWeight.w600)),
            if (nota != null)
              Text(nota!,
                  style: const TextStyle(
                      color: Color(0xFF525252), fontSize: 9)),
          ],
        ),
      ),
    );
  }
}

class _OpcaoMetodo extends StatelessWidget {
  const _OpcaoMetodo({
    required this.titulo,
    required this.descricao,
    required this.onTap,
  });

  final String titulo;
  final String descricao;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppConfig.dark,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppConfig.surface),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(titulo,
                style: const TextStyle(
                    color: AppConfig.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 3),
            Text(descricao,
                style:
                    const TextStyle(color: AppConfig.muted, fontSize: 11)),
          ],
        ),
      ),
    );
  }
}

class _Campo extends StatelessWidget {
  const _Campo({
    required this.rotulo,
    required this.controlador,
    this.teclado,
  });

  final String rotulo;
  final TextEditingController controlador;
  final TextInputType? teclado;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(rotulo.toUpperCase(),
            style: const TextStyle(
                color: Color(0xFF8A8A8A),
                fontSize: 9,
                letterSpacing: 0.8)),
        const SizedBox(height: 4),
        TextField(
          controller: controlador,
          keyboardType: teclado,
          style: const TextStyle(color: AppConfig.text, fontSize: 13),
          decoration: InputDecoration(
            isDense: true,
            filled: true,
            fillColor: AppConfig.dark,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 10, vertical: 11),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: const BorderSide(color: Color(0xFF404040)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: const BorderSide(color: Color(0xFF404040)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: const BorderSide(color: AppConfig.gold),
            ),
          ),
        ),
      ],
    );
  }
}

class _LinhaLevantamento extends StatelessWidget {
  const _LinhaLevantamento({required this.levantamento});

  final Map<String, dynamic> levantamento;

  @override
  Widget build(BuildContext context) {
    final estado = levantamento['estado']?.toString();
    final metodo = levantamento['metodo']?.toString();
    final motivo = levantamento['motivo']?.toString();
    final valor = (levantamento['valor'] as num?)?.toDouble() ?? 0;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    levantamento['referencia']?.toString() ?? 'Levantamento',
                    style: const TextStyle(
                        color: AppConfig.text,
                        fontSize: 12,
                        fontWeight: FontWeight.w600),
                  ),
                ),
                Text(kz(valor),
                    style: const TextStyle(
                        color: AppConfig.gold,
                        fontSize: 13,
                        fontWeight: FontWeight.w600)),
              ],
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: _corEstado(estado).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                        color: _corEstado(estado).withValues(alpha: 0.45)),
                  ),
                  child: Text(
                    _rotuloEstado(estado).toUpperCase(),
                    style: TextStyle(
                        color: _corEstado(estado),
                        fontSize: 8,
                        letterSpacing: 0.6),
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  metodo == 'transferencia' ? 'Transferência' : 'XPRESS',
                  style:
                      const TextStyle(color: AppConfig.muted, fontSize: 10),
                ),
              ],
            ),
            const SizedBox(height: 3),
            Text(
              'Pedido em ${dataHora(levantamento['solicitado_em'])}'
              '${levantamento['pago_em'] != null ? ' · pago em ${dataHora(levantamento['pago_em'])}' : ''}',
              style: const TextStyle(color: Color(0xFF6F6F6F), fontSize: 10),
            ),
            if (estado == 'rejeitado' && motivo != null && motivo.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Text('Motivo: $motivo',
                    style: const TextStyle(
                        color: Color(0xFFF87171), fontSize: 10)),
              ),
            if (estado == 'pendente')
              const Padding(
                padding: EdgeInsets.only(top: 3),
                child: Text('O valor está reservado e não pode ser pedido outra vez.',
                    style:
                        TextStyle(color: Color(0xFF6F6F6F), fontSize: 10)),
              ),
          ],
        ),
      ),
    );
  }
}

class _LinhaComissao extends StatelessWidget {
  const _LinhaComissao({required this.comissao});

  final Map<String, dynamic> comissao;

  @override
  Widget build(BuildContext context) {
    final estado = comissao['estado']?.toString();
    final total = (comissao['total'] as num?)?.toDouble() ?? 0;
    final valor = (comissao['comissao'] as num?)?.toDouble() ?? 0;
    final taxa = (comissao['taxa'] as num?)?.toDouble() ?? 0;
    final produto = comissao['produto']?.toString() ?? 'Produto';
    final quantidade = (comissao['quantidade'] as num?)?.toInt() ?? 1;

    return Card(
      margin: const EdgeInsets.only(bottom: 6),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // O produto é o que se vendeu; a referência fica em baixo.
                  Text(
                    quantidade > 1 ? '$produto × $quantidade' : produto,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        color: AppConfig.text, fontSize: 11),
                  ),
                  Text(
                    '${comissao['referencia'] ?? '—'} · '
                    '${dataCurta(comissao['criada_em'])} · '
                    '${(taxa * 100).toStringAsFixed(0)} %',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        color: Color(0xFF6F6F6F), fontSize: 9),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(kz(valor),
                    style: const TextStyle(
                        color: AppConfig.gold,
                        fontSize: 12,
                        fontWeight: FontWeight.w600)),
                Text(
                  '${_rotuloComissao(estado)} · ${kz(total)}',
                  style: TextStyle(
                      color: _corComissao(estado), fontSize: 9),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
