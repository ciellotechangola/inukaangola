import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/app_config.dart';
import '../features/cart/cart_page.dart';
import '../features/cart/cart_store.dart';
import '../features/catalog/catalog_page.dart';
import '../features/chat/conversations_page.dart';
import '../features/feed/feed_page.dart';
import '../features/gestor/gestor_page.dart';
import '../features/loja/loja_page.dart';
import '../features/profile/profile_page.dart';
import '../features/vendedor/painel_page.dart';
import 'sessao.dart';

class InukaApp extends StatelessWidget {
  const InukaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: AppConfig.dark,
        colorScheme: const ColorScheme.dark(
          primary: AppConfig.gold,
          onPrimary: AppConfig.dark,
          secondary: AppConfig.goldLight,
          surface: AppConfig.charcoal,
          onSurface: AppConfig.text,
          error: AppConfig.danger,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: AppConfig.dark,
          foregroundColor: AppConfig.text,
          elevation: 0,
          centerTitle: false,
          titleTextStyle: TextStyle(
            color: AppConfig.text,
            fontSize: 17,
            fontWeight: FontWeight.w400,
            letterSpacing: 0.2,
          ),
        ),
        cardColor: AppConfig.charcoal,
        dividerColor: AppConfig.surface,
        bottomNavigationBarTheme: const BottomNavigationBarThemeData(
          backgroundColor: AppConfig.charcoal,
          selectedItemColor: AppConfig.gold,
          unselectedItemColor: AppConfig.muted,
          type: BottomNavigationBarType.fixed,
          showUnselectedLabels: true,
          elevation: 0,
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: AppConfig.gold,
            foregroundColor: AppConfig.dark,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
            textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            foregroundColor: AppConfig.text,
            side: const BorderSide(color: Color(0xFF3A3A3A)),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
            textStyle: const TextStyle(fontSize: 14),
          ),
        ),
        textButtonTheme: TextButtonThemeData(
          style: TextButton.styleFrom(foregroundColor: AppConfig.gold),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: const Color(0xFF121212),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: AppConfig.surface),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: AppConfig.surface),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: AppConfig.gold),
          ),
          labelStyle: const TextStyle(color: AppConfig.muted, fontSize: 13),
          hintStyle: const TextStyle(color: Color(0xFF525252), fontSize: 13),
        ),
        snackBarTheme: const SnackBarThemeData(
          backgroundColor: AppConfig.charcoal,
          contentTextStyle: TextStyle(color: AppConfig.text, fontSize: 13),
          behavior: SnackBarBehavior.floating,
        ),
      ),
      // A app abre no catálogo — com ou sem sessão. É a montra: obrigar a
      // entrar antes de ver um produto afastava quem só quer espreitar.
      home: const RootPage(),
    );
  }
}

/// Raiz: mantém a sessão e o perfil sincronizados com a moldura.
class RootPage extends StatefulWidget {
  const RootPage({super.key});

  @override
  State<RootPage> createState() => _RootPageState();
}

