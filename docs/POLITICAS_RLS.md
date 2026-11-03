# Políticas de acesso (RLS) — INUKA Angola

Todas as tabelas em `public` têm RLS ativado. Nenhuma tabela é acessível sem política.

## Princípios

1. **Perfil vem do servidor.** `current_user_role()` lê `profiles` com `SECURITY DEFINER`, ignorando RLS, e é a única fonte de verdade. Nunca se confia num papel enviado pelo cliente.
2. **Leitura pública mínima.** Apenas catálogo e publicações com audiência `all` são visíveis a `anon`.
3. **Escrita sempre validada.** RPC `SECURITY DEFINER` valida permissões explicitamente antes de escrever.
4. **Auditoria imutável.** `audit_logs` só permite SELECT a gestores.

## Matriz de acesso

| Tabela | Visitante | Cliente | Vendedor | Gestor |
|---|---|---|---|---|
| `profiles` | — | próprio | próprios clientes | todos |
| `user_roles` | — | próprio | próprio | todos |
| `seller_profiles` | — | — | próprio | todos |
| `categories` | leitura | leitura | leitura | CRUD |
| `products` | ativos | ativos | todos | CRUD |
| `product_images` | ativos | ativos | todos | CRUD |
| `inventory` | — | leitura | leitura | CRUD |
| `inventory_movements` | — | — | leitura | CRUD |
| `favorites` | — | próprios | — | — |
| `carts` / `cart_items` | — | próprios | — | — |
| `orders` | — | próprias | dos seus clientes | todas |
| `order_items` | — | das suas encomendas | dos seus clientes | todas |
| `order_status_history` | — | das suas | dos seus clientes | todas |
| `reservations` | — | próprias | dos seus clientes | todas |
| `sales` | — | — | próprias | todas |
| `sale_items` | — | — | das suas vendas | todas |
| `seller_customers` | — | próprio registo | próprios | todos |
| `discount_requests` | — | próprios | dos seus clientes | todos |
| `conversations` | — | membro | membro | todas |
| `messages` | — | membro | membro | todas |
| `message_attachments` | — | membro | membro | todas |
| `groups` | — | membro | membro | CRUD |
| `posts` | audiência `all` | conforme audiência | conforme audiência | todas |
| `post_comments` | se permitido | se permitido | se permitido | todas |
| `notifications` | — | próprias | próprias | próprias |
| `sync_operations` | — | próprias | próprias | — |
| `audit_logs` | — | — | — | leitura |
| `platform_settings` | — | leitura | leitura | CRUD |

## Proteções contra escalada de privilégios

| Vetor de ataque | Proteção |
|---|---|
| `role: "manager"` nos metadados do registo | `handle_new_user` força sempre `customer` |
| `UPDATE profiles SET role='manager'` no browser | Trigger `prevent_role_escalation` → exceção `42501` |
| `UPDATE profiles SET is_active=false` | Mesmo trigger |
| Enviar preço manipulado na compra | `place_order`/`register_sale` usam o preço da BD |
| Reenviar a mesma venda (fila offline) | `client_ref` único por vendedor → devolve a existente |
| Ler conversa de outra pessoa | `is_conversation_member()` em todas as políticas de chat |
| Ler encomenda de outro cliente | `customer_id = auth.uid()` |
| Ver dados financeiros globais | `dashboard_stats` exige `is_manager()` |
| Aprovar desconto acima do limite | `decide_discount` compara com `max_discount_percent` |
| Escrever em `audit_logs` | Sem política de escrita; apenas trigger |

## Storage

| Bucket | Público | Leitura | Escrita |
|---|---|---|---|
| `product-images` | sim | todos | gestor |
| `avatars` | sim | todos | próprio (`avatars/{uid}/…`) |
| `post-attachments` | sim | todos | gestor |
| `message-attachments` | não | membros da conversa | membros da conversa |

Caminho obrigatório: `message-attachments/{conversation_id}/{ficheiro}` — a política
valida a pasta contra `conversation_members`.

## Notas de implementação

- Funções de verificação: `current_user_role()`, `is_manager()`, `is_seller()`, `is_customer()`, `is_conversation_member(uuid)`, `is_my_customer(uuid)`.
- Todas usam `SECURITY DEFINER` + `SET search_path = public, auth, pg_temp` para evitar sequestro de `search_path` e recursão de RLS.
- `prevent_role_escalation` permite operações sem JWT (`auth.uid() IS NULL`) para que o bootstrap via SQL Editor funcione.
