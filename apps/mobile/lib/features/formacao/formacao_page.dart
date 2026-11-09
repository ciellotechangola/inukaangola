import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/sessao.dart';
import '../../widgets/estado.dart';

/// Formação dos colaboradores.
///
/// Lê os cursos publicados pela gestão (`formacao_cursos`) e o detalhe de cada
/// um (`formacao_curso`), com o progresso de quem está a ver. Marcar uma aula
/// como concluída grava em `training_progress` — o progresso é do utilizador,
/// não do telemóvel.
class FormacaoPage extends StatefulWidget {
  const FormacaoPage({super.key});

  @override
  State<FormacaoPage> createState() => _FormacaoPageState();
}

class _FormacaoPageState extends State<FormacaoPage> {
  List<Map<String, dynamic>> _cursos = [];
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
      final resposta = await Supabase.instance.client
          .rpc('formacao_cursos', params: {'p_categoria': null, 'p_limit': 60});
      if (!mounted) return;
      setState(() {
        _cursos = (resposta as List? ?? [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        _aCarregar = false;
      });
    } on PostgrestException catch (e) {
      if (!mounted) return;
      setState(() {
        _erro = e.message.contains('SEM_PERMISSAO')
            ? 'A formação é para colaboradores da INUKA.'
            : 'Não foi possível carregar a formação.';
        _aCarregar = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _erro = 'Sem ligação. Tente novamente.';
        _aCarregar = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Formação'),
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
              ? EstadoErro(
                  mensagem: _erro!,
                  icone: Icons.lock_outline,
                  aoRepetir: _carregar,
                )
              : _cursos.isEmpty
                  ? const EstadoVazio(
                      icone: Icons.school_outlined,
                      titulo: 'Ainda não há cursos publicados.',
                      detalhe: 'A gestão publica aqui a formação da equipa.',
                    )
                  : RefreshIndicator(
                      color: AppConfig.gold,
                      onRefresh: _carregar,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
                        children: [
                          for (final curso in _cursos) _CartaoCurso(curso: curso),
                        ],
                      ),
                    ),
    );
  }
}

class _CartaoCurso extends StatelessWidget {
  const _CartaoCurso({required this.curso});

  final Map<String, dynamic> curso;

