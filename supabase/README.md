# Base de dados — INUKA Angola (Supabase)

## Ficheiro único

**`SETUP_COMPLETO.sql`** — cole tudo no Supabase → SQL Editor → RUN.

É idempotente: pode voltar a executar sem apagar dados nem duplicar objetos.

## Conteúdo

| Parte | Ficheiro fonte | O que faz |
|---|---|---|
| 1 | `migrations/0001_schema.sql` | Extensões, enums, 34 tabelas, índices, triggers |
| 2 | `migrations/0002_rls.sql` | RLS em 34 tabelas, 74 políticas, buckets + políticas de Storage |
| 3 | `migrations/0003_rpc.sql` | 40 funções de negócio, Realtime, permissões de execução |
| 4 | `migrations/0004_designer.sql` | Estúdio de design: 5 tabelas, 10 políticas (+4 Storage), 9 funções, bucket `design-assets` |
| 5 | `migrations/0005_provincias.sql` | Gestão multiprovincial: 2 tabelas, 18 províncias semeadas, 14 funções novas/reescritas, RLS provincial, stock por província, transferências |
| 6 | `migrations/0006_colaboradores.sql` | Identidade e gestão de colaboradores: 4 tabelas, referência com sequência por província, comissões, metas, RLS e 8 RPCs |

O ficheiro único é **gerado** — nunca o edite à mão:

```bash
npm run setup:sql     # concatena migrations/ em SETUP_COMPLETO.sql
```

## Depois de executar

1. **Semear o catálogo**:
   ```bash
   node supabase/seed.mjs          # 11 categorias + 6 produtos [DEMO]
   node supabase/seed.mjs --limpar # remover os produtos [DEMO]
   node supabase/seed-provincias.mjs  # províncias nas contas + stock em Luanda e no Uíge
   ```
2. **Criar o primeiro gestor** (o utilizador já tem de estar registado na app):
   ```sql
   SELECT public.promote_to_manager('+244923000004');
   ```
3. **Promover vendedores**:
   ```sql
   SELECT public.promote_to_seller('+244923000003', 'Luanda');
   ```
4. Copiar `Project URL`, `anon key` e `service_role` para `apps/web/.env.local`.

## Patches

| Ficheiro | Motivo |
|---|---|
| `PATCH_desconto_promocional.sql` | `decide_discount` passou a calcular o limite sobre o preço atual (promocional) em vez do preço oficial. Sem isto, descontos em produtos já em promoção eram recusados indevidamente. |
| `PATCH_2026-10-31_correcoes.sql` | Permissões com `COALESCE` (falha de segurança), estado inicial da encomenda, limite de desconto no pedido, FKs `SET NULL`, `profiles_select` para pares de conversa. |
| `PATCH_designer.sql` | Ativa o estúdio de design numa base já criada. É a migração 0004 isolada. |
| `PATCH_APLICAR_TUDO.sql` | **Recomendado.** Correções de 2026-10-31 + estúdio de design numa só execução. Idempotente. |
| `PATCH_PROVINCIAS.sql` | **Obrigatório para a gestão multiprovincial.** É a migração 0005 isolada: províncias, colunas `provincia_id`, RLS provincial, stock por província e transferências. Sem ele o site mostra o aviso "falta aplicar a migração provincial". |
| `PATCH_COLABORADORES.sql` | **Obrigatório** para referências por província, comissões, metas e perfis de colaborador. É a migração 0006 isolada. |
| `PATCH_CONTEUDOS.sql` | **Obrigatório** para comunicados, testemunhos, promoções e formação INUKA. É a migração 0007 isolada: 10 tabelas, 26 políticas, 11 funções, 6 gatilhos, bucket `content-media` e as 9 categorias de formação. |

### Ordem de aplicação numa base já existente

1. `PATCH_APLICAR_TUDO.sql` (se ainda não estiver aplicado)
2. `PATCH_PROVINCIAS.sql`
3. `PATCH_COLABORADORES.sql`
4. `PATCH_CONTEUDOS.sql`
5. `PATCH_designer.sql` outra vez — acrescenta o gatilho que fecha a escrita do
   estúdio a quem não é gestão (o resto do ficheiro é idempotente)

A migração provincial **não apaga nada**. Os registos antigos ficam atribuídos à
província-sede (`is_default = true`, por omissão **Luanda**). Se a sede for
outra, mude antes de executar:

```sql
UPDATE public.provincias SET is_default = (codigo = 'UIG');
```

Depois, atribua as províncias às pessoas (ecrã **Gestão → Províncias** ou RPC):

```sql
SELECT public.assign_province('<uuid do utilizador>', '<uuid da província>');
```

