import 'package:flutter/material.dart';

import '../config/app_config.dart';

/// Estados repetidos em toda a app.
///
/// Estavam copiados em cada ecrã — e cada cópia tinha um tamanho de ícone e
/// uma margem diferente, o que fazia a app parecer feita por várias pessoas.
/// Aqui ficam iguais: carregar, falhar, estar vazio.

class EstadoCarregando extends StatelessWidget {
  const EstadoCarregando({super.key, this.mensagem});

  final String? mensagem;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 26,
            height: 26,
            child: CircularProgressIndicator(strokeWidth: 2, color: AppConfig.gold),
          ),
          if (mensagem != null) ...[
            const SizedBox(height: 14),
            Text(
              mensagem!,
              style: const TextStyle(color: AppConfig.muted, fontSize: 12),
            ),
          ],
        ],
      ),
    );
  }
}

class EstadoErro extends StatelessWidget {
  const EstadoErro({
    super.key,
    required this.mensagem,
    this.aoRepetir,
    this.icone = Icons.wifi_off,
  });

  final String mensagem;
  final VoidCallback? aoRepetir;
  final IconData icone;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icone, size: 40, color: AppConfig.muted),
            const SizedBox(height: 14),
            Text(
              mensagem,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppConfig.muted, fontSize: 13, height: 1.45),
            ),
            if (aoRepetir != null) ...[
              const SizedBox(height: 18),
              OutlinedButton(onPressed: aoRepetir, child: const Text('Tentar novamente')),
            ],
          ],
        ),
      ),
    );
  }
}

class EstadoVazio extends StatelessWidget {
  const EstadoVazio({
    super.key,
    required this.titulo,
    this.detalhe,
    this.icone = Icons.inbox_outlined,
    this.acao,
  });

  final String titulo;
  final String? detalhe;
  final IconData icone;
  final Widget? acao;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icone, size: 40, color: AppConfig.muted),
            const SizedBox(height: 14),
            Text(
              titulo,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppConfig.text, fontSize: 14),
            ),
            if (detalhe != null) ...[
              const SizedBox(height: 6),
              Text(
                detalhe!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppConfig.muted, fontSize: 12, height: 1.45),
              ),
            ],
            if (acao != null) ...[const SizedBox(height: 18), acao!],
          ],
        ),
      ),
    );
  }
}

/// Etiqueta pequena e arredondada (referência, província, estado).
class Etiqueta extends StatelessWidget {
  const Etiqueta({
    super.key,
    required this.texto,
    this.cor = AppConfig.muted,
    this.icone,
  });

  final String texto;
  final Color cor;
  final IconData? icone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: cor.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: cor.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icone != null) ...[
            Icon(icone, size: 11, color: cor),
            const SizedBox(width: 4),
          ],
          Text(
            texto,
            style: TextStyle(color: cor, fontSize: 10.5, letterSpacing: 0.3),
          ),
        ],
      ),
    );
  }
}

/// Cabeçalho de secção, no mesmo registo do site (maiúsculas, espaçado).
class TituloSeccao extends StatelessWidget {
  const TituloSeccao(this.texto, {super.key, this.acao});

  final String texto;
  final Widget? acao;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 22, 16, 10),
      child: Row(
        children: [
          Expanded(
            child: Text(
              texto.toUpperCase(),
              style: const TextStyle(
                color: AppConfig.muted,
                fontSize: 10,
                letterSpacing: 1.6,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          if (acao != null) acao!,
        ],
      ),
    );
  }
}

/// Cartão escuro com a moldura fina do site.
class Cartao extends StatelessWidget {
  const Cartao({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(14),
    this.aoTocar,
  });

  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? aoTocar;

  @override
  Widget build(BuildContext context) {
    final conteudo = Padding(padding: padding, child: child);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppConfig.charcoal,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppConfig.surface),
      ),
      clipBehavior: Clip.antiAlias,
      child: aoTocar == null
          ? conteudo
          : Material(
              color: Colors.transparent,
              child: InkWell(onTap: aoTocar, child: conteudo),
            ),
    );
  }
}
