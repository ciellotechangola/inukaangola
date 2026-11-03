# Modelo de Dados — INUKA Angola

## Entidades principais

### Perfis e papéis
- `profiles` — dados do utilizador (nome, telefone, bairro, role)
- `user_roles` — fonte de verdade protegida para papéis
- `seller_profiles` — dados comerciais dos vendedores (comissão, região, gestor)

### Catálogo
- `categories` — categorias de produtos (editáveis pela gerência)
- `products` — catálogo com preço oficial e promocional
- `product_images` — imagens dos produtos (Supabase Storage)
- `inventory` — stock por produto
- `inventory_movements` — histórico de entradas/saídas
- `seller_products` — produtos autorizados por vendedor

### Compras
- `favorites` — favoritos do cliente
- `carts` / `cart_items` — carrinho persistente
- `orders` / `order_items` — encomendas com estados
- `order_status_history` — histórico de estados
- `reservations` / `reservation_items` — reservas com expiração

### Vendas
- `sales` / `sale_items` — vendas registadas pelos vendedores
- `seller_customers` — associação vendedor ↔ cliente
- `discount_requests` — pedidos de desconto com workflow de aprovação

### Comunicação
- `conversations` / `conversation_members` — conversas (direta, grupo, suporte)
- `messages` / `message_attachments` — mensagens com anexos
- `groups` — grupos internos
- `posts` / `post_attachments` / `post_reads` — INUKA Connect

### Sistema
- `notifications` — notificações internas
- `sync_operations` — fila de sincronização offline
- `audit_logs` — registos de auditoria

## Regras de consistência

- Valores monetários: `NUMERIC(12,2)` — nunca floating point.
- Preço e snapshot do produto guardados no momento da venda (`sale_items.product_snapshot`).
- Stock: operações atómicas no servidor via trigger `update_inventory_on_sale`.
- Idempotência: `sync_operations` com `(user_id, local_id, entity)` único.
- Referências únicas: `generate_order_reference()` e `generate_sale_reference()`.
