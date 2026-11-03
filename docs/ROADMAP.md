# Roadmap INUKA Angola

Legenda: ✅ concluído e verificado · 🟡 parcial · ⬜ não iniciado

## Fase 1 — Auditoria e arquitetura ✅
- [x] Inspecionar workspace
- [x] Monorepo: `apps/web` (Next.js) + `apps/mobile` (Flutter)
- [x] Documentação de arquitetura e identidade visual

## Fase 2 — Base de dados, autenticação e permissões ✅
- [x] `SETUP_COMPLETO.sql` idempotente, pronto a colar no Supabase
- [x] 56 tabelas, 123 políticas RLS, 95 funções, 5 buckets (inclui estúdio de design, províncias, conteúdos e revendedores)
- [x] Base real provisionada (`kvfovbdiaofgtaqopgeh`) com esquema aplicado
- [x] Autenticação por telefone com email interno determinístico
      (`u<telefone>@inuka.ao`)
- [x] Registo server-side via Admin API (`POST /api/auth/registo`) —
      contorna a confirmação por email e a validação de domínio MX
- [x] Login por telefone sem consultar `profiles` (sem fuga de dados)
- [x] Proteção de rotas por papel (`proxy.ts`); `/api/*` excluído de redireccionamento
- [x] Trigger anti-escalada de privilégios
- [x] Primeiro gestor criado e validado

## Fase 3 — Catálogo, favoritos, carrinho, compras e reservas ✅
- [x] Catálogo público com categorias e stock real (11 categorias semeadas)
- [x] Página de produto com preço, disponibilidade e pedido de desconto
- [x] Carrinho persistente (localStorage)
- [x] Checkout → `place_order` com reserva atómica de stock
- [x] Preço sempre do servidor: `unit_price` enviado pelo cliente é ignorado
- [x] Histórico de encomendas do cliente com estados
- [x] Favoritos
- [x] Reservas (RPC `create_reservation` / `cancel_reservation`)

## Fase 4 — Gestão de vendedores, clientes e vendas ✅
- [x] Painel do vendedor com indicadores reais (`seller_stats`)
- [x] Registo de venda com validação de stock e preço no servidor
- [x] Idempotência por `client_ref` (sem duplicar vendas)
- [x] Snapshot do produto na venda
- [x] Associação de clientes por telefone sem duplicação
- [x] Histórico de vendas

## Fase 5 — Chat, anexos e INUKA Connect 🟡
- [x] Chat 1-1 com Realtime e histórico persistente
- [x] Marcação de leitura
- [x] Isolamento verificado: terceiros não leem a conversa
- [x] Políticas de anexos privados no Storage
- [x] Chat no mobile (lista de conversas + envio com Realtime)
- [x] Correção: quem partilha uma conversa passa a ver o nome do interlocutor
      (antes o RLS escondia o perfil e o chat mostrava conversas sem nome)
- [ ] Upload de ficheiros na interface (bucket e políticas prontos)
- [ ] Grupos internos na interface (tabelas e políticas prontos)
- [ ] INUKA Connect na interface (tabelas e políticas prontos)

## Fase 6 — Offline-first e sincronização 🟡
- [x] Carrinho offline no web (localStorage)
- [x] Carrinho offline no mobile (`shared_preferences`) com checkout idempotente
- [x] `sync_push` idempotente no servidor (venda repetida não duplica receita)
- [x] Tabela `sync_operations` com estados e tentativas
- [ ] Fila local persistente no Flutter (SQLite)
- [ ] Indicador de sincronização na interface

## Fase 7 — Dashboard, relatórios e notificações 🟡
- [x] Dashboard da gerência com dados reais (`dashboard_stats`)
- [x] Gestão de produtos e stock
- [x] Gestão de encomendas com mudança de estado e histórico
- [x] Aprovação de descontos com limite configurável
- [x] Correção: limite de desconto calculado sobre o preço atual
      (`PATCH_desconto_promocional.sql`)
- [x] Correção: limite validado já no pedido, não só na decisão
- [x] Notificações geradas por triggers
- [ ] Exportação CSV/PDF
- [ ] Push notifications (requer credenciais FCM/APNs — indisponíveis)

## Fase 8 — Testes, segurança e publicação 🟡
- [x] 103 testes funcionais sobre PostgreSQL real (PGlite)
- [x] 30 testes de aceitação contra o Supabase real
- [x] 112 testes CRUD por perfil contra o Supabase real
- [x] 69 testes E2E do cliente web (sessão real por cookie, RLS, redireccionamentos, estúdio de design, filtros do catálogo, secções de gestão, chat por papel)
- [x] 13 testes do cliente Flutter (contrato de telefone + integração ao vivo)
- [x] Isolamento RLS verificado ao vivo
- [x] Build de produção sem erros (32 rotas)
- [x] Correção de segurança: permissões NULL-safe em encomendas e reservas
- [ ] Deploy (Vercel + Play Store)

## Pendências externas (não resolvíveis por código)

| Item | Bloqueio |
|---|---|
| Push notifications | credenciais FCM/APNs |
| Recuperação de palavra-passe por email | emails são sintéticos; repor via Admin API |
| Produtos reais | preços oficiais da INUKA não são conhecidos |
| Deploy | conta Vercel / Google Play Console |