## Funções RPC usadas pelo frontend

| Função | Quem chama | Efeito |
|---|---|---|
| `place_order(items, method, address, phone, notes, client_ref)` | Cliente | Cria encomenda, reserva stock, valida preços |
| `update_order_status(id, status, notes)` | Gestor / vendedor | Muda estado, converte reserva em saída, notifica |
| `my_orders()` | Cliente | Lista as suas encomendas |
| `create_reservation(items, expires_at, notes)` | Cliente | Reserva stock com expiração |
| `cancel_reservation(id)` | Cliente / gestor | Liberta stock reservado |
| `register_sale(items, customer, method, status, notes, client_ref)` | Vendedor | Venda idempotente, baixa de stock, snapshot do produto |
| `seller_stats(from, to)` | Vendedor | Indicadores do período |
| `link_customer_by_phone(phone)` | Vendedor | Associa cliente sem duplicar |
| `request_discount(product, price, reason)` | Cliente | Pedido de desconto |
| `decide_discount(id, approve, final_price)` | Gestor | Aprova/recusa respeitando limite |
| `get_or_create_direct_conversation(user)` | Cliente / vendedor | Abre chat sem duplicar |
| `mark_conversation_read(id)` | Todos | Marca como lido |
| `set_product_stock(product, qty, reason, provincia_id)` | Gestor | Ajuste de stock **da província** com movimento registado |
| `dashboard_stats(from, to, provincia_id)` | Gestor | Indicadores nacionais ou de uma província |
| `assign_province(user, provincia)` | Gestor | Atribui a província (valida quem atribui) |
| `province_overview()` | Administração nacional | Comparação de stock/vendas/equipas por província |
| `request_stock_transfer(product, from, to, qty, notes)` | Gestor | Pedido de transferência entre províncias |
| `decide_stock_transfer(id, approve)` | Administração nacional | Aprova/recusa e move as quantidades |
| `my_province()` / `is_national()` / `can_see_province()` / `can_manage_province()` | RLS | Identidade provincial usada nas políticas |
| `colaborador_painel(id, from, to)` | Colaborador / gestor | Cartões, séries de 6 meses, histórico e alertas de meta |
| `colaborador_ficha(id)` | Colaborador / gestor | Ficha completa (BI incluído) com verificação de permissão |
| `pesquisar_colaboradores(texto, provincia, municipio, estado, ordem)` | Gestor | Pesquisa por referência, nome, BI ou telefone |
| `colaboradores_overview(from, to)` | Gestor | Totais da rede, análise por província e ranking |
| `definir_meta(seller, provincia, inicio, fim, valor, vendas)` | Gestor | Meta individual ou da província |
| `pagar_comissoes(seller, metodo, notas)` | Gestor | Fecha as comissões pendentes num pagamento |
| `atualizar_perfil_colaborador(id, campos)` | Colaborador / gestor | Campos pessoais (próprio) e profissionais (gestão) |
| `proxima_referencia(provincia)` | Trigger | Próximo `INK-<código>-<número>` da província |
| `sync_push(operations)` | App mobile | Processa fila offline idempotente |
| `expire_reservations()` | Cron | Expira reservas vencidas |

## Segurança aplicada

- `role` nunca vem do cliente: no registo é sempre `customer`; metadados com `role` são ignorados.
- Alterar `role` ou `is_active` sem ser gestor levanta exceção `42501`.
- Operações administrativas diretas (SQL Editor / `service_role`, sem JWT) são permitidas para permitir o bootstrap.
- Funções `SECURITY DEFINER` com `search_path` fixo e validação interna de permissões.
- Preços e stock são sempre recalculados no servidor — o valor enviado pelo cliente é ignorado.
- `sale_items.product_snapshot` guarda nome e preço no momento da venda.
- `audit_logs` só tem política de SELECT para gestores; escrita apenas por trigger.

## Testes

```bash
cd supabase/tests && npm run check      # validação + 225 testes funcionais (PGlite)
node supabase/tests/live.test.mjs       # 30 testes de aceitação contra o Supabase real
```

| Suite | Alvo | Resultado |
|---|---|---|
| `validate.mjs` + `functional.test.mjs` | PostgreSQL em WASM (PGlite) | 225/225 |
| `live.test.mjs` | projeto Supabase real via HTTP | 30 testes |

A suite local corre sobre PGlite (PostgreSQL real em WASM) com stubs de `auth` e
`storage`, por isso não precisa de Docker nem de um projeto Supabase.

A suite ao vivo exercita Auth, PostgREST, RLS e RPC com JWT reais. Requer o
servidor web a correr (usa `POST /api/auth/registo`) e limpa os dados de teste
no início e no fim.