class _RootPageState extends State<RootPage> {
  @override
  void initState() {
    super.initState();
    Sessao.instance.carregar();
    Supabase.instance.client.auth.onAuthStateChange.listen((estado) {
      final evento = estado.event;
      if (evento == AuthChangeEvent.signedIn ||
          evento == AuthChangeEvent.initialSession ||
          evento == AuthChangeEvent.tokenRefreshed) {
        Sessao.instance.carregar(forcar: true);
      } else if (evento == AuthChangeEvent.signedOut) {
        Sessao.instance.limpar();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return const MainShell();
  }
}

/// Moldura da app: menu inferior por perfil.
///
/// Visitante e cliente vêem a loja (catálogo, notícias, carrinho, perfil).
/// Quem trabalha na empresa ganha um separador «Área» com as ferramentas do
/// seu papel — e perde «Notícias», que é conteúdo para clientes.
class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _indice = 0;

  @override
  void initState() {
    super.initState();
    // O carrinho é local: carrega antes de o utilizador chegar ao separador.
    CartStore.instance.carregar();
    Sessao.instance.addListener(_aoMudarSessao);
  }

  @override
  void dispose() {
    Sessao.instance.removeListener(_aoMudarSessao);
    super.dispose();
  }

  void _aoMudarSessao() {
    if (mounted) setState(() {});
  }

  void _irPara(String chave) {
    final lista = _separadores();
    final i = lista.indexWhere((s) => s.chave == chave);
    if (i >= 0 && mounted) setState(() => _indice = i);
  }

  /// Separadores do perfil actual. A ordem é a do menu.
  List<_Separador> _separadores() {
    final papel = Sessao.instance.papel;
    final equipa = papel.eEquipa;

    return [
      _Separador(
        chave: 'catalogo',
        rotulo: 'Catálogo',
        icone: Icons.grid_view_rounded,
        iconeActivo: Icons.grid_view,
        pagina: const CatalogPage(),
      ),
      if (!equipa)
        _Separador(
          chave: 'noticias',
          rotulo: 'Notícias',
          icone: Icons.newspaper_outlined,
          iconeActivo: Icons.newspaper,
          pagina: FeedPage(),
        ),
      if (equipa)
        _Separador(
          chave: 'area',
          rotulo: 'Área',
          icone: Icons.workspaces_outline,
          iconeActivo: Icons.workspaces,
          pagina: switch (papel) {
            Papel.gestor => const GestorPage(),
            Papel.loja => const LojaPage(),
            _ => const PainelColaboradorPage(),
          },
        ),
      _Separador(
        chave: 'carrinho',
        rotulo: 'Carrinho',
        icone: Icons.shopping_bag_outlined,
        iconeActivo: Icons.shopping_bag,
        pagina: CartPage(),
      ),
      if (Sessao.instance.autenticado)
        _Separador(
          chave: 'mensagens',
          rotulo: 'Mensagens',
          icone: Icons.chat_bubble_outline,
          iconeActivo: Icons.chat_bubble,
          pagina: ConversationsPage(),
        ),
      _Separador(
        chave: 'perfil',
        rotulo: 'Perfil',
        icone: Icons.person_outline,
        iconeActivo: Icons.person,
        pagina: ProfilePage(
          aoAbrirMensagens: Sessao.instance.autenticado ? () => _irPara('mensagens') : null,
          aoAbrirArea: equipa ? () => _irPara('area') : null,
        ),
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final lista = _separadores();
    // Sair da conta pode encurtar a lista: sem esta correcção o índice ficava
    // fora dos limites e a app rebentava no IndexedStack.
    final indice = _indice.clamp(0, lista.length - 1);

    return Scaffold(
      body: IndexedStack(
        index: indice,
        children: [for (final s in lista) s.pagina],
      ),
      bottomNavigationBar: AnimatedBuilder(
        animation: CartStore.instance,
        builder: (context, _) {
          final noCarrinho = CartStore.instance.quantidadeTotal;
          return Container(
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: Color(0xFF232323))),
            ),
            child: BottomNavigationBar(
              currentIndex: indice,
              onTap: (i) => setState(() => _indice = i),
              items: [
                for (final s in lista)
                  BottomNavigationBarItem(
                    icon: s.chave == 'carrinho'
                        ? Badge(
                            isLabelVisible: noCarrinho > 0,
                            label: Text('$noCarrinho'),
                            backgroundColor: AppConfig.gold,
                            textColor: AppConfig.dark,
                            child: Icon(s.icone),
                          )
                        : Icon(s.icone),
                    activeIcon: Icon(s.iconeActivo),
                    label: s.rotulo,
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Separador {
  _Separador({
    required this.chave,
    required this.rotulo,
    required this.icone,
    required this.iconeActivo,
    required this.pagina,
  });

  final String chave;
  final String rotulo;
  final IconData icone;
  final IconData iconeActivo;
  final Widget pagina;
}
