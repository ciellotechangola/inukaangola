import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/app_config.dart';
import '../features/auth/login_page.dart';

/// Papel do utilizador, tal como o servidor o entende.
///
/// Os valores correspondem ao enum `user_role` da base de dados. `visitante`
/// não existe no servidor: é o estado de quem abriu a app sem sessão — pode
/// ver o catálogo, mas não compra nem guarda nada.
enum Papel {
  visitante,
  cliente,
  colaborador,
  loja,
  gestor;

  /// Quem trabalha na empresa (colaborador, loja ou gestão).
  bool get eEquipa =>
      this == Papel.colaborador || this == Papel.loja || this == Papel.gestor;

  bool get eGestor => this == Papel.gestor;

  String get rotulo => switch (this) {
        Papel.visitante => 'Visitante',
        Papel.cliente => 'Cliente',
        Papel.colaborador => 'Colaborador',
        Papel.loja => 'Vendedor de loja',
        Papel.gestor => 'Gestor',
      };
}

/// Sessão e perfil do utilizador, num só sítio.
///
/// O perfil é lido uma vez (`my_profile`) e guardado em memória: o menu, o
/// perfil e as áreas de trabalho precisam do papel, e repetir a chamada em
/// cada ecrã tornava a navegação lenta e sujeita a falhas de rede.
class Sessao extends ChangeNotifier {
  Sessao._();

  static final Sessao instance = Sessao._();

  Map<String, dynamic>? _perfil;
  bool _aCarregar = false;
  String? _erro;

  Map<String, dynamic>? get perfil => _perfil;
  bool get aCarregar => _aCarregar;
  String? get erro => _erro;

  /// `auth.uid()` — `null` para visitante.
  String? get uid => Supabase.instance.client.auth.currentUser?.id;

  bool get autenticado => uid != null;

  String? get nome => _perfil?['full_name'] as String?;
  String? get telefone => _perfil?['phone'] as String?;
  String? get referencia => _perfil?['referencia'] as String?;
  String? get provincia => _perfil?['provincia_nome'] as String?;
  String? get avatarUrl => _perfil?['avatar_url'] as String?;

  /// Papel efectivo. Sem sessão é `visitante`; com sessão mas sem perfil
  /// carregado assume `cliente` — o pior que acontece é ver menus a menos,
  /// nunca a mais.
  Papel get papel {
    if (!autenticado) return Papel.visitante;
    final bruto = _perfil?['role']?.toString();
    return switch (bruto) {
      'manager' => Papel.gestor,
      'seller' => Papel.colaborador,
      'store_seller' => Papel.loja,
      'customer' => Papel.cliente,
      _ => Papel.cliente,
    };
  }

  /// Lê o perfil do servidor. Idempotente: chamadas seguidas reaproveitam.
  Future<void> carregar({bool forcar = false}) async {
    if (!autenticado) {
      _perfil = null;
      _erro = null;
      notifyListeners();
      return;
    }
    if (_aCarregar) return;
    if (_perfil != null && !forcar) return;

    _aCarregar = true;
    _erro = null;
    notifyListeners();

    try {
      final dados = await Supabase.instance.client.rpc('my_profile');
      _perfil = dados == null ? null : Map<String, dynamic>.from(dados as Map);
    } on PostgrestException catch (e) {
      _erro = e.message;
    } catch (_) {
      _erro = 'Sem ligação. Não foi possível ler o perfil.';
    } finally {
      _aCarregar = false;
      notifyListeners();
    }
  }

  /// Esquece o perfil (fim de sessão, ou dados que mudaram).
  void limpar() {
    _perfil = null;
    _erro = null;
    notifyListeners();
  }

  /// Garante que há sessão antes de uma acção que a exige.
  ///
  /// Devolve `true` se pode continuar. Se não houver sessão, abre o ecrã de
  /// entrada com o motivo à vista e espera pela resposta — quem entra volta
  /// exactamente ao ponto onde estava, sem perder o carrinho.
  static Future<bool> exigirSessao(
    BuildContext context, {
    String motivo = 'Precisa de entrar na sua conta para continuar.',
  }) async {
    if (Sessao.instance.autenticado) return true;

    final entrou = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => LoginPage(motivo: motivo, podeVoltar: true),
      ),
    );

    if (entrou == true) {
      await Sessao.instance.carregar(forcar: true);
      return true;
    }
    return false;
  }
}

/// Aviso curto e consistente em toda a app.
void avisar(BuildContext context, String texto, {bool erro = false}) {
  avisarEm(ScaffoldMessenger.of(context), texto, erro: erro);
}

/// O mesmo aviso, a partir de um `ScaffoldMessengerState` já guardado.
///
/// Serve os casos em que o aviso é dado depois de uma espera de rede: guardar
/// o mensageiro antes do `await` evita usar um `BuildContext` que pode já não
/// estar montado.
void avisarEm(ScaffoldMessengerState messenger, String texto, {bool erro = false}) {
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(texto),
        backgroundColor: erro ? AppConfig.danger : AppConfig.charcoal,
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 3),
      ),
    );
}
