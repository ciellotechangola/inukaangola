import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';

/// Levantamentos vistos pela gestão, dentro da app.
///
/// Lê `levantamentos_equipa()` — a base já filtra pela província que a pessoa
/// gere, por isso aqui não se repete a regra. Aprovar **não** paga: só
/// «Marcar como pago» mexe no dinheiro e fecha as comissões.
class LevantamentosGestorTab extends StatefulWidget {
  const LevantamentosGestorTab({super.key});

  @override
  State<LevantamentosGestorTab> createState() => _LevantamentosGestorTabState();
}

class _LevantamentosGestorTabState extends State<LevantamentosGestorTab> {
  List<Map<String, dynamic>> _pedidos = const [];
  String _filtro = 'todos';
  bool _aCarregar = true;
  String? _erro;
  String? _aDecidir;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _aCarregar = true;
      _erro = null;
    });

    try {
      final resposta = await Supabase.instance.client.rpc(
        'levantamentos_equipa',
        params: {'p_estado': _filtro == 'todos' ? null : _filtro},
      );

      if (!mounted) return;
      setState(() {
        _pedidos = resposta is List
            ? resposta
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : const [];
        _aCarregar = false;
      });
    } on PostgrestException catch (e) {
      if (!mounted) return;
      setState(() {
        _erro = e.message.contains('PGRST202')
            ? 'Falta aplicar a migração dos levantamentos na base de dados.'
            : e.message;
        _aCarregar = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _erro = 'Sem ligação. Não foi possível carregar os pedidos.';
        _aCarregar = false;
      });
    }
  }

  List<String> _accoes(String estado) {
    switch (estado) {
      case 'pendente':
        return ['aprovado', 'rejeitado'];
      case 'aprovado':
        return ['em_processamento', 'rejeitado'];
      case 'em_processamento':
        return ['pago', 'rejeitado'];
      default:
        return const [];
    }
  }

  String _rotuloAccao(String estado) {
    switch (estado) {
      case 'aprovado':
        return 'Aprovar';
      case 'em_processamento':
        return 'Em processamento';
      case 'pago':
        return 'Marcar como pago';
      case 'rejeitado':
        return 'Rejeitar';
      default:
        return estado;
    }
  }

  Future<void> _decidir(Map<String, dynamic> pedido, String estado) async {
    final valor = (pedido['valor'] as num?)?.toDouble() ?? 0;
    String? nota;

    if (estado == 'rejeitado') {
      nota = await _pedirMotivo();
      if (nota == null) return; // cancelou
      if (nota.trim().isEmpty) return;
      // O diálogo é assíncrono: sem esta guarda, o `context` podia já não
      // existir quando o segundo diálogo abre.
      if (!mounted) return;
    }

    if (estado == 'pago') {
      final confirmar = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: AppConfig.charcoal,
          title: const Text('Marcar como pago'),
          content: Text(
            'Confirma que ${kz(valor)} já saíram para '
            '${pedido['seller_nome'] ?? 'o colaborador'}?\n\n'
            'Esta acção fecha as comissões e não se desfaz.',
            style: const TextStyle(color: AppConfig.muted, fontSize: 13),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancelar')),
            ElevatedButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Confirmar')),
          ],
        ),
      );
      if (confirmar != true) return;
    }

    setState(() => _aDecidir = pedido['id']?.toString());

    try {
      await Supabase.instance.client.rpc('decidir_levantamento', params: {
        'p_id': pedido['id'],
        'p_estado': estado,
        'p_nota': (nota == null || nota.trim().isEmpty) ? null : nota.trim(),
      });
      if (!mounted) return;
      setState(() => _aDecidir = null);
      await _carregar();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(estado == 'pago'
              ? 'Pedido marcado como pago.'
              : 'Pedido actualizado para ${_rotuloEstado(estado)}.'),
          backgroundColor: AppConfig.success,
        ),
      );
    } on PostgrestException catch (e) {
      if (!mounted) return;
      setState(() => _aDecidir = null);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message), backgroundColor: AppConfig.danger),
      );
    } catch (_) {
      if (!mounted) return;
      setState(() => _aDecidir = null);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Sem ligação. A decisão não foi registada.'),
            backgroundColor: AppConfig.danger),
      );
    }
  }

  Future<String?> _pedirMotivo() async {
    final controlador = TextEditingController();
    final resultado = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppConfig.charcoal,
        title: const Text('Motivo da rejeição'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'O colaborador vai ler isto. O valor reservado volta ao saldo.',
              style: TextStyle(color: AppConfig.muted, fontSize: 11),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: controlador,
              autofocus: true,
              style: const TextStyle(color: AppConfig.text, fontSize: 13),
              decoration: const InputDecoration(
                hintText: 'Ex.: dados bancários incompletos',
                hintStyle: TextStyle(color: Color(0xFF525252), fontSize: 12),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppConfig.danger),
            onPressed: () => Navigator.pop(ctx, controlador.text),
            child: const Text('Rejeitar'),
          ),
        ],
      ),
    );
    return resultado;
  }

  @override
  Widget build(BuildContext context) {
    if (_aCarregar) {
      return const Center(
          child: CircularProgressIndicator(color: AppConfig.gold));
    }

    if (_erro != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.wifi_off, size: 40, color: AppConfig.muted),
              const SizedBox(height: 10),
              Text(_erro!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppConfig.muted, fontSize: 12)),
              const SizedBox(height: 14),
              OutlinedButton(
                  onPressed: _carregar, child: const Text('Tentar novamente')),
            ],
          ),
        ),
      );
    }

    const filtros = <String, String>{
      'todos': 'Todos',
      'pendente': 'Pendentes',
      'aprovado': 'Aprovados',
      'em_processamento': 'Em processamento',
      'pago': 'Pagos',
      'rejeitado': 'Rejeitados',
    };

    return RefreshIndicator(
      color: AppConfig.gold,
      onRefresh: _carregar,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 30),
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final f in filtros.entries) ...[
                  ChoiceChip(
                    label: Text(f.value,
                        style: const TextStyle(fontSize: 11)),
                    selected: _filtro == f.key,
                    onSelected: (_) {
                      setState(() => _filtro = f.key);
                      _carregar();
                    },
                    selectedColor: AppConfig.gold.withValues(alpha: 0.18),
                    backgroundColor: AppConfig.charcoal,
                    labelStyle: TextStyle(
                        color: _filtro == f.key
                            ? AppConfig.gold
                            : AppConfig.muted),
                    side: BorderSide(
                        color: _filtro == f.key
                            ? AppConfig.gold
                            : const Color(0xFF333333)),
                  ),
                  const SizedBox(width: 6),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (_pedidos.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Text('Nenhum pedido neste estado.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppConfig.muted, fontSize: 12)),
              ),
            )
          else
            for (final p in _pedidos) _cartao(p),
        ],
      ),
    );
  }

  Widget _cartao(Map<String, dynamic> p) {
    final estado = p['estado']?.toString() ?? 'pendente';
    final valor = (p['valor'] as num?)?.toDouble() ?? 0;
    final metodo = p['metodo']?.toString();
    final dados = p['dados'] is Map
        ? Map<String, dynamic>.from(p['dados'] as Map)
        : const <String, dynamic>{};
    final accoes = _accoes(estado);
    final ocupado = _aDecidir == p['id']?.toString();

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(13),
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
                      Text(p['seller_nome']?.toString() ?? 'Colaborador',
                          style: const TextStyle(
                              color: AppConfig.text,
                              fontSize: 13,
                              fontWeight: FontWeight.w600)),
                      Text(
                        '${p['seller_ref'] ?? ''} · ${p['seller_phone'] ?? 'sem telefone'}'
                        '${p['provincia'] != null ? ' · ${p['provincia']}' : ''}',
                        style: const TextStyle(
                            color: AppConfig.muted, fontSize: 10),
                      ),
                      Text(
                        'Pedido em ${dataHora(p['solicitado_em'])}',
                        style: const TextStyle(
                            color: Color(0xFF6F6F6F), fontSize: 9),
                      ),
                    ],
                  ),
                ),
                Text(kz(valor),
                    style: const TextStyle(
                        color: AppConfig.gold,
                        fontSize: 15,
                        fontWeight: FontWeight.w600)),
              ],
            ),
            const SizedBox(height: 8),
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
                  child: Text(_rotuloEstado(estado).toUpperCase(),
                      style: TextStyle(
                          color: _corEstado(estado),
                          fontSize: 8,
                          letterSpacing: 0.6)),
                ),
                const SizedBox(width: 6),
                Text(metodo == 'transferencia' ? 'Transferência' : 'XPRESS',
                    style: const TextStyle(
                        color: AppConfig.muted, fontSize: 10)),
                if (p['referencia'] != null) ...[
                  const SizedBox(width: 6),
                  Text('· ${p['referencia']}',
                      style: const TextStyle(
                          color: Color(0xFF6F6F6F), fontSize: 10)),
                ],
              ],
            ),
            const SizedBox(height: 8),

            // Para onde vai o dinheiro — a gestão precisa disto antes de pagar.
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(9),
              decoration: BoxDecoration(
                color: AppConfig.dark,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFF262626)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('DADOS DE RECEBIMENTO',
                      style: TextStyle(
                          color: Color(0xFF525252),
                          fontSize: 8,
                          letterSpacing: 0.8)),
                  const SizedBox(height: 3),
                  if (dados.isEmpty)
                    const Text('Sem dados',
                        style: TextStyle(
                            color: AppConfig.muted, fontSize: 11))
                  else
                    for (final campo in dados.entries)
                      Text(
                        '${campo.key[0].toUpperCase()}${campo.key.substring(1)}: ${campo.value}',
                        style: const TextStyle(
                            color: Color(0xFFD4D4D4), fontSize: 11),
                      ),
                  if (p['notas'] != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text('Nota: ${p['notas']}',
                          style: const TextStyle(
                              color: AppConfig.muted, fontSize: 10)),
                    ),
                  if (estado == 'rejeitado' && p['motivo'] != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text('Motivo: ${p['motivo']}',
                          style: const TextStyle(
                              color: Color(0xFFF87171), fontSize: 10)),
                    ),
                ],
              ),
            ),

            if (accoes.isNotEmpty) ...[
              const SizedBox(height: 9),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final a in accoes)
                    if (a == 'rejeitado')
                      OutlinedButton(
                        onPressed: ocupado ? null : () => _decidir(p, a),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppConfig.danger,
                          side: const BorderSide(color: Color(0xFF4A2020)),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 4),
                          minimumSize: Size.zero,
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        child: const Text('Rejeitar',
                            style: TextStyle(fontSize: 11)),
                      )
                    else
                      ElevatedButton(
                        onPressed: ocupado ? null : () => _decidir(p, a),
                        style: ElevatedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 4),
                          minimumSize: Size.zero,
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        child: Text(ocupado ? '…' : _rotuloAccao(a),
                            style: const TextStyle(fontSize: 11)),
                      ),
                ],
              ),
            ],

            if (estado == 'pago')
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text(
                  'Pago — pedido fechado. O histórico do colaborador já '
                  'reflecte este valor.',
                  style: TextStyle(color: AppConfig.success, fontSize: 10),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

String _rotuloEstado(String estado) {
  switch (estado) {
    case 'pendente':
      return 'Pendente';
    case 'aprovado':
      return 'Aprovado';
    case 'em_processamento':
      return 'Em processamento';
    case 'pago':
      return 'Pago';
    case 'rejeitado':
      return 'Rejeitado';
    default:
      return estado;
  }
}

Color _corEstado(String estado) {
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
