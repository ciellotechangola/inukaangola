import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/formato.dart';
import 'levantamentos_page.dart';
import 'registar_venda_page.dart';

/// Painel do colaborador dentro da app.
///
/// Lê `colaborador_painel()` — a mesma função que o site usa. Não recalcular
/// totais no cliente: as comissões são valores pagos a alguém e não podem
/// depender do que o telemóvel somou.
class PainelColaboradorPage extends StatefulWidget {
  const PainelColaboradorPage({super.key});

  @override
  State<PainelColaboradorPage> createState() => _PainelColaboradorPageState();
}

class _PainelColaboradorPageState extends State<PainelColaboradorPage> {
  Map<String, dynamic>? _dados;
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
      final resposta = await Supabase.instance.client.rpc('colaborador_painel');
      if (!mounted) return;
      setState(() {
        _dados = resposta == null ? null : Map<String, dynamic>.from(resposta as Map);
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
        _erro = 'Sem ligação. Não foi possível carregar o painel.';
        _aCarregar = false;
      });
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
        appBar: AppBar(title: const Text('Área de colaborador')),
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
                OutlinedButton(onPressed: _carregar, child: const Text('Tentar novamente')),
              ],
            ),
          ),
        ),
      );
    }

    final identidade = (_dados?['identidade'] as Map?) ?? const {};
    final cartoes = (_dados?['cartoes'] as Map?) ?? const {};
    final historico = (_dados?['historico'] as Map?) ?? const {};
    final alertas = (_dados?['alertas'] as List?) ?? const [];
    final vendas = (historico['vendas'] as List?) ?? const [];

    final metaPct = (cartoes['meta_pct'] as num?)?.toDouble() ?? 0;
    final temMeta = ((cartoes['meta_valor'] as num?)?.toDouble() ?? 0) > 0;
    final posicao = cartoes['posicao'];
    final equipa = cartoes['equipa'];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Área de colaborador'),
        actions: [
          IconButton(onPressed: _carregar, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _carregar,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(14, 16, 14, 40),
          children: [
            Text(
              'ÁREA DE COLABORADOR',
              style: TextStyle(
                color: AppConfig.muted.withValues(alpha: 0.9),
                fontSize: 10,
                letterSpacing: 1.6,
              ),
            ),
            const SizedBox(height: 10),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      identidade['full_name'] as String? ?? '—',
                      style: const TextStyle(fontSize: 18, color: AppConfig.text),
                    ),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: [
                        if (identidade['referencia'] != null)
                          Text(
                            identidade['referencia'] as String,
                            style: const TextStyle(
                              color: AppConfig.gold,
                              fontSize: 12,
                              letterSpacing: 0.6,
                            ),
                          ),
                        if (identidade['provincia_nome'] != null)
                          Text(
                            '· ${identidade['provincia_nome']}',
                            style: const TextStyle(color: AppConfig.muted, fontSize: 12),
                          ),
                      ],
                    ),
                    if (identidade['job_title'] != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        identidade['job_title'] as String,
                        style: const TextStyle(color: AppConfig.muted, fontSize: 12),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            if (alertas.isNotEmpty) ...[
              const SizedBox(height: 10),
              for (final a in alertas)
                Container(
                  margin: const EdgeInsets.only(bottom: 6),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppConfig.gold.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppConfig.gold.withValues(alpha: 0.3)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.notifications_active_outlined,
                          size: 16, color: AppConfig.gold),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          (a as Map)['texto'] as String? ?? '',
                          style: const TextStyle(color: AppConfig.gold, fontSize: 12),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
            const SizedBox(height: 14),
            // A venda é a razão pela qual o colaborador abre a app na rua:
            // fica à cabeça, não escondida num menu.
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const RegistarVendaPage()),
                  );
                  if (mounted) _carregar();
                },
                icon: const Icon(Icons.add_shopping_cart, size: 18),
                label: const Text('Registar venda'),
              ),
            ),
            const SizedBox(height: 8),
            // O dinheiro é a segunda razão para abrir a app: fica ao lado da
            // venda, não escondido num menu.
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute(
                        builder: (_) => const LevantamentosPage()),
                  );
                  if (mounted) _carregar();
                },
                icon: const Icon(Icons.account_balance_wallet_outlined,
                    size: 18),
                label: const Text('Retirar dinheiro'),
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: _Cartao(
                    rotulo: 'Vendas do mês',
                    valor: kz(cartoes['vendas_valor'] as num?),
                    nota: '${cartoes['vendas_count'] ?? 0} venda(s)',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _Cartao(
                    rotulo: 'Comissão por receber',
                    valor: kz(cartoes['comissao_pendente'] as num?),
                    nota: 'paga: ${kz(cartoes['comissao_paga'] as num?)}',
                    dourado: true,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: _Cartao(
                    rotulo: 'Clientes',
                    valor: '${cartoes['clientes_total'] ?? 0}',
                    nota: '${cartoes['clientes_ativos'] ?? 0} ativo(s)',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _Cartao(
                    rotulo: 'Posição na equipa',
                    valor: posicao == null ? '—' : '$posicao.º',
                    nota: equipa == null ? 'sem ranking' : 'de $equipa',
                  ),
                ),
              ],
            ),
            if (temMeta) ...[
              const SizedBox(height: 14),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Text('Meta do mês',
                              style: TextStyle(color: AppConfig.muted, fontSize: 12)),
                          const Spacer(),
                          Text(
                            '${metaPct.toStringAsFixed(metaPct % 1 == 0 ? 0 : 1)}%',
                            style: const TextStyle(color: AppConfig.gold, fontSize: 13),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: LinearProgressIndicator(
                          value: (metaPct / 100).clamp(0, 1).toDouble(),
                          minHeight: 8,
                          backgroundColor: AppConfig.surface,
                          valueColor:
                              const AlwaysStoppedAnimation<Color>(AppConfig.gold),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '${kz(cartoes['vendas_valor'] as num?)} de '
                        '${kz(cartoes['meta_valor'] as num?)}',
                        style: const TextStyle(color: AppConfig.muted, fontSize: 11),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: 20),
            const Text(
              'ÚLTIMAS VENDAS',
              style: TextStyle(color: AppConfig.muted, fontSize: 10, letterSpacing: 1.6),
            ),
            const SizedBox(height: 8),
            if (vendas.isEmpty)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Text('Ainda não há vendas registadas.',
                      style: TextStyle(color: AppConfig.muted, fontSize: 12)),
                ),
              )
            else
              Card(
                child: Column(
                  children: [
                    for (var i = 0; i < vendas.length; i++) ...[
                      if (i > 0) const Divider(height: 1, color: AppConfig.surface),
                      ListTile(
                        dense: true,
                        title: Text(
                          (vendas[i] as Map)['reference'] as String? ?? '—',
                          style: const TextStyle(color: AppConfig.text, fontSize: 13),
                        ),
                        subtitle: Text(
                          dataCurta((vendas[i] as Map)['created_at']),
                          style: const TextStyle(color: AppConfig.muted, fontSize: 11),
                        ),
                        trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              kz((vendas[i] as Map)['total_amount'] as num?),
                              style: const TextStyle(color: AppConfig.text, fontSize: 13),
                            ),
                            if (((vendas[i] as Map)['comissao'] as num?) != null &&
                                ((vendas[i] as Map)['comissao'] as num) > 0)
                              Text(
                                'com. ${kz((vendas[i] as Map)['comissao'] as num?)}',
                                style: const TextStyle(
                                    color: AppConfig.gold, fontSize: 10),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Cartao extends StatelessWidget {
  const _Cartao({
    required this.rotulo,
    required this.valor,
    this.nota,
    this.dourado = false,
  });

  final String rotulo;
  final String valor;
  final String? nota;
  final bool dourado;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              rotulo.toUpperCase(),
              style: const TextStyle(
                color: AppConfig.muted,
                fontSize: 9,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              valor,
              style: TextStyle(
                color: dourado ? AppConfig.gold : AppConfig.text,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (nota != null) ...[
              const SizedBox(height: 2),
              Text(nota!, style: const TextStyle(color: AppConfig.muted, fontSize: 10)),
            ],
          ],
        ),
      ),
    );
  }
}
