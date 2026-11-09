import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';
import '../../core/sessao.dart';
import '../../widgets/estado.dart';

/// Reservas do cliente.
///
/// Duas origens com o mesmo nome: as reservas de stock (guardam unidades
/// durante o prazo) e as reservas de produto esgotado (ficam à espera de
/// reposição). A nota escrita na reserva diz qual é qual — não se inventa
/// um estado que a base não tem.
class ReservasPage extends StatefulWidget {
  const ReservasPage({super.key});

  @override
  State<ReservasPage> createState() => _ReservasPageState();
}

class _ReservasPageState extends State<ReservasPage> {
  List<Map<String, dynamic>> _reservas = [];
  bool _aCarregar = true;
  String? _erro;
  String? _aCancelar;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() => _erro = null);
    try {
      final eu = Sessao.instance.uid;
      if (eu == null) {
        setState(() {
          _reservas = [];
          _aCarregar = false;
        });
        return;
      }
      final resposta = await Supabase.instance.client
          .from('reservations')
          .select('id, status, notes, expires_at, created_at, '
              'items:reservation_items(quantity, unit_price, '
              'product:products(name, sku))')
          .eq('customer_id', eu)
          .order('created_at', ascending: false);

      if (!mounted) return;
      setState(() {
        _reservas = (resposta as List)
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
        _erro = 'Sem ligação. Não foi possível carregar as reservas.';
        _aCarregar = false;
      });
    }
  }

  Future<void> _cancelar(Map<String, dynamic> reserva) async {
    final confirmar = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppConfig.charcoal,
        title: const Text('Cancelar reserva?', style: TextStyle(fontSize: 16)),
        content: const Text(
          'As unidades voltam a ficar disponíveis para outros clientes.',
          style: TextStyle(color: AppConfig.muted, fontSize: 12.5),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Não', style: TextStyle(color: AppConfig.muted)),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Cancelar reserva',
                style: TextStyle(color: AppConfig.danger)),
          ),
        ],
      ),
    );
    if (confirmar != true) return;

    setState(() => _aCancelar = reserva['id'] as String);
    try {
      await Supabase.instance.client.rpc(
        'cancel_reservation',
        params: {'p_reservation_id': reserva['id']},
      );
      if (!mounted) return;
      avisar(context, 'Reserva cancelada.');
      await _carregar();
    } catch (_) {
      if (!mounted) return;
      avisar(context, 'Não foi possível cancelar a reserva.', erro: true);
    } finally {
      if (mounted) setState(() => _aCancelar = null);
    }
  }

  static const _estados = {
    'active': ('Ativa', AppConfig.success),
    'expired': ('Expirada', Color(0xFFD9A441)),
    'confirmed': ('Confirmada', Color(0xFF5B9BD5)),
    'cancelled': ('Cancelada', AppConfig.danger),
  };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Reservas'),
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
          : _erro != null
              ? EstadoErro(mensagem: _erro!, aoRepetir: _carregar)
              : _reservas.isEmpty
                  ? const EstadoVazio(
                      icone: Icons.bookmark_border,
                      titulo: 'Ainda não tem reservas.',
                      detalhe:
                          'Pode reservar a partir do catálogo — num produto esgotado, '
                          'deixe o pedido e avisamos quando voltar ao stock.',
                    )
                  : RefreshIndicator(
                      color: AppConfig.gold,
                      onRefresh: _carregar,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
                        children: [
                          const Text(
                            'As reservas guardam unidades durante o prazo indicado. '
                            'As de produtos esgotados ficam registadas à espera de '
                            'reposição — a equipa entra em contacto consigo.',
                            style: TextStyle(
                                color: AppConfig.muted, fontSize: 11.5, height: 1.5),
                          ),
                          const SizedBox(height: 16),
                          for (final r in _reservas) _cartao(r),
                        ],
                      ),
                    ),
    );
  }

  Widget _cartao(Map<String, dynamic> reserva) {
    final estado = _estados[reserva['status']?.toString()] ??
        (reserva['status']?.toString() ?? '—', AppConfig.muted);
    final itens = (reserva['items'] as List? ?? [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    final total = itens.fold<double>(
      0,
      (soma, i) =>
          soma +
          (i['unit_price'] as num? ?? 0).toDouble() * (i['quantity'] as num? ?? 0),
    );
    final notas = reserva['notes'] as String?;
    final activa = reserva['status'] == 'active';
    final aCancelar = _aCancelar == reserva['id'];

    return Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Etiqueta(texto: estado.$1, cor: estado.$2),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Criada em ${dataCurta(reserva['created_at'])}',
                  style: const TextStyle(color: Color(0xFF525252), fontSize: 10.5),
                ),
              ),
              if (activa)
                TextButton(
                  onPressed: aCancelar ? null : () => _cancelar(reserva),
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: const Size(0, 32),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: Text(
                    aCancelar ? 'A cancelar…' : 'Cancelar',
                    style: const TextStyle(color: AppConfig.danger, fontSize: 11.5),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          for (final item in itens)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${item['quantity']}× '
                      '${(item['product'] as Map?)?['name'] ?? 'Produto'}',
                      style: const TextStyle(color: Color(0xFFD4D4D4), fontSize: 12.5),
                    ),
                  ),
                  Text(
                    kz((item['unit_price'] as num? ?? 0) * (item['quantity'] as num? ?? 0)),
                    style: const TextStyle(color: AppConfig.muted, fontSize: 12),
                  ),
                ],
              ),
            ),
          if (notas != null && notas.trim().isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFF141414),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppConfig.surface),
              ),
              child: Text(
                notas,
                style: const TextStyle(
                    color: AppConfig.muted, fontSize: 11, height: 1.45),
              ),
            ),
          ],
          const SizedBox(height: 10),
          const Divider(height: 1, color: AppConfig.surface),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Expira em ${dataHora(reserva['expires_at'])}',
                  style: const TextStyle(color: AppConfig.muted, fontSize: 11),
                ),
              ),
              Text(
                kz(total),
                style: const TextStyle(
                  color: AppConfig.gold,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
