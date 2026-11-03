# Arquitetura INUKA Angola

## Visão geral

Plataforma com duas faces de cliente:
- **Web (Next.js)**: catálogo público, área de cliente, painel de vendedor, dashboard administrativo, PWA.
- **Mobile (Flutter)**: catálogo, vendas offline-first, chat, notificações push.

Backend único via **Supabase**:
- Auth (telefone + senha adaptado)
- PostgreSQL com RLS
- Realtime (chat, notificações)
- Storage (imagens, PDFs)
- Edge Functions (operações privilegiadas)

## Identidade visual

- Cor principal: dourado/ouro champagne (`#C9A962`) do logótipo INUKA.
- Fundo escuro elegante (`#0A0A0A` a `#1A1A1A`).
- Superfícies em carvão (`#262626`).
- Texto claro (`#F5F5F5`).
- Vermelho usado como cor de destaque secundária, não principal.
- Tipografia: Inter (web), SF Pro / Roboto (mobile).

## Perfis

1. Visitante
2. Cliente
3. Vendedor
4. Gerente / Administrador

As permissões são validadas no servidor via RLS e funções de segurança. O perfil nunca é confiado vindo do cliente.

## Módulos

1. Autenticação e perfis
2. Catálogo de produtos
3. Carrinho, encomendas e reservas
4. Gestão comercial (vendedores, vendas, clientes)
5. Chat em tempo real
6. INUKA Connect (publicações)
7. Offline-first e sincronização
8. Dashboard e relatórios
9. Notificações
