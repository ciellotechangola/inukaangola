import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../widgets/foto_perfil.dart';
import '../favorites/favorites_page.dart';
import '../orders/orders_page.dart';
import '../settings/servidor_page.dart';
import '../vendedor/painel_page.dart';

/// Perfil do utilizador autenticado.
///
/// Usa `my_profile()` (RPC) e não uma consulta directa a `profiles`: a função
/// já resolve a província e a referência, e evita depender das políticas de
/// SELECT da tabela para desenhar o próprio ecrã.
class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key, this.aoIrParaSeparador});

  /// Permite ao perfil mandar o utilizador para o separador de mensagens sem
  /// abrir uma segunda cópia do mensageiro por cima do que já está aberto.
  final void Function(int indice)? aoIrParaSeparador;

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  Map<String, dynamic>? _perfil;
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
      final dados = await Supabase.instance.client.rpc('my_profile');
      if (!mounted) return;
      setState(() {
        _perfil = dados == null ? null : Map<String, dynamic>.from(dados as Map);
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
        _erro = 'Sem ligação. Não foi possível carregar o perfil.';
        _aCarregar = false;
      });
    }
  }

  Future<void> _sair() async {
    final confirmar = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppConfig.charcoal,
        title: const Text('Terminar sessão?'),
        content: const Text('O carrinho fica guardado neste telemóvel.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Sair', style: TextStyle(color: AppConfig.danger)),
          ),
        ],
      ),
    );
    if (confirmar != true) return;
    await Supabase.instance.client.auth.signOut();
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
        appBar: AppBar(title: const Text('Perfil')),
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

    final p = _perfil ?? const <String, dynamic>{};
    final nome = p['full_name'] as String?;
    final id = p['id'] as String? ?? Supabase.instance.client.auth.currentUser?.id ?? '';
    final referencia = p['referencia'] as String?;
    final provincia = p['provincia_nome'] as String?;
    final bairro = p['neighborhood'] as String?;
    final eColaborador = p['role'] == 'seller';
    final eGestor = p['role'] == 'manager';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Perfil'),
        actions: [
          IconButton(
            tooltip: 'Actualizar',
            onPressed: _carregar,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _carregar,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 40),
          children: [
            Center(
              child: FotoPerfil(
                userId: id,
                url: p['avatar_url'] as String?,
                nome: nome,
                raio: 44,
                aoMudar: (_) => _carregar(),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              nome ?? 'Utilizador',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 21, color: AppConfig.text),
            ),
            const SizedBox(height: 4),
            Text(
              p['phone'] as String? ?? '',
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppConfig.muted),
            ),
            if (referencia != null || provincia != null) ...[
              const SizedBox(height: 10),
              Center(
                child: Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  alignment: WrapAlignment.center,
                  children: [
                    if (referencia != null) _Etiqueta(texto: referencia, dourada: true),
                    if (provincia != null) _Etiqueta(texto: provincia),
                  ],
                ),
              ),
            ],
            if (bairro != null && bairro.trim().isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                bairro,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppConfig.muted, fontSize: 12),
              ),
            ],
            const SizedBox(height: 28),
            _Seccao(titulo: 'A minha conta'),
            _Item(
              icone: Icons.shopping_bag_outlined,
              titulo: 'Minhas encomendas',
              descricao: 'Estado e histórico',
              aoTocar: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const OrdersPage()),
              ),
            ),
            _Item(
              icone: Icons.favorite_border,
              titulo: 'Favoritos',
              descricao: 'Produtos que guardou',
              aoTocar: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const FavoritesPage()),
              ),
            ),
            _Item(
              icone: Icons.chat_bubble_outline,
              titulo: 'Mensagens',
              descricao: 'Falar com o seu colaborador',
              aoTocar: () => widget.aoIrParaSeparador?.call(2),
            ),
            if (eColaborador) ...[
              const SizedBox(height: 20),
              _Seccao(titulo: 'Área de colaborador'),
              _Item(
                icone: Icons.insights_outlined,
                titulo: 'O meu painel',
                descricao: 'Vendas, comissões e meta do mês',
                aoTocar: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const PainelColaboradorPage()),
                ),
              ),
            ],
            if (eGestor) ...[
              const SizedBox(height: 20),
              _Seccao(titulo: 'Gestão'),
              const Card(
                margin: EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: Icon(Icons.desktop_windows_outlined, color: AppConfig.gold),
                  title: Text('A gestão é feita no site',
                      style: TextStyle(color: AppConfig.text)),
                  subtitle: Text(
                    'Produtos, colaboradores, encomendas e relatórios continuam '
                    'na área de gestão do site — a app é a loja.',
                    style: TextStyle(color: AppConfig.muted, fontSize: 12),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 20),
            _Seccao(titulo: 'Aplicação'),
            _Item(
              icone: Icons.dns_outlined,
              titulo: 'Servidor',
              descricao: 'Endereço usado para criar conta',
              aoTocar: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ServidorPage()),
              ),
            ),
            const SizedBox(height: 28),
            OutlinedButton.icon(
              onPressed: _sair,
              icon: const Icon(Icons.logout, size: 18, color: AppConfig.danger),
              label: const Text('Terminar sessão',
                  style: TextStyle(color: AppConfig.danger)),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: AppConfig.danger),
              ),
            ),
            const SizedBox(height: 24),
            const Center(
              child: Text(
                'INUKA Angola · Always with you',
                style: TextStyle(color: AppConfig.muted, fontSize: 11),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Seccao extends StatelessWidget {
  const _Seccao({required this.titulo});

  final String titulo;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        titulo.toUpperCase(),
        style: const TextStyle(
          color: AppConfig.muted,
          fontSize: 10,
          letterSpacing: 1.6,
        ),
      ),
    );
  }
}

class _Item extends StatelessWidget {
  const _Item({
    required this.icone,
    required this.titulo,
    required this.aoTocar,
    this.descricao,
  });

  final IconData icone;
  final String titulo;
  final String? descricao;
  final VoidCallback aoTocar;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(icone, color: AppConfig.gold),
        title: Text(titulo, style: const TextStyle(color: AppConfig.text)),
        subtitle: descricao == null
            ? null
            : Text(descricao!, style: const TextStyle(color: AppConfig.muted, fontSize: 12)),
        trailing: const Icon(Icons.chevron_right, color: AppConfig.muted),
        onTap: aoTocar,
      ),
    );
  }
}

class _Etiqueta extends StatelessWidget {
  const _Etiqueta({required this.texto, this.dourada = false});

  final String texto;
  final bool dourada;

  @override
  Widget build(BuildContext context) {
    final cor = dourada ? AppConfig.gold : AppConfig.muted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: cor.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: cor.withValues(alpha: 0.4)),
      ),
      child: Text(texto, style: TextStyle(color: cor, fontSize: 11, letterSpacing: 0.6)),
    );
  }
}
