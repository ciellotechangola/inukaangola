import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config/app_config.dart';
import '../features/auth/login_page.dart';
import '../features/cart/cart_page.dart';
import '../features/cart/cart_store.dart';
import '../features/catalog/catalog_page.dart';
import '../features/feed/feed_page.dart';
import '../features/chat/conversations_page.dart';
import '../features/profile/profile_page.dart';

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
        ),
        cardColor: AppConfig.charcoal,
        dividerColor: AppConfig.surface,
        bottomNavigationBarTheme: const BottomNavigationBarThemeData(
          backgroundColor: AppConfig.charcoal,
          selectedItemColor: AppConfig.gold,
          unselectedItemColor: AppConfig.muted,
          type: BottomNavigationBarType.fixed,
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: AppConfig.gold,
            foregroundColor: AppConfig.dark,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            foregroundColor: AppConfig.text,
            side: const BorderSide(color: AppConfig.surface),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: AppConfig.dark,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: const BorderSide(color: AppConfig.surface),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: const BorderSide(color: AppConfig.gold),
          ),
          labelStyle: const TextStyle(color: AppConfig.muted),
        ),
      ),
      home: const RootPage(),
    );
  }
}

class RootPage extends StatelessWidget {
  const RootPage({super.key});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<AuthState>(
      stream: Supabase.instance.client.auth.onAuthStateChange,
      builder: (context, snapshot) {
        final session = snapshot.hasData ? snapshot.data!.session : null;
        if (session != null) {
          return const MainShell();
        }
        return const LoginPage();
      },
    );
  }
}

class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;

  @override
  void initState() {
    super.initState();
    // O carrinho é local: carrega antes de o utilizador chegar ao separador.
    CartStore.instance.carregar();
  }

  final pages = const [
    CatalogPage(),
    // Notícias fica ao lado do catálogo: é o que o cliente abre depois de ver
    // os produtos. O feed só mostra conteúdo publicado para clientes.
    FeedPage(),
    CartPage(),
    ConversationsPage(),
  ];

  @override
  Widget build(BuildContext context) {
    // O perfil precisa de mudar de separador (o atalho "Mensagens" não deve
    // abrir uma segunda cópia do mensageiro por cima do que já existe), por
    // isso a lista é construída aqui e não como `const`.
    final separadores = <Widget>[
      ...pages,
      ProfilePage(aoIrParaSeparador: (i) => setState(() => _index = i)),
    ];

    return Scaffold(
      body: IndexedStack(index: _index, children: separadores),
      bottomNavigationBar: AnimatedBuilder(
        animation: CartStore.instance,
        builder: (context, _) {
          final noCarrinho = CartStore.instance.quantidadeTotal;
          return BottomNavigationBar(
            currentIndex: _index,
            onTap: (i) => setState(() => _index = i),
            items: [
              const BottomNavigationBarItem(icon: Icon(Icons.grid_view), label: 'Catálogo'),
              const BottomNavigationBarItem(
                icon: Icon(Icons.newspaper_outlined),
                label: 'Notícias',
              ),
              BottomNavigationBarItem(
                icon: Badge(
                  isLabelVisible: noCarrinho > 0,
                  label: Text('$noCarrinho'),
                  backgroundColor: AppConfig.gold,
                  textColor: AppConfig.dark,
                  child: const Icon(Icons.shopping_bag),
                ),
                label: 'Carrinho',
              ),
              const BottomNavigationBarItem(
                icon: Icon(Icons.chat_bubble_outline),
                label: 'Mensagens',
              ),
              const BottomNavigationBarItem(
                icon: Icon(Icons.person_outline),
                label: 'Perfil',
              ),
            ],
          );
        },
      ),
    );
  }
}