  @override
  Widget build(BuildContext context) {
    final aulas = (curso['aulas'] as num?)?.toInt() ?? 0;
    final feitas = (curso['concluidas'] as num?)?.toInt() ?? 0;
    final progresso = aulas == 0 ? 0.0 : (feitas / aulas).clamp(0.0, 1.0);
    final categoria = curso['categoria'] as String?;
    final nivel = curso['level'] as String?;
    final minutos = (curso['duration_min'] as num?)?.toInt();

    return Cartao(
      aoTocar: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => CursoPage(curso: curso)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  curso['title'] as String? ?? 'Curso',
                  style: const TextStyle(
                    color: AppConfig.text,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (feitas == aulas && aulas > 0)
                const Etiqueta(
                  texto: 'Concluído',
                  cor: AppConfig.success,
                  icone: Icons.check,
                ),
            ],
          ),
          if ((curso['description'] as String?)?.trim().isNotEmpty == true) ...[
            const SizedBox(height: 5),
            Text(
              curso['description'] as String,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: AppConfig.muted, fontSize: 11.5, height: 1.4),
            ),
          ],
          const SizedBox(height: 9),
          Wrap(
            spacing: 6,
            runSpacing: 5,
            children: [
              if (categoria != null) Etiqueta(texto: categoria),
              if (nivel != null) Etiqueta(texto: nivel),
              Etiqueta(texto: '$aulas ${aulas == 1 ? "aula" : "aulas"}'),
              if (minutos != null && minutos > 0) Etiqueta(texto: '$minutos min'),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: progresso,
                    minHeight: 4,
                    backgroundColor: AppConfig.surface,
                    valueColor: const AlwaysStoppedAnimation(AppConfig.gold),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Text(
                '$feitas/$aulas',
                style: const TextStyle(color: AppConfig.muted, fontSize: 10.5),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Um curso aberto: descrição e aulas, com marcação de conclusão.
class CursoPage extends StatefulWidget {
  const CursoPage({super.key, required this.curso});

  final Map<String, dynamic> curso;

  @override
  State<CursoPage> createState() => _CursoPageState();
}

class _CursoPageState extends State<CursoPage> {
  Map<String, dynamic>? _detalhe;
  bool _aCarregar = true;
  String? _erro;
  String? _aGravar;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    try {
      final resposta = await Supabase.instance.client
          .rpc('formacao_curso', params: {'p_id': widget.curso['id']});
      if (!mounted) return;
      setState(() {
        _detalhe = resposta == null ? null : Map<String, dynamic>.from(resposta as Map);
        _aCarregar = false;
      });
    } on PostgrestException catch (e) {
      if (!mounted) return;
      setState(() {
        _erro = e.message.contains('SEM_PERMISSAO')
            ? 'Não tem acesso a este curso.'
            : 'Não foi possível abrir o curso.';
        _aCarregar = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _erro = 'Sem ligação. Tente novamente.';
        _aCarregar = false;
      });
    }
  }

  Future<void> _alternarAula(Map<String, dynamic> aula) async {
    if (!Sessao.instance.autenticado) return;
    final id = aula['id'] as String;
    final concluida = aula['concluida'] == true;
    setState(() => _aGravar = id);
    try {
      await Supabase.instance.client.rpc('formacao_concluir_aula', params: {
        'p_lesson_id': id,
        'p_concluida': !concluida,
      });
      await _carregar();
    } catch (_) {
      if (!mounted) return;
      avisar(context, 'Não foi possível gravar o progresso.', erro: true);
    } finally {
      if (mounted) setState(() => _aGravar = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final curso = _detalhe ?? widget.curso;
    final aulas = (curso['aulas'] as List? ?? [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    final total = (curso['aulas_total'] as num?)?.toInt() ?? aulas.length;
    final feitas = (curso['aulas_feitas'] as num?)?.toInt() ??
        aulas.where((a) => a['concluida'] == true).length;
    final percentagem = (curso['percentagem'] as num?)?.toInt() ??
        (total == 0 ? 0 : ((feitas / total) * 100).round());

    return Scaffold(
      appBar: AppBar(
        title: Text(
          curso['title'] as String? ?? 'Curso',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 15.5),
        ),
      ),
      body: _aCarregar
          ? const EstadoCarregando()
          : _erro != null
              ? EstadoErro(mensagem: _erro!, aoRepetir: _carregar)
              : ListView(
                  padding: const EdgeInsets.fromLTRB(18, 18, 18, 30),
                  children: [
                    if ((curso['description'] as String?)?.trim().isNotEmpty == true)
                      Text(
                        curso['description'] as String,
                        style: const TextStyle(
                            color: Color(0xFFA3A3A3), fontSize: 12.5, height: 1.55),
                      ),
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: LinearProgressIndicator(
                              value: total == 0 ? 0 : feitas / total,
                              minHeight: 5,
                              backgroundColor: AppConfig.surface,
                              valueColor: const AlwaysStoppedAnimation(AppConfig.gold),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Text(
                          '$percentagem%',
                          style: const TextStyle(color: AppConfig.gold, fontSize: 12),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '$feitas de $total aulas concluídas',
                      style: const TextStyle(color: AppConfig.muted, fontSize: 11),
                    ),
                    const SizedBox(height: 20),
                    if (aulas.isEmpty)
                      const EstadoVazio(
                        icone: Icons.menu_book_outlined,
                        titulo: 'Este curso ainda não tem aulas.',
                      )
                    else
                      for (final aula in aulas) _aula(aula),
                  ],
                ),
    );
  }

  Widget _aula(Map<String, dynamic> aula) {
    final concluida = aula['concluida'] == true;
    final aGravar = _aGravar == aula['id'];
    final corpo = aula['body'] as String?;
    final resumo = aula['summary'] as String?;
    final minutos = (aula['duration_min'] as num?)?.toInt();

    return Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              SizedBox(
                width: 26,
                height: 26,
                child: aGravar
                    ? const Padding(
                        padding: EdgeInsets.all(4),
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: AppConfig.gold),
                      )
                    : IconButton(
                        padding: EdgeInsets.zero,
                        iconSize: 22,
                        tooltip: concluida ? 'Marcar como não vista' : 'Marcar como vista',
                        onPressed: () => _alternarAula(aula),
                        icon: Icon(
                          concluida
                              ? Icons.check_circle
                              : Icons.radio_button_unchecked,
                          color: concluida ? AppConfig.success : AppConfig.muted,
                        ),
                      ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  aula['title'] as String? ?? 'Aula',
                  style: TextStyle(
                    color: concluida ? AppConfig.muted : AppConfig.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              if (minutos != null && minutos > 0)
                Text('$minutos min',
                    style: const TextStyle(color: AppConfig.muted, fontSize: 10)),
            ],
          ),
          if ((resumo ?? '').trim().isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              resumo!,
              style: const TextStyle(color: AppConfig.muted, fontSize: 11.5, height: 1.45),
            ),
          ],
          if ((corpo ?? '').trim().isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              corpo!,
              style: const TextStyle(color: Color(0xFFD4D4D4), fontSize: 12, height: 1.55),
            ),
          ],
        ],
      ),
    );
  }
}
