import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../config/app_config.dart';
import '../../core/sessao.dart';
import '../../widgets/estado.dart';
import '../../widgets/foto_perfil.dart';
import '../auth/login_page.dart';
import '../auth/register_page.dart';
import '../favorites/favorites_page.dart';
import '../formacao/formacao_page.dart';
import '../orders/orders_page.dart';
import '../purchases/purchases_page.dart';
import '../reservas/reservas_page.dart';
import '../settings/servidor_page.dart';

/// Perfil — a porta para a conta e para a área de trabalho de cada perfil.
///
/// Sem sessão mostra o convite a entrar e o que se ganha com isso (sem
/// esconder o catálogo, que continua acessível). Com sessão mostra os dados
/// reais do servidor e só os atalhos que competem ao papel do utilizador.
class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key, this.aoAbrirMensagens, this.aoAbrirArea});

  final VoidCallback? aoAbrirMensagens;
  final VoidCallback? aoAbrirArea;

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  @override
  void initState() {
    super.initState();
    Sessao.instance.addListener(_redesenhar);
    if (Sessao.instance.autenticado) Sessao.instance.carregar();
  }

  @override
  void dispose() {
    Sessao.instance.removeListener(_redesenhar);
    super.dispose();
  }

  void _redesenhar() {
    if (mounted) setState(() {});
  }

  Future<void> _entrar() async {
    final entrou = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => const LoginPage(
          motivo: 'Entre para ver as suas encomendas, reservas e favoritos.',
          podeVoltar: true,
        ),
      ),
    );
    if (entrou == true) await Sessao.instance.carregar(forcar: true);
  }

  Future<void> _criarConta() async {
    final criou = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const RegisterPage()),
    );
    if (criou == true) await Sessao.instance.carregar(forcar: true);
  }

  Future<void> _sair() async {
    final confirmar = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppConfig.charcoal,
        title: const Text('Terminar sessão?', style: TextStyle(fontSize: 17)),
        content: const Text(
          'O carrinho fica guardado neste telemóvel.',
          style: TextStyle(color: AppConfig.muted, fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar', style: TextStyle(color: AppConfig.muted)),
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
    Sessao.instance.limpar();
  }

  @override
  Widget build(BuildContext context) {
    final sessao = Sessao.instance;
    if (!sessao.autenticado) return _ecraVisitante();

    if (sessao.aCarregar && sessao.perfil == null) {
      return const Scaffold(body: EstadoCarregando(mensagem: 'A carregar o perfil…'));
    }

    final p = sessao.perfil ?? const <String, dynamic>{};
    final nome = p['full_name'] as String?;
    final id = p['id'] as String? ?? sessao.uid ?? '';
    final papel = sessao.papel;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Perfil'),
        actions: [
          IconButton(
            tooltip: 'Actualizar',
            onPressed: () => sessao.carregar(forcar: true),
            icon: const Icon(Icons.refresh, size: 20),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppConfig.gold,
        onRefresh: () => sessao.carregar(forcar: true),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 40),
          children: [
            Center(
              child: FotoPerfil(
                userId: id,
                url: p['avatar_url'] as String?,
                nome: nome,
                raio: 42,
                aoMudar: (_) => sessao.carregar(forcar: true),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              nome ?? 'Utilizador',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 20, color: AppConfig.text),
            ),
            const SizedBox(height: 3),
            Text(
              p['phone'] as String? ?? '',
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppConfig.muted, fontSize: 12.5),
            ),
            const SizedBox(height: 10),
            Center(
              child: Wrap(
                spacing: 7,
                runSpacing: 6,
                alignment: WrapAlignment.center,
                children: [
                  Etiqueta(texto: papel.rotulo, cor: AppConfig.gold),
                  if ((p['referencia'] as String?)?.isNotEmpty == true)
                    Etiqueta(texto: p['referencia'] as String),
                  if ((p['provincia_nome'] as String?)?.isNotEmpty == true)
                    Etiqueta(texto: p['provincia_nome'] as String),
                ],
              ),
            ),
            if ((p['neighborhood'] as String?)?.trim().isNotEmpty == true) ...[
              const SizedBox(height: 6),
              Text(
                p['neighborhood'] as String,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppConfig.muted, fontSize: 11.5),
              ),
            ],

            const TituloSeccao('A minha conta'),
            _Item(
              icone: Icons.shopping_bag_outlined,
              titulo: 'Minhas encomendas',
              descricao: 'Estado e histórico das compras no site e na app',
              aoTocar: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const OrdersPage()),
              ),
            ),
            _Item(
              icone: Icons.receipt_long_outlined,
              titulo: 'As minhas compras',
              descricao: 'O que comprou a um colaborador',
              aoTocar: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const PurchasesPage()),
              ),
            ),
            _Item(
              icone: Icons.bookmark_added_outlined,
              titulo: 'Reservas',
              descricao: 'Produtos guardados à espera de stock',
              aoTocar: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ReservasPage()),
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
            if (widget.aoAbrirMensagens != null)
              _Item(
                icone: Icons.chat_bubble_outline,
                titulo: 'Mensagens',
                descricao: 'Conversas com a equipa INUKA',
                aoTocar: widget.aoAbrirMensagens!,
              ),

            if (papel.eEquipa) ...[
              const TituloSeccao('Área de trabalho'),
              if (widget.aoAbrirArea != null)
                _Item(
                  icone: Icons.workspaces_outline,
                  titulo: 'A minha área',
                  descricao: switch (papel) {
                    Papel.gestor => 'Painel, stock e encomendas',
                    Papel.loja => 'Stock da loja, balcão e encomendas',
                    _ => 'Vendas, comissões e meta do mês',
                  },
                  aoTocar: widget.aoAbrirArea!,
                ),
              if (papel == Papel.colaborador || papel == Papel.gestor)
                _Item(
                  icone: Icons.school_outlined,
                  titulo: 'Formação',
                  descricao: 'Cursos e aulas da INUKA',
                  aoTocar: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const FormacaoPage()),
                  ),
                ),
            ],

            const TituloSeccao('Aplicação'),
            _Item(
              icone: Icons.dns_outlined,
              titulo: 'Servidor',
              descricao: 'Endereço usado para criar conta',
              aoTocar: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ServidorPage()),
              ),
            ),
            const SizedBox(height: 22),
            OutlinedButton.icon(
              onPressed: _sair,
              icon: const Icon(Icons.logout, size: 18, color: AppConfig.danger),
              label: const Text('Terminar sessão',
                  style: TextStyle(color: AppConfig.danger)),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: Color(0xFF7F1D1D)),
              ),
            ),
            const SizedBox(height: 22),
            const Center(
              child: Text(
                'INUKA Angola · Always with you',
                style: TextStyle(color: AppConfig.muted, fontSize: 10.5),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Ecrã de quem não tem conta: não é um muro, é um convite.
  Widget _ecraVisitante() {
    return Scaffold(
      appBar: AppBar(title: const Text('Perfil')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(22, 26, 22, 40),
        children: [
          Center(
            child: Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppConfig.gold.withValues(alpha: 0.08),
                border: Border.all(color: AppConfig.gold.withValues(alpha: 0.4)),
              ),
              alignment: Alignment.center,
              child: const Icon(Icons.person_outline, color: AppConfig.gold, size: 30),
            ),
          ),
          const SizedBox(height: 18),
          const Text(
            'Está a ver a loja como visitante',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 18, color: AppConfig.text),
          ),
          const SizedBox(height: 6),
          const Text(
            'Pode explorar o catálogo, ver preços e disponibilidade sem conta. '
            'Para comprar e acompanhar os seus pedidos, entre.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppConfig.muted, fontSize: 12.5, height: 1.5),
          ),
          const SizedBox(height: 24),
          ElevatedButton(onPressed: _entrar, child: const Text('Entrar na minha conta')),
          const SizedBox(height: 10),
          OutlinedButton(onPressed: _criarConta, child: const Text('Criar conta')),
          const SizedBox(height: 28),
          const TituloSeccao('Com conta pode'),
          const _Vantagem(icone: Icons.shopping_bag_outlined, texto: 'Comprar e acompanhar encomendas'),
          const _Vantagem(icone: Icons.bookmark_added_outlined, texto: 'Reservar produtos esgotados'),
          const _Vantagem(icone: Icons.favorite_border, texto: 'Guardar favoritos'),
          const _Vantagem(icone: Icons.newspaper_outlined, texto: 'Reagir e comentar as notícias'),
          const _Vantagem(icone: Icons.chat_bubble_outline, texto: 'Falar em privado com a equipa'),
          const SizedBox(height: 26),
          TextButton.icon(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const ServidorPage()),
            ),
            icon: const Icon(Icons.dns_outlined, size: 15, color: AppConfig.muted),
            label: const Text(
              'Configurar servidor',
              style: TextStyle(color: AppConfig.muted, fontSize: 11.5),
            ),
          ),
        ],
      ),
    );
  }
}

class _Vantagem extends StatelessWidget {
  const _Vantagem({required this.icone, required this.texto});

  final IconData icone;
  final String texto;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          Icon(icone, size: 16, color: AppConfig.gold),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              texto,
              style: const TextStyle(color: Color(0xFFD4D4D4), fontSize: 12.5),
            ),
          ),
        ],
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
    return Cartao(
      padding: EdgeInsets.zero,
      aoTocar: aoTocar,
      child: ListTile(
        dense: true,
        leading: Icon(icone, color: AppConfig.gold, size: 20),
        title: Text(titulo, style: const TextStyle(color: AppConfig.text, fontSize: 13.5)),
        subtitle: descricao == null
            ? null
            : Text(
                descricao!,
                style: const TextStyle(color: AppConfig.muted, fontSize: 11),
              ),
        trailing: const Icon(Icons.chevron_right, color: AppConfig.muted, size: 18),
        onTap: aoTocar,
      ),
    );
  }
}
