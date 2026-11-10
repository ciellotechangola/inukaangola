-- =============================================================================
--  INUKA ANGOLA — BASE DE DADOS COMPLETA (SUPABASE)
-- =============================================================================
--  COMO USAR
--  1. Abra o Supabase -> SQL Editor -> New query
--  2. Cole TODO este ficheiro
--  3. Clique em RUN
--
--  É idempotente: pode voltar a executar sem apagar dados.
--
--  DEPOIS DE EXECUTAR, crie o primeiro gestor:
--     SELECT public.promote_to_manager('+244 9xx xxx xxx');
--  (o utilizador tem de já estar registado na app)
--
--  CONTEÚDO
--    PARTE 1  ESQUEMA
--    PARTE 2  ROW LEVEL SECURITY
--    PARTE 3  LÓGICA DE NEGÓCIO + REALTIME
--    PARTE 4  DESIGNER (ESTÚDIO DE DESIGN)
--    PARTE 5  GESTÃO MULTIPROVINCIAL
--    PARTE 6  IDENTIDADE E GESTÃO DE COLABORADORES
--    PARTE 7  CONTEÚDOS PUBLICADOS E FORMAÇÃO
--    PARTE 8  TAXA DE COMISSÃO, PEDIDOS E REVENDEDORES
--    PARTE 9  RESERVA DE CLIENTES E COMPRAS DO CLIENTE
--    PARTE 10  TAXA DE ENTREGA
--    PARTE 11  CHAT: CLIENTE FALA COM A GESTÃO, GRUPOS SÓ DA EQUIPA
--    PARTE 12  DISPONIBILIDADE VISÍVEL A QUEM NÃO TEM CONTA
--    PARTE 13  PERFIS: VENDEDOR DE LOJA, ELIMINAÇÃO DE PRODUTOS E FEED
--    PARTE 14  ELIMINAR PRODUTO COM O HISTÓRICO (MODO FORÇADO)
--    PARTE 15  PROMOÇÕES POR PROVÍNCIA, COMISSÕES E LEVANTAMENTOS
--
--  Gerado por supabase/build-setup.mjs — não editar à mão.
--  A fonte são os ficheiros em supabase/migrations/.
-- =============================================================================


-- ###########################################################################
-- ##  PARTE 1 de 15 — ESQUEMA
-- ###########################################################################

-- =============================================================================
-- INUKA ANGOLA — MIGRAÇÃO 1/3 : ESQUEMA
-- Extensões, tipos, funções de segurança, tabelas, índices e triggers base.
-- Executar primeiro.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. TIPOS
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE public.user_role AS ENUM ('visitor', 'customer', 'seller', 'manager');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE public.order_status AS ENUM (
      'pending', 'confirmed', 'preparing', 'ready_pickup', 'in_delivery', 'completed', 'cancelled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reservation_status') THEN
    CREATE TYPE public.reservation_status AS ENUM ('active', 'expired', 'confirmed', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE public.payment_status AS ENUM ('pending', 'partial', 'paid', 'refunded');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'discount_request_status') THEN
    CREATE TYPE public.discount_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_operation_status') THEN
    CREATE TYPE public.sync_operation_status AS ENUM ('pending', 'synced', 'failed', 'conflict');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'post_audience') THEN
    CREATE TYPE public.post_audience AS ENUM ('all', 'sellers', 'customers', 'managers', 'group');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. TABELAS
-- -----------------------------------------------------------------------------

-- 2.1 Perfis
CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        public.user_role NOT NULL DEFAULT 'customer',
  full_name   text NOT NULL,
  phone       text UNIQUE,
  email       text,
  neighborhood text,
  avatar_url  text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_phone_format CHECK (phone IS NULL OR phone ~ '^\+[0-9]{7,15}$'),
  CONSTRAINT profiles_full_name_not_empty CHECK (length(btrim(full_name)) > 0)
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        public.user_role NOT NULL DEFAULT 'customer',
  assigned_by uuid REFERENCES auth.users(id),
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seller_profiles (
  id              uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  code            text UNIQUE,
  region          text,
  commission_rate numeric(5,4) NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 1),
  manager_id      uuid REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 2.2 Catálogo
CREATE TABLE IF NOT EXISTS public.categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  slug        text NOT NULL UNIQUE,
  description text,
  image_url   text,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku               text UNIQUE,
  name              text NOT NULL,
  category_id       uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  description       text,
  official_price    numeric(12,2) NOT NULL CHECK (official_price >= 0),
  promotional_price numeric(12,2) CHECK (promotional_price IS NULL OR promotional_price >= 0),
  is_active         boolean NOT NULL DEFAULT true,
  is_featured       boolean NOT NULL DEFAULT false,
  is_bestseller     boolean NOT NULL DEFAULT false,
  is_new            boolean NOT NULL DEFAULT false,
  commercial_info   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- SET NULL: o produto é um registo de negócio e tem de sobreviver à
  -- remoção da conta que o criou (caso contrário a conta nunca pode ser apagada).
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_name_not_empty CHECK (length(btrim(name)) > 0),
  CONSTRAINT products_promo_lte_official CHECK (
    promotional_price IS NULL OR promotional_price <= official_price
  )
);

CREATE TABLE IF NOT EXISTS public.product_images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  url          text,
  sort_order   int NOT NULL DEFAULT 0,
  is_primary   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  quantity            int NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved_quantity   int NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  low_stock_threshold int NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  warehouse_location  text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_reserved_lte_quantity CHECK (reserved_quantity <= quantity)
);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  type              text NOT NULL CHECK (type IN ('in', 'out', 'adjustment', 'return', 'correction', 'reservation', 'release')),
  quantity          int NOT NULL,
  previous_quantity int NOT NULL,
  new_quantity      int NOT NULL,
  reference         text,
  notes             text,
  -- SET NULL: o movimento de stock é histórico e não pode bloquear
  -- a remoção da conta de quem o registou.
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seller_products (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id       uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  authorized_price numeric(12,2),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_id, product_id)
);

-- 2.3 Cliente
CREATE TABLE IF NOT EXISTS public.favorites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.carts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cart_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id    uuid NOT NULL REFERENCES public.carts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity   int NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, product_id)
);

-- 2.4 Encomendas
CREATE TABLE IF NOT EXISTS public.orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        text NOT NULL UNIQUE,
  client_ref       text,
  customer_id      uuid NOT NULL REFERENCES auth.users(id),
  seller_id        uuid REFERENCES public.profiles(id),
  status           public.order_status NOT NULL DEFAULT 'pending',
  total_amount     numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  delivery_method  text NOT NULL DEFAULT 'pickup' CHECK (delivery_method IN ('pickup', 'delivery')),
  delivery_address text,
  contact_phone    text,
  notes            text,
  payment_status   public.payment_status NOT NULL DEFAULT 'pending',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id),
  quantity    int NOT NULL CHECK (quantity > 0),
  unit_price  numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  total_price numeric(12,2) NOT NULL CHECK (total_price >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_status_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  status          public.order_status NOT NULL,
  previous_status public.order_status,
  changed_by      uuid REFERENCES auth.users(id),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 2.5 Reservas
CREATE TABLE IF NOT EXISTS public.reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id),
  seller_id   uuid REFERENCES public.profiles(id),
  status      public.reservation_status NOT NULL DEFAULT 'active',
  expires_at  timestamptz,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reservation_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  product_id     uuid NOT NULL REFERENCES public.products(id),
  quantity       int NOT NULL CHECK (quantity > 0),
  unit_price     numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 2.6 Vendas
CREATE TABLE IF NOT EXISTS public.sales (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference      text NOT NULL UNIQUE,
  client_ref     text,
  seller_id      uuid NOT NULL REFERENCES public.profiles(id),
  customer_id    uuid REFERENCES auth.users(id),
  order_id       uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  total_amount   numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  payment_status public.payment_status NOT NULL DEFAULT 'pending',
  payment_method text,
  notes          text,
  is_offline     boolean NOT NULL DEFAULT false,
  sync_status    public.sync_operation_status NOT NULL DEFAULT 'synced',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id          uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id       uuid NOT NULL REFERENCES public.products(id),
  quantity         int NOT NULL CHECK (quantity > 0),
  unit_price       numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  total_price      numeric(12,2) NOT NULL CHECK (total_price >= 0),
  product_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seller_customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (seller_id, customer_id)
);

CREATE TABLE IF NOT EXISTS public.discount_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id       uuid REFERENCES public.profiles(id),
  product_id      uuid NOT NULL REFERENCES public.products(id),
  official_price  numeric(12,2) NOT NULL CHECK (official_price >= 0),
  requested_price numeric(12,2) NOT NULL CHECK (requested_price >= 0),
  justification   text,
  status          public.discount_request_status NOT NULL DEFAULT 'pending',
  decided_by      uuid REFERENCES auth.users(id),
  decided_at      timestamptz,
  final_price     numeric(12,2),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 2.7 Comunicação
CREATE TABLE IF NOT EXISTS public.conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group', 'support')),
  title      text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversation_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_read_at    timestamptz,
  UNIQUE (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES auth.users(id),
  content         text,
  reply_to        uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  is_edited       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_content_or_attachment CHECK (content IS NULL OR length(btrim(content)) > 0)
);

CREATE TABLE IF NOT EXISTS public.message_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name    text NOT NULL,
  file_type    text NOT NULL,
  file_size    int NOT NULL CHECK (file_size > 0 AND file_size <= 20971520),
  url          text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL UNIQUE REFERENCES public.conversations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  is_private      boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 2.8 INUKA Connect
CREATE TABLE IF NOT EXISTS public.posts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id      uuid NOT NULL REFERENCES auth.users(id),
  title          text NOT NULL,
  content        text NOT NULL,
  audience       public.post_audience NOT NULL DEFAULT 'all',
  group_id       uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  is_pinned      boolean NOT NULL DEFAULT false,
  is_urgent      boolean NOT NULL DEFAULT false,
  allow_comments boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.post_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name    text NOT NULL,
  file_type    text NOT NULL,
  url          text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.post_reads (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.post_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2.9 Sistema
CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sync_operations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_id      uuid NOT NULL,
  entity        text NOT NULL,
  operation     text NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        public.sync_operation_status NOT NULL DEFAULT 'pending',
  attempts      int NOT NULL DEFAULT 0,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, local_id, entity)
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id),
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  uuid,
  old_data   jsonb,
  new_data   jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_settings (key, value)
VALUES
  ('max_discount_percent', '{"value": 20}'::jsonb),
  ('reservation_expiry_hours', '{"value": 48}'::jsonb),
  ('low_stock_threshold', '{"value": 5}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. FUNÇÕES DE SEGURANÇA
-- SECURITY DEFINER + search_path fixo: lêem a tabela profiles ignorando RLS,
-- evitando recursão infinita nas políticas.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()),
    'visitor'::public.user_role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_authenticated()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.current_user_role() = 'manager'::public.user_role;
$$;

CREATE OR REPLACE FUNCTION public.is_seller()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.current_user_role() IN ('seller'::public.user_role, 'manager'::public.user_role);
$$;

CREATE OR REPLACE FUNCTION public.is_customer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.current_user_role() IN ('customer'::public.user_role, 'manager'::public.user_role);
$$;

-- Verifica se o utilizador atual é membro de uma conversa
CREATE OR REPLACE FUNCTION public.is_conversation_member(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members cm
    WHERE cm.conversation_id = p_conversation_id
      AND cm.user_id = auth.uid()
  );
$$;

-- Verifica se o utilizador atual é o vendedor responsável por um cliente
CREATE OR REPLACE FUNCTION public.is_my_customer(p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.seller_customers sc
    WHERE sc.customer_id = p_customer_id
      AND sc.seller_id = auth.uid()
      AND sc.is_active = true
  );
$$;

-- Normalização de telefone angolano: 9xx xxx xxx -> +2449xxxxxxxx
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean text;
BEGIN
  IF p_phone IS NULL THEN
    RETURN NULL;
  END IF;

  v_clean := regexp_replace(p_phone, '[^0-9+]', '', 'g');

  IF v_clean = '' THEN
    RETURN NULL;
  END IF;

  -- Remove zeros à esquerda (ex.: 00244...)
  v_clean := regexp_replace(v_clean, '^00', '+', '');

  IF left(v_clean, 1) <> '+' THEN
    v_clean := '+244' || v_clean;
  END IF;

  -- Angola: +244 seguido de 9 dígitos
  IF v_clean !~ '^\+244[0-9]{9}$' THEN
    RETURN NULL;
  END IF;

  RETURN v_clean;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. ÍNDICES
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_category     ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active       ON public.products(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_products_featured     ON public.products(is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_products_name_trgm    ON public.products(lower(name));
CREATE INDEX IF NOT EXISTS idx_product_images_prod   ON public.product_images(product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_orders_customer       ON public.orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller         ON public.orders(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status         ON public.orders(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_client_ref ON public.orders(customer_id, client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_order     ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_seller          ON public.sales(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_customer        ON public.sales(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_client_ref ON public.sales(seller_id, client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sale_items_sale       ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_seller_customers_s    ON public.seller_customers(seller_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_seller_customers_c    ON public.seller_customers(customer_id);
CREATE INDEX IF NOT EXISTS idx_reservations_customer ON public.reservations(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reservations_expires  ON public.reservations(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_discount_customer     ON public.discount_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_discount_status       ON public.discount_requests(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_conv_members_user     ON public.conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_members_conv     ON public.conversation_members(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv         ON public.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_message   ON public.message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_posts_audience        ON public.posts(audience, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user    ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread  ON public.notifications(user_id) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_sync_pending          ON public.sync_operations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_entity          ON public.audit_logs(entity, entity_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 5. TRIGGERS
-- -----------------------------------------------------------------------------

-- 5.1 updated_at automático
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'profiles', 'seller_profiles', 'categories', 'products', 'carts', 'cart_items',
    'orders', 'reservations', 'sales', 'discount_requests', 'conversations',
    'messages', 'groups', 'posts', 'sync_operations'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t
    );
  END LOOP;
END $$;

-- 5.2 Auditoria genérica
-- Resolve a chave primária de forma genérica: a maioria das tabelas usa "id",
-- mas user_roles usa "user_id". Nunca falha por coluna inexistente.
CREATE OR REPLACE FUNCTION public.safe_uuid(p_value text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_value IS NULL OR p_value !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN p_value::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_new  jsonb;
  v_old  jsonb;
  v_id   uuid;
BEGIN
  v_new := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_old := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;

  v_id := COALESCE(
    public.safe_uuid(v_new->>'id'),
    public.safe_uuid(v_old->>'id'),
    public.safe_uuid(v_new->>'user_id'),
    public.safe_uuid(v_old->>'user_id')
  );

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data)
    VALUES (auth.uid(), 'delete', TG_TABLE_NAME, v_id, v_old);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data, new_data)
    VALUES (auth.uid(), 'update', TG_TABLE_NAME, v_id, v_old, v_new);
    RETURN NEW;
  ELSE
    INSERT INTO public.audit_logs (user_id, action, entity, entity_id, new_data)
    VALUES (auth.uid(), 'create', TG_TABLE_NAME, v_id, v_new);
    RETURN NEW;
  END IF;
END;
$$;

DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'profiles', 'products', 'categories', 'orders', 'sales', 'reservations',
    'discount_requests', 'inventory', 'inventory_movements', 'seller_customers',
    'user_roles', 'posts'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.log_audit()', t
    );
  END LOOP;
END $$;

-- 5.3 Criar perfil após registo no Auth
-- SEGURANÇA: o papel é SEMPRE 'customer'. Metadados do cliente são ignorados
-- para impedir escalada de privilégios no registo.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, phone, email, neighborhood)
  VALUES (
    NEW.id,
    'customer'::public.user_role,
    COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(COALESCE(NEW.email, 'Utilizador'), '@', 1)),
    public.normalize_phone(COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone)),
    NEW.email,
    NULLIF(btrim(NEW.raw_user_meta_data->>'neighborhood'), '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users';
    EXECUTE 'CREATE TRIGGER on_auth_user_created
             AFTER INSERT ON auth.users
             FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()';
  END IF;
END $$;

-- 5.4 Sincronizar user_roles com profiles.role
CREATE OR REPLACE FUNCTION public.sync_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role, assigned_by)
  VALUES (NEW.id, NEW.role, auth.uid())
  ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role,
        assigned_by = auth.uid(),
        assigned_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_role ON public.profiles;
CREATE TRIGGER trg_sync_profile_role
AFTER INSERT OR UPDATE OF role ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role();

-- 5.5 Impedir escalada de privilégios
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  -- Operações administrativas diretas na base de dados (SQL Editor, service_role,
  -- migrações) não transportam JWT: auth.uid() é NULL. São permitidas para que
  -- seja possível criar o primeiro gestor. Só acessos com JWT são validados.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Só um gestor pode criar um perfil que não seja 'customer'
    IF NEW.role <> 'customer'::public.user_role AND NOT public.is_manager() THEN
      NEW.role := 'customer'::public.user_role;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas gestores podem alterar papéis de utilizador'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas gestores podem ativar ou desativar contas'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_role_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_role_escalation
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();


-- ###########################################################################
-- ##  PARTE 2 de 15 — ROW LEVEL SECURITY
-- ###########################################################################

-- =============================================================================
-- INUKA ANGOLA — MIGRAÇÃO 2/3 : ROW LEVEL SECURITY
-- Ativa RLS em todas as tabelas e define as políticas de acesso.
-- Executar depois da migração 1.
-- =============================================================================

ALTER TABLE public.profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_customers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_attachments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_reads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_operations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings    ENABLE ROW LEVEL SECURITY;

-- Remove políticas anteriores para permitir reexecução
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- PERFIS
-- -----------------------------------------------------------------------------
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    profiles.id = auth.uid()
    OR public.is_manager()
    OR (public.is_seller() AND public.is_my_customer(profiles.id))
    -- Quem partilha uma conversa vê o nome do interlocutor. Sem isto, o chat
    -- mostrava conversas sem nome: o RLS escondia o perfil de quem estava
    -- do outro lado, mesmo sendo o destinatário das mensagens.
    OR EXISTS (
      SELECT 1
      FROM public.conversation_members me
      JOIN public.conversation_members outro
        ON outro.conversation_id = me.conversation_id
      WHERE me.user_id = auth.uid()
        AND outro.user_id = profiles.id
    )
  );

CREATE POLICY profiles_insert_self ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (profiles.id = auth.uid());

CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING (profiles.id = auth.uid() OR public.is_manager())
  WITH CHECK (profiles.id = auth.uid() OR public.is_manager());

CREATE POLICY profiles_delete_manager ON public.profiles
  FOR DELETE TO authenticated
  USING (public.is_manager());

-- -----------------------------------------------------------------------------
-- PAPÉIS (apenas leitura própria; escrita só gestores)
-- -----------------------------------------------------------------------------
CREATE POLICY user_roles_select ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_roles.user_id = auth.uid() OR public.is_manager());

CREATE POLICY user_roles_manager_write ON public.user_roles
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- -----------------------------------------------------------------------------
-- VENDEDORES
-- -----------------------------------------------------------------------------
CREATE POLICY seller_profiles_select ON public.seller_profiles
  FOR SELECT TO authenticated
  USING (seller_profiles.id = auth.uid() OR public.is_manager());

CREATE POLICY seller_profiles_manager_write ON public.seller_profiles
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- -----------------------------------------------------------------------------
-- CATÁLOGO — leitura pública (inclui visitantes anónimos)
-- -----------------------------------------------------------------------------
CREATE POLICY categories_public_read ON public.categories
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY categories_manager_write ON public.categories
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY products_public_read ON public.products
  FOR SELECT TO anon, authenticated
  USING (products.is_active = true OR public.is_manager() OR public.is_seller());

CREATE POLICY products_manager_write ON public.products
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY product_images_public_read ON public.product_images
  FOR SELECT TO anon, authenticated
  USING (
    public.is_manager()
    OR public.is_seller()
    OR EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_images.product_id AND p.is_active = true
    )
  );

CREATE POLICY product_images_manager_write ON public.product_images
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- Inventário: leitura autenticada, escrita apenas gestores
CREATE POLICY inventory_read ON public.inventory
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY inventory_manager_write ON public.inventory
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY inventory_movements_read ON public.inventory_movements
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.is_seller());

CREATE POLICY inventory_movements_manager_write ON public.inventory_movements
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY seller_products_select ON public.seller_products
  FOR SELECT TO authenticated
  USING (seller_products.seller_id = auth.uid() OR public.is_manager());

CREATE POLICY seller_products_manager_write ON public.seller_products
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- -----------------------------------------------------------------------------
-- CLIENTE: favoritos, carrinho
-- -----------------------------------------------------------------------------
CREATE POLICY favorites_owner ON public.favorites
  FOR ALL TO authenticated
  USING (favorites.user_id = auth.uid())
  WITH CHECK (favorites.user_id = auth.uid());

CREATE POLICY carts_owner ON public.carts
  FOR ALL TO authenticated
  USING (carts.user_id = auth.uid())
  WITH CHECK (carts.user_id = auth.uid());

CREATE POLICY cart_items_owner ON public.cart_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.carts c
      WHERE c.id = cart_items.cart_id AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.carts c
      WHERE c.id = cart_items.cart_id AND c.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- ENCOMENDAS
-- Cliente vê as suas; vendedor vê as dos seus clientes; gestor vê todas.
-- -----------------------------------------------------------------------------
CREATE POLICY orders_select ON public.orders
  FOR SELECT TO authenticated
  USING (
    orders.customer_id = auth.uid()
    OR orders.seller_id = auth.uid()
    OR public.is_manager()
    OR (public.is_seller() AND public.is_my_customer(orders.customer_id))
  );

CREATE POLICY orders_insert_customer ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    orders.customer_id = auth.uid()
    AND public.is_customer()
  );

CREATE POLICY orders_update_manager_seller ON public.orders
  FOR UPDATE TO authenticated
  USING (
    public.is_manager()
    OR orders.seller_id = auth.uid()
    OR (orders.customer_id = auth.uid() AND orders.status = 'pending')
  )
  WITH CHECK (
    public.is_manager()
    OR orders.seller_id = auth.uid()
    OR orders.customer_id = auth.uid()
  );

CREATE POLICY order_items_select ON public.order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          o.customer_id = auth.uid()
          OR o.seller_id = auth.uid()
          OR public.is_manager()
          OR (public.is_seller() AND public.is_my_customer(o.customer_id))
        )
    )
  );

CREATE POLICY order_items_insert_owner ON public.order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id AND o.customer_id = auth.uid()
    )
  );

CREATE POLICY order_status_history_select ON public.order_status_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_status_history.order_id
        AND (
          o.customer_id = auth.uid()
          OR o.seller_id = auth.uid()
          OR public.is_manager()
        )
    )
  );

CREATE POLICY order_status_history_insert ON public.order_status_history
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager() OR public.is_seller());

-- -----------------------------------------------------------------------------
-- RESERVAS
-- -----------------------------------------------------------------------------
CREATE POLICY reservations_select ON public.reservations
  FOR SELECT TO authenticated
  USING (
    reservations.customer_id = auth.uid()
    OR reservations.seller_id = auth.uid()
    OR public.is_manager()
    OR (public.is_seller() AND public.is_my_customer(reservations.customer_id))
  );

CREATE POLICY reservations_insert_customer ON public.reservations
  FOR INSERT TO authenticated
  WITH CHECK (reservations.customer_id = auth.uid() AND public.is_customer());

CREATE POLICY reservations_update ON public.reservations
  FOR UPDATE TO authenticated
  USING (
    public.is_manager()
    OR reservations.seller_id = auth.uid()
    OR (reservations.customer_id = auth.uid() AND reservations.status = 'active')
  );

CREATE POLICY reservation_items_select ON public.reservation_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.id = reservation_items.reservation_id
        AND (
          r.customer_id = auth.uid()
          OR r.seller_id = auth.uid()
          OR public.is_manager()
        )
    )
  );

CREATE POLICY reservation_items_insert ON public.reservation_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.id = reservation_items.reservation_id AND r.customer_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- VENDAS — vendedor só vê e cria as suas
-- -----------------------------------------------------------------------------
CREATE POLICY sales_select ON public.sales
  FOR SELECT TO authenticated
  USING (sales.seller_id = auth.uid() OR public.is_manager());

CREATE POLICY sales_insert_seller ON public.sales
  FOR INSERT TO authenticated
  WITH CHECK (sales.seller_id = auth.uid() AND public.is_seller());

CREATE POLICY sales_update_manager ON public.sales
  FOR UPDATE TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY sale_items_select ON public.sale_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND (s.seller_id = auth.uid() OR public.is_manager())
    )
  );

CREATE POLICY sale_items_insert ON public.sale_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id AND s.seller_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- CLIENTES ASSOCIADOS
-- -----------------------------------------------------------------------------
CREATE POLICY seller_customers_select ON public.seller_customers
  FOR SELECT TO authenticated
  USING (
    seller_customers.seller_id = auth.uid()
    OR seller_customers.customer_id = auth.uid()
    OR public.is_manager()
  );

CREATE POLICY seller_customers_insert_seller ON public.seller_customers
  FOR INSERT TO authenticated
  WITH CHECK (seller_customers.seller_id = auth.uid() AND public.is_seller());

CREATE POLICY seller_customers_manager_write ON public.seller_customers
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- -----------------------------------------------------------------------------
-- PEDIDOS DE DESCONTO
-- -----------------------------------------------------------------------------
CREATE POLICY discount_requests_select ON public.discount_requests
  FOR SELECT TO authenticated
  USING (
    discount_requests.customer_id = auth.uid()
    OR discount_requests.seller_id = auth.uid()
    OR public.is_manager()
  );

CREATE POLICY discount_requests_insert_customer ON public.discount_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    discount_requests.customer_id = auth.uid() AND public.is_customer()
  );

CREATE POLICY discount_requests_update_manager ON public.discount_requests
  FOR UPDATE TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- -----------------------------------------------------------------------------
-- CHAT
-- -----------------------------------------------------------------------------
CREATE POLICY conversations_select ON public.conversations
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversations.id) OR public.is_manager());

CREATE POLICY conversations_insert ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (conversations.created_by = auth.uid() OR public.is_manager());

CREATE POLICY conversations_update ON public.conversations
  FOR UPDATE TO authenticated
  USING (public.is_manager());

CREATE POLICY conversation_members_select ON public.conversation_members
  FOR SELECT TO authenticated
  USING (
    conversation_members.user_id = auth.uid()
    OR public.is_manager()
    OR public.is_conversation_member(conversation_members.conversation_id)
  );

CREATE POLICY conversation_members_insert ON public.conversation_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_manager()
    OR conversation_members.user_id = auth.uid()
    OR public.is_conversation_member(conversation_members.conversation_id)
  );

CREATE POLICY conversation_members_update_self ON public.conversation_members
  FOR UPDATE TO authenticated
  USING (conversation_members.user_id = auth.uid())
  WITH CHECK (conversation_members.user_id = auth.uid());

CREATE POLICY conversation_members_manager_write ON public.conversation_members
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY messages_select ON public.messages
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(messages.conversation_id) OR public.is_manager());

CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    messages.sender_id = auth.uid()
    AND public.is_conversation_member(messages.conversation_id)
  );

CREATE POLICY messages_update_sender ON public.messages
  FOR UPDATE TO authenticated
  USING (messages.sender_id = auth.uid())
  WITH CHECK (messages.sender_id = auth.uid());

CREATE POLICY messages_delete_sender ON public.messages
  FOR DELETE TO authenticated
  USING (messages.sender_id = auth.uid() OR public.is_manager());

CREATE POLICY message_attachments_select ON public.message_attachments
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_attachments.message_id
        AND public.is_conversation_member(m.conversation_id)
    )
  );

CREATE POLICY message_attachments_insert ON public.message_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_attachments.message_id
        AND m.sender_id = auth.uid()
        AND public.is_conversation_member(m.conversation_id)
    )
  );

CREATE POLICY groups_select ON public.groups
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(groups.conversation_id) OR public.is_manager());

CREATE POLICY groups_manager_write ON public.groups
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- -----------------------------------------------------------------------------
-- INUKA CONNECT
-- -----------------------------------------------------------------------------
CREATE POLICY posts_select ON public.posts
  FOR SELECT TO anon, authenticated
  USING (
    public.is_manager()
    OR posts.audience = 'all'
    OR (posts.audience = 'sellers' AND public.is_seller())
    OR (posts.audience = 'customers' AND public.is_customer())
    OR (posts.audience = 'managers' AND public.is_manager())
    OR (
      posts.audience = 'group'
      AND posts.group_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.groups g
        WHERE g.id = posts.group_id
          AND public.is_conversation_member(g.conversation_id)
      )
    )
  );

CREATE POLICY posts_manager_write ON public.posts
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY post_attachments_select ON public.post_attachments
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_attachments.post_id
    )
  );

CREATE POLICY post_attachments_manager_write ON public.post_attachments
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY post_reads_owner ON public.post_reads
  FOR ALL TO authenticated
  USING (post_reads.user_id = auth.uid())
  WITH CHECK (post_reads.user_id = auth.uid());

CREATE POLICY post_comments_select ON public.post_comments
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_comments.post_id AND p.allow_comments = true
    )
    OR public.is_manager()
  );

CREATE POLICY post_comments_insert ON public.post_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    post_comments.author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_comments.post_id AND p.allow_comments = true
    )
  );

CREATE POLICY post_comments_delete ON public.post_comments
  FOR DELETE TO authenticated
  USING (post_comments.author_id = auth.uid() OR public.is_manager());

-- -----------------------------------------------------------------------------
-- SISTEMA
-- -----------------------------------------------------------------------------
CREATE POLICY notifications_owner ON public.notifications
  FOR ALL TO authenticated
  USING (notifications.user_id = auth.uid())
  WITH CHECK (notifications.user_id = auth.uid());

CREATE POLICY sync_operations_owner ON public.sync_operations
  FOR ALL TO authenticated
  USING (sync_operations.user_id = auth.uid())
  WITH CHECK (sync_operations.user_id = auth.uid());

-- Auditoria: apenas leitura por gestores. Sem INSERT/UPDATE/DELETE direto
-- (escrita apenas via trigger SECURITY DEFINER).
CREATE POLICY audit_logs_manager_read ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_manager());

CREATE POLICY platform_settings_read ON public.platform_settings
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY platform_settings_manager_write ON public.platform_settings
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- -----------------------------------------------------------------------------
-- STORAGE
-- Convenção de caminhos:
--   product-images/{product_id}/{ficheiro}
--   avatars/{user_id}/{ficheiro}
--   message-attachments/{conversation_id}/{ficheiro}
--   post-attachments/{post_id}/{ficheiro}
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    RAISE NOTICE 'Schema storage inexistente — políticas de Storage ignoradas.';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public)
  VALUES
    ('product-images',      'product-images',      true),
    ('avatars',             'avatars',             true),
    ('post-attachments',    'post-attachments',    true),
    ('message-attachments', 'message-attachments', false)
  ON CONFLICT (id) DO NOTHING;

  -- Limpar políticas de storage anteriores com os mesmos nomes
  BEGIN
    DROP POLICY IF EXISTS "inuka_product_images_read"   ON storage.objects;
    DROP POLICY IF EXISTS "inuka_product_images_write"  ON storage.objects;
    DROP POLICY IF EXISTS "inuka_avatars_read"          ON storage.objects;
    DROP POLICY IF EXISTS "inuka_avatars_write"         ON storage.objects;
    DROP POLICY IF EXISTS "inuka_post_attachments_read" ON storage.objects;
    DROP POLICY IF EXISTS "inuka_post_attachments_write" ON storage.objects;
    DROP POLICY IF EXISTS "inuka_msg_attachments_read"  ON storage.objects;
    DROP POLICY IF EXISTS "inuka_msg_attachments_write" ON storage.objects;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Sem permissão para gerir políticas de storage.objects.';
  END;

  CREATE POLICY "inuka_product_images_read" ON storage.objects
    FOR SELECT TO anon, authenticated
    USING (bucket_id = 'product-images');

  CREATE POLICY "inuka_product_images_write" ON storage.objects
    FOR ALL TO authenticated
    USING (bucket_id = 'product-images' AND public.is_manager())
    WITH CHECK (bucket_id = 'product-images' AND public.is_manager());

  CREATE POLICY "inuka_avatars_read" ON storage.objects
    FOR SELECT TO anon, authenticated
    USING (bucket_id = 'avatars');

  CREATE POLICY "inuka_avatars_write" ON storage.objects
    FOR ALL TO authenticated
    USING (
      bucket_id = 'avatars'
      AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_manager())
    )
    WITH CHECK (
      bucket_id = 'avatars'
      AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_manager())
    );

  CREATE POLICY "inuka_post_attachments_read" ON storage.objects
    FOR SELECT TO anon, authenticated
    USING (bucket_id = 'post-attachments');

  CREATE POLICY "inuka_post_attachments_write" ON storage.objects
    FOR ALL TO authenticated
    USING (bucket_id = 'post-attachments' AND public.is_manager())
    WITH CHECK (bucket_id = 'post-attachments' AND public.is_manager());

  -- Anexos de chat: apenas membros da conversa indicada na pasta
  CREATE POLICY "inuka_msg_attachments_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'message-attachments'
      AND (
        public.is_manager()
        OR public.is_conversation_member(((storage.foldername(name))[1])::uuid)
      )
    );

  CREATE POLICY "inuka_msg_attachments_write" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'message-attachments'
      AND public.is_conversation_member(((storage.foldername(name))[1])::uuid)
    );
END $$;


-- ###########################################################################
-- ##  PARTE 3 de 15 — LÓGICA DE NEGÓCIO + REALTIME
-- ###########################################################################

-- =============================================================================
-- INUKA ANGOLA — MIGRAÇÃO 3/3 : LÓGICA DE NEGÓCIO (RPC) + REALTIME
-- Funções transacionais chamadas pelo frontend via supabase.rpc(...)
-- Executar depois da migração 2.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. REFERÊNCIAS ÚNICAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_order_reference()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref text;
  v_exists boolean;
BEGIN
  LOOP
    v_ref := 'ENC-' || to_char(now(), 'YYYYMMDD') || '-' ||
             upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));
    SELECT EXISTS (SELECT 1 FROM public.orders o WHERE o.reference = v_ref) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_ref;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_sale_reference()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref text;
  v_exists boolean;
BEGIN
  LOOP
    v_ref := 'VND-' || to_char(now(), 'YYYYMMDD') || '-' ||
             upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));
    SELECT EXISTS (SELECT 1 FROM public.sales s WHERE s.reference = v_ref) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_ref;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. TOTAIS AUTOMÁTICOS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalc_order_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id uuid := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
  UPDATE public.orders o
  SET total_amount = (
        SELECT COALESCE(SUM(oi.total_price), 0)
        FROM public.order_items oi
        WHERE oi.order_id = v_order_id
      ),
      updated_at = now()
  WHERE o.id = v_order_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_order_total ON public.order_items;
CREATE TRIGGER trg_recalc_order_total
AFTER INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.recalc_order_total();

CREATE OR REPLACE FUNCTION public.recalc_sale_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale_id uuid := COALESCE(NEW.sale_id, OLD.sale_id);
BEGIN
  UPDATE public.sales s
  SET total_amount = (
        SELECT COALESCE(SUM(si.total_price), 0)
        FROM public.sale_items si
        WHERE si.sale_id = v_sale_id
      ),
      updated_at = now()
  WHERE s.id = v_sale_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_sale_total ON public.sale_items;
CREATE TRIGGER trg_recalc_sale_total
AFTER INSERT OR UPDATE OR DELETE ON public.sale_items
FOR EACH ROW EXECUTE FUNCTION public.recalc_sale_total();

-- -----------------------------------------------------------------------------
-- 3. HISTÓRICO E NOTIFICAÇÕES
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.on_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_status_history (order_id, status, previous_status, changed_by, notes)
    VALUES (NEW.id, NEW.status, OLD.status, auth.uid(), NULL);

    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      NEW.customer_id,
      'order_update',
      'Atualização da encomenda',
      'A encomenda ' || NEW.reference || ' está agora: ' || NEW.status::text,
      jsonb_build_object('order_id', NEW.id, 'status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_order_status_change ON public.orders;
CREATE TRIGGER trg_on_order_status_change
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.on_order_status_change();

CREATE OR REPLACE FUNCTION public.on_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    cm.user_id,
    'new_message',
    'Nova mensagem',
    COALESCE(left(NEW.content, 80), 'Anexo enviado'),
    jsonb_build_object('conversation_id', NEW.conversation_id, 'message_id', NEW.id)
  FROM public.conversation_members cm
  WHERE cm.conversation_id = NEW.conversation_id
    AND cm.user_id <> NEW.sender_id;

  UPDATE public.conversations c
  SET updated_at = now()
  WHERE c.id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_new_message ON public.messages;
CREATE TRIGGER trg_on_new_message
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.on_new_message();

CREATE OR REPLACE FUNCTION public.on_new_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    p.id,
    'new_order',
    'Nova encomenda',
    'Encomenda ' || NEW.reference || ' criada.',
    jsonb_build_object('order_id', NEW.id)
  FROM public.profiles p
  WHERE p.role = 'manager' AND p.is_active = true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_new_order ON public.orders;
CREATE TRIGGER trg_on_new_order
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.on_new_order();

-- -----------------------------------------------------------------------------
-- 4. PERFIL
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_profile public.profiles;
BEGIN
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id = auth.uid();
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN to_jsonb(v_profile);
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. ENCOMENDAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_order(
  p_items            jsonb,
  p_delivery_method  text DEFAULT 'pickup',
  p_delivery_address text DEFAULT NULL,
  p_contact_phone    text DEFAULT NULL,
  p_notes            text DEFAULT NULL,
  p_client_ref       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_order_id uuid;
  v_ref      text;
  v_item     jsonb;
  v_prod     record;
  v_qty      int;
  v_price    numeric(12,2);
  v_total    numeric(12,2) := 0;
  v_existing public.orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_customer() THEN
    RAISE EXCEPTION 'Apenas clientes podem criar encomendas' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'O carrinho está vazio';
  END IF;

  IF p_delivery_method NOT IN ('pickup', 'delivery') THEN
    RAISE EXCEPTION 'Modalidade de entrega inválida';
  END IF;

  IF p_delivery_method = 'delivery' AND COALESCE(btrim(p_delivery_address), '') = '' THEN
    RAISE EXCEPTION 'Indique o endereço de entrega';
  END IF;

  -- Idempotência: mesma referência de cliente devolve a encomenda existente
  IF p_client_ref IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.orders o
    WHERE o.customer_id = v_uid AND o.client_ref = p_client_ref;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id', v_existing.id,
        'reference', v_existing.reference,
        'total', v_existing.total_amount,
        'duplicated', true
      );
    END IF;
  END IF;

  v_ref := public.generate_order_reference();

  INSERT INTO public.orders (
    reference, client_ref, customer_id, status, delivery_method,
    delivery_address, contact_phone, notes, payment_status
  )
  VALUES (
    v_ref, p_client_ref, v_uid, 'pending', p_delivery_method,
    NULLIF(btrim(p_delivery_address), ''), NULLIF(btrim(p_contact_phone), ''),
    NULLIF(btrim(p_notes), ''), 'pending'
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida';
    END IF;

    SELECT p.id, p.name, p.official_price, p.promotional_price, p.is_active,
           i.quantity AS stock, i.reserved_quantity AS reserved
      INTO v_prod
    FROM public.products p
    LEFT JOIN public.inventory i ON i.product_id = p.id
    WHERE p.id = (v_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto inexistente';
    END IF;

    IF NOT v_prod.is_active THEN
      RAISE EXCEPTION 'Produto indisponível: %', v_prod.name;
    END IF;

    v_price := COALESCE(v_prod.promotional_price, v_prod.official_price);

    -- Reserva atómica de stock (apenas se existir controlo de inventário)
    IF v_prod.stock IS NOT NULL THEN
      UPDATE public.inventory i
      SET reserved_quantity = i.reserved_quantity + v_qty,
          updated_at = now()
      WHERE i.product_id = v_prod.id
        AND (i.quantity - i.reserved_quantity) >= v_qty;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente para %', v_prod.name;
      END IF;
    END IF;

    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, total_price)
    VALUES (v_order_id, v_prod.id, v_qty, v_price, v_price * v_qty);
  END LOOP;

  SELECT COALESCE(SUM(oi.total_price), 0) INTO v_total
  FROM public.order_items oi WHERE oi.order_id = v_order_id;

  -- Estado inicial no histórico. O trigger `trg_on_order_status_change`
  -- só dispara em UPDATE, por isso o INSERT tem de o registar aqui.
  INSERT INTO public.order_status_history (order_id, status, previous_status, changed_by, notes)
  VALUES (v_order_id, 'pending', NULL, v_uid, 'Encomenda criada');

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'reference', v_ref,
    'total', v_total,
    'duplicated', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id uuid,
  p_status   public.order_status,
  p_notes    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_order public.orders;
  v_item  record;
BEGIN
  SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Encomenda inexistente';
  END IF;

  -- Atenção: `seller_id` é opcional. `NULL = auth.uid()` devolve NULL, e
  -- `NOT (false OR NULL OR false)` é NULL — o IF não disparava e qualquer
  -- utilizador autenticado conseguia alterar a encomenda. Daí o COALESCE.
  IF NOT (
    public.is_manager()
    OR v_order.customer_id = auth.uid()
    OR COALESCE(v_order.seller_id = auth.uid(), false)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para alterar esta encomenda' USING ERRCODE = '42501';
  END IF;

  -- Cliente só pode cancelar enquanto estiver pendente
  IF v_order.customer_id = auth.uid()
     AND NOT public.is_manager()
     AND p_status <> 'cancelled' THEN
    RAISE EXCEPTION 'O cliente apenas pode cancelar a encomenda' USING ERRCODE = '42501';
  END IF;

  IF v_order.status = 'completed' THEN
    RAISE EXCEPTION 'Encomenda já concluída não pode ser alterada';
  END IF;

  IF p_status = v_order.status THEN
    RETURN jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'changed', false);
  END IF;

  -- Concluir: converter reserva em saída efetiva de stock
  IF p_status = 'completed' THEN
    FOR v_item IN
      SELECT oi.product_id, oi.quantity FROM public.order_items oi WHERE oi.order_id = v_order.id
    LOOP
      UPDATE public.inventory i
      SET quantity = i.quantity - v_item.quantity,
          reserved_quantity = GREATEST(i.reserved_quantity - v_item.quantity, 0),
          updated_at = now()
      WHERE i.product_id = v_item.product_id;

      IF FOUND THEN
        INSERT INTO public.inventory_movements (
          product_id, type, quantity, previous_quantity, new_quantity, reference, notes, created_by
        )
        SELECT
          v_item.product_id,
          'out',
          v_item.quantity,
          i.quantity + v_item.quantity,
          i.quantity,
          v_order.reference,
          'Encomenda concluída',
          auth.uid()
        FROM public.inventory i WHERE i.product_id = v_item.product_id;
      END IF;
    END LOOP;
  END IF;

  -- Cancelar: libertar reserva
  IF p_status = 'cancelled' THEN
    FOR v_item IN
      SELECT oi.product_id, oi.quantity FROM public.order_items oi WHERE oi.order_id = v_order.id
    LOOP
      UPDATE public.inventory i
      SET reserved_quantity = GREATEST(i.reserved_quantity - v_item.quantity, 0),
          updated_at = now()
      WHERE i.product_id = v_item.product_id;
    END LOOP;
  END IF;

  UPDATE public.orders o
  SET status = p_status,
      notes = COALESCE(p_notes, o.notes),
      payment_status = CASE WHEN p_status = 'completed' THEN 'paid'::public.payment_status ELSE o.payment_status END,
      updated_at = now()
  WHERE o.id = v_order.id;

  UPDATE public.order_status_history h
  SET notes = p_notes
  WHERE h.order_id = v_order.id
    AND h.id = (
      SELECT h2.id FROM public.order_status_history h2
      WHERE h2.order_id = v_order.id
      ORDER BY h2.created_at DESC LIMIT 1
    );

  RETURN jsonb_build_object('order_id', v_order.id, 'status', p_status, 'changed', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.my_orders()
RETURNS SETOF public.orders
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, auth, pg_temp
AS $$
  SELECT * FROM public.orders o
  WHERE o.customer_id = auth.uid()
  ORDER BY o.created_at DESC;
$$;

-- -----------------------------------------------------------------------------
-- 6. RESERVAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_reservation(
  p_items      jsonb,
  p_expires_at timestamptz DEFAULT NULL,
  p_notes      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_item  jsonb;
  v_prod  record;
  v_qty   int;
  v_price numeric(12,2);
  v_hours int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_customer() THEN
    RAISE EXCEPTION 'Apenas clientes podem reservar' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum produto indicado';
  END IF;

  IF p_expires_at IS NULL THEN
    SELECT COALESCE((value->>'value')::int, 48) INTO v_hours
    FROM public.platform_settings WHERE key = 'reservation_expiry_hours';
    v_hours := COALESCE(v_hours, 48);
    p_expires_at := now() + (v_hours || ' hours')::interval;
  END IF;

  INSERT INTO public.reservations (customer_id, status, expires_at, notes)
  VALUES (v_uid, 'active', p_expires_at, NULLIF(btrim(p_notes), ''))
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida';
    END IF;

    SELECT p.id, p.name, p.official_price, p.promotional_price, p.is_active,
           i.quantity AS stock, i.reserved_quantity AS reserved
      INTO v_prod
    FROM public.products p
    LEFT JOIN public.inventory i ON i.product_id = p.id
    WHERE p.id = (v_item->>'product_id')::uuid;

    IF NOT FOUND OR NOT v_prod.is_active THEN
      RAISE EXCEPTION 'Produto indisponível';
    END IF;

    v_price := COALESCE(v_prod.promotional_price, v_prod.official_price);

    IF v_prod.stock IS NOT NULL THEN
      UPDATE public.inventory i
      SET reserved_quantity = i.reserved_quantity + v_qty,
          updated_at = now()
      WHERE i.product_id = v_prod.id
        AND (i.quantity - i.reserved_quantity) >= v_qty;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente para %', v_prod.name;
      END IF;
    END IF;

    INSERT INTO public.reservation_items (reservation_id, product_id, quantity, unit_price)
    VALUES (v_id, v_prod.id, v_qty, v_price);
  END LOOP;

  RETURN jsonb_build_object('reservation_id', v_id, 'expires_at', p_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_reservation(p_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_res public.reservations;
  v_it  record;
BEGIN
  SELECT * INTO v_res FROM public.reservations r WHERE r.id = p_reservation_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva inexistente';
  END IF;

  -- `seller_id` pode ser NULL; ver a nota em update_order_status.
  IF NOT (
    public.is_manager()
    OR v_res.customer_id = auth.uid()
    OR COALESCE(v_res.seller_id = auth.uid(), false)
  ) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;

  FOR v_it IN SELECT ri.product_id, ri.quantity FROM public.reservation_items ri WHERE ri.reservation_id = v_res.id
  LOOP
    UPDATE public.inventory i
    SET reserved_quantity = GREATEST(i.reserved_quantity - v_it.quantity, 0),
        updated_at = now()
    WHERE i.product_id = v_it.product_id;
  END LOOP;

  UPDATE public.reservations r
  SET status = 'cancelled', updated_at = now()
  WHERE r.id = v_res.id;

  RETURN jsonb_build_object('reservation_id', v_res.id, 'status', 'cancelled');
END;
$$;

-- Expirar reservas antigas (chamar via cron / pg_cron)
CREATE OR REPLACE FUNCTION public.expire_reservations()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res record;
  v_it  record;
  v_count int := 0;
BEGIN
  FOR v_res IN
    SELECT r.id FROM public.reservations r
    WHERE r.status = 'active' AND r.expires_at IS NOT NULL AND r.expires_at < now()
    FOR UPDATE
  LOOP
    FOR v_it IN SELECT ri.product_id, ri.quantity FROM public.reservation_items ri WHERE ri.reservation_id = v_res.id
    LOOP
      UPDATE public.inventory i
      SET reserved_quantity = GREATEST(i.reserved_quantity - v_it.quantity, 0),
          updated_at = now()
      WHERE i.product_id = v_it.product_id;
    END LOOP;

    UPDATE public.reservations r SET status = 'expired', updated_at = now() WHERE r.id = v_res.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. VENDAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_sale(
  p_items          jsonb,
  p_customer_id    uuid DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_payment_status public.payment_status DEFAULT 'pending',
  p_notes          text DEFAULT NULL,
  p_client_ref     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_sale_id  uuid;
  v_ref      text;
  v_item     jsonb;
  v_prod     record;
  v_qty      int;
  v_price    numeric(12,2);
  v_total    numeric(12,2) := 0;
  v_existing public.sales;
  v_stock    int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_seller() THEN
    RAISE EXCEPTION 'Apenas vendedores podem registar vendas' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum produto indicado';
  END IF;

  -- Vendedor só pode vender a clientes que lhe estão associados
  IF p_customer_id IS NOT NULL
     AND NOT public.is_manager()
     AND NOT public.is_my_customer(p_customer_id) THEN
    RAISE EXCEPTION 'Cliente não associado a este vendedor' USING ERRCODE = '42501';
  END IF;

  -- Idempotência: evita duplicar vendas reenviadas pela fila offline
  IF p_client_ref IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.sales s
    WHERE s.seller_id = v_uid AND s.client_ref = p_client_ref;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'sale_id', v_existing.id,
        'reference', v_existing.reference,
        'total', v_existing.total_amount,
        'duplicated', true
      );
    END IF;
  END IF;

  v_ref := public.generate_sale_reference();

  INSERT INTO public.sales (
    reference, client_ref, seller_id, customer_id, payment_method,
    payment_status, notes, is_offline, sync_status
  )
  VALUES (
    v_ref, p_client_ref, v_uid, p_customer_id,
    NULLIF(btrim(p_payment_method), ''), p_payment_status,
    NULLIF(btrim(p_notes), ''), p_client_ref IS NOT NULL, 'synced'
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida';
    END IF;

    SELECT p.id, p.name, p.sku, p.official_price, p.promotional_price, p.is_active,
           i.quantity AS stock
      INTO v_prod
    FROM public.products p
    LEFT JOIN public.inventory i ON i.product_id = p.id
    WHERE p.id = (v_item->>'product_id')::uuid;

    IF NOT FOUND OR NOT v_prod.is_active THEN
      RAISE EXCEPTION 'Produto indisponível';
    END IF;

    -- Preço validado no servidor (nunca confiar no preço enviado pelo cliente)
    v_price := COALESCE(v_prod.promotional_price, v_prod.official_price);

    IF v_prod.stock IS NOT NULL THEN
      SELECT i.quantity INTO v_stock
      FROM public.inventory i WHERE i.product_id = v_prod.id FOR UPDATE;

      IF v_stock < v_qty THEN
        RAISE EXCEPTION 'Stock insuficiente para % (disponível: %)', v_prod.name, v_stock;
      END IF;

      UPDATE public.inventory i
      SET quantity = i.quantity - v_qty, updated_at = now()
      WHERE i.product_id = v_prod.id;

      INSERT INTO public.inventory_movements (
        product_id, type, quantity, previous_quantity, new_quantity, reference, notes, created_by
      )
      VALUES (
        v_prod.id, 'out', v_qty, v_stock, v_stock - v_qty, v_ref, 'Venda registada', v_uid
      );
    END IF;

    INSERT INTO public.sale_items (
      sale_id, product_id, quantity, unit_price, total_price, product_snapshot
    )
    VALUES (
      v_sale_id, v_prod.id, v_qty, v_price, v_price * v_qty,
      jsonb_build_object(
        'name', v_prod.name,
        'sku', v_prod.sku,
        'official_price', v_prod.official_price,
        'promotional_price', v_prod.promotional_price,
        'sold_at', now()
      )
    );
  END LOOP;

  SELECT COALESCE(SUM(si.total_price), 0) INTO v_total
  FROM public.sale_items si WHERE si.sale_id = v_sale_id;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'reference', v_ref,
    'total', v_total,
    'duplicated', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_stats(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_from  timestamptz := COALESCE(p_from, date_trunc('month', now()));
  v_to    timestamptz := COALESCE(p_to, now());
  v_total numeric(14,2);
  v_count int;
  v_units int;
  v_customers int;
  v_top jsonb;
BEGIN
  SELECT COALESCE(SUM(s.total_amount), 0), COUNT(*)
    INTO v_total, v_count
  FROM public.sales s
  WHERE s.seller_id = v_uid AND s.created_at BETWEEN v_from AND v_to;

  SELECT COALESCE(SUM(si.quantity), 0)
    INTO v_units
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  WHERE s.seller_id = v_uid AND s.created_at BETWEEN v_from AND v_to;

  SELECT COUNT(*) INTO v_customers
  FROM public.seller_customers sc
  WHERE sc.seller_id = v_uid AND sc.is_active = true;

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_top
  FROM (
    SELECT si.product_snapshot->>'name' AS name, SUM(si.quantity) AS units, SUM(si.total_price) AS value
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE s.seller_id = v_uid AND s.created_at BETWEEN v_from AND v_to
    GROUP BY si.product_snapshot->>'name'
    ORDER BY SUM(si.quantity) DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'period_from', v_from,
    'period_to', v_to,
    'total_sales_value', v_total,
    'sales_count', v_count,
    'units_sold', v_units,
    'customers_count', v_customers,
    'top_products', v_top
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. CLIENTES DO VENDEDOR
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_customer_by_phone(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_phone  text;
  v_target uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_seller() THEN
    RAISE EXCEPTION 'Apenas vendedores podem associar clientes' USING ERRCODE = '42501';
  END IF;

  v_phone := public.normalize_phone(p_phone);
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Telefone inválido. Use o formato +244 9xx xxx xxx';
  END IF;

  SELECT p.id INTO v_target FROM public.profiles p WHERE p.phone = v_phone;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'phone', v_phone);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.seller_customers sc
    WHERE sc.customer_id = v_target AND sc.seller_id <> v_uid AND sc.is_active = true
  ) THEN
    RETURN jsonb_build_object(
      'found', true,
      'linked', false,
      'reason', 'already_assigned',
      'message', 'Este cliente já está associado a outro vendedor. Solicite transferência à gerência.'
    );
  END IF;

  INSERT INTO public.seller_customers (seller_id, customer_id, assigned_by)
  VALUES (v_uid, v_target, v_uid)
  ON CONFLICT (seller_id, customer_id) DO UPDATE SET is_active = true;

  RETURN jsonb_build_object('found', true, 'linked', true, 'customer_id', v_target);
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. DESCONTOS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_discount(
  p_product_id      uuid,
  p_requested_price numeric,
  p_justification   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_price   numeric(12,2);
  v_official numeric(12,2);
  v_limit   numeric;
  v_max     numeric;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_customer() THEN
    RAISE EXCEPTION 'Apenas clientes podem pedir descontos' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(p.promotional_price, p.official_price), p.official_price
    INTO v_price, v_official
  FROM public.products p
  WHERE p.id = p_product_id AND p.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto indisponível';
  END IF;

  IF p_requested_price <= 0 OR p_requested_price >= v_price THEN
    RAISE EXCEPTION 'O valor pedido deve ser inferior ao preço atual (%)', v_price;
  END IF;

  -- O pedido tem de respeitar já os limites comerciais configurados.
  -- Sem isto, o cliente podia submeter valores impossíveis e só descobria
  -- na decisão da gerência. O limite é calculado sobre o preço ATUAL
  -- (promocional, se existir), igual a decide_discount.
  SELECT COALESCE((value->>'value')::numeric, 20) INTO v_limit
  FROM public.platform_settings WHERE key = 'max_discount_percent';
  v_limit := COALESCE(v_limit, 20);

  v_max := v_price * (1 - v_limit / 100);

  IF p_requested_price < v_max THEN
    RAISE EXCEPTION 'Desconto acima do limite permitido (% %%)', v_limit;
  END IF;

  INSERT INTO public.discount_requests (
    customer_id, product_id, official_price, requested_price, justification, status
  )
  VALUES (v_uid, p_product_id, v_official, p_requested_price, NULLIF(btrim(p_justification), ''), 'pending')
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT p.id, 'discount_request', 'Novo pedido de desconto',
         'Um cliente pediu desconto num produto.',
         jsonb_build_object('discount_request_id', v_id)
  FROM public.profiles p WHERE p.role = 'manager' AND p.is_active = true;

  RETURN jsonb_build_object('discount_request_id', v_id, 'status', 'pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_discount(
  p_request_id  uuid,
  p_approve     boolean,
  p_final_price numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_req   public.discount_requests;
  v_max   numeric;
  v_limit numeric;
  v_base  numeric(12,2);
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode decidir descontos' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.discount_requests d WHERE d.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido inexistente';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Pedido já decidido';
  END IF;

  SELECT COALESCE((value->>'value')::numeric, 20) INTO v_limit
  FROM public.platform_settings WHERE key = 'max_discount_percent';
  v_limit := COALESCE(v_limit, 20);

  IF p_approve THEN
    -- O limite tem de ser calculado sobre o preço ATUAL de venda
    -- (promocional, se existir) — exactamente o mesmo valor que
    -- request_discount usou para validar o pedido.
    -- Usar aqui o preço oficial tornaria impossível aprovar qualquer
    -- desconto num produto que já esteja em promoção.
    SELECT COALESCE(p.promotional_price, p.official_price)
      INTO v_base
    FROM public.products p
    WHERE p.id = v_req.product_id;

    v_base := COALESCE(v_base, v_req.official_price);
    v_max  := v_base * (1 - v_limit / 100);

    IF COALESCE(p_final_price, v_req.requested_price) < v_max THEN
      RAISE EXCEPTION 'Desconto acima do limite permitido (% %%)', v_limit;
    END IF;

    UPDATE public.discount_requests d
    SET status = 'approved',
        final_price = COALESCE(p_final_price, d.requested_price),
        decided_by = auth.uid(),
        decided_at = now(),
        updated_at = now()
    WHERE d.id = v_req.id;
  ELSE
    UPDATE public.discount_requests d
    SET status = 'rejected',
        decided_by = auth.uid(),
        decided_at = now(),
        updated_at = now()
    WHERE d.id = v_req.id;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_req.customer_id,
    'discount_decision',
    CASE WHEN p_approve THEN 'Desconto aprovado' ELSE 'Desconto recusado' END,
    CASE WHEN p_approve THEN 'O seu pedido de desconto foi aprovado.'
         ELSE 'O seu pedido de desconto foi recusado.' END,
    jsonb_build_object('discount_request_id', v_req.id)
  );

  RETURN jsonb_build_object(
    'discount_request_id', v_req.id,
    'status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. CHAT
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(p_other_user uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_conv uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF p_other_user = v_uid THEN
    RAISE EXCEPTION 'Não pode conversar consigo próprio';
  END IF;

  SELECT c.id INTO v_conv
  FROM public.conversations c
  WHERE c.type = 'direct'
    AND (SELECT COUNT(*) FROM public.conversation_members m WHERE m.conversation_id = c.id) = 2
    AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id = c.id AND m.user_id = v_uid)
    AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id = c.id AND m.user_id = p_other_user)
  LIMIT 1;

  IF v_conv IS NULL THEN
    INSERT INTO public.conversations (type, created_by)
    VALUES ('direct', v_uid)
    RETURNING id INTO v_conv;

    INSERT INTO public.conversation_members (conversation_id, user_id)
    VALUES (v_conv, v_uid), (v_conv, p_other_user);
  END IF;

  RETURN v_conv;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_conversation_member(p_conversation_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta conversa' USING ERRCODE = '42501';
  END IF;

  UPDATE public.conversation_members cm
  SET last_read_at = now()
  WHERE cm.conversation_id = p_conversation_id AND cm.user_id = auth.uid();
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. STOCK (gerência)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_product_stock(
  p_product_id uuid,
  p_quantity   int,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prev int;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode alterar stock' USING ERRCODE = '42501';
  END IF;

  IF p_quantity < 0 THEN
    RAISE EXCEPTION 'A quantidade não pode ser negativa';
  END IF;

  INSERT INTO public.inventory (product_id, quantity)
  VALUES (p_product_id, p_quantity)
  ON CONFLICT (product_id) DO UPDATE
    SET quantity = EXCLUDED.quantity, updated_at = now()
  RETURNING (SELECT i.quantity FROM public.inventory i WHERE i.product_id = p_product_id)
  INTO v_prev;

  SELECT i.quantity INTO v_prev FROM public.inventory i WHERE i.product_id = p_product_id;

  INSERT INTO public.inventory_movements (
    product_id, type, quantity, previous_quantity, new_quantity, notes, created_by
  )
  VALUES (
    p_product_id, 'adjustment', 0, v_prev, p_quantity,
    COALESCE(NULLIF(btrim(p_reason), ''), 'Ajuste manual de stock'), auth.uid()
  );

  RETURN jsonb_build_object('product_id', p_product_id, 'quantity', p_quantity);
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. DASHBOARD (gerência)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_stats(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_from timestamptz := COALESCE(p_from, date_trunc('month', now()));
  v_to   timestamptz := COALESCE(p_to, now());
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode consultar indicadores' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'period_from', v_from,
    'period_to', v_to,
    'sales_total_value', (
      SELECT COALESCE(SUM(s.total_amount), 0) FROM public.sales s
      WHERE s.created_at BETWEEN v_from AND v_to
    ),
    'sales_count', (
      SELECT COUNT(*) FROM public.sales s WHERE s.created_at BETWEEN v_from AND v_to
    ),
    'orders_count', (
      SELECT COUNT(*) FROM public.orders o WHERE o.created_at BETWEEN v_from AND v_to
    ),
    'orders_by_status', (
      SELECT COALESCE(jsonb_object_agg(t.status, t.qty), '{}'::jsonb)
      FROM (
        SELECT o.status::text AS status, COUNT(*) AS qty
        FROM public.orders o WHERE o.created_at BETWEEN v_from AND v_to
        GROUP BY o.status
      ) t
    ),
    'customers_count', (
      SELECT COUNT(*) FROM public.profiles p WHERE p.role = 'customer'
    ),
    'sellers_count', (
      SELECT COUNT(*) FROM public.profiles p WHERE p.role = 'seller' AND p.is_active = true
    ),
    'active_reservations', (
      SELECT COUNT(*) FROM public.reservations r WHERE r.status = 'active'
    ),
    'pending_discounts', (
      SELECT COUNT(*) FROM public.discount_requests d WHERE d.status = 'pending'
    ),
    'low_stock_products', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT p.name, i.quantity, i.low_stock_threshold
        FROM public.inventory i
        JOIN public.products p ON p.id = i.product_id
        WHERE i.quantity <= i.low_stock_threshold
        ORDER BY i.quantity ASC
        LIMIT 20
      ) t
    ),
    'sales_by_seller', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT pr.full_name AS seller, COUNT(*) AS sales, SUM(s.total_amount) AS value
        FROM public.sales s
        JOIN public.profiles pr ON pr.id = s.seller_id
        WHERE s.created_at BETWEEN v_from AND v_to
        GROUP BY pr.full_name
        ORDER BY SUM(s.total_amount) DESC
        LIMIT 20
      ) t
    ),
    'top_products', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT si.product_snapshot->>'name' AS name, SUM(si.quantity) AS units, SUM(si.total_price) AS value
        FROM public.sale_items si
        JOIN public.sales s ON s.id = si.sale_id
        WHERE s.created_at BETWEEN v_from AND v_to
        GROUP BY si.product_snapshot->>'name'
        ORDER BY SUM(si.quantity) DESC
        LIMIT 10
      ) t
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 13. SINCRONIZAÇÃO OFFLINE
-- Recebe a fila do dispositivo e processa cada operação de forma idempotente.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_push(p_operations jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_op    jsonb;
  v_local uuid;
  v_ent   text;
  v_res   jsonb;
  v_out   jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF p_operations IS NULL OR jsonb_typeof(p_operations) <> 'array' THEN
    RAISE EXCEPTION 'Formato inválido';
  END IF;

  FOR v_op IN SELECT * FROM jsonb_array_elements(p_operations)
  LOOP
    v_local := (v_op->>'local_id')::uuid;
    v_ent   := v_op->>'entity';

    BEGIN
      IF v_ent = 'sale' THEN
        v_res := public.register_sale(
          (v_op->'payload')->'items',
          NULLIF(v_op->'payload'->>'customer_id', '')::uuid,
          v_op->'payload'->>'payment_method',
          COALESCE((v_op->'payload'->>'payment_status')::public.payment_status, 'pending'),
          v_op->'payload'->>'notes',
          v_op->>'local_id'
        );
      ELSIF v_ent = 'favorite' THEN
        INSERT INTO public.favorites (user_id, product_id)
        VALUES (v_uid, (v_op->'payload'->>'product_id')::uuid)
        ON CONFLICT (user_id, product_id) DO NOTHING;
        v_res := jsonb_build_object('ok', true);
      ELSIF v_ent = 'order' THEN
        v_res := public.place_order(
          (v_op->'payload')->'items',
          COALESCE(v_op->'payload'->>'delivery_method', 'pickup'),
          v_op->'payload'->>'delivery_address',
          v_op->'payload'->>'contact_phone',
          v_op->'payload'->>'notes',
          v_op->>'local_id'
        );
      ELSE
        RAISE EXCEPTION 'Entidade não suportada: %', v_ent;
      END IF;

      INSERT INTO public.sync_operations (user_id, local_id, entity, operation, payload, status, attempts)
      VALUES (v_uid, v_local, v_ent, 'create', v_op->'payload', 'synced', 1)
      ON CONFLICT (user_id, local_id, entity) DO UPDATE
        SET status = 'synced', attempts = public.sync_operations.attempts + 1, error_message = NULL;

      v_out := v_out || jsonb_build_object(
        'local_id', v_local, 'entity', v_ent, 'status', 'synced', 'result', v_res
      );
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.sync_operations (user_id, local_id, entity, operation, payload, status, attempts, error_message)
      VALUES (v_uid, v_local, v_ent, 'create', v_op->'payload', 'failed', 1, SQLERRM)
      ON CONFLICT (user_id, local_id, entity) DO UPDATE
        SET status = 'failed',
            attempts = public.sync_operations.attempts + 1,
            error_message = SQLERRM;

      v_out := v_out || jsonb_build_object(
        'local_id', v_local, 'entity', v_ent, 'status', 'failed', 'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('count', jsonb_array_length(v_out), 'results', v_out);
END;
$$;

-- -----------------------------------------------------------------------------
-- 14. PROMOVER UTILIZADOR A GESTOR (bootstrap)
-- Só pode ser executada pelo dono do projeto (postgres/service_role).
-- Chamar no SQL Editor, nunca a partir do frontend.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_to_manager(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_phone text := public.normalize_phone(p_phone);
  v_id    uuid;
BEGIN
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Telefone inválido';
  END IF;

  SELECT p.id INTO v_id FROM public.profiles p WHERE p.phone = v_phone;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nenhum perfil com o telefone %', v_phone;
  END IF;

  UPDATE public.profiles p SET role = 'manager', is_active = true WHERE p.id = v_id;

  INSERT INTO public.user_roles (user_id, role, assigned_by)
  VALUES (v_id, 'manager', v_id)
  ON CONFLICT (user_id) DO UPDATE SET role = 'manager', assigned_at = now();

  RETURN jsonb_build_object('user_id', v_id, 'role', 'manager');
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_to_seller(p_phone text, p_region text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_phone text := public.normalize_phone(p_phone);
  v_id    uuid;
BEGIN
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Telefone inválido';
  END IF;

  SELECT p.id INTO v_id FROM public.profiles p WHERE p.phone = v_phone;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nenhum perfil com o telefone %', v_phone;
  END IF;

  UPDATE public.profiles p SET role = 'seller' WHERE p.id = v_id;

  INSERT INTO public.user_roles (user_id, role, assigned_by)
  VALUES (v_id, 'seller', v_id)
  ON CONFLICT (user_id) DO UPDATE SET role = 'seller', assigned_at = now();

  INSERT INTO public.seller_profiles (id, region)
  VALUES (v_id, p_region)
  ON CONFLICT (id) DO NOTHING;

  RETURN jsonb_build_object('user_id', v_id, 'role', 'seller');
END;
$$;

-- -----------------------------------------------------------------------------
-- 15. REALTIME
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY['messages', 'conversations', 'notifications', 'orders', 'posts', 'discount_requests'];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    WHEN undefined_object THEN
      NULL;
    END;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 16. PERMISSÕES DE EXECUÇÃO
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.my_profile()                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_status(uuid, public.order_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_orders()                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_reservation(jsonb, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_reservation(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_sale(jsonb, uuid, text, public.payment_status, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_stats(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_customer_by_phone(text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_discount(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_discount(uuid, boolean, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_stock(uuid, int, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_stats(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_push(jsonb)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_reservations()               TO authenticated;

-- Funções de bootstrap: NÃO expor ao frontend
REVOKE ALL ON FUNCTION public.promote_to_manager(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_to_seller(text, text) FROM PUBLIC, anon, authenticated;


-- ###########################################################################
-- ##  PARTE 4 de 15 — DESIGNER (ESTÚDIO DE DESIGN)
-- ###########################################################################

-- =============================================================================
-- INUKA ANGOLA — MIGRAÇÃO 4/4 : DESIGNER (estúdio de design)
--
-- Cinco tabelas:
--   design_templates       modelos prontos, geridos pela gestão
--   design_projects        projetos do cliente (documento em jsonb, versionado)
--   design_assets          imagens carregadas pelo cliente (ficheiro no Storage)
--   design_versions        instantâneos do documento, para recuperação
--   designer_preferences   preferências do cliente (formato, fonte, snapping)
--
-- Decisões:
--   * O documento (páginas + elementos) vive num único jsonb. Um modelo
--     relacional de elementos obrigaria a reescrever N linhas a cada arrasto
--     do rato e não traria qualquer consulta que o produto precise.
--   * design_projects NÃO tem política de INSERT nem de UPDATE. Toda a escrita
--     passa pelas RPC (SECURITY DEFINER) que validam o dono e a versão. Assim
--     o cliente não consegue forjar `owner_id` nem saltar a concorrência
--     otimista incrementando `version` à mão.
--   * Isolamento estrito: cada cliente só vê e gere os seus projetos. Nem o
--     gestor lê projetos alheios — é o que o requisito pede.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABELAS
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.design_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text,
  category    text NOT NULL DEFAULT 'geral',
  format_key  text NOT NULL DEFAULT 'square',
  width       int  NOT NULL CHECK (width  BETWEEN 64 AND 8000),
  height      int  NOT NULL CHECK (height BETWEEN 64 AND 8000),
  pages       jsonb NOT NULL DEFAULT '[]'::jsonb,
  thumbnail   text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_templates_title_not_empty CHECK (length(btrim(title)) > 0),
  CONSTRAINT design_templates_pages_array CHECK (jsonb_typeof(pages) = 'array')
);

CREATE TABLE IF NOT EXISTS public.design_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title         text NOT NULL DEFAULT 'Sem título',
  format_key    text NOT NULL DEFAULT 'square',
  width         int  NOT NULL,
  height        int  NOT NULL,
  pages         jsonb NOT NULL DEFAULT '[]'::jsonb,
  thumbnail     text,
  template_id   uuid REFERENCES public.design_templates(id) ON DELETE SET NULL,
  version       int  NOT NULL DEFAULT 1,
  last_saved_at timestamptz,
  is_archived   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_projects_title_not_empty CHECK (length(btrim(title)) > 0),
  CONSTRAINT design_projects_size CHECK (width BETWEEN 64 AND 8000 AND height BETWEEN 64 AND 8000),
  CONSTRAINT design_projects_pages_array CHECK (jsonb_typeof(pages) = 'array'),
  -- A miniatura é um data URL pequeno; 400 kB é o teto que o editor respeita.
  CONSTRAINT design_projects_thumbnail_size CHECK (thumbnail IS NULL OR length(thumbnail) <= 400000),
  CONSTRAINT design_projects_version_positive CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS public.design_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  width        int,
  height       int,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_assets_name_not_empty CHECK (length(btrim(name)) > 0),
  CONSTRAINT design_assets_mime_image CHECK (mime_type LIKE 'image/%')
);

-- 1.4 Histórico: instantâneos do documento.
--     Guardar é autosave a cada 1,3 s; gravar um instantâneo a cada gravação
--     encheria a tabela em minutos. O instantâneo automático é limitado a um
--     por cada 5 minutos (ver design_save) e a lista é podada a 30 por projeto.
--     O cliente pode ainda criar instantâneos manuais com etiqueta.
CREATE TABLE IF NOT EXISTS public.design_versions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.design_projects(id) ON DELETE CASCADE,
  owner_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version    int  NOT NULL,
  title      text NOT NULL DEFAULT 'Sem título',
  pages      jsonb NOT NULL DEFAULT '[]'::jsonb,
  thumbnail  text,
  label      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_versions_pages_array CHECK (jsonb_typeof(pages) = 'array'),
  CONSTRAINT design_versions_version_positive CHECK (version > 0)
);

-- 1.5 Preferências: uma linha por utilizador.
CREATE TABLE IF NOT EXISTS public.designer_preferences (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_format_key text NOT NULL DEFAULT 'square',
  last_font       text NOT NULL DEFAULT 'Inter',
  snap_enabled    boolean NOT NULL DEFAULT true,
  grid_size       int NOT NULL DEFAULT 8 CHECK (grid_size BETWEEN 1 AND 200),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. ÍNDICES
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_design_versions_project
  ON public.design_versions (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_design_projects_owner
  ON public.design_projects (owner_id, updated_at DESC)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_design_projects_owner_all
  ON public.design_projects (owner_id);

CREATE INDEX IF NOT EXISTS idx_design_assets_owner
  ON public.design_assets (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_design_templates_active
  ON public.design_templates (sort_order, title)
  WHERE is_active = true;

-- -----------------------------------------------------------------------------
-- 3. TRIGGERS
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_design_projects_updated_at ON public.design_projects;
CREATE TRIGGER trg_design_projects_updated_at
  BEFORE UPDATE ON public.design_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_design_templates_updated_at ON public.design_templates;
CREATE TRIGGER trg_design_templates_updated_at
  BEFORE UPDATE ON public.design_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.design_projects  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_assets    ENABLE ROW LEVEL SECURITY;

-- 4.1 Projetos: dono único. Sem INSERT/UPDATE — escreve-se só por RPC.
DROP POLICY IF EXISTS design_projects_select ON public.design_projects;
CREATE POLICY design_projects_select ON public.design_projects
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS design_projects_delete ON public.design_projects;
CREATE POLICY design_projects_delete ON public.design_projects
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- 4.2 Modelos: leitura para todos os autenticados, gestão só para o gestor.
DROP POLICY IF EXISTS design_templates_select ON public.design_templates;
CREATE POLICY design_templates_select ON public.design_templates
  FOR SELECT TO authenticated
  USING (is_active = true OR public.is_manager());

DROP POLICY IF EXISTS design_templates_write ON public.design_templates;
CREATE POLICY design_templates_write ON public.design_templates
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- 4.3 Uploads: o cliente gere os seus; o gestor pode ler (suporte).
DROP POLICY IF EXISTS design_assets_select ON public.design_assets;
CREATE POLICY design_assets_select ON public.design_assets
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS design_assets_insert ON public.design_assets;
CREATE POLICY design_assets_insert ON public.design_assets
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS design_assets_update ON public.design_assets;
CREATE POLICY design_assets_update ON public.design_assets
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS design_assets_delete ON public.design_assets;
CREATE POLICY design_assets_delete ON public.design_assets
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- 4.4 Histórico: leitura só do dono. Sem INSERT/UPDATE/DELETE — escreve-se
--     apenas dentro das funções SECURITY DEFINER (design_save, snapshot,
--     restore), para o cliente não forjar instantâneos nem apagar o rasto.
ALTER TABLE public.design_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS design_versions_select ON public.design_versions;
CREATE POLICY design_versions_select ON public.design_versions
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

-- 4.5 Preferências: cada utilizador tem exatamente a sua linha.
ALTER TABLE public.designer_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS designer_preferences_select ON public.designer_preferences;
CREATE POLICY designer_preferences_select ON public.designer_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS designer_preferences_insert ON public.designer_preferences;
CREATE POLICY designer_preferences_insert ON public.designer_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS designer_preferences_update ON public.designer_preferences;
CREATE POLICY designer_preferences_update ON public.designer_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 5. STORAGE — bucket privado para imagens do designer
--    Caminho: design-assets/{user_id}/{uuid}.{ext}
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    RAISE NOTICE 'Schema storage inexistente — políticas de Storage do designer ignoradas.';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public)
  VALUES ('design-assets', 'design-assets', false)
  ON CONFLICT (id) DO NOTHING;

  BEGIN
    DROP POLICY IF EXISTS "inuka_design_assets_read"   ON storage.objects;
    DROP POLICY IF EXISTS "inuka_design_assets_insert" ON storage.objects;
    DROP POLICY IF EXISTS "inuka_design_assets_update" ON storage.objects;
    DROP POLICY IF EXISTS "inuka_design_assets_delete" ON storage.objects;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Sem permissão para gerir políticas de storage.objects.';
  END;

  -- Bucket privado: nem o dono lê sem política. A pasta tem de ser o seu uid.
  CREATE POLICY "inuka_design_assets_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'design-assets'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );

  CREATE POLICY "inuka_design_assets_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'design-assets'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );

  CREATE POLICY "inuka_design_assets_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      bucket_id = 'design-assets'
      AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
      bucket_id = 'design-assets'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );

  CREATE POLICY "inuka_design_assets_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id = 'design-assets'
      AND (storage.foldername(name))[1] = auth.uid()::text
    );
END $$;

-- -----------------------------------------------------------------------------
-- 6. LÓGICA DE NEGÓCIO
-- -----------------------------------------------------------------------------

-- 6.1 Criar projeto
CREATE OR REPLACE FUNCTION public.design_create(
  p_title       text DEFAULT 'Sem título',
  p_format_key  text DEFAULT 'square',
  p_width       int  DEFAULT 1080,
  p_height      int  DEFAULT 1080,
  p_pages       jsonb DEFAULT '[]'::jsonb,
  p_template_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_pages  jsonb := COALESCE(p_pages, '[]'::jsonb);
  v_row    public.design_projects;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  IF jsonb_typeof(v_pages) <> 'array' THEN
    RAISE EXCEPTION 'PAGINAS_INVALIDAS';
  END IF;

  IF p_width NOT BETWEEN 64 AND 8000 OR p_height NOT BETWEEN 64 AND 8000 THEN
    RAISE EXCEPTION 'DIMENSOES_INVALIDAS';
  END IF;

  -- Modelo inexistente ou desativado não bloqueia a criação: fica sem origem.
  IF p_template_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.design_templates
    WHERE id = p_template_id AND is_active = true
  ) THEN
    p_template_id := NULL;
  END IF;

  INSERT INTO public.design_projects (
    owner_id, title, format_key, width, height, pages, template_id, version, last_saved_at
  )
  VALUES (
    v_uid,
    COALESCE(NULLIF(btrim(p_title), ''), 'Sem título'),
    COALESCE(NULLIF(btrim(p_format_key), ''), 'square'),
    p_width,
    p_height,
    v_pages,
    p_template_id,
    1,
    now()
  )
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

-- 6.1b Podar o histórico: mantém os N instantâneos mais recentes.
--      Chamada de dentro de design_save e design_snapshot; não é exposta ao
--      cliente (sem GRANT), por isso não aparece em /rest/v1/rpc.
CREATE OR REPLACE FUNCTION public.design_versions_prune(p_id uuid, p_manter int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_apagadas int;
BEGIN
  WITH vivos AS (
    SELECT id
    FROM public.design_versions
    WHERE project_id = p_id
    ORDER BY created_at DESC
    LIMIT GREATEST(1, p_manter)
  )
  DELETE FROM public.design_versions dv
  WHERE dv.project_id = p_id
    AND dv.id NOT IN (SELECT id FROM vivos);

  GET DIAGNOSTICS v_apagadas = ROW_COUNT;
  RETURN v_apagadas;
END;
$$;

-- 6.2 Guardar projeto (concorrência otimista por versão)
--     Devolve {conflict:false, version, updated_at} quando grava.
--     Devolve {conflict:true, version, updated_at, pages, title} quando a versão
--     esperada já não é a atual — o cliente decide entre recarregar ou duplicar.
CREATE OR REPLACE FUNCTION public.design_save(
  p_id               uuid,
  p_pages            jsonb,
  p_title            text DEFAULT NULL,
  p_thumbnail        text DEFAULT NULL,
  p_expected_version int  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_row   public.design_projects;
  v_pages jsonb := COALESCE(p_pages, '[]'::jsonb);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  IF jsonb_typeof(v_pages) <> 'array' THEN
    RAISE EXCEPTION 'PAGINAS_INVALIDAS';
  END IF;

  SELECT * INTO v_row
  FROM public.design_projects
  WHERE id = p_id AND owner_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_row.version THEN
    RETURN jsonb_build_object(
      'conflict',   true,
      'version',    v_row.version,
      'updated_at', v_row.updated_at,
      'title',      v_row.title,
      'pages',      v_row.pages
    );
  END IF;

  UPDATE public.design_projects
     SET pages         = v_pages,
         title         = COALESCE(NULLIF(btrim(COALESCE(p_title, '')), ''), title),
         thumbnail     = COALESCE(p_thumbnail, thumbnail),
         version       = version + 1,
         last_saved_at = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  -- Instantâneo automático, no máximo um a cada 5 minutos. Um erro aqui não
  -- pode fazer falhar a gravação: o documento já está persistido.
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.design_versions
      WHERE project_id = p_id AND created_at > now() - interval '5 minutes'
    ) THEN
      INSERT INTO public.design_versions (project_id, owner_id, version, title, pages, thumbnail, label)
      VALUES (p_id, v_uid, v_row.version, v_row.title, v_row.pages, v_row.thumbnail, 'auto');

      PERFORM public.design_versions_prune(p_id, 30);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'conflict',   false,
    'version',    v_row.version,
    'updated_at', v_row.updated_at,
    'saved_at',   v_row.last_saved_at
  );
END;
$$;

-- 6.3 Duplicar projeto
CREATE OR REPLACE FUNCTION public.design_duplicate(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_src public.design_projects;
  v_new uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  SELECT * INTO v_src
  FROM public.design_projects
  WHERE id = p_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  INSERT INTO public.design_projects (
    owner_id, title, format_key, width, height, pages, thumbnail, template_id, version, last_saved_at
  )
  VALUES (
    v_uid,
    left(v_src.title || ' (cópia)', 120),
    v_src.format_key,
    v_src.width,
    v_src.height,
    v_src.pages,
    v_src.thumbnail,
    v_src.template_id,
    1,
    now()
  )
  RETURNING id INTO v_new;

  RETURN v_new;
END;
$$;

-- 6.4 Apagar projeto (definitivo — o cliente pediu-o explicitamente)
CREATE OR REPLACE FUNCTION public.design_delete(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  DELETE FROM public.design_projects
  WHERE id = p_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;
END;
$$;

-- 6.5 Renomear (operação leve, sem tocar no documento)
CREATE OR REPLACE FUNCTION public.design_rename(p_id uuid, p_title text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  UPDATE public.design_projects
     SET title = COALESCE(NULLIF(btrim(COALESCE(p_title, '')), ''), title)
   WHERE id = p_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;
END;
$$;

-- 6.6 Publicar um projeto como modelo (só gestão)
--     É isto que alimenta a galeria de modelos vista pelos clientes.
CREATE OR REPLACE FUNCTION public.design_publish_template(
  p_project_id uuid,
  p_title      text DEFAULT NULL,
  p_category   text DEFAULT 'geral'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_proj public.design_projects;
  v_novo uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  IF NOT COALESCE(public.is_manager(), false) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO';
  END IF;

  SELECT * INTO v_proj
  FROM public.design_projects
  WHERE id = p_project_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  INSERT INTO public.design_templates (
    title, description, category, format_key, width, height, pages, thumbnail, created_by
  )
  VALUES (
    COALESCE(NULLIF(btrim(COALESCE(p_title, '')), ''), v_proj.title),
    'Modelo publicado a partir de um projeto.',
    COALESCE(NULLIF(btrim(COALESCE(p_category, '')), ''), 'geral'),
    v_proj.format_key,
    v_proj.width,
    v_proj.height,
    v_proj.pages,
    v_proj.thumbnail,
    v_uid
  )
  RETURNING id INTO v_novo;

  RETURN v_novo;
END;
$$;

-- 6.7 Criar um instantâneo manual (botão "Guardar versão")
CREATE OR REPLACE FUNCTION public.design_snapshot(p_id uuid, p_label text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.design_projects;
  v_new uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  SELECT * INTO v_row
  FROM public.design_projects
  WHERE id = p_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  INSERT INTO public.design_versions (project_id, owner_id, version, title, pages, thumbnail, label)
  VALUES (
    p_id,
    v_uid,
    v_row.version,
    v_row.title,
    v_row.pages,
    v_row.thumbnail,
    NULLIF(btrim(COALESCE(p_label, '')), '')
  )
  RETURNING id INTO v_new;

  PERFORM public.design_versions_prune(p_id, 30);
  RETURN v_new;
END;
$$;

-- 6.8 Listar o histórico de um projeto (sem o documento, que é pesado)
CREATE OR REPLACE FUNCTION public.design_versions_list(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.design_projects WHERE id = p_id AND owner_id = v_uid
  ) THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'created_at') DESC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT jsonb_build_object(
             'id',         dv.id,
             'version',    dv.version,
             'title',      dv.title,
             'label',      dv.label,
             'created_at', dv.created_at,
             'thumbnail',  dv.thumbnail,
             'paginas',    jsonb_array_length(dv.pages),
             'elementos',  (
               SELECT coalesce(sum(jsonb_array_length(pg->'elements')), 0)
               FROM jsonb_array_elements(dv.pages) AS pg
               WHERE jsonb_typeof(pg->'elements') = 'array'
             )
           ) AS item
    FROM public.design_versions dv
    WHERE dv.project_id = p_id AND dv.owner_id = v_uid
    LIMIT 60
  ) t;

  RETURN v_out;
END;
$$;

-- 6.9 Restaurar uma versão anterior
--     Copia o documento da versão para o projeto, sobe a versão (para que
--     outros separadores detetem o conflito) e guarda o estado anterior como
--     instantâneo, para que a própria restauração seja reversível.
CREATE OR REPLACE FUNCTION public.design_restore_version(p_id uuid, p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ver public.design_versions;
  v_row public.design_projects;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  SELECT * INTO v_ver
  FROM public.design_versions
  WHERE id = p_version_id AND project_id = p_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VERSAO_NAO_ENCONTRADA';
  END IF;

  SELECT * INTO v_row
  FROM public.design_projects
  WHERE id = p_id AND owner_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  -- Guarda o estado atual antes de o substituir.
  INSERT INTO public.design_versions (project_id, owner_id, version, title, pages, thumbnail, label)
  VALUES (p_id, v_uid, v_row.version, v_row.title, v_row.pages, v_row.thumbnail, 'antes de restaurar');

  UPDATE public.design_projects
     SET pages         = v_ver.pages,
         title         = v_ver.title,
         thumbnail     = COALESCE(v_ver.thumbnail, thumbnail),
         version       = version + 1,
         last_saved_at = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  PERFORM public.design_versions_prune(p_id, 30);

  RETURN jsonb_build_object(
    'version',      v_row.version,
    'title',        v_row.title,
    'pages',        v_row.pages,
    'updated_at',   v_row.updated_at,
    'restaurado_de', v_ver.version
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. PERMISSÕES
-- -----------------------------------------------------------------------------
GRANT SELECT, DELETE ON public.design_projects  TO authenticated;
GRANT SELECT         ON public.design_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.design_assets TO authenticated;
GRANT SELECT         ON public.design_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.designer_preferences TO authenticated;

GRANT EXECUTE ON FUNCTION public.design_create(text, text, int, int, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_save(uuid, jsonb, text, text, int)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_duplicate(uuid)                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_delete(uuid)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_rename(uuid, text)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_publish_template(uuid, text, text)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_snapshot(uuid, text)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_versions_list(uuid)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.design_restore_version(uuid, uuid)                 TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. O ESTÚDIO É SÓ DA GESTÃO
-- -----------------------------------------------------------------------------
-- A rota /designer já é fechada no servidor (proxy + guarda na página), mas isso
-- é a interface. Sem esta guarda, um colaborador autenticado podia chamar
-- `design_create` pela API REST e criar projetos que nunca conseguiria abrir —
-- lixo na base de dados e uma permissão que o produto diz que não existe.
--
-- A guarda vive num gatilho, não em cada função: todas as escritas do estúdio
-- (criar, gravar, duplicar, renomear, restaurar) passam por `design_projects`,
-- por isso um gatilho cobre também qualquer código futuro que se esqueça de
-- verificar. `design_publish_template` já tinha a sua própria verificação.
--
-- `auth.uid() IS NULL` (service_role, scripts, SQL Editor) continua a escrever:
-- aí não há utilizador a quem negar, e o RLS já barra o anónimo.
CREATE OR REPLACE FUNCTION public.design_projects_so_gestao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT COALESCE(public.is_manager(), false) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS design_projects_so_gestao ON public.design_projects;
CREATE TRIGGER design_projects_so_gestao
  BEFORE INSERT OR UPDATE ON public.design_projects
  FOR EACH ROW EXECUTE FUNCTION public.design_projects_so_gestao();


-- ###########################################################################
-- ##  PARTE 5 de 15 — GESTÃO MULTIPROVINCIAL
-- ###########################################################################

-- =============================================================================
-- INUKA ANGOLA — MIGRAÇÃO 5/5 : GESTÃO MULTIPROVINCIAL
-- =============================================================================
-- O que esta migração acrescenta:
--   1. Tabela `provincias` (18 províncias de Angola) que funciona também como
--      registo de delegações.
--   2. `provincia_id` em perfis, produtos, stock, movimentos, encomendas,
--      reservas, vendas e distribuidores.
--   3. Funções de identidade provincial: my_province(), is_national(),
--      can_see_province(), can_manage_province().
--   4. RLS reescrita: cada utilizador provincial só vê a sua província;
--      a administração nacional vê tudo.
--   5. Stock por província (uma linha de inventário por produto e província)
--      e transferências entre províncias com aprovação nacional.
--   6. Código de referência único por pessoa (`profiles.referencia`).
--
-- PRINCÍPIO: nada é apagado. Os registos existentes são preservados e ficam
-- atribuídos de forma DETERMINÍSTICA (nunca aleatória) à província-sede.
--
-- É idempotente: pode ser executada mais do que uma vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PROVÍNCIAS / DELEGAÇÕES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provincias (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome               text NOT NULL UNIQUE,
  codigo             text NOT NULL UNIQUE,
  slug               text NOT NULL UNIQUE,
  capital            text,
  -- Dados da delegação. Uma província activa com delegação é, na prática,
  -- uma delegação da INUKA.
  delegacao_nome     text,
  delegacao_endereco text,
  delegacao_telefone text,
  is_default         boolean NOT NULL DEFAULT false,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provincias_codigo_format CHECK (codigo ~ '^[A-Z]{3}$'),
  CONSTRAINT provincias_slug_format   CHECK (slug ~ '^[a-z0-9-]+$')
);

-- Só pode existir uma província-sede (destino dos registos antigos).
CREATE UNIQUE INDEX IF NOT EXISTS provincias_uma_sede
  ON public.provincias (is_default) WHERE is_default;

INSERT INTO public.provincias (nome, codigo, slug, capital, delegacao_nome, is_default)
VALUES
  ('Bengo',          'BGO', 'bengo',          'Caxito',       'Delegação do Bengo',          false),
  ('Benguela',       'BGL', 'benguela',       'Benguela',     'Delegação de Benguela',       false),
  ('Bié',            'BIE', 'bie',            'Kuito',        'Delegação do Bié',            false),
  ('Cabinda',        'CAB', 'cabinda',        'Cabinda',      'Delegação de Cabinda',        false),
  ('Cuando Cubango', 'CCU', 'cuando-cubango', 'Menongue',     'Delegação do Cuando Cubango', false),
  ('Cuanza Norte',   'CNO', 'cuanza-norte',   'N''dalatando', 'Delegação do Cuanza Norte',   false),
  ('Cuanza Sul',     'CSU', 'cuanza-sul',     'Sumbe',        'Delegação do Cuanza Sul',     false),
  ('Cunene',         'CNN', 'cunene',         'Ondjiva',      'Delegação do Cunene',         false),
  ('Huambo',         'HUA', 'huambo',         'Huambo',       'Delegação do Huambo',         false),
  ('Huíla',          'HLA', 'huila',          'Lubango',      'Delegação da Huíla',          false),
  ('Luanda',         'LDA', 'luanda',         'Luanda',       'Delegação de Luanda',         true),
  ('Lunda Norte',    'LNO', 'lunda-norte',    'Dundo',        'Delegação da Lunda Norte',    false),
  ('Lunda Sul',      'LSU', 'lunda-sul',      'Saurimo',      'Delegação da Lunda Sul',      false),
  ('Malanje',        'MAL', 'malanje',        'Malanje',      'Delegação de Malanje',        false),
  ('Moxico',         'MOX', 'moxico',         'Luena',        'Delegação do Moxico',         false),
  ('Namibe',         'NAM', 'namibe',         'Moçâmedes',    'Delegação do Namibe',         false),
  ('Uíge',           'UIG', 'uige',           'Uíge',         'Delegação do Uíge',           false),
  ('Zaire',          'ZAI', 'zaire',          'Mbanza Kongo', 'Delegação do Zaire',          false)
ON CONFLICT (codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. COLUNAS DE PROVÍNCIA
-- -----------------------------------------------------------------------------
-- Perfis: `NULL` = ainda não atribuído (vê tudo, como hoje). A administração
-- nacional marca-se com `is_national_admin`.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS provincia_id      uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_national_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS referencia        text;

-- Produtos: `NULL` = produto nacional, visível em todas as províncias.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL;

-- Stock: uma linha por (produto, província). `NULL` = armazém-sede (legado).
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL;

ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL;

-- O stock deixou de ser único por produto: passa a ser único por
-- (produto, província). A linha da sede (provincia_id NULL) mantém-se única.
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_product_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_produto_provincia
  ON public.inventory (product_id, provincia_id) WHERE provincia_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_produto_sede
  ON public.inventory (product_id) WHERE provincia_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_provincia   ON public.profiles (provincia_id);
CREATE INDEX IF NOT EXISTS idx_products_provincia   ON public.products (provincia_id);
CREATE INDEX IF NOT EXISTS idx_inventory_provincia  ON public.inventory (provincia_id);
CREATE INDEX IF NOT EXISTS idx_movements_provincia  ON public.inventory_movements (provincia_id);
CREATE INDEX IF NOT EXISTS idx_orders_provincia     ON public.orders (provincia_id);
CREATE INDEX IF NOT EXISTS idx_sales_provincia      ON public.sales (provincia_id);
CREATE INDEX IF NOT EXISTS idx_reservas_provincia   ON public.reservations (provincia_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_referencia
  ON public.profiles (referencia) WHERE referencia IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. CÓDIGO DE REFERÊNCIA
-- -----------------------------------------------------------------------------
-- Cada pessoa (colaborador ou cliente) recebe uma referência legível e única,
-- com o código da província. Ex.: INK-UIG-00042.
CREATE SEQUENCE IF NOT EXISTS public.referencia_seq START 1;

CREATE OR REPLACE FUNCTION public.gerar_referencia(p_provincia_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_codigo text;
BEGIN
  SELECT pr.codigo INTO v_codigo
  FROM public.provincias pr WHERE pr.id = p_provincia_id;

  RETURN 'INK-' || COALESCE(v_codigo, 'NAC') || '-'
      || lpad(nextval('public.referencia_seq')::text, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.fill_referencia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_codigo text;
BEGIN
  SELECT pr.codigo INTO v_codigo
  FROM public.provincias pr WHERE pr.id = NEW.provincia_id;

  IF NEW.referencia IS NULL OR btrim(NEW.referencia) = '' THEN
    NEW.referencia := public.gerar_referencia(NEW.provincia_id);
    RETURN NEW;
  END IF;

  -- Mudou de província: o prefixo acompanha, o número NÃO.
  -- `INK-NAC-00003` → `INK-UIG-00003`. O número é a identidade da pessoa e
  -- pode já estar impresso num cartão; o prefixo é que diz a que delegação
  -- pertence. Sem isto, quem foi atribuído depois da migração ficava com o
  -- prefixo `NAC` para sempre.
  IF TG_OP = 'UPDATE' AND NEW.provincia_id IS DISTINCT FROM OLD.provincia_id THEN
    NEW.referencia := regexp_replace(
      NEW.referencia,
      '^INK-[A-Z]{3}-',
      'INK-' || COALESCE(v_codigo, 'NAC') || '-'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_referencia ON public.profiles;
CREATE TRIGGER trg_fill_referencia
BEFORE INSERT OR UPDATE OF provincia_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.fill_referencia();

-- O registo pode indicar a província nos metadados (slug, código ou nome).
-- Se não indicar, fica sem província e o gestor atribui depois.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_chave text := NULLIF(btrim(COALESCE(
    NEW.raw_user_meta_data->>'provincia_slug',
    NEW.raw_user_meta_data->>'provincia',
    NEW.raw_user_meta_data->>'province'
  )), '');
  v_prov uuid;
BEGIN
  IF v_chave IS NOT NULL THEN
    SELECT pr.id INTO v_prov
    FROM public.provincias pr
    WHERE pr.slug = lower(v_chave)
       OR pr.codigo = upper(v_chave)
       OR pr.nome ILIKE v_chave
    LIMIT 1;
  END IF;

  INSERT INTO public.profiles (id, role, full_name, phone, email, neighborhood, provincia_id)
  VALUES (
    NEW.id,
    'customer'::public.user_role,
    COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(COALESCE(NEW.email, 'Utilizador'), '@', 1)),
    public.normalize_phone(COALESCE(NEW.raw_user_meta_data->>'phone', NEW.phone)),
    NEW.email,
    NULLIF(btrim(NEW.raw_user_meta_data->>'neighborhood'), ''),
    v_prov
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. IDENTIDADE PROVINCIAL (funções de apoio ao RLS)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_province()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT p.provincia_id FROM public.profiles p WHERE p.id = auth.uid();
$$;

-- Administração nacional: marcada explicitamente OU sem província atribuída.
-- O segundo caso protege as contas que já existiam antes desta migração —
-- nenhuma delas fica sem acesso por não ter província.
CREATE OR REPLACE FUNCTION public.is_national()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT p.is_national_admin OR p.provincia_id IS NULL
     FROM public.profiles p WHERE p.id = auth.uid()),
    false
  );
$$;

-- Posso VER um registo desta província?
--   - administração nacional / sem província: vê tudo
--   - registo nacional (provincia_id NULL): visível a todos
--   - caso contrário: só a minha província
CREATE OR REPLACE FUNCTION public.can_see_province(p_provincia_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.is_national()
      OR p_provincia_id IS NULL
      OR p_provincia_id = public.my_province();
$$;

-- Posso GERIR um registo desta província?
-- (gerir é mais restrito do que ver: um registo nacional só é gerível pela
-- administração nacional)
CREATE OR REPLACE FUNCTION public.can_manage_province(p_provincia_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.is_national()
      OR (p_provincia_id IS NOT NULL AND p_provincia_id = public.my_province());
$$;

CREATE OR REPLACE FUNCTION public.default_province()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pr.id FROM public.provincias pr WHERE pr.is_default LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- 5. PROTEÇÃO: ninguém muda a própria província
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_province_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  -- SQL Editor / service_role / migrações não transportam JWT.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_national() THEN
    IF NEW.provincia_id IS DISTINCT FROM OLD.provincia_id THEN
      RAISE EXCEPTION 'A província só pode ser alterada pela administração nacional'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.is_national_admin IS DISTINCT FROM OLD.is_national_admin THEN
      RAISE EXCEPTION 'Apenas a administração nacional pode alterar este campo'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_province_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_province_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_province_escalation();

-- -----------------------------------------------------------------------------
-- 6. PREENCHIMENTO AUTOMÁTICO DA PROVÍNCIA
-- O cliente nunca escolhe a província: ela vem do perfil de quem escreve.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fill_province()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_me uuid := public.my_province();
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    IF TG_OP = 'INSERT' AND NEW.provincia_id IS NULL
       AND v_me IS NOT NULL AND NOT public.is_national() THEN
      NEW.provincia_id := v_me;
    ELSIF TG_OP = 'UPDATE' AND NEW.provincia_id IS DISTINCT FROM OLD.provincia_id
       AND NOT public.can_manage_province(NEW.provincia_id) THEN
      RAISE EXCEPTION 'Não pode mover produtos entre províncias' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'inventory' THEN
    IF TG_OP = 'INSERT' AND NEW.provincia_id IS NULL
       AND v_me IS NOT NULL AND NOT public.is_national() THEN
      NEW.provincia_id := v_me;
    END IF;
  ELSIF TG_TABLE_NAME = 'orders' THEN
    IF TG_OP = 'INSERT' THEN
      -- Numa inserção feita por um utilizador com sessão, a província é
      -- SEMPRE derivada do perfil — o valor enviado pelo cliente é ignorado.
      -- Sem sessão (service_role, SQL Editor) respeita-se o valor indicado.
      IF auth.uid() IS NOT NULL THEN
        NEW.provincia_id := COALESCE(
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.customer_id),
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.seller_id),
          public.default_province()
        );
      ELSIF NEW.provincia_id IS NULL THEN
        NEW.provincia_id := COALESCE(
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.customer_id),
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.seller_id),
          public.default_province()
        );
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'sales' THEN
    IF TG_OP = 'INSERT' THEN
      IF auth.uid() IS NOT NULL THEN
        NEW.provincia_id := COALESCE(
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.seller_id),
          public.default_province()
        );
      ELSIF NEW.provincia_id IS NULL THEN
        NEW.provincia_id := COALESCE(
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.seller_id),
          public.default_province()
        );
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'reservations' THEN
    IF TG_OP = 'INSERT' THEN
      IF auth.uid() IS NOT NULL THEN
        NEW.provincia_id := COALESCE(
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.customer_id),
          public.default_province()
        );
      ELSIF NEW.provincia_id IS NULL THEN
        NEW.provincia_id := COALESCE(
          (SELECT p.provincia_id FROM public.profiles p WHERE p.id = NEW.customer_id),
          public.default_province()
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_province_products ON public.products;
CREATE TRIGGER trg_fill_province_products
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.fill_province();

DROP TRIGGER IF EXISTS trg_fill_province_inventory ON public.inventory;
CREATE TRIGGER trg_fill_province_inventory
BEFORE INSERT ON public.inventory
FOR EACH ROW EXECUTE FUNCTION public.fill_province();

DROP TRIGGER IF EXISTS trg_fill_province_orders ON public.orders;
CREATE TRIGGER trg_fill_province_orders
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.fill_province();

DROP TRIGGER IF EXISTS trg_fill_province_sales ON public.sales;
CREATE TRIGGER trg_fill_province_sales
BEFORE INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.fill_province();

DROP TRIGGER IF EXISTS trg_fill_province_reservations ON public.reservations;
CREATE TRIGGER trg_fill_province_reservations
BEFORE INSERT ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.fill_province();

-- Manter o distribuidor alinhado com o perfil
CREATE OR REPLACE FUNCTION public.sync_seller_province()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.provincia_id IS DISTINCT FROM OLD.provincia_id THEN
    UPDATE public.seller_profiles sp
    SET provincia_id = NEW.provincia_id, updated_at = now()
    WHERE sp.id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_seller_province ON public.profiles;
CREATE TRIGGER trg_sync_seller_province
AFTER UPDATE OF provincia_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_seller_province();

-- -----------------------------------------------------------------------------
-- 7. PRESERVAR OS DADOS EXISTENTES (atribuição determinística)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_sede uuid := public.default_province();
BEGIN
  IF v_sede IS NULL THEN
    RAISE EXCEPTION 'Não existe província-sede (is_default). Migração abortada.';
  END IF;

  -- Gestores que já existiam passam a ser administração nacional.
  UPDATE public.profiles p
  SET is_national_admin = true
  WHERE p.role = 'manager' AND p.is_national_admin = false;

  -- Referências em falta
  UPDATE public.profiles p
  SET referencia = public.gerar_referencia(p.provincia_id)
  WHERE p.referencia IS NULL;

  -- Referências com o prefixo de outra província. Acontece a quem é atribuído
  -- depois da migração (a referência nasceu quando ninguém tinha província e
  -- ficou `INK-NAC-...`). O número fica, o prefixo corrige-se.
  UPDATE public.profiles p
  SET referencia = regexp_replace(
        p.referencia,
        '^INK-[A-Z]{3}-',
        'INK-' || COALESCE(
          (SELECT pr.codigo FROM public.provincias pr WHERE pr.id = p.provincia_id),
          'NAC'
        ) || '-'
      )
  WHERE p.referencia ~ '^INK-[A-Z]{3}-'
    AND p.referencia NOT LIKE 'INK-' || COALESCE(
          (SELECT pr.codigo FROM public.provincias pr WHERE pr.id = p.provincia_id),
          'NAC'
        ) || '-%';

  -- Stock existente: passa a ser o stock da sede.
  UPDATE public.inventory i
  SET provincia_id = v_sede
  WHERE i.provincia_id IS NULL;

  -- Movimentos: herdam a província da linha de stock.
  UPDATE public.inventory_movements m
  SET provincia_id = i.provincia_id
  FROM public.inventory i
  WHERE i.product_id = m.product_id AND m.provincia_id IS NULL;

  UPDATE public.inventory_movements m
  SET provincia_id = v_sede
  WHERE m.provincia_id IS NULL;

  -- Encomendas: província do colaborador que acompanha, senão do cliente.
  UPDATE public.orders o
  SET provincia_id = COALESCE(
    (SELECT p.provincia_id FROM public.profiles p WHERE p.id = o.seller_id),
    (SELECT p.provincia_id FROM public.profiles p WHERE p.id = o.customer_id),
    v_sede
  )
  WHERE o.provincia_id IS NULL;

  UPDATE public.reservations r
  SET provincia_id = COALESCE(
    (SELECT p.provincia_id FROM public.profiles p WHERE p.id = r.customer_id),
    v_sede
  )
  WHERE r.provincia_id IS NULL;

  UPDATE public.sales s
  SET provincia_id = COALESCE(
    (SELECT p.provincia_id FROM public.profiles p WHERE p.id = s.seller_id),
    v_sede
  )
  WHERE s.provincia_id IS NULL;

  UPDATE public.seller_profiles sp
  SET provincia_id = (SELECT p.provincia_id FROM public.profiles p WHERE p.id = sp.id)
  WHERE sp.provincia_id IS NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 8. TRANSFERÊNCIAS DE STOCK ENTRE PROVÍNCIAS
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.transferencia_seq START 1;

CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         text NOT NULL UNIQUE,
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  from_provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  to_provincia_id   uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  quantity          int NOT NULL CHECK (quantity > 0),
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfers_provincias_distintas
    CHECK (from_provincia_id IS DISTINCT FROM to_provincia_id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_status ON public.stock_transfers (status, created_at DESC);

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 9. RPC: ATRIBUIR PROVÍNCIA A UM UTILIZADOR
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_province(
  p_user_id      uuid,
  p_provincia_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_role public.user_role;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode atribuir províncias' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_manage_province(p_provincia_id) THEN
    RAISE EXCEPTION 'Só pode atribuir a sua própria província' USING ERRCODE = '42501';
  END IF;

  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Utilizador inexistente';
  END IF;

  UPDATE public.profiles p
  SET provincia_id = p_provincia_id, updated_at = now()
  WHERE p.id = p_user_id;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'provincia_id', p_provincia_id,
    'role', v_role
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. RPC: INDICADORES POR PROVÍNCIA (administração nacional)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.province_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_national() THEN
    RAISE EXCEPTION 'Apenas a administração nacional pode comparar províncias'
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(t ORDER BY t.nome)
    FROM (
      SELECT
        pr.id,
        pr.nome,
        pr.codigo,
        pr.slug,
        pr.delegacao_nome,
        pr.is_active,
        (SELECT COUNT(*) FROM public.profiles p
          WHERE p.provincia_id = pr.id AND p.role = 'seller' AND p.is_active)::int AS colaboradores,
        (SELECT COUNT(*) FROM public.profiles p
          WHERE p.provincia_id = pr.id AND p.role = 'customer')::int AS clientes,
        (SELECT COUNT(*) FROM public.products pd
          WHERE pd.provincia_id = pr.id AND pd.is_active)::int AS produtos,
        (SELECT COALESCE(SUM(i.quantity), 0) FROM public.inventory i
          WHERE i.provincia_id = pr.id)::int AS stock_total,
        (SELECT COUNT(*) FROM public.inventory i
          WHERE i.provincia_id = pr.id AND i.quantity <= i.low_stock_threshold)::int AS stock_baixo,
        (SELECT COALESCE(SUM(s.total_amount), 0) FROM public.sales s
          WHERE s.provincia_id = pr.id) AS vendas_valor,
        (SELECT COUNT(*) FROM public.sales s WHERE s.provincia_id = pr.id)::int AS vendas_count,
        (SELECT COUNT(*) FROM public.orders o WHERE o.provincia_id = pr.id)::int AS encomendas_count
      FROM public.provincias pr
    ) t
  ), '[]'::jsonb);
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. RPC: TRANSFERÊNCIAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_stock_transfer(
  p_product_id uuid,
  p_from       uuid,
  p_to         uuid,
  p_quantity   int,
  p_notes      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ref text;
  v_id  uuid;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode pedir transferências' USING ERRCODE = '42501';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade inválida';
  END IF;

  IF p_from IS NOT DISTINCT FROM p_to THEN
    RAISE EXCEPTION 'A origem e o destino têm de ser províncias diferentes';
  END IF;

  IF p_to IS NULL THEN
    RAISE EXCEPTION 'Indique a província de destino';
  END IF;

  IF NOT public.is_national() AND p_from IS DISTINCT FROM public.my_province() THEN
    RAISE EXCEPTION 'Só pode transferir a partir da sua província' USING ERRCODE = '42501';
  END IF;

  v_ref := 'TRF-' || lpad(nextval('public.transferencia_seq')::text, 5, '0');

  INSERT INTO public.stock_transfers (
    reference, product_id, from_provincia_id, to_provincia_id,
    quantity, status, requested_by, notes
  )
  VALUES (
    v_ref, p_product_id, p_from, p_to, p_quantity, 'pending', auth.uid(),
    NULLIF(btrim(p_notes), '')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('transfer_id', v_id, 'reference', v_ref, 'status', 'pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_stock_transfer(
  p_transfer_id uuid,
  p_approve     boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_tr     public.stock_transfers;
  v_origem int;
BEGIN
  -- A aprovação é sempre nacional: é o controlo central das quantidades.
  IF NOT public.is_national() THEN
    RAISE EXCEPTION 'Apenas a administração nacional aprova transferências'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_tr FROM public.stock_transfers t
  WHERE t.id = p_transfer_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transferência inexistente';
  END IF;

  IF v_tr.status <> 'pending' THEN
    RAISE EXCEPTION 'Esta transferência já foi decidida (estado: %)', v_tr.status;
  END IF;

  IF NOT p_approve THEN
    UPDATE public.stock_transfers t
    SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), updated_at = now()
    WHERE t.id = v_tr.id;

    RETURN jsonb_build_object('transfer_id', v_tr.id, 'status', 'rejected');
  END IF;

  SELECT i.quantity INTO v_origem
  FROM public.inventory i
  WHERE i.product_id = v_tr.product_id
    AND i.provincia_id IS NOT DISTINCT FROM v_tr.from_provincia_id
  FOR UPDATE;

  IF v_origem IS NULL THEN
    RAISE EXCEPTION 'A província de origem não tem stock deste produto';
  END IF;

  IF v_origem < v_tr.quantity THEN
    RAISE EXCEPTION 'Stock insuficiente na origem (disponível: %)', v_origem;
  END IF;

  UPDATE public.inventory i
  SET quantity = i.quantity - v_tr.quantity, updated_at = now()
  WHERE i.product_id = v_tr.product_id
    AND i.provincia_id IS NOT DISTINCT FROM v_tr.from_provincia_id;

  INSERT INTO public.inventory_movements (
    product_id, provincia_id, type, quantity, previous_quantity, new_quantity, reference, notes, created_by
  )
  VALUES (
    v_tr.product_id, v_tr.from_provincia_id, 'out', v_tr.quantity,
    v_origem, v_origem - v_tr.quantity, v_tr.reference,
    'Transferência enviada', auth.uid()
  );

  -- Destino: pode ainda não ter linha de stock
  INSERT INTO public.inventory (product_id, provincia_id, quantity)
  VALUES (v_tr.product_id, v_tr.to_provincia_id, v_tr.quantity)
  ON CONFLICT (product_id, provincia_id) WHERE provincia_id IS NOT NULL
  DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity, updated_at = now();

  INSERT INTO public.inventory_movements (
    product_id, provincia_id, type, quantity, previous_quantity, new_quantity, reference, notes, created_by
  )
  SELECT
    v_tr.product_id, v_tr.to_provincia_id, 'in', v_tr.quantity,
    i.quantity - v_tr.quantity, i.quantity, v_tr.reference,
    'Transferência recebida', auth.uid()
  FROM public.inventory i
  WHERE i.product_id = v_tr.product_id
    AND i.provincia_id IS NOT DISTINCT FROM v_tr.to_provincia_id;

  UPDATE public.stock_transfers t
  SET status = 'approved', decided_by = auth.uid(), decided_at = now(), updated_at = now()
  WHERE t.id = v_tr.id;

  RETURN jsonb_build_object('transfer_id', v_tr.id, 'status', 'approved');
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. STOCK POR PROVÍNCIA
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_product_stock(uuid, int, text);

CREATE OR REPLACE FUNCTION public.set_product_stock(
  p_product_id   uuid,
  p_quantity     int,
  p_reason       text DEFAULT NULL,
  p_provincia_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov uuid := COALESCE(p_provincia_id, public.my_province());
  v_prev int := 0;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode alterar stock' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Só pode alterar stock da sua província' USING ERRCODE = '42501';
  END IF;

  IF p_quantity < 0 THEN
    RAISE EXCEPTION 'A quantidade não pode ser negativa';
  END IF;

  SELECT COALESCE(i.quantity, 0) INTO v_prev
  FROM public.inventory i
  WHERE i.product_id = p_product_id
    AND i.provincia_id IS NOT DISTINCT FROM v_prov;

  v_prev := COALESCE(v_prev, 0);

  IF v_prov IS NULL THEN
    INSERT INTO public.inventory (product_id, provincia_id, quantity)
    VALUES (p_product_id, NULL, p_quantity)
    ON CONFLICT (product_id) WHERE provincia_id IS NULL
    DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();
  ELSE
    INSERT INTO public.inventory (product_id, provincia_id, quantity)
    VALUES (p_product_id, v_prov, p_quantity)
    ON CONFLICT (product_id, provincia_id) WHERE provincia_id IS NOT NULL
    DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();
  END IF;

  INSERT INTO public.inventory_movements (
    product_id, provincia_id, type, quantity, previous_quantity, new_quantity, notes, created_by
  )
  VALUES (
    p_product_id, v_prov, 'adjustment', p_quantity - v_prev, v_prev, p_quantity,
    COALESCE(NULLIF(btrim(p_reason), ''), 'Ajuste manual de stock'), auth.uid()
  );

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'provincia_id', v_prov,
    'quantity', p_quantity
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 13. ENCOMENDAS COM STOCK PROVINCIAL
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_order(
  p_items            jsonb,
  p_delivery_method  text DEFAULT 'pickup',
  p_delivery_address text DEFAULT NULL,
  p_contact_phone    text DEFAULT NULL,
  p_notes            text DEFAULT NULL,
  p_client_ref       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_order_id uuid;
  v_ref      text;
  v_item     jsonb;
  v_prod     record;
  v_inv      record;
  v_prov     uuid;
  v_qty      int;
  v_price    numeric(12,2);
  v_total    numeric(12,2) := 0;
  v_existing public.orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_customer() THEN
    RAISE EXCEPTION 'Apenas clientes podem criar encomendas' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'O carrinho está vazio';
  END IF;

  IF p_delivery_method NOT IN ('pickup', 'delivery') THEN
    RAISE EXCEPTION 'Modalidade de entrega inválida';
  END IF;

  IF p_delivery_method = 'delivery' AND COALESCE(btrim(p_delivery_address), '') = '' THEN
    RAISE EXCEPTION 'Indique o endereço de entrega';
  END IF;

  IF p_client_ref IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.orders o
    WHERE o.customer_id = v_uid AND o.client_ref = p_client_ref;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id', v_existing.id,
        'reference', v_existing.reference,
        'total', v_existing.total_amount,
        'duplicated', true
      );
    END IF;
  END IF;

  v_ref := public.generate_order_reference();
  -- A província da encomenda vem do perfil do cliente (nunca do cliente HTTP).
  v_prov := public.my_province();

  INSERT INTO public.orders (
    reference, client_ref, customer_id, status, delivery_method,
    delivery_address, contact_phone, notes, payment_status, provincia_id
  )
  VALUES (
    v_ref, p_client_ref, v_uid, 'pending', p_delivery_method,
    NULLIF(btrim(p_delivery_address), ''), NULLIF(btrim(p_contact_phone), ''),
    NULLIF(btrim(p_notes), ''), 'pending', v_prov
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida';
    END IF;

    SELECT p.id, p.name, p.official_price, p.promotional_price, p.is_active, p.provincia_id
      INTO v_prod
    FROM public.products p
    WHERE p.id = (v_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto inexistente';
    END IF;

    IF NOT v_prod.is_active THEN
      RAISE EXCEPTION 'Produto indisponível: %', v_prod.name;
    END IF;

    -- Produto provincial só se vende na sua província
    IF v_prod.provincia_id IS NOT NULL AND v_prod.provincia_id IS DISTINCT FROM v_prov THEN
      RAISE EXCEPTION 'O produto % não está disponível na sua província', v_prod.name
        USING ERRCODE = '42501';
    END IF;

    v_price := COALESCE(v_prod.promotional_price, v_prod.official_price);

    -- Linha de stock: a da província do cliente; se não existir, a da sede.
    SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
    FROM public.inventory i
    WHERE i.product_id = v_prod.id
      AND i.provincia_id IS NOT DISTINCT FROM v_prov
    LIMIT 1;

    IF NOT FOUND AND v_prov IS NOT NULL THEN
      SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_prod.id AND i.provincia_id IS NULL
      LIMIT 1;
    END IF;

    -- Última tentativa: o armazém-sede. A sede é a província marcada
    -- `is_default` (Luanda). Sem este passo, um cliente sem província — conta
    -- antiga ou criada pela gestão sem província — comprava **sem reservar
    -- stock nenhum**: a linha `provincia_id IS NULL` deixou de existir quando
    -- o inventário legado passou a pertencer à sede como província real.
    IF v_inv.id IS NULL THEN
      SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
      FROM public.inventory i
      JOIN public.provincias pr ON pr.id = i.provincia_id
      WHERE i.product_id = v_prod.id AND pr.is_default
      ORDER BY i.updated_at DESC
      LIMIT 1;
    END IF;

    IF v_inv.id IS NOT NULL THEN
      UPDATE public.inventory i
      SET reserved_quantity = i.reserved_quantity + v_qty,
          updated_at = now()
      WHERE i.id = v_inv.id
        AND (i.quantity - i.reserved_quantity) >= v_qty;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente para %', v_prod.name;
      END IF;
    END IF;

    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, total_price)
    VALUES (v_order_id, v_prod.id, v_qty, v_price, v_price * v_qty);
  END LOOP;

  SELECT COALESCE(SUM(oi.total_price), 0) INTO v_total
  FROM public.order_items oi WHERE oi.order_id = v_order_id;

  INSERT INTO public.order_status_history (order_id, status, previous_status, changed_by, notes)
  VALUES (v_order_id, 'pending', NULL, v_uid, 'Encomenda criada');

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'reference', v_ref,
    'total', v_total,
    'duplicated', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id uuid,
  p_status   public.order_status,
  p_notes    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_order public.orders;
  v_item  record;
  v_inv   record;
BEGIN
  SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Encomenda inexistente';
  END IF;

  IF NOT (
    public.is_manager()
    OR v_order.customer_id = auth.uid()
    OR COALESCE(v_order.seller_id = auth.uid(), false)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para alterar esta encomenda' USING ERRCODE = '42501';
  END IF;

  IF public.is_manager()
     AND NOT public.can_manage_province(v_order.provincia_id) THEN
    RAISE EXCEPTION 'Encomenda de outra província' USING ERRCODE = '42501';
  END IF;

  IF v_order.customer_id = auth.uid()
     AND NOT public.is_manager()
     AND p_status <> 'cancelled' THEN
    RAISE EXCEPTION 'O cliente apenas pode cancelar a encomenda' USING ERRCODE = '42501';
  END IF;

  IF v_order.status = 'completed' THEN
    RAISE EXCEPTION 'Encomenda já concluída não pode ser alterada';
  END IF;

  IF p_status = v_order.status THEN
    RETURN jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'changed', false);
  END IF;

  IF p_status = 'completed' THEN
    FOR v_item IN
      SELECT oi.product_id, oi.quantity FROM public.order_items oi WHERE oi.order_id = v_order.id
    LOOP
      SELECT i.id, i.quantity INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_item.product_id
        AND i.provincia_id IS NOT DISTINCT FROM v_order.provincia_id
      LIMIT 1;

      IF NOT FOUND AND v_order.provincia_id IS NOT NULL THEN
        SELECT i.id, i.quantity INTO v_inv
        FROM public.inventory i
        WHERE i.product_id = v_item.product_id AND i.provincia_id IS NULL
        LIMIT 1;
      END IF;

      IF v_inv.id IS NOT NULL THEN
        UPDATE public.inventory i
        SET quantity = i.quantity - v_item.quantity,
            reserved_quantity = GREATEST(i.reserved_quantity - v_item.quantity, 0),
            updated_at = now()
        WHERE i.id = v_inv.id;

        INSERT INTO public.inventory_movements (
          product_id, provincia_id, type, quantity, previous_quantity, new_quantity,
          reference, notes, created_by
        )
        VALUES (
          v_item.product_id, v_order.provincia_id, 'out', v_item.quantity,
          v_inv.quantity, v_inv.quantity - v_item.quantity,
          v_order.reference, 'Encomenda concluída', auth.uid()
        );
      END IF;
    END LOOP;
  END IF;

  IF p_status = 'cancelled' THEN
    FOR v_item IN
      SELECT oi.product_id, oi.quantity FROM public.order_items oi WHERE oi.order_id = v_order.id
    LOOP
      SELECT i.id INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_item.product_id
        AND i.provincia_id IS NOT DISTINCT FROM v_order.provincia_id
      LIMIT 1;

      IF NOT FOUND AND v_order.provincia_id IS NOT NULL THEN
        SELECT i.id INTO v_inv
        FROM public.inventory i
        WHERE i.product_id = v_item.product_id AND i.provincia_id IS NULL
        LIMIT 1;
      END IF;

      IF v_inv.id IS NOT NULL THEN
        UPDATE public.inventory i
        SET reserved_quantity = GREATEST(i.reserved_quantity - v_item.quantity, 0),
            updated_at = now()
        WHERE i.id = v_inv.id;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.orders o
  SET status = p_status,
      notes = COALESCE(p_notes, o.notes),
      payment_status = CASE WHEN p_status = 'completed' THEN 'paid'::public.payment_status ELSE o.payment_status END,
      updated_at = now()
  WHERE o.id = v_order.id;

  UPDATE public.order_status_history h
  SET notes = p_notes
  WHERE h.order_id = v_order.id
    AND h.id = (
      SELECT h2.id FROM public.order_status_history h2
      WHERE h2.order_id = v_order.id
      ORDER BY h2.created_at DESC LIMIT 1
    );

  RETURN jsonb_build_object('order_id', v_order.id, 'status', p_status, 'changed', true);
END;
$$;

-- -----------------------------------------------------------------------------
-- 14. RESERVAS COM STOCK PROVINCIAL
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_reservation(
  p_items      jsonb,
  p_expires_at timestamptz DEFAULT NULL,
  p_notes      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_item  jsonb;
  v_prod  record;
  v_inv   record;
  v_prov  uuid;
  v_qty   int;
  v_price numeric(12,2);
  v_hours int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_customer() THEN
    RAISE EXCEPTION 'Apenas clientes podem reservar' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum produto indicado';
  END IF;

  IF p_expires_at IS NULL THEN
    SELECT COALESCE((value->>'value')::int, 48) INTO v_hours
    FROM public.platform_settings WHERE key = 'reservation_expiry_hours';
    v_hours := COALESCE(v_hours, 48);
    p_expires_at := now() + (v_hours || ' hours')::interval;
  END IF;

  v_prov := public.my_province();

  INSERT INTO public.reservations (customer_id, status, expires_at, notes, provincia_id)
  VALUES (v_uid, 'active', p_expires_at, NULLIF(btrim(p_notes), ''), v_prov)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida';
    END IF;

    SELECT p.id, p.name, p.official_price, p.promotional_price, p.is_active, p.provincia_id
      INTO v_prod
    FROM public.products p
    WHERE p.id = (v_item->>'product_id')::uuid;

    IF NOT FOUND OR NOT v_prod.is_active THEN
      RAISE EXCEPTION 'Produto indisponível';
    END IF;

    IF v_prod.provincia_id IS NOT NULL AND v_prod.provincia_id IS DISTINCT FROM v_prov THEN
      RAISE EXCEPTION 'O produto % não está disponível na sua província', v_prod.name
        USING ERRCODE = '42501';
    END IF;

    v_price := COALESCE(v_prod.promotional_price, v_prod.official_price);

    SELECT i.id INTO v_inv
    FROM public.inventory i
    WHERE i.product_id = v_prod.id
      AND i.provincia_id IS NOT DISTINCT FROM v_prov
    LIMIT 1;

    IF NOT FOUND AND v_prov IS NOT NULL THEN
      SELECT i.id INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_prod.id AND i.provincia_id IS NULL
      LIMIT 1;
    END IF;

    IF v_inv.id IS NOT NULL THEN
      UPDATE public.inventory i
      SET reserved_quantity = i.reserved_quantity + v_qty,
          updated_at = now()
      WHERE i.id = v_inv.id
        AND (i.quantity - i.reserved_quantity) >= v_qty;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente para %', v_prod.name;
      END IF;
    END IF;

    INSERT INTO public.reservation_items (reservation_id, product_id, quantity, unit_price)
    VALUES (v_id, v_prod.id, v_qty, v_price);
  END LOOP;

  RETURN jsonb_build_object('reservation_id', v_id, 'expires_at', p_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_reservation(p_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_res public.reservations;
  v_it  record;
  v_inv record;
BEGIN
  SELECT * INTO v_res FROM public.reservations r WHERE r.id = p_reservation_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva inexistente';
  END IF;

  IF NOT (
    public.is_manager()
    OR v_res.customer_id = auth.uid()
    OR COALESCE(v_res.seller_id = auth.uid(), false)
  ) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;

  FOR v_it IN SELECT ri.product_id, ri.quantity FROM public.reservation_items ri WHERE ri.reservation_id = v_res.id
  LOOP
    SELECT i.id INTO v_inv
    FROM public.inventory i
    WHERE i.product_id = v_it.product_id
      AND i.provincia_id IS NOT DISTINCT FROM v_res.provincia_id
    LIMIT 1;

    IF NOT FOUND AND v_res.provincia_id IS NOT NULL THEN
      SELECT i.id INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_it.product_id AND i.provincia_id IS NULL
      LIMIT 1;
    END IF;

    IF v_inv.id IS NOT NULL THEN
      UPDATE public.inventory i
      SET reserved_quantity = GREATEST(i.reserved_quantity - v_it.quantity, 0),
          updated_at = now()
      WHERE i.id = v_inv.id;
    END IF;
  END LOOP;

  UPDATE public.reservations r
  SET status = 'cancelled', updated_at = now()
  WHERE r.id = v_res.id;

  RETURN jsonb_build_object('reservation_id', v_res.id, 'status', 'cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_reservations()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res record;
  v_it  record;
  v_inv record;
  v_count int := 0;
BEGIN
  FOR v_res IN
    SELECT r.id, r.provincia_id FROM public.reservations r
    WHERE r.status = 'active' AND r.expires_at IS NOT NULL AND r.expires_at < now()
    FOR UPDATE
  LOOP
    FOR v_it IN SELECT ri.product_id, ri.quantity FROM public.reservation_items ri WHERE ri.reservation_id = v_res.id
    LOOP
      SELECT i.id INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_it.product_id
        AND i.provincia_id IS NOT DISTINCT FROM v_res.provincia_id
      LIMIT 1;

      IF NOT FOUND AND v_res.provincia_id IS NOT NULL THEN
        SELECT i.id INTO v_inv
        FROM public.inventory i
        WHERE i.product_id = v_it.product_id AND i.provincia_id IS NULL
        LIMIT 1;
      END IF;

      IF v_inv.id IS NOT NULL THEN
        UPDATE public.inventory i
        SET reserved_quantity = GREATEST(i.reserved_quantity - v_it.quantity, 0),
            updated_at = now()
        WHERE i.id = v_inv.id;
      END IF;
    END LOOP;

    UPDATE public.reservations r SET status = 'expired', updated_at = now() WHERE r.id = v_res.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- 15. VENDAS COM STOCK PROVINCIAL
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_sale(
  p_items          jsonb,
  p_customer_id    uuid DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_payment_status public.payment_status DEFAULT 'pending',
  p_notes          text DEFAULT NULL,
  p_client_ref     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_sale_id  uuid;
  v_ref      text;
  v_item     jsonb;
  v_prod     record;
  v_inv      record;
  v_prov     uuid;
  v_qty      int;
  v_price    numeric(12,2);
  v_total    numeric(12,2) := 0;
  v_existing public.sales;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_seller() THEN
    RAISE EXCEPTION 'Apenas vendedores podem registar vendas' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum produto indicado';
  END IF;

  IF p_customer_id IS NOT NULL
     AND NOT public.is_manager()
     AND NOT public.is_my_customer(p_customer_id) THEN
    RAISE EXCEPTION 'Cliente não associado a este vendedor' USING ERRCODE = '42501';
  END IF;

  IF p_client_ref IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.sales s
    WHERE s.seller_id = v_uid AND s.client_ref = p_client_ref;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'sale_id', v_existing.id,
        'reference', v_existing.reference,
        'total', v_existing.total_amount,
        'duplicated', true
      );
    END IF;
  END IF;

  v_ref := public.generate_sale_reference();
  v_prov := public.my_province();

  INSERT INTO public.sales (
    reference, client_ref, seller_id, customer_id, payment_method,
    payment_status, notes, is_offline, sync_status, provincia_id
  )
  VALUES (
    v_ref, p_client_ref, v_uid, p_customer_id,
    NULLIF(btrim(p_payment_method), ''), p_payment_status,
    NULLIF(btrim(p_notes), ''), p_client_ref IS NOT NULL, 'synced', v_prov
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida';
    END IF;

    SELECT p.id, p.name, p.sku, p.official_price, p.promotional_price, p.is_active, p.provincia_id
      INTO v_prod
    FROM public.products p
    WHERE p.id = (v_item->>'product_id')::uuid;

    IF NOT FOUND OR NOT v_prod.is_active THEN
      RAISE EXCEPTION 'Produto indisponível';
    END IF;

    IF v_prod.provincia_id IS NOT NULL AND v_prod.provincia_id IS DISTINCT FROM v_prov THEN
      RAISE EXCEPTION 'O produto % não está disponível na sua província', v_prod.name
        USING ERRCODE = '42501';
    END IF;

    v_price := COALESCE(v_prod.promotional_price, v_prod.official_price);

    SELECT i.id, i.quantity INTO v_inv
    FROM public.inventory i
    WHERE i.product_id = v_prod.id
      AND i.provincia_id IS NOT DISTINCT FROM v_prov
    LIMIT 1;

    IF NOT FOUND AND v_prov IS NOT NULL THEN
      SELECT i.id, i.quantity INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_prod.id AND i.provincia_id IS NULL
      LIMIT 1;
    END IF;

    IF v_inv.id IS NOT NULL THEN
      IF v_inv.quantity < v_qty THEN
        RAISE EXCEPTION 'Stock insuficiente para % (disponível: %)', v_prod.name, v_inv.quantity;
      END IF;

      UPDATE public.inventory i
      SET quantity = i.quantity - v_qty, updated_at = now()
      WHERE i.id = v_inv.id;

      INSERT INTO public.inventory_movements (
        product_id, provincia_id, type, quantity, previous_quantity, new_quantity,
        reference, notes, created_by
      )
      VALUES (
        v_prod.id, v_prov, 'out', v_qty, v_inv.quantity, v_inv.quantity - v_qty,
        v_ref, 'Venda registada', v_uid
      );
    END IF;

    INSERT INTO public.sale_items (
      sale_id, product_id, quantity, unit_price, total_price, product_snapshot
    )
    VALUES (
      v_sale_id, v_prod.id, v_qty, v_price, v_price * v_qty,
      jsonb_build_object(
        'name', v_prod.name,
        'sku', v_prod.sku,
        'official_price', v_prod.official_price,
        'promotional_price', v_prod.promotional_price,
        'sold_at', now()
      )
    );
  END LOOP;

  SELECT COALESCE(SUM(si.total_price), 0) INTO v_total
  FROM public.sale_items si WHERE si.sale_id = v_sale_id;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'reference', v_ref,
    'total', v_total,
    'duplicated', false
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 16. PERFIL COM IDENTIDADE PROVINCIAL
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_profile public.profiles;
  v_prov    public.provincias;
BEGIN
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id = auth.uid();
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_profile.provincia_id IS NOT NULL THEN
    SELECT * INTO v_prov FROM public.provincias pr WHERE pr.id = v_profile.provincia_id;
  END IF;

  RETURN to_jsonb(v_profile) || jsonb_build_object(
    'provincia_nome',     v_prov.nome,
    'provincia_codigo',   v_prov.codigo,
    'provincia_slug',     v_prov.slug,
    'delegacao_nome',     v_prov.delegacao_nome,
    'delegacao_endereco', v_prov.delegacao_endereco,
    'delegacao_telefone', v_prov.delegacao_telefone,
    'is_national',        public.is_national()
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 17. INDICADORES DA GERÊNCIA (por província)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.dashboard_stats(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.dashboard_stats(
  p_from         timestamptz DEFAULT NULL,
  p_to           timestamptz DEFAULT NULL,
  p_provincia_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_from timestamptz := COALESCE(p_from, date_trunc('month', now()));
  v_to   timestamptz := COALESCE(p_to, now());
  -- A administração nacional pode escolher uma província; um gestor
  -- provincial só pode ver a sua, mesmo que peça outra.
  v_prov uuid := CASE
                   WHEN public.is_national() THEN p_provincia_id
                   ELSE public.my_province()
                 END;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode consultar indicadores' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'period_from', v_from,
    'period_to', v_to,
    'provincia_id', v_prov,
    'scope', CASE WHEN v_prov IS NULL THEN 'nacional' ELSE 'provincial' END,
    'sales_total_value', (
      SELECT COALESCE(SUM(s.total_amount), 0) FROM public.sales s
      WHERE s.created_at BETWEEN v_from AND v_to
        AND (v_prov IS NULL OR s.provincia_id = v_prov)
    ),
    'sales_count', (
      SELECT COUNT(*) FROM public.sales s
      WHERE s.created_at BETWEEN v_from AND v_to
        AND (v_prov IS NULL OR s.provincia_id = v_prov)
    ),
    'orders_count', (
      SELECT COUNT(*) FROM public.orders o
      WHERE o.created_at BETWEEN v_from AND v_to
        AND (v_prov IS NULL OR o.provincia_id = v_prov)
    ),
    'orders_by_status', (
      SELECT COALESCE(jsonb_object_agg(t.status, t.qty), '{}'::jsonb)
      FROM (
        SELECT o.status::text AS status, COUNT(*) AS qty
        FROM public.orders o
        WHERE o.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR o.provincia_id = v_prov)
        GROUP BY o.status
      ) t
    ),
    'customers_count', (
      SELECT COUNT(*) FROM public.profiles p
      WHERE p.role = 'customer'
        AND (v_prov IS NULL OR p.provincia_id = v_prov)
    ),
    'sellers_count', (
      SELECT COUNT(*) FROM public.profiles p
      WHERE p.role = 'seller' AND p.is_active = true
        AND (v_prov IS NULL OR p.provincia_id = v_prov)
    ),
    'active_reservations', (
      SELECT COUNT(*) FROM public.reservations r
      WHERE r.status = 'active'
        AND (v_prov IS NULL OR r.provincia_id = v_prov)
    ),
    'pending_discounts', (
      SELECT COUNT(*) FROM public.discount_requests d
      WHERE d.status = 'pending'
        AND (v_prov IS NULL OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = d.customer_id AND p.provincia_id = v_prov
        ))
    ),
    'low_stock_products', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT p.name, i.quantity, i.low_stock_threshold, pr.nome AS provincia
        FROM public.inventory i
        JOIN public.products p ON p.id = i.product_id
        LEFT JOIN public.provincias pr ON pr.id = i.provincia_id
        WHERE i.quantity <= i.low_stock_threshold
          AND (v_prov IS NULL OR i.provincia_id = v_prov)
        ORDER BY i.quantity ASC
        LIMIT 20
      ) t
    ),
    'sales_by_seller', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT pr.full_name AS seller, COUNT(*) AS sales, SUM(s.total_amount) AS value
        FROM public.sales s
        JOIN public.profiles pr ON pr.id = s.seller_id
        WHERE s.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR s.provincia_id = v_prov)
        GROUP BY pr.full_name
        ORDER BY SUM(s.total_amount) DESC
        LIMIT 20
      ) t
    ),
    'top_products', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT si.product_snapshot->>'name' AS name, SUM(si.quantity) AS units, SUM(si.total_price) AS value
        FROM public.sale_items si
        JOIN public.sales s ON s.id = si.sale_id
        WHERE s.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR s.provincia_id = v_prov)
        GROUP BY si.product_snapshot->>'name'
        ORDER BY SUM(si.quantity) DESC
        LIMIT 10
      ) t
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 18. COLABORADORES: província na promoção
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.promote_to_seller(text, text);

CREATE OR REPLACE FUNCTION public.promote_to_seller(
  p_phone        text,
  p_region       text DEFAULT NULL,
  p_provincia_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_phone text := public.normalize_phone(p_phone);
  v_id    uuid;
BEGIN
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Telefone inválido';
  END IF;

  SELECT p.id INTO v_id FROM public.profiles p WHERE p.phone = v_phone;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nenhum perfil com o telefone %', v_phone;
  END IF;

  UPDATE public.profiles p
  SET role = 'seller',
      provincia_id = COALESCE(p_provincia_id, p.provincia_id)
  WHERE p.id = v_id;

  INSERT INTO public.user_roles (user_id, role, assigned_by)
  VALUES (v_id, 'seller', v_id)
  ON CONFLICT (user_id) DO UPDATE SET role = 'seller', assigned_at = now();

  INSERT INTO public.seller_profiles (id, region, provincia_id)
  VALUES (v_id, p_region, p_provincia_id)
  ON CONFLICT (id) DO UPDATE
    SET provincia_id = COALESCE(EXCLUDED.provincia_id, public.seller_profiles.provincia_id);

  RETURN jsonb_build_object('user_id', v_id, 'role', 'seller', 'provincia_id', p_provincia_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 19. RLS PROVINCIAL
-- -----------------------------------------------------------------------------
ALTER TABLE public.provincias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provincias_read ON public.provincias;
CREATE POLICY provincias_read ON public.provincias
  FOR SELECT TO anon, authenticated
  USING (provincias.is_active = true OR public.is_manager());

DROP POLICY IF EXISTS provincias_manager_write ON public.provincias;
CREATE POLICY provincias_manager_write ON public.provincias
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.is_national())
  WITH CHECK (public.is_manager() AND public.is_national());

-- PERFIS ---------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    profiles.id = auth.uid()
    OR (public.is_manager() AND public.can_see_province(profiles.provincia_id)
        AND (public.is_national() OR profiles.provincia_id = public.my_province()))
    OR (public.is_seller() AND public.is_my_customer(profiles.id))
    -- O cliente vê o colaborador que lhe está atribuído (aba de referência).
    OR EXISTS (
      SELECT 1 FROM public.seller_customers sc
      WHERE sc.customer_id = auth.uid()
        AND sc.seller_id = profiles.id
        AND sc.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.conversation_members me
      JOIN public.conversation_members outro
        ON outro.conversation_id = me.conversation_id
      WHERE me.user_id = auth.uid()
        AND outro.user_id = profiles.id
    )
  );

-- CATÁLOGO -------------------------------------------------------------
DROP POLICY IF EXISTS products_public_read ON public.products;
CREATE POLICY products_public_read ON public.products
  FOR SELECT TO anon, authenticated
  USING (
    -- A administração nacional vê tudo, incluindo inactivos.
    public.is_national()
    OR (
      (products.is_active = true OR public.is_manager() OR public.is_seller())
      AND (
        auth.uid() IS NULL                      -- visitante: montra pública
        OR products.provincia_id IS NULL        -- produto nacional
        OR products.provincia_id = public.my_province()
      )
    )
  );

DROP POLICY IF EXISTS products_manager_write ON public.products;
CREATE POLICY products_manager_write ON public.products
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(products.provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(products.provincia_id));

DROP POLICY IF EXISTS inventory_read ON public.inventory;
CREATE POLICY inventory_read ON public.inventory
  FOR SELECT TO authenticated
  USING (public.can_see_province(inventory.provincia_id));

DROP POLICY IF EXISTS inventory_manager_write ON public.inventory;
CREATE POLICY inventory_manager_write ON public.inventory
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(inventory.provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(inventory.provincia_id));

DROP POLICY IF EXISTS inventory_movements_read ON public.inventory_movements;
CREATE POLICY inventory_movements_read ON public.inventory_movements
  FOR SELECT TO authenticated
  USING (
    (public.is_manager() OR public.is_seller())
    AND public.can_see_province(inventory_movements.provincia_id)
  );

DROP POLICY IF EXISTS inventory_movements_manager_write ON public.inventory_movements;
CREATE POLICY inventory_movements_manager_write ON public.inventory_movements
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(inventory_movements.provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(inventory_movements.provincia_id));

DROP POLICY IF EXISTS seller_profiles_select ON public.seller_profiles;
CREATE POLICY seller_profiles_select ON public.seller_profiles
  FOR SELECT TO authenticated
  USING (
    seller_profiles.id = auth.uid()
    OR (public.is_manager() AND public.can_see_province(seller_profiles.provincia_id))
  );

DROP POLICY IF EXISTS seller_profiles_manager_write ON public.seller_profiles;
CREATE POLICY seller_profiles_manager_write ON public.seller_profiles
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(seller_profiles.provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(seller_profiles.provincia_id));

-- ENCOMENDAS / VENDAS --------------------------------------------------
DROP POLICY IF EXISTS orders_select ON public.orders;
CREATE POLICY orders_select ON public.orders
  FOR SELECT TO authenticated
  USING (
    (
      orders.customer_id = auth.uid()
      OR orders.seller_id = auth.uid()
      OR public.is_manager()
      OR (public.is_seller() AND public.is_my_customer(orders.customer_id))
    )
    AND public.can_see_province(orders.provincia_id)
  );

DROP POLICY IF EXISTS orders_update_manager_seller ON public.orders;
CREATE POLICY orders_update_manager_seller ON public.orders
  FOR UPDATE TO authenticated
  USING (
    (
      public.is_manager()
      OR orders.seller_id = auth.uid()
      OR (orders.customer_id = auth.uid() AND orders.status = 'pending')
    )
    AND public.can_see_province(orders.provincia_id)
  )
  WITH CHECK (
    (
      public.is_manager()
      OR orders.seller_id = auth.uid()
      OR orders.customer_id = auth.uid()
    )
    AND public.can_see_province(orders.provincia_id)
  );

DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select ON public.sales
  FOR SELECT TO authenticated
  USING (
    (sales.seller_id = auth.uid() OR public.is_manager())
    AND public.can_see_province(sales.provincia_id)
  );

DROP POLICY IF EXISTS sales_update_manager ON public.sales;
CREATE POLICY sales_update_manager ON public.sales
  FOR UPDATE TO authenticated
  USING (public.is_manager() AND public.can_manage_province(sales.provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(sales.provincia_id));

DROP POLICY IF EXISTS reservations_select ON public.reservations;
CREATE POLICY reservations_select ON public.reservations
  FOR SELECT TO authenticated
  USING (
    (
      reservations.customer_id = auth.uid()
      OR reservations.seller_id = auth.uid()
      OR public.is_manager()
      OR (public.is_seller() AND public.is_my_customer(reservations.customer_id))
    )
    AND public.can_see_province(reservations.provincia_id)
  );

-- TRANSFERÊNCIAS -------------------------------------------------------
DROP POLICY IF EXISTS stock_transfers_select ON public.stock_transfers;
CREATE POLICY stock_transfers_select ON public.stock_transfers
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    AND (
      public.is_national()
      OR stock_transfers.from_provincia_id = public.my_province()
      OR stock_transfers.to_provincia_id = public.my_province()
    )
  );

DROP POLICY IF EXISTS stock_transfers_insert ON public.stock_transfers;
CREATE POLICY stock_transfers_insert ON public.stock_transfers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager());

-- -----------------------------------------------------------------------------
-- 20. PERMISSÕES DE EXECUÇÃO
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.my_province()                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_national()                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_province(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_province(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.default_province()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_province(uuid, uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.province_overview()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_stock_transfer(uuid, uuid, uuid, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_stock_transfer(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_stock(uuid, int, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_stats(timestamptz, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gerar_referencia(uuid)         TO authenticated;

REVOKE ALL ON FUNCTION public.promote_to_seller(text, text, uuid) FROM PUBLIC, anon, authenticated;

-- Realtime: as transferências aparecem na hora a quem aprova
DO $$
BEGIN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_transfers';
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN undefined_object THEN NULL;
END $$;


-- ###########################################################################
-- ##  PARTE 6 de 15 — IDENTIDADE E GESTÃO DE COLABORADORES
-- ###########################################################################

-- =============================================================================
-- INUKA ANGOLA — MIGRAÇÃO 6/6 : IDENTIDADE E GESTÃO DE COLABORADORES
-- =============================================================================
-- O que esta migração acrescenta, sem tocar no que já existe:
--
--   1. Referência por província (`INK-UIG-00005`), com contador próprio por
--      província — cada província tem a sua sequência.
--   2. Dados pessoais e profissionais do colaborador (BI, nascimento, WhatsApp,
--      morada, município, função, categoria, data de entrada).
--   3. Comissões: uma linha por venda (UNIQUE), taxa congelada no momento da
--      venda, estados pendente/paga/anulada e histórico de pagamentos.
--   4. Metas individuais e por província, com cumprimento calculado.
--   5. `sales.status` — uma venda cancelada deixa de contar para tudo.
--   6. RPCs de painel, ficha, pesquisa e visão geral.
--   7. RLS: cada colaborador só vê o que é seu; o BI nunca sai para terceiros.
--
-- Idempotente: pode ser colada sobre uma base que já tenha a 0005.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TIPOS NOVOS
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sale_status') THEN
    CREATE TYPE public.sale_status AS ENUM ('completed', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'commission_status') THEN
    CREATE TYPE public.commission_status AS ENUM ('pending', 'paid', 'cancelled');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. VENDA CANCELADA NÃO CONTA
-- -----------------------------------------------------------------------------
-- `payment_status` diz se foi paga; `status` diz se a venda existe. São coisas
-- diferentes: uma venda por pagar é válida, uma venda cancelada não é.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS status public.sale_status NOT NULL DEFAULT 'completed';

CREATE INDEX IF NOT EXISTS idx_sales_status ON public.sales (status, created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. DADOS DO COLABORADOR
-- -----------------------------------------------------------------------------
-- Ficam em `seller_profiles`, que já é 1:1 com o perfil e já tem a política
-- certa: só o próprio ou um gestor da província lê. É por isso que o BI não
-- precisa de uma tabela separada — nunca é exposto a um cliente.
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS bi_number   text,
  ADD COLUMN IF NOT EXISTS birth_date  date,
  ADD COLUMN IF NOT EXISTS whatsapp    text,
  ADD COLUMN IF NOT EXISTS address     text,
  ADD COLUMN IF NOT EXISTS municipio   text,
  ADD COLUMN IF NOT EXISTS job_title   text,
  ADD COLUMN IF NOT EXISTS category    text,
  ADD COLUMN IF NOT EXISTS hired_at    date;

-- O BI é único quando existe (comparação sem espaços e sem maiúsculas).
CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_bi
  ON public.seller_profiles (upper(btrim(bi_number)))
  WHERE bi_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_seller_municipio ON public.seller_profiles (municipio);
CREATE INDEX IF NOT EXISTS idx_seller_hired     ON public.seller_profiles (hired_at);

-- Quem já era colaborador entra hoje (não há data melhor e não se inventa).
UPDATE public.seller_profiles
SET hired_at = COALESCE(hired_at, created_at::date)
WHERE hired_at IS NULL;

-- -----------------------------------------------------------------------------
-- 4. REFERÊNCIA COM SEQUÊNCIA POR PROVÍNCIA
-- -----------------------------------------------------------------------------
-- Antes havia uma sequência global. Passa a haver um contador por província,
-- para que `INK-UIG-00001` e `INK-LDA-00001` possam coexistir: o número diz
-- "o 1.º colaborador desta província".
CREATE TABLE IF NOT EXISTS public.referencia_contadores (
  codigo     text PRIMARY KEY,
  ultimo     int NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Sem políticas: ninguém escreve aqui pelo cliente. Só a função abaixo, que é
-- SECURITY DEFINER, toca nesta tabela.
ALTER TABLE public.referencia_contadores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referencia_contadores FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.proxima_referencia(p_provincia_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_codigo text;
  v_num    int;
BEGIN
  SELECT pr.codigo INTO v_codigo
  FROM public.provincias pr WHERE pr.id = p_provincia_id;

  v_codigo := COALESCE(v_codigo, 'NAC');

  -- O `ON CONFLICT DO UPDATE` é atómico: dois pedidos simultâneos nunca
  -- recebem o mesmo número.
  INSERT INTO public.referencia_contadores AS c (codigo, ultimo)
  VALUES (v_codigo, 1)
  ON CONFLICT (codigo) DO UPDATE
    SET ultimo = c.ultimo + 1,
        updated_at = now()
  RETURNING c.ultimo INTO v_num;

  RETURN 'INK-' || v_codigo || '-' || lpad(v_num::text, 5, '0');
END;
$$;

-- `gerar_referencia` mantém-se como nome público (já é usada em testes e em
-- código antigo), mas passa a delegar no contador por província.
CREATE OR REPLACE FUNCTION public.gerar_referencia(p_provincia_id uuid)
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.proxima_referencia(p_provincia_id);
$$;

-- Arranque dos contadores: continuam a partir da referência mais alta que já
-- existe em cada província. Sem isto, o primeiro colaborador novo do Uíge
-- voltaria a receber `00001` e colidia com quem já lá está.
INSERT INTO public.referencia_contadores AS c (codigo, ultimo)
SELECT split_part(referencia, '-', 2) AS codigo,
       MAX((split_part(referencia, '-', 3))::int) AS ultimo
FROM public.profiles
WHERE referencia ~ '^INK-[A-Z]{3}-[0-9]+$'
GROUP BY 1
ON CONFLICT (codigo) DO UPDATE
  SET ultimo = GREATEST(c.ultimo, EXCLUDED.ultimo),
      updated_at = now();

-- -----------------------------------------------------------------------------
-- 5. COMISSÕES
-- -----------------------------------------------------------------------------
-- Uma linha por venda (`UNIQUE sale_id`): é isto que impede uma comissão
-- duplicada, e não uma verificação na aplicação.
CREATE TABLE IF NOT EXISTS public.commission_payouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  amount       numeric(12,2) NOT NULL CHECK (amount >= 0),
  method       text,
  notes        text,
  paid_at      timestamptz NOT NULL DEFAULT now(),
  paid_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_commissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id      uuid NOT NULL UNIQUE REFERENCES public.sales(id) ON DELETE CASCADE,
  seller_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  base_amount  numeric(12,2) NOT NULL DEFAULT 0 CHECK (base_amount >= 0),
  rate         numeric(5,4) NOT NULL DEFAULT 0 CHECK (rate >= 0 AND rate <= 1),
  amount       numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status       public.commission_status NOT NULL DEFAULT 'pending',
  paid_at      timestamptz,
  payout_id    uuid REFERENCES public.commission_payouts(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comissao_paga_tem_data CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_commissions_seller ON public.sale_commissions (seller_id, status);
CREATE INDEX IF NOT EXISTS idx_commissions_prov   ON public.sale_commissions (provincia_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commissions_payout ON public.sale_commissions (payout_id);
CREATE INDEX IF NOT EXISTS idx_payouts_seller     ON public.commission_payouts (seller_id, paid_at DESC);

-- Calcula a comissão de cada venda. Corre depois de a venda existir, por isso
-- uma venda criada por RPC ou por INSERT directo é tratada da mesma maneira.
CREATE OR REPLACE FUNCTION public.fill_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_rate numeric(5,4);
BEGIN
  -- Só reage ao que muda o valor: evita recalcular em cada UPDATE da venda.
  IF TG_OP = 'UPDATE'
     AND NEW.status       IS NOT DISTINCT FROM OLD.status
     AND NEW.total_amount IS NOT DISTINCT FROM OLD.total_amount
     AND NEW.seller_id    IS NOT DISTINCT FROM OLD.seller_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(sp.commission_rate, 0) INTO v_rate
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;
  v_rate := COALESCE(v_rate, 0);

  IF NEW.status = 'cancelled' THEN
    INSERT INTO public.sale_commissions AS c
      (sale_id, seller_id, provincia_id, base_amount, rate, amount, status)
    VALUES
      (NEW.id, NEW.seller_id, NEW.provincia_id, NEW.total_amount, v_rate, 0, 'cancelled')
    ON CONFLICT (sale_id) DO UPDATE
      SET status = 'cancelled', amount = 0, base_amount = EXCLUDED.base_amount,
          updated_at = now()
      WHERE c.status <> 'paid';   -- uma comissão já paga não se anula sozinha
  ELSE
    INSERT INTO public.sale_commissions AS c
      (sale_id, seller_id, provincia_id, base_amount, rate, amount, status)
    VALUES
      (NEW.id, NEW.seller_id, NEW.provincia_id, NEW.total_amount, v_rate,
       round(NEW.total_amount * v_rate, 2), 'pending')
    ON CONFLICT (sale_id) DO UPDATE
      SET seller_id = EXCLUDED.seller_id,
          provincia_id = EXCLUDED.provincia_id,
          base_amount = EXCLUDED.base_amount,
          rate = EXCLUDED.rate,
          amount = EXCLUDED.amount,
          updated_at = now()
      WHERE c.status = 'pending';  -- paga ou anulada fica como está
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_commission ON public.sales;
CREATE TRIGGER trg_fill_commission
AFTER INSERT OR UPDATE OF status, total_amount, seller_id ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.fill_commission();

-- Comissões das vendas que já existiam (a base é preservada, não se inventa).
INSERT INTO public.sale_commissions
  (sale_id, seller_id, provincia_id, base_amount, rate, amount, status)
SELECT s.id, s.seller_id, s.provincia_id, s.total_amount,
       COALESCE(sp.commission_rate, 0),
       round(s.total_amount * COALESCE(sp.commission_rate, 0), 2),
       CASE WHEN s.status = 'cancelled'
            THEN 'cancelled'::public.commission_status
            ELSE 'pending'::public.commission_status END
FROM public.sales s
LEFT JOIN public.seller_profiles sp ON sp.id = s.seller_id
ON CONFLICT (sale_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. METAS
-- -----------------------------------------------------------------------------
-- Uma meta é de um colaborador OU de uma província, nunca das duas coisas.
CREATE TABLE IF NOT EXISTS public.sales_goals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  provincia_id  uuid REFERENCES public.provincias(id) ON DELETE CASCADE,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  target_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (target_amount >= 0),
  target_sales  int NOT NULL DEFAULT 0 CHECK (target_sales >= 0),
  notes         text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_goals_scope CHECK (
    (seller_id IS NOT NULL AND provincia_id IS NULL) OR
    (seller_id IS NULL AND provincia_id IS NOT NULL)
  ),
  CONSTRAINT sales_goals_periodo CHECK (period_end >= period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_goal_seller
  ON public.sales_goals (seller_id, period_start, period_end)
  WHERE seller_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_goal_provincia
  ON public.sales_goals (provincia_id, period_start, period_end)
  WHERE provincia_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 7. DEFAULTS DO COLABORADOR
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fill_seller_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.hired_at := COALESCE(NEW.hired_at, CURRENT_DATE);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_seller_defaults ON public.seller_profiles;
CREATE TRIGGER trg_fill_seller_defaults
BEFORE INSERT ON public.seller_profiles
FOR EACH ROW EXECUTE FUNCTION public.fill_seller_defaults();

-- -----------------------------------------------------------------------------
-- 8. HISTÓRICO DE ALTERAÇÕES IMPORTANTES
-- -----------------------------------------------------------------------------
-- Só os campos que mudam direitos e dinheiro: papel, província, referência,
-- estado e taxa de comissão. Não se registam alterações de morada nem de nome.
CREATE OR REPLACE FUNCTION public.audit_collaborator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    IF OLD.role IS NOT DISTINCT FROM NEW.role
       AND OLD.provincia_id IS NOT DISTINCT FROM NEW.provincia_id
       AND OLD.referencia   IS NOT DISTINCT FROM NEW.referencia
       AND OLD.is_active    IS NOT DISTINCT FROM NEW.is_active THEN
      RETURN NULL;
    END IF;
    v_old := jsonb_build_object('role', OLD.role, 'provincia_id', OLD.provincia_id,
                                'referencia', OLD.referencia, 'is_active', OLD.is_active);
    v_new := jsonb_build_object('role', NEW.role, 'provincia_id', NEW.provincia_id,
                                'referencia', NEW.referencia, 'is_active', NEW.is_active);
  ELSE
    IF OLD.commission_rate IS NOT DISTINCT FROM NEW.commission_rate
       AND OLD.job_title IS NOT DISTINCT FROM NEW.job_title
       AND OLD.category  IS NOT DISTINCT FROM NEW.category THEN
      RETURN NULL;
    END IF;
    v_old := jsonb_build_object('commission_rate', OLD.commission_rate,
                                'job_title', OLD.job_title, 'category', OLD.category);
    v_new := jsonb_build_object('commission_rate', NEW.commission_rate,
                                'job_title', NEW.job_title, 'category', NEW.category);
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data, new_data)
  VALUES (auth.uid(), 'update', TG_TABLE_NAME, NEW.id, v_old, v_new);

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_collaborator ON public.profiles;
CREATE TRIGGER trg_audit_collaborator
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.audit_collaborator();

DROP TRIGGER IF EXISTS trg_audit_seller ON public.seller_profiles;
CREATE TRIGGER trg_audit_seller
AFTER UPDATE ON public.seller_profiles
FOR EACH ROW EXECUTE FUNCTION public.audit_collaborator();

-- -----------------------------------------------------------------------------
-- 9. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.sale_commissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_goals        ENABLE ROW LEVEL SECURITY;

-- Comissões: o colaborador vê as suas; o gestor vê as da província que gere.
DROP POLICY IF EXISTS sale_commissions_select ON public.sale_commissions;
CREATE POLICY sale_commissions_select ON public.sale_commissions
  FOR SELECT TO authenticated
  USING (
    seller_id = auth.uid()
    OR (public.is_manager() AND public.can_see_province(provincia_id))
  );

-- Escrita só pelas funções SECURITY DEFINER (o trigger e `pagar_comissoes`).
DROP POLICY IF EXISTS sale_commissions_manager_write ON public.sale_commissions;
CREATE POLICY sale_commissions_manager_write ON public.sale_commissions
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(provincia_id));

DROP POLICY IF EXISTS commission_payouts_select ON public.commission_payouts;
CREATE POLICY commission_payouts_select ON public.commission_payouts
  FOR SELECT TO authenticated
  USING (
    seller_id = auth.uid()
    OR (public.is_manager() AND public.can_see_province(provincia_id))
  );

DROP POLICY IF EXISTS commission_payouts_manager_write ON public.commission_payouts;
CREATE POLICY commission_payouts_manager_write ON public.commission_payouts
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(provincia_id));

-- Metas: a própria, a da província onde está, e o gestor vê as que gere.
DROP POLICY IF EXISTS sales_goals_select ON public.sales_goals;
CREATE POLICY sales_goals_select ON public.sales_goals
  FOR SELECT TO authenticated
  USING (
    seller_id = auth.uid()
    OR (provincia_id IS NOT NULL AND provincia_id = public.my_province())
    OR (public.is_manager() AND public.can_see_province(provincia_id))
  );

DROP POLICY IF EXISTS sales_goals_manager_write ON public.sales_goals;
CREATE POLICY sales_goals_manager_write ON public.sales_goals
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(provincia_id));

-- -----------------------------------------------------------------------------
-- 10. PERMISSÃO: QUEM PODE VER QUEM
-- -----------------------------------------------------------------------------
-- Regra única usada por todas as RPCs abaixo:
--   · o próprio;
--   · um gestor, dentro da província que gere (ou de todas, se for nacional).
CREATE OR REPLACE FUNCTION public.can_view_collaborator(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN p_id = auth.uid() THEN true
    WHEN NOT public.is_manager() THEN false
    ELSE public.can_see_province((SELECT p.provincia_id FROM public.profiles p WHERE p.id = p_id))
  END;
$$;

-- -----------------------------------------------------------------------------
-- 11. RPC: FICHA DO COLABORADOR
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.colaborador_ficha(p_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_id    uuid := COALESCE(p_id, auth.uid());
  v_p     public.profiles;
  v_sp    public.seller_profiles;
  v_prov  public.provincias;
  v_gestor text;
  v_pode  boolean;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501';
  END IF;

  v_pode := public.can_view_collaborator(v_id);
  IF NOT v_pode THEN
    RAISE EXCEPTION 'Sem permissão para ver esta ficha' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_p FROM public.profiles WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador inexistente';
  END IF;

  SELECT * INTO v_sp FROM public.seller_profiles WHERE id = v_id;
  IF v_p.provincia_id IS NOT NULL THEN
    SELECT * INTO v_prov FROM public.provincias WHERE id = v_p.provincia_id;
  END IF;
  IF v_sp.manager_id IS NOT NULL THEN
    SELECT p.full_name INTO v_gestor FROM public.profiles p WHERE p.id = v_sp.manager_id;
  END IF;

  RETURN jsonb_build_object(
    'id',            v_p.id,
    'full_name',     v_p.full_name,
    'role',          v_p.role,
    'avatar_url',    v_p.avatar_url,
    'phone',         v_p.phone,
    'email',         v_p.email,
    'is_active',     v_p.is_active,
    'created_at',    v_p.created_at,
    'referencia',    v_p.referencia,
    'provincia_id',  v_p.provincia_id,
    'provincia_nome',   v_prov.nome,
    'provincia_codigo', v_prov.codigo,
    'delegacao_nome',   v_prov.delegacao_nome,
    -- Dados pessoais: só chegam aqui depois da verificação acima.
    'bi_number',     v_sp.bi_number,
    'birth_date',    v_sp.birth_date,
    'whatsapp',      v_sp.whatsapp,
    'address',       v_sp.address,
    'municipio',     v_sp.municipio,
    -- Dados profissionais
    'job_title',     v_sp.job_title,
    'category',      v_sp.category,
    'hired_at',      v_sp.hired_at,
    'commission_rate', COALESCE(v_sp.commission_rate, 0),
    'manager_id',    v_sp.manager_id,
    'manager_name',  v_gestor,
    'region',        v_sp.region,
    'code',          v_sp.code
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. RPC: PAINEL INDIVIDUAL
-- -----------------------------------------------------------------------------
-- Devolve tudo o que o painel mostra, numa só chamada: identidade, cartões,
-- séries dos últimos 6 meses, histórico e alertas de meta.
CREATE OR REPLACE FUNCTION public.colaborador_painel(
  p_id   uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_id      uuid := COALESCE(p_id, auth.uid());
  v_from    timestamptz := COALESCE(p_from, date_trunc('month', now()));
  v_to      timestamptz := COALESCE(p_to, now());
  v_p       public.profiles;
  v_sp      public.seller_profiles;
  v_prov    public.provincias;
  v_meta    public.sales_goals;
  v_meta_pv public.sales_goals;
  v_valor   numeric(14,2) := 0;
  v_qtd     int := 0;
  v_com_total numeric(14,2) := 0;
  v_com_paga  numeric(14,2) := 0;
  v_com_pend  numeric(14,2) := 0;
  v_clientes  int := 0;
  v_ativos    int := 0;
  v_posicao   int := NULL;
  v_equipa    int := NULL;
  v_alvo      numeric(14,2) := 0;
  v_pct       numeric(6,2) := 0;
  v_meses     text[] := ARRAY[]::text[];
  v_serie_v   numeric[] := ARRAY[]::numeric[];
  v_serie_c   numeric[] := ARRAY[]::numeric[];
  v_mes       date;
  i           int;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_view_collaborator(v_id) THEN
    RAISE EXCEPTION 'Sem permissão para ver este painel' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_p FROM public.profiles WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador inexistente';
  END IF;
  SELECT * INTO v_sp FROM public.seller_profiles WHERE id = v_id;
  IF v_p.provincia_id IS NOT NULL THEN
    SELECT * INTO v_prov FROM public.provincias WHERE id = v_p.provincia_id;
  END IF;

  -- Vendas válidas do período (canceladas fora).
  SELECT COALESCE(SUM(s.total_amount), 0), COUNT(*)
    INTO v_valor, v_qtd
  FROM public.sales s
  WHERE s.seller_id = v_id
    AND s.status <> 'cancelled'
    AND s.created_at BETWEEN v_from AND v_to;

  SELECT COALESCE(SUM(c.amount), 0),
         COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'paid'), 0),
         COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'pending'), 0)
    INTO v_com_total, v_com_paga, v_com_pend
  FROM public.sale_commissions c
  WHERE c.seller_id = v_id;

  SELECT COUNT(*) INTO v_clientes
  FROM public.seller_customers sc WHERE sc.seller_id = v_id;
  SELECT COUNT(*) INTO v_ativos
  FROM public.seller_customers sc WHERE sc.seller_id = v_id AND sc.is_active = true;

  -- Meta individual do mês corrente; se não houver, a meta da província serve
  -- de referência (é o objectivo da equipa, não uma meta inventada).
  SELECT * INTO v_meta
  FROM public.sales_goals g
  WHERE g.seller_id = v_id
    AND CURRENT_DATE BETWEEN g.period_start AND g.period_end
  ORDER BY g.period_start DESC LIMIT 1;

  IF v_meta.id IS NULL AND v_p.provincia_id IS NOT NULL THEN
    SELECT * INTO v_meta_pv
    FROM public.sales_goals g
    WHERE g.provincia_id = v_p.provincia_id
      AND CURRENT_DATE BETWEEN g.period_start AND g.period_end
    ORDER BY g.period_start DESC LIMIT 1;
  END IF;

  v_alvo := COALESCE(NULLIF(v_meta.target_amount, 0), v_meta_pv.target_amount, 0);
  IF v_alvo > 0 THEN
    v_pct := round(LEAST(v_valor / v_alvo * 100, 999), 2);
  END IF;

  -- Posição no ranking da província (só faz sentido para colaboradores).
  IF v_p.provincia_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_equipa
    FROM public.profiles p
    WHERE p.role = 'seller' AND p.is_active = true AND p.provincia_id = v_p.provincia_id;

    SELECT COUNT(*) + 1 INTO v_posicao
    FROM (
      SELECT p.id, COALESCE(SUM(s.total_amount), 0) AS v
      FROM public.profiles p
      LEFT JOIN public.sales s
        ON s.seller_id = p.id AND s.status <> 'cancelled'
       AND s.created_at BETWEEN v_from AND v_to
      WHERE p.role = 'seller' AND p.is_active = true AND p.provincia_id = v_p.provincia_id
      GROUP BY p.id
    ) t
    WHERE t.v > v_valor;
  END IF;

  -- Séries dos últimos 6 meses (inclui o corrente).
  -- `REVERSE` é obrigatório: sem ele, `5..0` não itera nenhuma vez.
  FOR i IN REVERSE 5..0 LOOP
    v_mes := date_trunc('month', now())::date - (i || ' month')::interval;
    v_meses := v_meses || to_char(v_mes, 'YYYY-MM');
    v_serie_v := v_serie_v || COALESCE((
      SELECT SUM(s.total_amount) FROM public.sales s
      WHERE s.seller_id = v_id AND s.status <> 'cancelled'
        AND s.created_at >= v_mes AND s.created_at < (v_mes + interval '1 month')
    ), 0);
    v_serie_c := v_serie_c || COALESCE((
      SELECT SUM(c.amount) FROM public.sale_commissions c
      WHERE c.seller_id = v_id AND c.status <> 'cancelled'
        AND c.created_at >= v_mes AND c.created_at < (v_mes + interval '1 month')
    ), 0);
  END LOOP;

  RETURN jsonb_build_object(
    'identidade', jsonb_build_object(
      'id', v_p.id,
      'full_name', v_p.full_name,
      'avatar_url', v_p.avatar_url,
      'phone', v_p.phone,
      'whatsapp', v_sp.whatsapp,
      'email', v_p.email,
      'referencia', v_p.referencia,
      'role', v_p.role,
      'is_active', v_p.is_active,
      'created_at', v_p.created_at,
      'job_title', v_sp.job_title,
      'category', v_sp.category,
      'hired_at', v_sp.hired_at,
      'provincia_id', v_p.provincia_id,
      'provincia_nome', v_prov.nome,
      'provincia_codigo', v_prov.codigo,
      'delegacao_nome', v_prov.delegacao_nome,
      'delegacao_telefone', v_prov.delegacao_telefone
    ),
    'cartoes', jsonb_build_object(
      'clientes_total', v_clientes,
      'clientes_ativos', v_ativos,
      'vendas_count', v_qtd,
      'vendas_valor', v_valor,
      'comissao_total', v_com_total,
      'comissao_paga', v_com_paga,
      'comissao_pendente', v_com_pend,
      'meta_valor', v_alvo,
      'meta_pct', v_pct,
      'meta_origem', CASE WHEN v_meta.id IS NOT NULL THEN 'individual'
                          WHEN v_meta_pv.id IS NOT NULL THEN 'provincia'
                          ELSE NULL END,
      'posicao', v_posicao,
      'equipa', v_equipa
    ),
    'series', jsonb_build_object(
      'meses', to_jsonb(v_meses),
      'vendas', to_jsonb(v_serie_v),
      'comissoes', to_jsonb(v_serie_c)
    ),
    'historico', jsonb_build_object(
      'vendas', (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
          SELECT s.id, s.reference, s.total_amount, s.status, s.created_at,
                 COALESCE(c.amount, 0) AS comissao
          FROM public.sales s
          LEFT JOIN public.sale_commissions c ON c.sale_id = s.id
          WHERE s.seller_id = v_id
          ORDER BY s.created_at DESC LIMIT 8
        ) t
      ),
      'clientes', (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
          SELECT p.full_name, p.phone, sc.is_active, sc.assigned_at
          FROM public.seller_customers sc
          JOIN public.profiles p ON p.id = sc.customer_id
          WHERE sc.seller_id = v_id
          ORDER BY sc.assigned_at DESC LIMIT 8
        ) t
      ),
      'pagamentos', (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
          SELECT cp.id, cp.amount, cp.paid_at, cp.method, cp.notes
          FROM public.commission_payouts cp
          WHERE cp.seller_id = v_id
          ORDER BY cp.paid_at DESC LIMIT 8
        ) t
      )
    ),
    'alertas', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
        SELECT 'meta_atingida' AS tipo,
               'Meta mensal atingida: ' || v_pct || '%' AS texto
        WHERE v_alvo > 0 AND v_pct >= 100
        UNION ALL
        SELECT 'meta_perto',
               'Faltam ' || round(v_alvo - v_valor, 2) || ' AOA para a meta'
        WHERE v_alvo > 0 AND v_pct >= 80 AND v_pct < 100
        UNION ALL
        SELECT 'comissao_pendente',
               'Tem ' || v_com_pend || ' AOA de comissão por receber'
        WHERE v_com_pend > 0
      ) t
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 13. RPC: PESQUISA DE COLABORADORES (gestão)
-- -----------------------------------------------------------------------------
-- A pesquisa é feita no servidor: devolve só o que o gestor pode ver e já com
-- os indicadores, para a tabela não ter de cruzar tabelas no cliente.
CREATE OR REPLACE FUNCTION public.pesquisar_colaboradores(
  p_texto      text DEFAULT NULL,
  p_provincia  uuid DEFAULT NULL,
  p_municipio  text DEFAULT NULL,
  p_estado     text DEFAULT NULL,   -- 'ativos' | 'inativos' | NULL
  p_ordem      text DEFAULT NULL    -- 'nome' | 'vendas' | 'clientes' | 'comissao' | 'meta'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_texto  text := NULLIF(btrim(COALESCE(p_texto, '')), '');
  v_digitos text := regexp_replace(COALESCE(p_texto, ''), '[^0-9]', '', 'g');
  v_prov   uuid := CASE
                     WHEN public.is_national() THEN p_provincia
                     ELSE public.my_province()
                   END;
  v_mes    date := date_trunc('month', now())::date;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode pesquisar colaboradores' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(t ORDER BY
      CASE p_ordem
        WHEN 'vendas'   THEN t.vendas_valor
        WHEN 'clientes' THEN t.clientes::numeric
        WHEN 'comissao' THEN t.comissao_total
        WHEN 'meta'     THEN t.meta_pct
      END DESC NULLS LAST,
      t.nome ASC
    )
    FROM (
      SELECT
        p.id,
        p.full_name  AS nome,
        p.referencia,
        p.avatar_url,
        p.phone,
        p.is_active,
        p.created_at,
        p.provincia_id,
        pr.nome      AS provincia,
        pr.codigo    AS provincia_codigo,
        sp.municipio,
        sp.bi_number,
        sp.job_title,
        sp.category,
        sp.commission_rate,
        COALESCE(cl.total, 0)  AS clientes,
        COALESCE(cl.ativos, 0) AS clientes_ativos,
        COALESCE(v.qtd, 0)     AS vendas_count,
        COALESCE(v.valor, 0)   AS vendas_valor,
        COALESCE(cm.total, 0)  AS comissao_total,
        COALESCE(cm.pendente, 0) AS comissao_pendente,
        COALESCE(m.alvo, 0)    AS meta_valor,
        CASE WHEN COALESCE(m.alvo, 0) > 0
             THEN round(COALESCE(v.valor, 0) / m.alvo * 100, 2)
             ELSE 0 END        AS meta_pct
      FROM public.profiles p
      LEFT JOIN public.seller_profiles sp ON sp.id = p.id
      LEFT JOIN public.provincias pr      ON pr.id = p.provincia_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE sc.is_active) AS ativos
        FROM public.seller_customers sc WHERE sc.seller_id = p.id
      ) cl ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS qtd, SUM(s.total_amount) AS valor
        FROM public.sales s
        WHERE s.seller_id = p.id AND s.status <> 'cancelled'
      ) v ON true
      LEFT JOIN LATERAL (
        SELECT SUM(c.amount) AS total,
               SUM(c.amount) FILTER (WHERE c.status = 'pending') AS pendente
        FROM public.sale_commissions c
        WHERE c.seller_id = p.id AND c.status <> 'cancelled'
      ) cm ON true
      LEFT JOIN LATERAL (
        SELECT g.target_amount AS alvo
        FROM public.sales_goals g
        WHERE g.seller_id = p.id AND v_mes BETWEEN g.period_start AND g.period_end
        ORDER BY g.period_start DESC LIMIT 1
      ) m ON true
      WHERE p.role = 'seller'
        AND (v_prov IS NULL OR p.provincia_id = v_prov)
        AND (p_municipio IS NULL OR btrim(p_municipio) = '' OR sp.municipio = p_municipio)
        AND (p_estado IS NULL OR p_estado = ''
             OR (p_estado = 'ativos'   AND p.is_active)
             OR (p_estado = 'inativos' AND NOT p.is_active))
        AND (
          v_texto IS NULL
          OR p.referencia ILIKE '%' || v_texto || '%'
          OR p.full_name  ILIKE '%' || v_texto || '%'
          OR sp.bi_number ILIKE '%' || v_texto || '%'
          OR (length(v_digitos) >= 3 AND regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g') LIKE '%' || v_digitos || '%')
        )
    ) t
  ), '[]'::jsonb);
END;
$$;

-- -----------------------------------------------------------------------------
-- 14. RPC: VISÃO GERAL DA REDE (gestão)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.colaboradores_overview(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_from timestamptz := COALESCE(p_from, date_trunc('month', now()));
  v_to   timestamptz := COALESCE(p_to, now());
  v_prov uuid := CASE WHEN public.is_national() THEN NULL ELSE public.my_province() END;
  v_mes  date := date_trunc('month', now())::date;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode ver a rede' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'period_from', v_from,
    'period_to', v_to,
    'scope', CASE WHEN v_prov IS NULL THEN 'nacional' ELSE 'provincial' END,
    'totais', jsonb_build_object(
      'colaboradores', (
        SELECT COUNT(*) FROM public.profiles p
        WHERE p.role = 'seller' AND (v_prov IS NULL OR p.provincia_id = v_prov)
      ),
      'colaboradores_ativos', (
        SELECT COUNT(*) FROM public.profiles p
        WHERE p.role = 'seller' AND p.is_active AND (v_prov IS NULL OR p.provincia_id = v_prov)
      ),
      'colaboradores_inativos', (
        SELECT COUNT(*) FROM public.profiles p
        WHERE p.role = 'seller' AND NOT p.is_active AND (v_prov IS NULL OR p.provincia_id = v_prov)
      ),
      'clientes', (
        SELECT COUNT(*) FROM public.profiles p
        WHERE p.role = 'customer' AND (v_prov IS NULL OR p.provincia_id = v_prov)
      ),
      'vendas_count', (
        SELECT COUNT(*) FROM public.sales s
        WHERE s.status <> 'cancelled' AND s.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR s.provincia_id = v_prov)
      ),
      'vendas_valor', (
        SELECT COALESCE(SUM(s.total_amount), 0) FROM public.sales s
        WHERE s.status <> 'cancelled' AND s.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR s.provincia_id = v_prov)
      ),
      'comissao_gerada', (
        SELECT COALESCE(SUM(c.amount), 0) FROM public.sale_commissions c
        WHERE c.status <> 'cancelled' AND c.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR c.provincia_id = v_prov)
      ),
      'comissao_paga', (
        SELECT COALESCE(SUM(c.amount), 0) FROM public.sale_commissions c
        WHERE c.status = 'paid'
          AND (v_prov IS NULL OR c.provincia_id = v_prov)
      ),
      'comissao_pendente', (
        SELECT COALESCE(SUM(c.amount), 0) FROM public.sale_commissions c
        WHERE c.status = 'pending'
          AND (v_prov IS NULL OR c.provincia_id = v_prov)
      ),
      'metas_atingidas', (
        SELECT COUNT(*) FROM (
          SELECT g.seller_id, g.target_amount
          FROM public.sales_goals g
          WHERE g.seller_id IS NOT NULL
            AND v_mes BETWEEN g.period_start AND g.period_end
            AND (v_prov IS NULL OR EXISTS (
              SELECT 1 FROM public.profiles p
              WHERE p.id = g.seller_id AND p.provincia_id = v_prov))
        ) g
        WHERE g.target_amount > 0 AND COALESCE((
          SELECT SUM(s.total_amount) FROM public.sales s
          WHERE s.seller_id = g.seller_id AND s.status <> 'cancelled'
            AND s.created_at BETWEEN v_from AND v_to
        ), 0) >= g.target_amount
      ),
      'metas_em_curso', (
        SELECT COUNT(*) FROM public.sales_goals g
        WHERE g.seller_id IS NOT NULL
          AND v_mes BETWEEN g.period_start AND g.period_end
          AND (v_prov IS NULL OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = g.seller_id AND p.provincia_id = v_prov))
      )
    ),
    'provincias', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.vendas_valor DESC), '[]'::jsonb)
      FROM (
        SELECT
          pr.id, pr.nome, pr.codigo,
          (SELECT COUNT(*) FROM public.profiles p
           WHERE p.role = 'seller' AND p.provincia_id = pr.id) AS colaboradores,
          (SELECT COUNT(*) FROM public.profiles p
           WHERE p.role = 'seller' AND p.is_active AND p.provincia_id = pr.id) AS colaboradores_ativos,
          (SELECT COUNT(*) FROM public.profiles p
           WHERE p.role = 'customer' AND p.provincia_id = pr.id) AS clientes,
          (SELECT COUNT(*) FROM public.sales s
           WHERE s.provincia_id = pr.id AND s.status <> 'cancelled'
             AND s.created_at BETWEEN v_from AND v_to) AS vendas_count,
          COALESCE((SELECT SUM(s.total_amount) FROM public.sales s
           WHERE s.provincia_id = pr.id AND s.status <> 'cancelled'
             AND s.created_at BETWEEN v_from AND v_to), 0) AS vendas_valor,
          COALESCE((SELECT SUM(c.amount) FROM public.sale_commissions c
           WHERE c.provincia_id = pr.id AND c.status <> 'cancelled'), 0) AS comissao,
          COALESCE((SELECT SUM(c.amount) FROM public.sale_commissions c
           WHERE c.provincia_id = pr.id AND c.status = 'pending'), 0) AS comissao_pendente
        FROM public.provincias pr
        WHERE pr.is_active AND (v_prov IS NULL OR pr.id = v_prov)
      ) t
    ),
    'ranking', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT p.id, p.full_name AS nome, p.referencia, p.avatar_url,
               pr.nome AS provincia,
               COALESCE(SUM(s.total_amount), 0) AS vendas_valor,
               COUNT(s.id) AS vendas_count,
               COALESCE(SUM(c.amount) FILTER (WHERE c.status <> 'cancelled'), 0) AS comissao
        FROM public.profiles p
        LEFT JOIN public.provincias pr ON pr.id = p.provincia_id
        LEFT JOIN public.sales s
          ON s.seller_id = p.id AND s.status <> 'cancelled'
         AND s.created_at BETWEEN v_from AND v_to
        LEFT JOIN public.sale_commissions c ON c.sale_id = s.id
        WHERE p.role = 'seller' AND p.is_active
          AND (v_prov IS NULL OR p.provincia_id = v_prov)
        GROUP BY p.id, p.full_name, p.referencia, p.avatar_url, pr.nome
        ORDER BY COALESCE(SUM(s.total_amount), 0) DESC, p.full_name
        LIMIT 10
      ) t
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 15. RPC: METAS E PAGAMENTOS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.definir_meta(
  p_seller_id     uuid DEFAULT NULL,
  p_provincia_id  uuid DEFAULT NULL,
  p_inicio        date DEFAULT NULL,
  p_fim           date DEFAULT NULL,
  p_valor         numeric DEFAULT 0,
  p_vendas        int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_inicio date := COALESCE(p_inicio, date_trunc('month', now())::date);
  v_fim    date := COALESCE(p_fim, (date_trunc('month', now()) + interval '1 month - 1 day')::date);
  v_prov   uuid;
  v_id     uuid;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode definir metas' USING ERRCODE = '42501';
  END IF;

  IF (p_seller_id IS NULL) = (p_provincia_id IS NULL) THEN
    RAISE EXCEPTION 'Indique um colaborador OU uma província';
  END IF;

  IF p_seller_id IS NOT NULL THEN
    SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = p_seller_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Colaborador inexistente';
    END IF;
  ELSE
    v_prov := p_provincia_id;
  END IF;

  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Só pode definir metas na província que gere' USING ERRCODE = '42501';
  END IF;

  IF p_seller_id IS NOT NULL THEN
    INSERT INTO public.sales_goals AS g
      (seller_id, period_start, period_end, target_amount, target_sales, created_by)
    VALUES (p_seller_id, v_inicio, v_fim, COALESCE(p_valor, 0), COALESCE(p_vendas, 0), auth.uid())
    ON CONFLICT (seller_id, period_start, period_end) WHERE seller_id IS NOT NULL
    DO UPDATE SET target_amount = EXCLUDED.target_amount,
                  target_sales  = EXCLUDED.target_sales,
                  updated_at = now()
    RETURNING g.id INTO v_id;
  ELSE
    INSERT INTO public.sales_goals AS g
      (provincia_id, period_start, period_end, target_amount, target_sales, created_by)
    VALUES (p_provincia_id, v_inicio, v_fim, COALESCE(p_valor, 0), COALESCE(p_vendas, 0), auth.uid())
    ON CONFLICT (provincia_id, period_start, period_end) WHERE provincia_id IS NOT NULL
    DO UPDATE SET target_amount = EXCLUDED.target_amount,
                  target_sales  = EXCLUDED.target_sales,
                  updated_at = now()
    RETURNING g.id INTO v_id;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'inicio', v_inicio, 'fim', v_fim,
                            'valor', COALESCE(p_valor, 0), 'vendas', COALESCE(p_vendas, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.pagar_comissoes(
  p_seller_id uuid,
  p_method    text DEFAULT NULL,
  p_notes     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov   uuid;
  v_total  numeric(12,2);
  v_payout uuid;
  v_qtd    int;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode pagar comissões' USING ERRCODE = '42501';
  END IF;

  SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = p_seller_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador inexistente';
  END IF;
  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Só pode pagar comissões da província que gere' USING ERRCODE = '42501';
  END IF;

  -- Só comissões com valor: uma venda a 0% gera uma linha de 0 AOA, e pagar
  -- zero não é um pagamento.
  SELECT COALESCE(SUM(c.amount), 0), COUNT(*)
    INTO v_total, v_qtd
  FROM public.sale_commissions c
  WHERE c.seller_id = p_seller_id AND c.status = 'pending' AND c.amount > 0;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Não há comissões pendentes';
  END IF;

  INSERT INTO public.commission_payouts (seller_id, provincia_id, amount, method, notes, paid_by)
  VALUES (p_seller_id, v_prov, v_total, p_method, p_notes, auth.uid())
  RETURNING id INTO v_payout;

  UPDATE public.sale_commissions c
  SET status = 'paid', paid_at = now(), payout_id = v_payout, updated_at = now()
  WHERE c.seller_id = p_seller_id AND c.status = 'pending' AND c.amount > 0;

  RETURN jsonb_build_object('payout_id', v_payout, 'amount', v_total, 'comissoes', v_qtd);
END;
$$;

-- -----------------------------------------------------------------------------
-- 16. RPC: ACTUALIZAR DADOS DO COLABORADOR
-- -----------------------------------------------------------------------------
-- O próprio só mexe em contactos e morada. Tudo o resto (BI, função, categoria,
-- taxa de comissão, estado) é da gestão. A lista é explícita: um campo novo no
-- formulário não passa a ser editável só por existir.
CREATE OR REPLACE FUNCTION public.atualizar_perfil_colaborador(
  p_id     uuid,
  p_campos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_eu      uuid := auth.uid();
  v_gestor  boolean := public.is_manager();
  v_prov    uuid;
  v_pode    boolean;
BEGIN
  IF v_eu IS NULL THEN
    RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501';
  END IF;

  SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador inexistente';
  END IF;

  v_pode := (p_id = v_eu) OR (v_gestor AND public.can_manage_province(v_prov));
  IF NOT v_pode THEN
    RAISE EXCEPTION 'Sem permissão para alterar este perfil' USING ERRCODE = '42501';
  END IF;

  -- A ficha tem de existir para se guardar dados de colaborador.
  INSERT INTO public.seller_profiles (id) VALUES (p_id)
  ON CONFLICT (id) DO NOTHING;

  -- --- campos que o próprio pode alterar ---
  IF p_campos ? 'whatsapp' THEN
    UPDATE public.seller_profiles SET whatsapp = NULLIF(btrim(p_campos->>'whatsapp'), ''), updated_at = now() WHERE id = p_id;
  END IF;
  IF p_campos ? 'address' THEN
    UPDATE public.seller_profiles SET address = NULLIF(btrim(p_campos->>'address'), ''), updated_at = now() WHERE id = p_id;
  END IF;
  IF p_campos ? 'municipio' THEN
    UPDATE public.seller_profiles SET municipio = NULLIF(btrim(p_campos->>'municipio'), ''), updated_at = now() WHERE id = p_id;
  END IF;
  IF p_campos ? 'avatar_url' THEN
    UPDATE public.profiles SET avatar_url = NULLIF(btrim(p_campos->>'avatar_url'), ''), updated_at = now() WHERE id = p_id;
  END IF;

  -- --- campos reservados à gestão ---
  -- Recusar é melhor do que ignorar em silêncio: um formulário que envie o BI
  -- tem de saber que não foi guardado.
  IF NOT (v_gestor AND public.can_manage_province(v_prov))
     AND p_campos ?| ARRAY['full_name','bi_number','birth_date','job_title',
                           'category','hired_at','manager_id','commission_rate','is_active'] THEN
    RAISE EXCEPTION 'Só a gestão pode alterar estes campos' USING ERRCODE = '42501';
  END IF;

  IF v_gestor AND public.can_manage_province(v_prov) THEN
    IF p_campos ? 'full_name' THEN
      UPDATE public.profiles SET full_name = btrim(p_campos->>'full_name'), updated_at = now() WHERE id = p_id;
    END IF;
    IF p_campos ? 'bi_number' THEN
      UPDATE public.seller_profiles SET bi_number = NULLIF(upper(btrim(p_campos->>'bi_number')), ''), updated_at = now() WHERE id = p_id;
    END IF;
    IF p_campos ? 'birth_date' THEN
      UPDATE public.seller_profiles SET birth_date = NULLIF(p_campos->>'birth_date', '')::date, updated_at = now() WHERE id = p_id;
    END IF;
    IF p_campos ? 'job_title' THEN
      UPDATE public.seller_profiles SET job_title = NULLIF(btrim(p_campos->>'job_title'), ''), updated_at = now() WHERE id = p_id;
    END IF;
    IF p_campos ? 'category' THEN
      UPDATE public.seller_profiles SET category = NULLIF(btrim(p_campos->>'category'), ''), updated_at = now() WHERE id = p_id;
    END IF;
    IF p_campos ? 'hired_at' THEN
      UPDATE public.seller_profiles SET hired_at = NULLIF(p_campos->>'hired_at', '')::date, updated_at = now() WHERE id = p_id;
    END IF;
    IF p_campos ? 'manager_id' THEN
      UPDATE public.seller_profiles SET manager_id = NULLIF(p_campos->>'manager_id', '')::uuid, updated_at = now() WHERE id = p_id;
    END IF;
    IF p_campos ? 'commission_rate' THEN
      UPDATE public.seller_profiles
      SET commission_rate = LEAST(GREATEST(COALESCE((p_campos->>'commission_rate')::numeric, 0), 0), 1),
          updated_at = now()
      WHERE id = p_id;
    END IF;
    IF p_campos ? 'is_active' THEN
      UPDATE public.profiles SET is_active = COALESCE((p_campos->>'is_active')::boolean, true), updated_at = now() WHERE id = p_id;
    END IF;
  END IF;

  RETURN public.colaborador_ficha(p_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 17. INDICADORES EXISTENTES PASSAM A IGNORAR VENDAS CANCELADAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seller_stats(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_from  timestamptz := COALESCE(p_from, date_trunc('month', now()));
  v_to    timestamptz := COALESCE(p_to, now());
  v_total numeric(14,2);
  v_count int;
  v_units int;
  v_customers int;
  v_top jsonb;
BEGIN
  SELECT COALESCE(SUM(s.total_amount), 0), COUNT(*)
    INTO v_total, v_count
  FROM public.sales s
  WHERE s.seller_id = v_uid AND s.status <> 'cancelled'
    AND s.created_at BETWEEN v_from AND v_to;

  SELECT COALESCE(SUM(si.quantity), 0)
    INTO v_units
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  WHERE s.seller_id = v_uid AND s.status <> 'cancelled'
    AND s.created_at BETWEEN v_from AND v_to;

  SELECT COUNT(*) INTO v_customers
  FROM public.seller_customers sc
  WHERE sc.seller_id = v_uid AND sc.is_active = true;

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_top
  FROM (
    SELECT si.product_snapshot->>'name' AS name, SUM(si.quantity) AS units, SUM(si.total_price) AS value
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE s.seller_id = v_uid AND s.status <> 'cancelled'
      AND s.created_at BETWEEN v_from AND v_to
    GROUP BY si.product_snapshot->>'name'
    ORDER BY SUM(si.quantity) DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'period_from', v_from,
    'period_to', v_to,
    'total_sales_value', v_total,
    'sales_count', v_count,
    'units_sold', v_units,
    'customers_count', v_customers,
    'top_products', v_top
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 18. INDICADORES DA GERÊNCIA (mesma função, agora sem vendas canceladas)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_stats(
  p_from         timestamptz DEFAULT NULL,
  p_to           timestamptz DEFAULT NULL,
  p_provincia_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_from timestamptz := COALESCE(p_from, date_trunc('month', now()));
  v_to   timestamptz := COALESCE(p_to, now());
  v_prov uuid := CASE
                   WHEN public.is_national() THEN p_provincia_id
                   ELSE public.my_province()
                 END;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode consultar indicadores' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'period_from', v_from,
    'period_to', v_to,
    'provincia_id', v_prov,
    'scope', CASE WHEN v_prov IS NULL THEN 'nacional' ELSE 'provincial' END,
    'sales_total_value', (
      SELECT COALESCE(SUM(s.total_amount), 0) FROM public.sales s
      WHERE s.created_at BETWEEN v_from AND v_to
        AND s.status <> 'cancelled'
        AND (v_prov IS NULL OR s.provincia_id = v_prov)
    ),
    'sales_count', (
      SELECT COUNT(*) FROM public.sales s
      WHERE s.created_at BETWEEN v_from AND v_to
        AND s.status <> 'cancelled'
        AND (v_prov IS NULL OR s.provincia_id = v_prov)
    ),
    'orders_count', (
      SELECT COUNT(*) FROM public.orders o
      WHERE o.created_at BETWEEN v_from AND v_to
        AND (v_prov IS NULL OR o.provincia_id = v_prov)
    ),
    'orders_by_status', (
      SELECT COALESCE(jsonb_object_agg(t.status, t.qty), '{}'::jsonb)
      FROM (
        SELECT o.status::text AS status, COUNT(*) AS qty
        FROM public.orders o
        WHERE o.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR o.provincia_id = v_prov)
        GROUP BY o.status
      ) t
    ),
    'customers_count', (
      SELECT COUNT(*) FROM public.profiles p
      WHERE p.role = 'customer'
        AND (v_prov IS NULL OR p.provincia_id = v_prov)
    ),
    'sellers_count', (
      SELECT COUNT(*) FROM public.profiles p
      WHERE p.role = 'seller' AND p.is_active = true
        AND (v_prov IS NULL OR p.provincia_id = v_prov)
    ),
    'active_reservations', (
      SELECT COUNT(*) FROM public.reservations r
      WHERE r.status = 'active'
        AND (v_prov IS NULL OR r.provincia_id = v_prov)
    ),
    'pending_discounts', (
      SELECT COUNT(*) FROM public.discount_requests d
      WHERE d.status = 'pending'
        AND (v_prov IS NULL OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = d.customer_id AND p.provincia_id = v_prov
        ))
    ),
    'low_stock_products', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT p.name, i.quantity, i.low_stock_threshold, pr.nome AS provincia
        FROM public.inventory i
        JOIN public.products p ON p.id = i.product_id
        LEFT JOIN public.provincias pr ON pr.id = i.provincia_id
        WHERE i.quantity <= i.low_stock_threshold
          AND (v_prov IS NULL OR i.provincia_id = v_prov)
        ORDER BY i.quantity ASC
        LIMIT 20
      ) t
    ),
    'sales_by_seller', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT pr.full_name AS seller, COUNT(*) AS sales, SUM(s.total_amount) AS value
        FROM public.sales s
        JOIN public.profiles pr ON pr.id = s.seller_id
        WHERE s.created_at BETWEEN v_from AND v_to
          AND s.status <> 'cancelled'
          AND (v_prov IS NULL OR s.provincia_id = v_prov)
        GROUP BY pr.full_name
        ORDER BY SUM(s.total_amount) DESC
        LIMIT 20
      ) t
    ),
    'top_products', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT si.product_snapshot->>'name' AS name, SUM(si.quantity) AS units, SUM(si.total_price) AS value
        FROM public.sale_items si
        JOIN public.sales s ON s.id = si.sale_id
        WHERE s.created_at BETWEEN v_from AND v_to
          AND s.status <> 'cancelled'
          AND (v_prov IS NULL OR s.provincia_id = v_prov)
        GROUP BY si.product_snapshot->>'name'
        ORDER BY SUM(si.quantity) DESC
        LIMIT 10
      ) t
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 19. PERMISSÕES
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.proxima_referencia(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_collaborator(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.colaborador_ficha(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.colaborador_painel(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pesquisar_colaboradores(text, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.colaboradores_overview(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.definir_meta(uuid, uuid, date, date, numeric, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pagar_comissoes(uuid, text, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.atualizar_perfil_colaborador(uuid, jsonb) TO authenticated;

-- Realtime: o painel do colaborador reage a novas comissões.
DO $$
BEGIN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.sale_commissions';
EXCEPTION WHEN duplicate_object THEN NULL;
        WHEN undefined_object THEN NULL;
END $$;


-- ###########################################################################
-- ##  PARTE 7 de 15 — CONTEÚDOS PUBLICADOS E FORMAÇÃO
-- ###########################################################################

-- =============================================================================
-- INUKA ANGOLA — MIGRAÇÃO 7 : CONTEÚDOS PUBLICADOS E FORMAÇÃO
--
-- O estúdio de design deixa de ser um editor isolado e passa a ter um destino.
-- Esta migração cria o registo central de conteúdos (`content_items`) que liga
-- um projeto do designer a uma área do sistema:
--
--   comunicado  -> feed dos colaboradores        (/vendedor/comunicados)
--   testemunho  -> área dos clientes             (/cliente/testemunhos)
--   promocao    -> loja                          (/promocoes)
--   formacao    -> capa de um curso              (/vendedor/formacao)
--
-- Decisões:
--   * Um único registo para os quatro tipos. As diferenças (datas, produtos,
--     autor do testemunho) são colunas opcionais, não tabelas separadas: o
--     gestor publica sempre a partir do mesmo diálogo e a listagem de gestão
--     é uma só consulta. Tabelas por tipo obrigariam a quatro cópias de tudo.
--   * `project_id` é ÚNICO. É isto que impede a duplicação de publicações
--     quando o gestor volta a publicar o mesmo projeto: o segundo publish
--     atualiza o registo existente em vez de criar outro.
--   * A escrita é toda do gestor (política RLS). Não há RPC de publicação
--     porque o registo é um documento simples — a validação vive em triggers
--     (título, datas, published_at), que se aplicam também a quem escrever
--     por outra via.
--   * A leitura de `content_items` para `anon` só devolve testemunhos e
--     promoções nacionais e publicados. Um rascunho ou um comunicado interno
--     nunca sai da base por esta porta.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CONTEÚDOS
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL
                  CHECK (kind IN ('comunicado', 'testemunho', 'promocao', 'formacao')),
  title           text NOT NULL,
  subtitle        text,
  body            text,
  -- Projeto do designer que originou o conteúdo. Único: um projeto, uma
  -- publicação. Republicar atualiza esta linha.
  project_id      uuid REFERENCES public.design_projects(id) ON DELETE SET NULL,
  image_url       text,
  image_path      text,
  status          text NOT NULL DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho', 'em_edicao', 'publicado', 'agendado', 'suspenso', 'arquivado')),
  provincia_id    uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  -- Comunicado importante: fica no topo do feed.
  is_pinned       boolean NOT NULL DEFAULT false,
  allow_reactions boolean NOT NULL DEFAULT true,
  allow_comments  boolean NOT NULL DEFAULT true,
  -- Identificação autorizada do cliente (testemunho).
  author_name     text,
  author_photo    text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  cta_label       text,
  cta_href        text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order      int NOT NULL DEFAULT 0,
  created_by      uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_items_title_not_empty CHECK (length(btrim(title)) > 0),
  CONSTRAINT content_items_datas CHECK (
    ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at
  ),
  CONSTRAINT content_items_metadata_obj CHECK (jsonb_typeof(metadata) = 'object')
);

-- Um projeto do designer só pode estar publicado num sítio.
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_items_project
  ON public.content_items (project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_content_items_feed
  ON public.content_items (kind, status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_items_provincia
  ON public.content_items (provincia_id);

CREATE INDEX IF NOT EXISTS idx_content_items_gestao
  ON public.content_items (status, updated_at DESC);

-- Produtos anunciados numa promoção (ou associados a um conteúdo).
CREATE TABLE IF NOT EXISTS public.content_products (
  item_id    uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_content_products_item
  ON public.content_products (item_id, sort_order);

-- Reações: uma por utilizador e conteúdo.
CREATE TABLE IF NOT EXISTS public.content_reactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction   text NOT NULL DEFAULT 'gosto' CHECK (reaction IN ('gosto', 'adoro', 'util')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_content_reactions_item
  ON public.content_reactions (item_id);

CREATE TABLE IF NOT EXISTS public.content_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  body       text NOT NULL,
  is_hidden  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_comments_body_not_empty CHECK (length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_content_comments_item
  ON public.content_comments (item_id, created_at);

-- -----------------------------------------------------------------------------
-- 2. FORMAÇÃO
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.training_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  slug        text NOT NULL UNIQUE,
  description text,
  icon        text,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.training_courses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid REFERENCES public.training_categories(id) ON DELETE SET NULL,
  title        text NOT NULL,
  description  text,
  cover_url    text,
  level        text NOT NULL DEFAULT 'iniciacao'
               CHECK (level IN ('iniciacao', 'intermedio', 'avancado')),
  status       text NOT NULL DEFAULT 'rascunho'
               CHECK (status IN ('rascunho', 'publicado', 'suspenso', 'arquivado')),
  provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  duration_min int NOT NULL DEFAULT 0 CHECK (duration_min >= 0),
  sort_order   int NOT NULL DEFAULT 0,
  -- Capa produzida no estúdio: permite abrir o curso de volta no editor.
  project_id   uuid REFERENCES public.design_projects(id) ON DELETE SET NULL,
  -- Registo de conteúdo correspondente. Existe para o curso poder ter
  -- reações e comentários sem uma segunda tabela de comentários.
  content_id   uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  created_by   uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_courses_title_not_empty CHECK (length(btrim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_training_courses_status
  ON public.training_courses (status, sort_order, title);

CREATE TABLE IF NOT EXISTS public.training_lessons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  title        text NOT NULL,
  summary      text,
  body         text,
  kind         text NOT NULL DEFAULT 'texto'
               CHECK (kind IN ('texto', 'video', 'pdf', 'link', 'quiz')),
  video_url    text,
  file_path    text,
  file_name    text,
  duration_min int NOT NULL DEFAULT 0 CHECK (duration_min >= 0),
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_lessons_title_not_empty CHECK (length(btrim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_training_lessons_course
  ON public.training_lessons (course_id, sort_order);

CREATE TABLE IF NOT EXISTS public.training_enrollments (
  course_id    uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (course_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.training_progress (
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id    uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  lesson_id    uuid NOT NULL REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_training_progress_curso
  ON public.training_progress (course_id, user_id);

CREATE TABLE IF NOT EXISTS public.training_bookmarks (
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id  uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);

-- -----------------------------------------------------------------------------
-- 3. TRIGGERS
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_content_items_updated_at ON public.content_items;
CREATE TRIGGER trg_content_items_updated_at
  BEFORE UPDATE ON public.content_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_training_courses_updated_at ON public.training_courses;
CREATE TRIGGER trg_training_courses_updated_at
  BEFORE UPDATE ON public.training_courses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_training_lessons_updated_at ON public.training_lessons;
CREATE TRIGGER trg_training_lessons_updated_at
  BEFORE UPDATE ON public.training_lessons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- `published_at` é carimbado pelo servidor, não pelo cliente. Assim uma
-- alteração de estado feita por qualquer via fica com a data certa.
CREATE OR REPLACE FUNCTION public.content_items_antes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- `OLD` não existe num INSERT: separar os ramos evita o erro em vez de
  -- depender do curto-circuito do `OR`.
  IF NEW.status = 'publicado' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.published_at := COALESCE(NEW.published_at, now());
    ELSIF OLD.status IS DISTINCT FROM 'publicado' THEN
      NEW.published_at := COALESCE(NEW.published_at, now());
    END IF;
  END IF;

  -- Uma promoção sem início começa agora; sem isto a loja não a mostra.
  IF NEW.kind = 'promocao' AND NEW.starts_at IS NULL THEN
    NEW.starts_at := COALESCE(NEW.published_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_content_items_antes ON public.content_items;
CREATE TRIGGER trg_content_items_antes
  BEFORE INSERT OR UPDATE ON public.content_items
  FOR EACH ROW EXECUTE FUNCTION public.content_items_antes();

CREATE OR REPLACE FUNCTION public.training_courses_antes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_content uuid;
BEGIN
  IF NEW.status = 'publicado' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.published_at := COALESCE(NEW.published_at, now());
    ELSIF OLD.status IS DISTINCT FROM 'publicado' THEN
      NEW.published_at := COALESCE(NEW.published_at, now());
    END IF;
  END IF;

  -- Cada curso ganha um registo de conteúdo, criado aqui e não na aplicação:
  -- assim os comentários funcionam mesmo para um curso criado por SQL.
  -- Sem `project_id`: esse índice é único (um projeto, uma publicação) e o
  -- cartaz do curso pode já estar publicado como conteúdo próprio.
  IF TG_OP = 'INSERT' AND NEW.content_id IS NULL THEN
    INSERT INTO public.content_items (
      kind, title, subtitle, body, image_url, status, provincia_id,
      allow_reactions, allow_comments
    )
    VALUES (
      'formacao', NEW.title, NULL, NEW.description, NEW.cover_url, NEW.status,
      NEW.provincia_id, true, true
    )
    RETURNING id INTO v_content;

    NEW.content_id := v_content;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_courses_antes ON public.training_courses;
CREATE TRIGGER trg_training_courses_antes
  BEFORE INSERT OR UPDATE ON public.training_courses
  FOR EACH ROW EXECUTE FUNCTION public.training_courses_antes();

-- Manter o registo de conteúdo alinhado com o curso (título, capa, estado).
CREATE OR REPLACE FUNCTION public.training_courses_sincronizar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.content_id IS NOT NULL THEN
    UPDATE public.content_items
       SET title        = NEW.title,
           body         = NEW.description,
           image_url    = COALESCE(NEW.cover_url, image_url),
           status       = NEW.status,
           provincia_id = NEW.provincia_id
     WHERE id = NEW.content_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_courses_sincronizar ON public.training_courses;
CREATE TRIGGER trg_training_courses_sincronizar
  AFTER UPDATE ON public.training_courses
  FOR EACH ROW EXECUTE FUNCTION public.training_courses_sincronizar();

-- -----------------------------------------------------------------------------
-- 4. VISIBILIDADE (funções de apoio ao RLS)
-- -----------------------------------------------------------------------------

-- Posso ver este conteúdo?
--   * gestor: tudo
--   * publicado + província que me é visível
--   * anónimo: só publicados, nacionais, e apenas testemunhos/promoções
--   * promoções: só dentro das datas
CREATE OR REPLACE FUNCTION public.pode_ver_conteudo(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.content_items c
    WHERE c.id = p_id
      AND (
        public.is_manager()
        OR (
          c.status = 'publicado'
          AND public.can_see_province(c.provincia_id)
          -- Comunicados e material de formação são internos: um cliente não
          -- os vê, mesmo que peça o id diretamente.
          AND (c.kind IN ('testemunho', 'promocao') OR public.is_seller())
          AND (
            auth.uid() IS NOT NULL
            OR (
              c.kind IN ('testemunho', 'promocao')
              -- Visitante sem sessão só vê promoções dentro das datas. Quem
              -- tem sessão vê também as terminadas, marcadas como tal.
              AND (
                c.kind <> 'promocao'
                OR (
                  (c.starts_at IS NULL OR c.starts_at <= now())
                  AND (c.ends_at IS NULL OR c.ends_at >= now())
                )
              )
            )
          )
        )
      )
  );
$$;

-- Posso ver este curso? A formação é interna: clientes não entram.
CREATE OR REPLACE FUNCTION public.pode_ver_formacao(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.training_courses c
    WHERE c.id = p_id
      AND (
        public.is_manager()
        OR (
          c.status = 'publicado'
          AND (public.is_seller() OR public.is_manager())
          AND public.can_see_province(c.provincia_id)
        )
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.content_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_reactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_comments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_courses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_lessons    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_progress   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_bookmarks  ENABLE ROW LEVEL SECURITY;

-- 5.1 Conteúdos ---------------------------------------------------------------
DROP POLICY IF EXISTS content_items_read ON public.content_items;
CREATE POLICY content_items_read ON public.content_items
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR (
      status = 'publicado'
      AND public.can_see_province(provincia_id)
      AND (kind IN ('testemunho', 'promocao') OR public.is_seller())
    )
  );

DROP POLICY IF EXISTS content_items_read_anon ON public.content_items;
CREATE POLICY content_items_read_anon ON public.content_items
  FOR SELECT TO anon
  USING (
    status = 'publicado'
    AND kind IN ('testemunho', 'promocao')
    AND provincia_id IS NULL
    AND (
      kind <> 'promocao'
      OR (
        (starts_at IS NULL OR starts_at <= now())
        AND (ends_at IS NULL OR ends_at >= now())
      )
    )
  );

DROP POLICY IF EXISTS content_items_write ON public.content_items;
CREATE POLICY content_items_write ON public.content_items
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- 5.2 Produtos anunciados -----------------------------------------------------
DROP POLICY IF EXISTS content_products_read ON public.content_products;
CREATE POLICY content_products_read ON public.content_products
  FOR SELECT TO authenticated
  USING (public.pode_ver_conteudo(item_id));

DROP POLICY IF EXISTS content_products_read_anon ON public.content_products;
CREATE POLICY content_products_read_anon ON public.content_products
  FOR SELECT TO anon
  USING (public.pode_ver_conteudo(item_id));

DROP POLICY IF EXISTS content_products_write ON public.content_products;
CREATE POLICY content_products_write ON public.content_products
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- 5.3 Reações ----------------------------------------------------------------
-- Ler as reações de um conteúdo visível é necessário para mostrar a contagem
-- e para saber se já reagi. Não se lê reações de conteúdos que não posso ver.
DROP POLICY IF EXISTS content_reactions_read ON public.content_reactions;
CREATE POLICY content_reactions_read ON public.content_reactions
  FOR SELECT TO authenticated
  USING (public.pode_ver_conteudo(item_id));

DROP POLICY IF EXISTS content_reactions_insert ON public.content_reactions;
CREATE POLICY content_reactions_insert ON public.content_reactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.pode_ver_conteudo(item_id));

DROP POLICY IF EXISTS content_reactions_update ON public.content_reactions;
CREATE POLICY content_reactions_update ON public.content_reactions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS content_reactions_delete ON public.content_reactions;
CREATE POLICY content_reactions_delete ON public.content_reactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_manager());

-- 5.4 Comentários ------------------------------------------------------------
DROP POLICY IF EXISTS content_comments_read ON public.content_comments;
CREATE POLICY content_comments_read ON public.content_comments
  FOR SELECT TO authenticated
  USING (public.is_manager() OR (NOT is_hidden AND public.pode_ver_conteudo(item_id)));

DROP POLICY IF EXISTS content_comments_insert ON public.content_comments;
CREATE POLICY content_comments_insert ON public.content_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.content_items c
      WHERE c.id = item_id
        AND c.allow_comments
        AND (public.is_manager() OR c.status = 'publicado')
    )
    AND public.pode_ver_conteudo(item_id)
  );

DROP POLICY IF EXISTS content_comments_update ON public.content_comments;
CREATE POLICY content_comments_update ON public.content_comments
  FOR UPDATE TO authenticated
  USING (public.is_manager() OR user_id = auth.uid())
  WITH CHECK (public.is_manager() OR user_id = auth.uid());

DROP POLICY IF EXISTS content_comments_delete ON public.content_comments;
CREATE POLICY content_comments_delete ON public.content_comments
  FOR DELETE TO authenticated
  USING (public.is_manager() OR user_id = auth.uid());

-- 5.5 Formação ---------------------------------------------------------------
DROP POLICY IF EXISTS training_categories_read ON public.training_categories;
CREATE POLICY training_categories_read ON public.training_categories
  FOR SELECT TO authenticated
  USING (is_active OR public.is_manager());

DROP POLICY IF EXISTS training_categories_write ON public.training_categories;
CREATE POLICY training_categories_write ON public.training_categories
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS training_courses_read ON public.training_courses;
CREATE POLICY training_courses_read ON public.training_courses
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR (
      status = 'publicado'
      AND (public.is_seller() OR public.is_manager())
      AND public.can_see_province(provincia_id)
    )
  );

DROP POLICY IF EXISTS training_courses_write ON public.training_courses;
CREATE POLICY training_courses_write ON public.training_courses
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS training_lessons_read ON public.training_lessons;
CREATE POLICY training_lessons_read ON public.training_lessons
  FOR SELECT TO authenticated
  USING (public.pode_ver_formacao(course_id));

DROP POLICY IF EXISTS training_lessons_write ON public.training_lessons;
CREATE POLICY training_lessons_write ON public.training_lessons
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- 5.6 Progresso: cada colaborador só vê e escreve o seu -----------------------
DROP POLICY IF EXISTS training_enrollments_rw ON public.training_enrollments;
CREATE POLICY training_enrollments_rw ON public.training_enrollments
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_manager())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS training_progress_rw ON public.training_progress;
CREATE POLICY training_progress_rw ON public.training_progress
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_manager())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS training_bookmarks_rw ON public.training_bookmarks;
CREATE POLICY training_bookmarks_rw ON public.training_bookmarks
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 6. LÓGICA DE NEGÓCIO
-- -----------------------------------------------------------------------------

-- 6.1 Duplicar um conteúdo (o gestor cria variações sem perder o original).
CREATE OR REPLACE FUNCTION public.content_duplicate(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_src public.content_items;
  v_new uuid;
BEGIN
  IF NOT COALESCE(public.is_manager(), false) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO';
  END IF;

  SELECT * INTO v_src FROM public.content_items WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  INSERT INTO public.content_items (
    kind, title, subtitle, body, image_url, image_path, status, provincia_id,
    is_pinned, allow_reactions, allow_comments, author_name, author_photo,
    starts_at, ends_at, cta_label, cta_href, metadata, sort_order
  )
  VALUES (
    v_src.kind,
    left(v_src.title || ' (cópia)', 160),
    v_src.subtitle, v_src.body, v_src.image_url, v_src.image_path,
    'rascunho',                       -- a cópia nunca nasce publicada
    v_src.provincia_id, false, v_src.allow_reactions, v_src.allow_comments,
    v_src.author_name, v_src.author_photo,
    v_src.starts_at, v_src.ends_at, v_src.cta_label, v_src.cta_href,
    v_src.metadata, v_src.sort_order
  )
  RETURNING id INTO v_new;

  INSERT INTO public.content_products (item_id, product_id, sort_order)
  SELECT v_new, product_id, sort_order
  FROM public.content_products WHERE item_id = p_id;

  RETURN v_new;
END;
$$;

-- 6.2 Feed: uma chamada devolve tudo o que um cartão precisa.
--     Evita quatro consultas por cartão (reações, comentários, produtos,
--     província) que é o que aconteceria com embeds do PostgREST.
CREATE OR REPLACE FUNCTION public.conteudo_feed(
  p_kind  text DEFAULT NULL,
  p_limit int  DEFAULT 40
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(item ORDER BY fixado DESC, publicado DESC NULLS LAST), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT
      jsonb_build_object(
        'id',              c.id,
        'kind',            c.kind,
        'title',           c.title,
        'subtitle',        c.subtitle,
        'body',            c.body,
        'image_url',       c.image_url,
        'status',          c.status,
        'is_pinned',       c.is_pinned,
        'allow_reactions', c.allow_reactions,
        'allow_comments',  c.allow_comments,
        'author_name',     c.author_name,
        'author_photo',    c.author_photo,
        'starts_at',       c.starts_at,
        'ends_at',         c.ends_at,
        'published_at',    c.published_at,
        'cta_label',       c.cta_label,
        'cta_href',        c.cta_href,
        'metadata',        c.metadata,
        'provincia_id',    c.provincia_id,
        'provincia_nome',  pr.nome,
        'project_id',      c.project_id,
        'reacoes',         (SELECT count(*) FROM public.content_reactions r WHERE r.item_id = c.id),
        'comentarios',     (SELECT count(*) FROM public.content_comments m
                             WHERE m.item_id = c.id AND NOT m.is_hidden),
        'minha_reacao',    (SELECT r.reaction FROM public.content_reactions r
                             WHERE r.item_id = c.id AND r.user_id = auth.uid()),
        'produtos',        (
          SELECT coalesce(jsonb_agg(produto ORDER BY ordem), '[]'::jsonb)
          FROM (
            SELECT cp.sort_order AS ordem,
                   jsonb_build_object(
                     'id',    p.id,
                     'name',  p.name,
                     'sku',   p.sku,
                     'preco', coalesce(p.promotional_price, p.official_price),
                     'oficial', p.official_price,
                     'imagem', (
                       SELECT pi.url FROM public.product_images pi
                       WHERE pi.product_id = p.id
                       ORDER BY pi.is_primary DESC, pi.sort_order
                       LIMIT 1
                     )
                   ) AS produto
            FROM public.content_products cp
            JOIN public.products p ON p.id = cp.product_id
            WHERE cp.item_id = c.id
          ) t
        )
      ) AS item,
      c.is_pinned  AS fixado,
      c.published_at AS publicado
    FROM public.content_items c
    LEFT JOIN public.provincias pr ON pr.id = c.provincia_id
    WHERE (p_kind IS NULL OR c.kind = p_kind)
      AND (
        public.is_manager()
        OR (
          c.status = 'publicado'
          AND public.can_see_province(c.provincia_id)
          -- Comunicados e material de formação são internos: um cliente não
          -- os vê, mesmo que peça o id diretamente.
          AND (c.kind IN ('testemunho', 'promocao') OR public.is_seller())
          AND (
            auth.uid() IS NOT NULL
            OR (
              c.kind IN ('testemunho', 'promocao')
              AND (
                c.kind <> 'promocao'
                OR (
                  (c.starts_at IS NULL OR c.starts_at <= now())
                  AND (c.ends_at IS NULL OR c.ends_at >= now())
                )
              )
            )
          )
        )
      )
    ORDER BY c.is_pinned DESC, c.published_at DESC NULLS LAST, c.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 40), 100))
  ) lista;

  RETURN v_out;
END;
$$;

-- 6.3 Cursos com progresso do utilizador atual.
CREATE OR REPLACE FUNCTION public.formacao_cursos(
  p_categoria uuid DEFAULT NULL,
  p_limit     int  DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(curso ORDER BY ordem, titulo), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT
      jsonb_build_object(
        'id',           c.id,
        'title',        c.title,
        'description',  c.description,
        'cover_url',    c.cover_url,
        'level',        c.level,
        'status',       c.status,
        'duration_min', c.duration_min,
        'category_id',  c.category_id,
        'categoria',    tc.name,
        'categoria_slug', tc.slug,
        'provincia_nome', pr.nome,
        'aulas',        (SELECT count(*) FROM public.training_lessons l WHERE l.course_id = c.id),
        'concluidas',   (SELECT count(*) FROM public.training_progress p
                          WHERE p.course_id = c.id AND p.user_id = v_uid),
        'inscrito',     EXISTS (SELECT 1 FROM public.training_enrollments e
                                 WHERE e.course_id = c.id AND e.user_id = v_uid),
        'guardado',     EXISTS (SELECT 1 FROM public.training_bookmarks b
                                 WHERE b.course_id = c.id AND b.user_id = v_uid),
        'publicado',    c.published_at
      ) AS curso,
      tc.sort_order AS ordem,
      c.title       AS titulo
    FROM public.training_courses c
    LEFT JOIN public.training_categories tc ON tc.id = c.category_id
    LEFT JOIN public.provincias pr ON pr.id = c.provincia_id
    WHERE (p_categoria IS NULL OR c.category_id = p_categoria)
      AND (
        public.is_manager()
        OR (
          c.status = 'publicado'
          AND public.can_see_province(c.provincia_id)
          AND public.is_seller()
        )
      )
    ORDER BY tc.sort_order NULLS LAST, c.sort_order, c.title
    LIMIT greatest(1, least(coalesce(p_limit, 60), 200))
  ) lista;

  RETURN v_out;
END;
$$;

-- 6.4 Um curso com aulas e o progresso de quem está a ver.
CREATE OR REPLACE FUNCTION public.formacao_curso(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_curso public.training_courses;
  v_total int;
  v_feitas int;
  v_out jsonb;
BEGIN
  IF NOT public.pode_ver_formacao(p_id) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO';
  END IF;

  SELECT * INTO v_curso FROM public.training_courses WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  SELECT count(*) INTO v_total FROM public.training_lessons WHERE course_id = p_id;
  SELECT count(*) INTO v_feitas FROM public.training_progress
   WHERE course_id = p_id AND user_id = v_uid;

  SELECT jsonb_build_object(
    'id',           v_curso.id,
    'title',        v_curso.title,
    'description',  v_curso.description,
    'cover_url',    v_curso.cover_url,
    'level',        v_curso.level,
    'status',       v_curso.status,
    'duration_min', v_curso.duration_min,
    'project_id',   v_curso.project_id,
    'categoria',    (SELECT tc.name FROM public.training_categories tc WHERE tc.id = v_curso.category_id),
    'aulas_total',  v_total,
    'aulas_feitas', v_feitas,
    'percentagem',  CASE WHEN v_total = 0 THEN 0
                         ELSE round((v_feitas::numeric / v_total) * 100) END,
    'inscrito',     EXISTS (SELECT 1 FROM public.training_enrollments e
                             WHERE e.course_id = p_id AND e.user_id = v_uid),
    'guardado',     EXISTS (SELECT 1 FROM public.training_bookmarks b
                             WHERE b.course_id = p_id AND b.user_id = v_uid),
    'content_id',   v_curso.content_id,
    'reacoes',      (SELECT count(*) FROM public.content_reactions r
                      WHERE r.item_id = v_curso.content_id),
    'comentarios',  (SELECT count(*) FROM public.content_comments m
                      WHERE m.item_id = v_curso.content_id AND NOT m.is_hidden),
    'minha_reacao', (SELECT r.reaction FROM public.content_reactions r
                      WHERE r.item_id = v_curso.content_id AND r.user_id = v_uid),
    'aulas', (
      SELECT coalesce(jsonb_agg(aula ORDER BY ordem), '[]'::jsonb)
      FROM (
        SELECT l.sort_order AS ordem,
               jsonb_build_object(
                 'id',           l.id,
                 'title',        l.title,
                 'summary',      l.summary,
                 'body',         l.body,
                 'kind',         l.kind,
                 'video_url',    l.video_url,
                 'file_path',    l.file_path,
                 'file_name',    l.file_name,
                 'duration_min', l.duration_min,
                 'concluida',    EXISTS (
                   SELECT 1 FROM public.training_progress p
                   WHERE p.lesson_id = l.id AND p.user_id = v_uid
                 )
               ) AS aula
        FROM public.training_lessons l
        WHERE l.course_id = p_id
      ) t
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

-- 6.5 Marcar/desmarcar uma aula como concluída.
--     Devolve o progresso do curso já recalculado, para a interface não ter de
--     voltar a perguntar. Marca a inscrição e, quando todas as aulas ficam
--     feitas, carimba a conclusão do curso.
CREATE OR REPLACE FUNCTION public.formacao_concluir_aula(
  p_lesson_id uuid,
  p_concluida boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_course uuid;
  v_total  int;
  v_feitas int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  SELECT course_id INTO v_course FROM public.training_lessons WHERE id = p_lesson_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AULA_NAO_ENCONTRADA';
  END IF;

  IF NOT public.pode_ver_formacao(v_course) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO';
  END IF;

  IF p_concluida THEN
    INSERT INTO public.training_progress (user_id, course_id, lesson_id)
    VALUES (v_uid, v_course, p_lesson_id)
    ON CONFLICT (user_id, lesson_id) DO NOTHING;
  ELSE
    DELETE FROM public.training_progress
    WHERE user_id = v_uid AND lesson_id = p_lesson_id;
  END IF;

  INSERT INTO public.training_enrollments (course_id, user_id, last_seen_at)
  VALUES (v_course, v_uid, now())
  ON CONFLICT (course_id, user_id)
  DO UPDATE SET last_seen_at = now();

  SELECT count(*) INTO v_total FROM public.training_lessons WHERE course_id = v_course;
  SELECT count(*) INTO v_feitas FROM public.training_progress
   WHERE course_id = v_course AND user_id = v_uid;

  UPDATE public.training_enrollments
     SET completed_at = CASE WHEN v_total > 0 AND v_feitas >= v_total THEN now() ELSE NULL END
   WHERE course_id = v_course AND user_id = v_uid;

  RETURN jsonb_build_object(
    'concluidas',  v_feitas,
    'total',       v_total,
    'percentagem', CASE WHEN v_total = 0 THEN 0
                        ELSE round((v_feitas::numeric / v_total) * 100) END,
    'curso_concluido', v_total > 0 AND v_feitas >= v_total
  );
END;
$$;

-- 6.6 Estatísticas de participação, para o gestor.
CREATE OR REPLACE FUNCTION public.formacao_estatisticas(p_course_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT COALESCE(public.is_manager(), false) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO';
  END IF;

  SELECT coalesce(jsonb_agg(linha ORDER BY inscritos DESC, titulo), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT jsonb_build_object(
             'course_id', c.id,
             'titulo',    c.title,
             'status',    c.status,
             'aulas',     (SELECT count(*) FROM public.training_lessons l WHERE l.course_id = c.id),
             'inscritos', (SELECT count(*) FROM public.training_enrollments e WHERE e.course_id = c.id),
             'concluidos',(SELECT count(*) FROM public.training_enrollments e
                            WHERE e.course_id = c.id AND e.completed_at IS NOT NULL),
             'media_pct', (
               SELECT CASE WHEN count(*) = 0 THEN 0
                           ELSE round(avg(
                             CASE WHEN l.total = 0 THEN 0
                                  ELSE (SELECT count(*) FROM public.training_progress p
                                         WHERE p.course_id = c.id AND p.user_id = e.user_id)::numeric
                                       / l.total * 100
                             END))
                      END
               FROM public.training_enrollments e
               CROSS JOIN (SELECT count(*) AS total FROM public.training_lessons WHERE course_id = c.id) l
               WHERE e.course_id = c.id
             )
           ) AS linha,
           (SELECT count(*) FROM public.training_enrollments e WHERE e.course_id = c.id) AS inscritos,
           c.title AS titulo
    FROM public.training_courses c
    WHERE p_course_id IS NULL OR c.id = p_course_id
  ) t;

  RETURN v_out;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. STORAGE — bucket público para as imagens publicadas
--    Caminho: content-media/{kind}/{uuid}.{ext}
--    Público porque o site e a app mostram estas imagens a visitantes sem
--    sessão. A escrita continua restrita ao gestor.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    RAISE NOTICE 'Schema storage inexistente — políticas de Storage dos conteúdos ignoradas.';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public)
  VALUES ('content-media', 'content-media', true)
  ON CONFLICT (id) DO NOTHING;

  BEGIN
    DROP POLICY IF EXISTS "inuka_content_media_write"  ON storage.objects;
    DROP POLICY IF EXISTS "inuka_content_media_update" ON storage.objects;
    DROP POLICY IF EXISTS "inuka_content_media_delete" ON storage.objects;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Sem permissão para gerir políticas de storage.objects.';
  END;

  CREATE POLICY "inuka_content_media_write" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'content-media' AND public.is_manager());

  CREATE POLICY "inuka_content_media_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'content-media' AND public.is_manager())
    WITH CHECK (bucket_id = 'content-media' AND public.is_manager());

  CREATE POLICY "inuka_content_media_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'content-media' AND public.is_manager());
END $$;

-- -----------------------------------------------------------------------------
-- 8. PERMISSÕES
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_items     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_products  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_reactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_comments  TO authenticated;
GRANT SELECT ON public.content_items TO anon;
GRANT SELECT ON public.content_products TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_categories  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_courses     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_lessons     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_enrollments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_progress    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_bookmarks   TO authenticated;

GRANT EXECUTE ON FUNCTION public.content_duplicate(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.conteudo_feed(text, int)                TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.pode_ver_conteudo(uuid)                 TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.pode_ver_formacao(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.formacao_cursos(uuid, int)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.formacao_curso(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.formacao_concluir_aula(uuid, boolean)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.formacao_estatisticas(uuid)             TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. CATEGORIAS DE FORMAÇÃO (as nove áreas pedidas pela gestão)
-- -----------------------------------------------------------------------------
INSERT INTO public.training_categories (name, slug, description, icon, sort_order) VALUES
  ('Conhecimento da INUKA Angola', 'inuka', 'História, valores e identidade da marca.', 'sparkles', 1),
  ('Conhecimento dos Produtos', 'produtos', 'Linhas, benefícios e argumentos de venda.', 'package', 2),
  ('Técnicas de Vendas', 'vendas', 'Abordagem, demonstração e fecho.', 'trending-up', 3),
  ('Atendimento e Experiência do Cliente', 'atendimento', 'Receber bem e resolver bem.', 'heart', 4),
  ('Comunicação e Marketing', 'comunicacao', 'Como falar da marca e divulgar.', 'megaphone', 5),
  ('Fidelização de Clientes', 'fidelizacao', 'Relações que duram.', 'repeat', 6),
  ('Desenvolvimento Pessoal', 'desenvolvimento', 'Postura, disciplina e confiança.', 'user', 7),
  ('Liderança e Gestão de Equipas', 'lideranca', 'Gerir pessoas e resultados.', 'users', 8),
  ('Ética e Postura Profissional', 'etica', 'O que se espera de quem representa a INUKA.', 'shield', 9)
ON CONFLICT (slug) DO NOTHING;


-- ###########################################################################
-- ##  PARTE 8 de 15 — TAXA DE COMISSÃO, PEDIDOS E REVENDEDORES
-- ###########################################################################

-- =============================================================================
--  0008 — TAXA DE COMISSÃO, PEDIDOS, CANDIDATURAS DE REVENDEDOR
-- =============================================================================
--  Idempotente. Pode ser colado sobre uma base já existente.
--
--  O QUE RESOLVE
--   1. A taxa de comissão deixa de estar presa a cada colaborador. Passa a
--      haver UMA taxa da empresa (10% por omissão) que a gestão muda num sítio
--      só, e que todos os colaboradores herdam. Uma taxa pessoal continua a ser
--      possível, mas passa a ser a excepção e não a regra.
--   2. O cliente passa a poder confirmar que recebeu a encomenda
--      ("em entrega" -> "concluída"). Antes só podia cancelar.
--   3. Candidaturas a revendedor: o visitante deixa o contacto na loja e a
--      gestão recebe. Tabela própria, sem misturar com encomendas.
--   4. "Falar com a equipa INUKA": uma conversa de grupo com o colaborador
--      vinculado E a gestão, em vez de uma conversa directa só com o vendedor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TAXA DE COMISSÃO DA EMPRESA
-- -----------------------------------------------------------------------------
-- O valor vive em `platform_settings` para não haver um número mágico no
-- código. `{"value": 0.10}` = 10%.
INSERT INTO public.platform_settings (key, value)
VALUES ('commission_rate', '{"value": 0.10}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- `NULL` passa a significar "usa a taxa da empresa".
-- Antes a coluna era NOT NULL DEFAULT 0, e 0 tanto queria dizer "sem comissão"
-- como "ainda ninguém definiu isto" — duas coisas diferentes com o mesmo valor.
ALTER TABLE public.seller_profiles ALTER COLUMN commission_rate DROP NOT NULL;
ALTER TABLE public.seller_profiles ALTER COLUMN commission_rate DROP DEFAULT;

-- Normalização única dos valores antigos.
--
-- Só corre uma vez: sem o marcador, voltar a executar este ficheiro apagaria as
-- taxas pessoais que a gestão tivesse definido depois. O marcador é o que torna
-- a operação segura de repetir.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key = 'commission_rate_normalizado') THEN
    -- 0% e 5% eram os valores herdados do formulário antigo, não decisões da
    -- gestão. Passam a herdar a taxa da empresa (10%).
    UPDATE public.seller_profiles SET commission_rate = NULL;

    INSERT INTO public.platform_settings (key, value)
    VALUES ('commission_rate_normalizado', '{"value": true}'::jsonb)
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;

COMMENT ON COLUMN public.seller_profiles.commission_rate IS
  'Taxa pessoal. NULL = herda a taxa da empresa (platform_settings.commission_rate).';

-- Taxa da empresa. Nunca devolve NULL: sem linha, vale 10%.
CREATE OR REPLACE FUNCTION public.taxa_comissao_global()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT (value ->> 'value')::numeric
       FROM public.platform_settings WHERE key = 'commission_rate'),
    0.10
  );
$$;

-- Taxa que se aplica a esta pessoa: a pessoal, se existir; senão a da empresa.
CREATE OR REPLACE FUNCTION public.taxa_comissao_efetiva(p_seller uuid DEFAULT auth.uid())
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT sp.commission_rate FROM public.seller_profiles sp WHERE sp.id = p_seller),
    public.taxa_comissao_global()
  );
$$;

-- O que a interface precisa de saber para explicar o número ao colaborador.
-- `p_seller` permite à gestão ver a taxa de qualquer colaborador; qualquer
-- outra pessoa só vê a sua.
CREATE OR REPLACE FUNCTION public.taxa_comissao_de(p_seller uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_global  numeric := public.taxa_comissao_global();
  v_pessoal numeric;
  v_efetiva numeric;
BEGIN
  IF NOT public.is_manager() AND p_seller IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sem permissão para ver a taxa de outra pessoa' USING ERRCODE = '42501';
  END IF;

  SELECT sp.commission_rate INTO v_pessoal
  FROM public.seller_profiles sp WHERE sp.id = p_seller;

  v_efetiva := COALESCE(v_pessoal, v_global);

  RETURN jsonb_build_object(
    'global',  v_global,
    'pessoal', v_pessoal,
    'efetiva', v_efetiva,
    'origem',  CASE WHEN v_pessoal IS NULL THEN 'empresa' ELSE 'pessoal' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.taxa_comissao()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.taxa_comissao_de(auth.uid());
$$;

-- Mudar a taxa. Só a gestão, e fica registado na auditoria.
CREATE OR REPLACE FUNCTION public.definir_taxa_comissao(
  p_rate                  numeric,
  p_recalcular_pendentes  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_antiga    numeric;
  v_pendentes integer := 0;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode alterar a taxa de comissão' USING ERRCODE = '42501';
  END IF;

  IF p_rate IS NULL OR p_rate < 0 OR p_rate > 1 THEN
    RAISE EXCEPTION 'Taxa inválida: tem de estar entre 0%% e 100%%';
  END IF;

  v_antiga := public.taxa_comissao_global();

  INSERT INTO public.platform_settings AS ps (key, value, updated_by, updated_at)
  VALUES ('commission_rate', jsonb_build_object('value', p_rate), auth.uid(), now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();

  -- Recalcular comissões por pagar é opcional e explícito. Feito por omissão,
  -- subir a taxa inflacionava comissões de vendas antigas sem ninguém pedir.
  -- Só toca em quem não tem taxa pessoal: essa é uma decisão da gestão e não
  -- se sobrepõe em bloco.
  IF p_recalcular_pendentes THEN
    WITH alvo AS (
      UPDATE public.sale_commissions c
      SET rate = p_rate,
          amount = round(c.base_amount * p_rate, 2),
          updated_at = now()
      FROM public.sales s
      JOIN public.seller_profiles sp ON sp.id = s.seller_id
      WHERE c.sale_id = s.id
        AND c.status = 'pending'
        AND sp.commission_rate IS NULL
      RETURNING c.id
    )
    SELECT count(*) INTO v_pendentes FROM alvo;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update_commission_rate', 'platform_settings', NULL,
    jsonb_build_object('rate', v_antiga),
    jsonb_build_object('rate', p_rate, 'recalculadas', v_pendentes)
  );

  RETURN jsonb_build_object(
    'rate', p_rate,
    'anterior', v_antiga,
    'recalculadas', v_pendentes
  );
END;
$$;

-- Taxa pessoal de um colaborador: define-a, ou devolve-o à taxa da empresa.
--
-- Existe à parte de `atualizar_perfil_colaborador` de propósito: aquela função
-- trata o `commission_rate` ausente como 0 (herança do formulário antigo), e
-- mudá-la obrigaria a redefinir uma função de duzentas linhas. Aqui o `NULL`
-- tem um significado explícito — "usa a da empresa".
CREATE OR REPLACE FUNCTION public.definir_taxa_colaborador(
  p_id   uuid,
  p_rate numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov uuid;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode alterar a taxa de um colaborador' USING ERRCODE = '42501';
  END IF;

  SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador inexistente';
  END IF;

  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Sem permissão sobre colaboradores desta província' USING ERRCODE = '42501';
  END IF;

  IF p_rate IS NOT NULL AND (p_rate < 0 OR p_rate > 1) THEN
    RAISE EXCEPTION 'Taxa inválida: tem de estar entre 0%% e 100%%';
  END IF;

  UPDATE public.seller_profiles sp
  SET commission_rate = p_rate, updated_at = now()
  WHERE sp.id = p_id;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, new_data)
  VALUES (
    auth.uid(), 'update_seller_commission_rate', 'seller_profiles', p_id,
    jsonb_build_object('rate', p_rate)
  );

  RETURN public.taxa_comissao_de(p_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. A COMISSÃO PASSA A USAR A TAXA EFETIVA
-- -----------------------------------------------------------------------------
-- Substitui a versão da migração 0006, que lia `COALESCE(sp.commission_rate, 0)`
-- e portanto punha 0% em quem herdava.
CREATE OR REPLACE FUNCTION public.fill_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_rate numeric(5,4);
BEGIN
  -- Só reage ao que muda o valor: evita recalcular em cada UPDATE da venda.
  IF TG_OP = 'UPDATE'
     AND NEW.status       IS NOT DISTINCT FROM OLD.status
     AND NEW.total_amount IS NOT DISTINCT FROM OLD.total_amount
     AND NEW.seller_id    IS NOT DISTINCT FROM OLD.seller_id THEN
    RETURN NEW;
  END IF;

  v_rate := public.taxa_comissao_efetiva(NEW.seller_id);

  IF NEW.status = 'cancelled' THEN
    INSERT INTO public.sale_commissions AS c
      (sale_id, seller_id, provincia_id, base_amount, rate, amount, status)
    VALUES
      (NEW.id, NEW.seller_id, NEW.provincia_id, NEW.total_amount, v_rate, 0, 'cancelled')
    ON CONFLICT (sale_id) DO UPDATE
      SET status = 'cancelled', amount = 0, base_amount = EXCLUDED.base_amount,
          updated_at = now()
      WHERE c.status <> 'paid';   -- uma comissão já paga não se anula sozinha
  ELSE
    INSERT INTO public.sale_commissions AS c
      (sale_id, seller_id, provincia_id, base_amount, rate, amount, status)
    VALUES
      (NEW.id, NEW.seller_id, NEW.provincia_id, NEW.total_amount, v_rate,
       round(NEW.total_amount * v_rate, 2), 'pending')
    ON CONFLICT (sale_id) DO UPDATE
      SET seller_id = EXCLUDED.seller_id,
          provincia_id = EXCLUDED.provincia_id,
          base_amount = EXCLUDED.base_amount,
          rate = EXCLUDED.rate,
          amount = EXCLUDED.amount,
          updated_at = now()
      WHERE c.status = 'pending';  -- paga ou anulada fica como está
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. PEDIDOS: O CLIENTE CONFIRMA A ENTREGA
-- -----------------------------------------------------------------------------
-- Antes o cliente só podia cancelar. Agora, quando a encomenda já saiu para
-- entrega (ou está pronta para levantamento), pode confirmar que a recebeu.
-- Quem muda para "concluída" continua a ser a gestão — e também o cliente, mas
-- só nesse passo final. É a diferença entre "a loja diz que entregou" e
-- "o comprador confirma que recebeu".
CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id uuid,
  p_status   public.order_status,
  p_notes    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_order public.orders;
  v_item  record;
  v_sou_cliente boolean;
BEGIN
  SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Encomenda inexistente';
  END IF;

  -- Atenção: `seller_id` é opcional. `NULL = auth.uid()` devolve NULL, e
  -- `NOT (false OR NULL OR false)` é NULL — o IF não disparava e qualquer
  -- utilizador autenticado conseguia alterar a encomenda. Daí o COALESCE.
  IF NOT (
    public.is_manager()
    OR v_order.customer_id = auth.uid()
    OR COALESCE(v_order.seller_id = auth.uid(), false)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para alterar esta encomenda' USING ERRCODE = '42501';
  END IF;

  -- O comprador: pode cancelar ou confirmar a recepção. Não é um "gestor da
  -- encomenda" — não lhe compete escolher "em preparação" ou "em entrega".
  v_sou_cliente := COALESCE(v_order.customer_id = auth.uid(), false)
                   AND NOT public.is_manager()
                   AND NOT COALESCE(v_order.seller_id = auth.uid(), false);

  IF v_sou_cliente AND p_status NOT IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'O cliente apenas pode cancelar a encomenda ou confirmar a entrega'
      USING ERRCODE = '42501';
  END IF;

  IF v_sou_cliente AND p_status = 'completed'
     AND v_order.status NOT IN ('in_delivery', 'ready_pickup') THEN
    RAISE EXCEPTION 'Ainda não pode confirmar esta entrega' USING ERRCODE = '42501';
  END IF;

  IF v_order.status = 'completed' THEN
    RAISE EXCEPTION 'Encomenda já concluída não pode ser alterada';
  END IF;

  IF p_status = v_order.status THEN
    RETURN jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'changed', false);
  END IF;

  -- Concluir: converter reserva em saída efetiva de stock
  IF p_status = 'completed' THEN
    FOR v_item IN
      SELECT oi.product_id, oi.quantity FROM public.order_items oi WHERE oi.order_id = v_order.id
    LOOP
      UPDATE public.inventory i
      SET quantity = i.quantity - v_item.quantity,
          reserved_quantity = GREATEST(i.reserved_quantity - v_item.quantity, 0),
          updated_at = now()
      WHERE i.product_id = v_item.product_id;

      IF FOUND THEN
        INSERT INTO public.inventory_movements (
          product_id, type, quantity, previous_quantity, new_quantity, reference, notes, created_by
        )
        SELECT
          v_item.product_id,
          'out',
          v_item.quantity,
          i.quantity + v_item.quantity,
          i.quantity,
          v_order.reference,
          CASE WHEN v_sou_cliente THEN 'Entrega confirmada pelo cliente'
               ELSE 'Encomenda concluída' END,
          auth.uid()
        FROM public.inventory i WHERE i.product_id = v_item.product_id;
      END IF;
    END LOOP;
  END IF;

  -- Cancelar: libertar reserva
  IF p_status = 'cancelled' THEN
    FOR v_item IN
      SELECT oi.product_id, oi.quantity FROM public.order_items oi WHERE oi.order_id = v_order.id
    LOOP
      UPDATE public.inventory i
      SET reserved_quantity = GREATEST(i.reserved_quantity - v_item.quantity, 0),
          updated_at = now()
      WHERE i.product_id = v_item.product_id;
    END LOOP;
  END IF;

  UPDATE public.orders o
  SET status = p_status,
      notes = COALESCE(p_notes, o.notes),
      payment_status = CASE WHEN p_status = 'completed' THEN 'paid'::public.payment_status ELSE o.payment_status END,
      updated_at = now()
  WHERE o.id = v_order.id;

  UPDATE public.order_status_history h
  SET notes = p_notes
  WHERE h.order_id = v_order.id
    AND h.id = (
      SELECT h2.id FROM public.order_status_history h2
      WHERE h2.order_id = v_order.id
      ORDER BY h2.created_at DESC LIMIT 1
    );

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', p_status,
    'changed', true,
    'pelo_cliente', v_sou_cliente
  );
END;
$$;

-- O colaborador também tem de saber que entrou uma encomenda na sua carteira.
CREATE OR REPLACE FUNCTION public.on_new_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  -- Gestão: vê todas.
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    p.id,
    'new_order',
    'Nova encomenda',
    'Encomenda ' || NEW.reference || ' criada.',
    jsonb_build_object('order_id', NEW.id)
  FROM public.profiles p
  WHERE p.role = 'manager' AND p.is_active = true;

  -- Colaborador: só a dele. Sem este bloco a encomenda existia na base e
  -- ninguém na equipa de vendas era avisado.
  IF NEW.seller_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      NEW.seller_id,
      'new_order',
      'Nova encomenda na sua carteira',
      'Encomenda ' || NEW.reference || ' criada.',
      jsonb_build_object('order_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. CANDIDATURAS A REVENDEDOR
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reseller_applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name    text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
  phone        text NOT NULL CHECK (char_length(btrim(phone)) BETWEEN 9 AND 24),
  provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  message      text CHECK (message IS NULL OR char_length(message) <= 800),
  -- Onde é que a pessoa já conhece a INUKA? Ajuda a triagem.
  source       text,
  status       text NOT NULL DEFAULT 'novo'
                 CHECK (status IN ('novo', 'em_contacto', 'aprovado', 'recusado')),
  handled_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reseller_applications_estado
  ON public.reseller_applications (status, created_at DESC);

ALTER TABLE public.reseller_applications ENABLE ROW LEVEL SECURITY;

-- Sem este GRANT a política de INSERT não serve de nada a quem não tem sessão:
-- o formulário é público e o papel `anon` não recebe INSERT por omissão.
GRANT INSERT ON public.reseller_applications TO anon, authenticated;

-- Qualquer pessoa pode candidatar-se — é um formulário público da loja.
DROP POLICY IF EXISTS reseller_applications_insert ON public.reseller_applications;
CREATE POLICY reseller_applications_insert ON public.reseller_applications
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    -- Nunca se aceita um estado já "tratado" nem um responsável vindos do
    -- browser: quem se candidata não decide o resultado da candidatura.
    status = 'novo'
    AND handled_by IS NULL
    AND handled_at IS NULL
  );

-- Ler e tratar é só da gestão. O telefone de quem se candidatou não é público.
DROP POLICY IF EXISTS reseller_applications_manager_read ON public.reseller_applications;
CREATE POLICY reseller_applications_manager_read ON public.reseller_applications
  FOR SELECT TO authenticated
  USING (public.is_manager());

DROP POLICY IF EXISTS reseller_applications_manager_update ON public.reseller_applications;
CREATE POLICY reseller_applications_manager_update ON public.reseller_applications
  FOR UPDATE TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS reseller_applications_manager_delete ON public.reseller_applications;
CREATE POLICY reseller_applications_manager_delete ON public.reseller_applications
  FOR DELETE TO authenticated
  USING (public.is_manager());

DROP TRIGGER IF EXISTS trg_reseller_applications_updated ON public.reseller_applications;
CREATE TRIGGER trg_reseller_applications_updated
BEFORE UPDATE ON public.reseller_applications
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. "FALAR COM A EQUIPA INUKA"
-- -----------------------------------------------------------------------------
-- O cliente falava só com o colaborador. Uma conversa de grupo junta o
-- colaborador vinculado e a gestão, para não haver mensagens que morrem num
-- telefone que ninguém leu.
--
-- Porque é que isto é uma função e não um INSERT do cliente?
-- `conversations` e `conversation_members` não têm política de INSERT para
-- clientes — de propósito. Sem SECURITY DEFINER, o cliente não consegue criar
-- a conversa; e dar-lhe INSERT directo deixá-lo-ia acrescentar qualquer pessoa.
CREATE OR REPLACE FUNCTION public.abrir_conversa_equipa()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_me        uuid := auth.uid();
  v_role      public.user_role;
  v_provincia uuid;
  v_seller    uuid;
  v_manager   uuid;
  v_conv      uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sessão necessária' USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.provincia_id INTO v_role, v_provincia
  FROM public.profiles p WHERE p.id = v_me;

  -- Colaborador vinculado (o mais recente, se por alguma razão houver mais do
  -- que um activo).
  SELECT sc.seller_id INTO v_seller
  FROM public.seller_customers sc
  WHERE sc.customer_id = v_me AND sc.is_active = true
  ORDER BY sc.assigned_at DESC
  LIMIT 1;

  -- Gestor: de preferência o da mesma província; senão o mais antigo activo.
  SELECT p.id INTO v_manager
  FROM public.profiles p
  WHERE p.role = 'manager' AND p.is_active = true
  ORDER BY (p.provincia_id IS NOT DISTINCT FROM v_provincia) DESC, p.created_at
  LIMIT 1;

  -- Uma conversa por cliente: reutiliza-se em vez de criar uma nova em cada
  -- clique. `created_by` é o cliente, por isso não se misturam equipas.
  SELECT c.id INTO v_conv
  FROM public.conversations c
  WHERE c.type = 'group'
    AND c.created_by = v_me
    AND c.title = 'Equipa INUKA'
  LIMIT 1;

  IF v_conv IS NULL THEN
    INSERT INTO public.conversations (type, title, created_by)
    VALUES ('group', 'Equipa INUKA', v_me)
    RETURNING id INTO v_conv;
  END IF;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (v_conv, v_me, 'admin')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  IF v_seller IS NOT NULL AND v_seller <> v_me THEN
    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (v_conv, v_seller, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  IF v_manager IS NOT NULL AND v_manager <> v_me THEN
    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (v_conv, v_manager, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN v_conv;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. PERMISSÕES E REALTIME
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.taxa_comissao_global()               TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.taxa_comissao_efetiva(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.taxa_comissao_de(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.taxa_comissao()                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.definir_taxa_comissao(numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.definir_taxa_colaborador(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abrir_conversa_equipa()              TO authenticated;

-- A taxa muda no painel da gestão e tem de chegar ao colaborador que está com
-- a página aberta, sem ele recarregar.
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_settings';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_profiles';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.reseller_applications';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;


-- ###########################################################################
-- ##  PARTE 9 de 15 — RESERVA DE CLIENTES E COMPRAS DO CLIENTE
-- ###########################################################################

-- =============================================================================
--  INUKA ANGOLA — PARTE 9
--  RESERVA DE CLIENTES
-- =============================================================================
--  O QUE MUDA E PORQUÊ
--
--  Até aqui, o colaborador que acrescentava alguém à carteira criava uma conta
--  de utilizador com uma palavra-passe provisória (`INUKA######`). Isso tem
--  três problemas:
--
--   1. A pessoa nunca pediu conta nenhuma. Ficava com um acesso que não
--      controla e com uma palavra-passe que circula por telefone.
--   2. Quem cria a conta é o colaborador, mas quem a usa é o cliente — e o
--      cliente não escolhe a palavra-passe, não confirma o número e não sabe
--      que a conta existe até alguém lhe dizer.
--   3. As compras feitas antes do registo ficavam sem dono: `sales.customer_id`
--      só aceita contas existentes.
--
--  A partir daqui, o colaborador **reserva** o cliente: guarda nome, telefone,
--  bairro e província, sem tocar em `auth.users`. Quando a pessoa se regista
--  com esse número, `ligar_reserva_ao_cliente` faz o resto — vincula a carteira
--  e entrega-lhe as vendas que já tinham sido registadas com o seu telefone.
--
--  Nenhuma conta é criada por quem não é o próprio.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. CLIENTES RESERVADOS (por activar)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reserved_customers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Fica nulo quando a reserva nasce de uma venda a um telefone desconhecido:
  -- o nome verdadeiro só aparece quando o cliente se registar.
  full_name    text,
  phone        text NOT NULL UNIQUE,
  neighborhood text,
  provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  notes        text,
  status       text NOT NULL DEFAULT 'reservado',
  customer_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  linked_at    timestamptz,
  CONSTRAINT reserved_customers_status_check
    CHECK (status IN ('reservado', 'ligado', 'cancelado', 'conflito')),
  CONSTRAINT reserved_customers_phone_format
    CHECK (phone ~ '^\+244[0-9]{9}$')
);

CREATE INDEX IF NOT EXISTS reserved_customers_seller_idx
  ON public.reserved_customers (seller_id, status);

CREATE INDEX IF NOT EXISTS reserved_customers_phone_idx
  ON public.reserved_customers (phone);


-- -----------------------------------------------------------------------------
-- 2. VENDA COM TELEFONE MAS SEM CONTA
-- -----------------------------------------------------------------------------
--  `sales.customer_id` referencia `auth.users`: não aceita um telefone. Esta
--  coluna guarda o número de quem comprou antes de ter conta, para que a venda
--  possa ser entregue mais tarde, no registo.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_phone text;

CREATE INDEX IF NOT EXISTS sales_customer_phone_idx
  ON public.sales (customer_phone)
  WHERE customer_phone IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 3. RLS — reservas
-- -----------------------------------------------------------------------------
ALTER TABLE public.reserved_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reserved_customers_select ON public.reserved_customers;
CREATE POLICY reserved_customers_select ON public.reserved_customers
  FOR SELECT TO authenticated
  USING (reserved_customers.seller_id = auth.uid() OR public.is_manager());

DROP POLICY IF EXISTS reserved_customers_insert ON public.reserved_customers;
CREATE POLICY reserved_customers_insert ON public.reserved_customers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_manager()
    OR (reserved_customers.seller_id = auth.uid() AND public.is_seller())
  );

DROP POLICY IF EXISTS reserved_customers_update ON public.reserved_customers;
CREATE POLICY reserved_customers_update ON public.reserved_customers
  FOR UPDATE TO authenticated
  USING (reserved_customers.seller_id = auth.uid() OR public.is_manager())
  WITH CHECK (reserved_customers.seller_id = auth.uid() OR public.is_manager());

DROP POLICY IF EXISTS reserved_customers_delete ON public.reserved_customers;
CREATE POLICY reserved_customers_delete ON public.reserved_customers
  FOR DELETE TO authenticated
  USING (reserved_customers.seller_id = auth.uid() OR public.is_manager());


-- -----------------------------------------------------------------------------
-- 4. REGISTAR VENDA COM TELEFONE
-- -----------------------------------------------------------------------------
--  Não repete a lógica de stock, preço e comissão: chama `register_sale` e
--  limita-se a gravar o telefone na venda que ela acabou de criar. Assim há um
--  único sítio onde o stock é validado e descontado.
CREATE OR REPLACE FUNCTION public.register_sale_by_phone(
  p_items          jsonb,
  p_customer_phone text,
  p_payment_method text DEFAULT NULL,
  p_payment_status public.payment_status DEFAULT 'pending',
  p_notes          text DEFAULT NULL,
  p_client_ref     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_phone     text;
  v_sale      jsonb;
  v_sale_id   uuid;
  v_reservado boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_seller() THEN
    RAISE EXCEPTION 'Apenas vendedores podem registar vendas' USING ERRCODE = '42501';
  END IF;

  v_phone := public.normalize_phone(p_customer_phone);
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Telefone inválido. Use o formato +244 9xx xxx xxx'
      USING ERRCODE = '22023';
  END IF;

  -- Uma conta que já exista não passa por aqui: o chamador usa
  -- `link_customer_by_phone` e `register_sale` com o `customer_id`.
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.phone = v_phone) THEN
    RAISE EXCEPTION 'Este telefone já tem conta. Associe o cliente antes de registar a venda.'
      USING ERRCODE = '23505';
  END IF;

  v_sale := public.register_sale(
    p_items, NULL, p_payment_method, p_payment_status, p_notes, p_client_ref
  );

  v_sale_id := (v_sale->>'sale_id')::uuid;

  -- Numa venda duplicada a linha já tem telefone; reescrever é inofensivo.
  UPDATE public.sales s
  SET customer_phone = v_phone, updated_at = now()
  WHERE s.id = v_sale_id;

  -- Reserva automática: quem vende a um telefone desconhecido fica com o
  -- cliente na carteira, à espera do registo. `DO NOTHING` respeita uma reserva
  -- que já exista (de outro colaborador, por exemplo).
  IF NOT EXISTS (
    SELECT 1 FROM public.reserved_customers r WHERE r.phone = v_phone
  ) THEN
    INSERT INTO public.reserved_customers (
      seller_id, created_by, full_name, phone, provincia_id, status
    )
    VALUES (v_uid, v_uid, NULL, v_phone, public.my_province(), 'reservado')
    ON CONFLICT (phone) DO NOTHING;
    v_reservado := true;
  END IF;

  RETURN v_sale || jsonb_build_object(
    'customer_phone', v_phone,
    'reservado', v_reservado
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 5. LIGAR A RESERVA QUANDO O CLIENTE SE REGISTA
-- -----------------------------------------------------------------------------
--  Idempotente: pode correr duas vezes sem duplicar vínculos nem vendas.
--  Chamada no fim de `/api/auth/registo` e sempre que um colaborador associa
--  uma conta que já existe.
CREATE OR REPLACE FUNCTION public.ligar_reserva_ao_cliente(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_phone    text;
  v_res      public.reserved_customers;
  v_vendas   int := 0;
  v_ligados  int := 0;
  v_carteira int := 0;
  v_conflito int := 0;
  v_tocado   int := 0;
  v_uid      uuid := auth.uid();
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sem_cliente');
  END IF;

  -- Só o próprio, a gestão, ou o servidor (auth.uid() nulo) podem pedir a
  -- ligação. Sem isto, qualquer sessão autenticada podia passar o uuid de
  -- outra pessoa e fechar-lhe a reserva.
  IF v_uid IS NOT NULL AND v_uid <> p_customer_id AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'Sem permissão para ligar reservas deste cliente' USING ERRCODE = '42501';
  END IF;

  SELECT public.normalize_phone(p.phone) INTO v_phone
  FROM public.profiles p WHERE p.id = p_customer_id;

  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'sem_telefone');
  END IF;

  -- 5.1 Vendas registadas com este telefone passam a ter dono.
  WITH actualizadas AS (
    UPDATE public.sales s
    SET customer_id = p_customer_id, updated_at = now()
    WHERE s.customer_id IS NULL
      AND public.normalize_phone(s.customer_phone) = v_phone
    RETURNING 1
  )
  SELECT count(*) INTO v_vendas FROM actualizadas;

  -- 5.2 Reservas: vínculo com a carteira e fecho da reserva.
  FOR v_res IN
    SELECT * FROM public.reserved_customers r
    WHERE r.phone = v_phone AND r.status = 'reservado'
  LOOP
    -- Um cliente só pode estar na carteira de um colaborador. Se já estiver
    -- noutra, a reserva fecha como conflito e a transferência é da gestão.
    IF EXISTS (
      SELECT 1 FROM public.seller_customers sc
      WHERE sc.customer_id = p_customer_id
        AND sc.is_active = true
        AND sc.seller_id <> v_res.seller_id
    ) THEN
      UPDATE public.reserved_customers
      SET status = 'conflito', customer_id = p_customer_id, linked_at = now()
      WHERE id = v_res.id;
      v_conflito := v_conflito + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.seller_customers (seller_id, customer_id, assigned_by, is_active)
    VALUES (
      v_res.seller_id,
      p_customer_id,
      COALESCE(v_res.created_by, v_res.seller_id),
      true
    )
    ON CONFLICT (seller_id, customer_id) DO UPDATE SET is_active = true;
    v_carteira := v_carteira + 1;

    -- Quem se registou sem escolher província fica com a da reserva. É a mesma
    -- regra que a carteira já impunha quando criava a conta: o cliente pertence
    -- à delegação de quem o registou.
    IF v_res.provincia_id IS NOT NULL THEN
      UPDATE public.profiles p
      SET provincia_id = v_res.provincia_id, updated_at = now()
      WHERE p.id = p_customer_id AND p.provincia_id IS NULL;
    END IF;

    UPDATE public.reserved_customers
    SET status = 'ligado', customer_id = p_customer_id, linked_at = now()
    WHERE id = v_res.id;
    v_ligados := v_ligados + 1;
  END LOOP;

  SELECT count(*) INTO v_tocado
  FROM public.seller_customers sc
  WHERE sc.customer_id = p_customer_id AND sc.is_active = true;

  RETURN jsonb_build_object(
    'ok', true,
    'telefone', v_phone,
    'reservas_ligadas', v_ligados,
    'reservas_em_conflito', v_conflito,
    'vendas_atribuidas', v_vendas,
    'na_carteira', v_tocado
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 6. AS COMPRAS DO CLIENTE
-- -----------------------------------------------------------------------------
--  `sales_select` só deixa ver ao vendedor e à gestão, e o cliente não pode
--  ler o perfil do colaborador (é o RLS de `profiles`). Em vez de abrir as
--  tabelas, devolve-se exactamente o que é do próprio — nada mais.
CREATE OR REPLACE FUNCTION public.minhas_compras(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'id',             s.id,
      'reference',      s.reference,
      'created_at',     s.created_at,
      'total',          s.total_amount,
      'payment_status', s.payment_status,
      'payment_method', s.payment_method,
      'seller_name',    p.full_name,
      'seller_phone',   p.phone,
      'provincia',      pr.nome,
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name',        COALESCE(si.product_snapshot->>'name', prd.name),
          'sku',         COALESCE(si.product_snapshot->>'sku', prd.sku),
          'quantity',    si.quantity,
          'unit_price',  si.unit_price,
          'total_price', si.total_price
        ) ORDER BY si.created_at)
        FROM public.sale_items si
        LEFT JOIN public.products prd ON prd.id = si.product_id
        WHERE si.sale_id = s.id
      ), '[]'::jsonb)
    ) AS x
    FROM public.sales s
    LEFT JOIN public.profiles p   ON p.id = s.seller_id
    LEFT JOIN public.provincias pr ON pr.id = s.provincia_id
    WHERE s.customer_id = v_uid
    ORDER BY s.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  ) t;

  RETURN v_out;
END;
$$;


-- -----------------------------------------------------------------------------
-- 7. PERMISSÕES
-- -----------------------------------------------------------------------------
--  `REVOKE ... FROM PUBLIC` não é decoração: no Supabase as funções nascem
--  executáveis por PUBLIC, e `ligar_reserva_ao_cliente` recebe um uuid de
--  cliente. Sem isto, um pedido anónimo podia tentar ligar reservas alheias.
REVOKE ALL ON FUNCTION public.register_sale_by_phone(jsonb, text, text, public.payment_status, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ligar_reserva_ao_cliente(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.minhas_compras(int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.register_sale_by_phone(jsonb, text, text, public.payment_status, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ligar_reserva_ao_cliente(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.minhas_compras(int) TO authenticated;


-- ###########################################################################
-- ##  PARTE 10 de 15 — TAXA DE ENTREGA
-- ###########################################################################

-- =============================================================================
--  0010 — TAXA DE ENTREGA
-- =============================================================================
--  A entrega passa a ter preço: gratuita no Uíge, paga nas outras províncias.
--
--  O QUE MUDA
--    1. `orders.delivery_fee` — quanto custou a entrega desta encomenda.
--       `orders.total_amount` passa a ser produtos + entrega.
--    2. `taxa_entrega(provincia)` — a regra, num sítio só. Lê a configuração
--       que a gerência grava em `platform_settings` (chave `entrega`).
--    3. `place_order` grava a taxa. O cliente não a envia: se viesse do
--       browser, bastava editá-la para viajar de graça.
--    4. `recalc_order_total` soma a taxa. Sem isto o gatilho que recalcula o
--       total a partir das linhas voltava a apagá-la a cada item inserido.
--
--  CONFIGURAÇÃO (opcional — o padrão já é «grátis no Uíge, 2 000 Kz fora»)
--
--    INSERT INTO public.platform_settings (key, value) VALUES ('entrega',
--      '{"taxaPadrao": 2000, "gratis": ["uige"], "nota": null}'::jsonb)
--    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
--  Idempotente. Pode correr mais do que uma vez.
-- =============================================================================

-- ----------------------------------------------------------------- 1. COLUNA
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_fee numeric(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_delivery_fee_positive'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_delivery_fee_positive CHECK (delivery_fee >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.orders.delivery_fee IS
  'Taxa de entrega cobrada nesta encomenda. 0 = entrega gratuita. Já incluída em total_amount.';

-- ------------------------------------------------------- 2. TOTAL COM TAXA
-- O gatilho das linhas mandava no total: recalculava-o só a partir de
-- `order_items` e, a cada item inserido, apagava a taxa. Passa a somá-la.
CREATE OR REPLACE FUNCTION public.recalc_order_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id uuid := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
  UPDATE public.orders o
  SET total_amount = (
        SELECT COALESCE(SUM(oi.total_price), 0)
        FROM public.order_items oi
        WHERE oi.order_id = v_order_id
      ) + COALESCE(o.delivery_fee, 0),
      updated_at = now()
  WHERE o.id = v_order_id;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------- 3. A REGRA
-- Espelho exacto de `apps/web/src/lib/entrega.ts`. Se uma mudar, a outra
-- muda com ela — esta é a que manda, porque é a que grava.
CREATE OR REPLACE FUNCTION public.taxa_entrega(p_provincia uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_def  jsonb;
  v_slug text;
  v_taxa numeric := 2000;   -- mesmo valor de ENTREGA_PADRAO no TypeScript
BEGIN
  SELECT value INTO v_def FROM public.platform_settings WHERE key = 'entrega';

  -- Sem configuração gravada: aplica-se o padrão (Uíge grátis, resto paga).
  IF v_def IS NULL OR jsonb_typeof(v_def) <> 'object' THEN
    v_def := '{"taxaPadrao": 2000, "gratis": ["uige"]}'::jsonb;
  END IF;

  IF p_provincia IS NOT NULL THEN
    SELECT pr.slug INTO v_slug FROM public.provincias pr WHERE pr.id = p_provincia;
  END IF;

  -- Província isenta (por omissão, o Uíge).
  IF v_slug IS NOT NULL
     AND jsonb_typeof(COALESCE(v_def->'gratis', '[]'::jsonb)) = 'array'
     AND (COALESCE(v_def->'gratis', '[]'::jsonb) @> to_jsonb(v_slug)) THEN
    RETURN 0;
  END IF;

  IF jsonb_typeof(v_def->'taxaPadrao') = 'number' THEN
    v_taxa := (v_def->>'taxaPadrao')::numeric;
  END IF;

  RETURN GREATEST(COALESCE(v_taxa, 0), 0);
END;
$$;

-- ------------------------------------------------ 4. ENCOMENDA COM TAXA
CREATE OR REPLACE FUNCTION public.place_order(
  p_items            jsonb,
  p_delivery_method  text DEFAULT 'pickup',
  p_delivery_address text DEFAULT NULL,
  p_contact_phone    text DEFAULT NULL,
  p_notes            text DEFAULT NULL,
  p_client_ref       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_order_id uuid;
  v_ref      text;
  v_item     jsonb;
  v_prod     record;
  v_inv      record;
  v_prov     uuid;
  v_qty      int;
  v_price    numeric(12,2);
  v_total    numeric(12,2) := 0;
  v_taxa     numeric(12,2) := 0;
  v_existing public.orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_customer() THEN
    RAISE EXCEPTION 'Apenas clientes podem criar encomendas' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'O carrinho está vazio';
  END IF;

  IF p_delivery_method NOT IN ('pickup', 'delivery') THEN
    RAISE EXCEPTION 'Modalidade de entrega inválida';
  END IF;

  IF p_delivery_method = 'delivery' AND COALESCE(btrim(p_delivery_address), '') = '' THEN
    RAISE EXCEPTION 'Indique o endereço de entrega';
  END IF;

  IF p_client_ref IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.orders o
    WHERE o.customer_id = v_uid AND o.client_ref = p_client_ref;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id', v_existing.id,
        'reference', v_existing.reference,
        'total', v_existing.total_amount,
        'delivery_fee', v_existing.delivery_fee,
        'duplicated', true
      );
    END IF;
  END IF;

  v_ref := public.generate_order_reference();
  -- A província da encomenda vem do perfil do cliente (nunca do cliente HTTP).
  v_prov := public.my_province();

  -- Levantamento na delegação não paga entrega. Só a entrega ao domicílio
  -- paga — e só fora das províncias isentas.
  IF p_delivery_method = 'delivery' THEN
    v_taxa := public.taxa_entrega(v_prov);
  END IF;

  INSERT INTO public.orders (
    reference, client_ref, customer_id, status, delivery_method,
    delivery_address, contact_phone, notes, payment_status, provincia_id,
    delivery_fee
  )
  VALUES (
    v_ref, p_client_ref, v_uid, 'pending', p_delivery_method,
    NULLIF(btrim(p_delivery_address), ''), NULLIF(btrim(p_contact_phone), ''),
    NULLIF(btrim(p_notes), ''), 'pending', v_prov,
    v_taxa
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida';
    END IF;

    SELECT p.id, p.name, p.official_price, p.promotional_price, p.is_active, p.provincia_id
      INTO v_prod
    FROM public.products p
    WHERE p.id = (v_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto inexistente';
    END IF;

    IF NOT v_prod.is_active THEN
      RAISE EXCEPTION 'Produto indisponível: %', v_prod.name;
    END IF;

    -- Produto provincial só se vende na sua província
    IF v_prod.provincia_id IS NOT NULL AND v_prod.provincia_id IS DISTINCT FROM v_prov THEN
      RAISE EXCEPTION 'O produto % não está disponível na sua província', v_prod.name
        USING ERRCODE = '42501';
    END IF;

    v_price := COALESCE(v_prod.promotional_price, v_prod.official_price);

    -- Linha de stock: a da província do cliente; se não existir, a da sede.
    SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
    FROM public.inventory i
    WHERE i.product_id = v_prod.id
      AND i.provincia_id IS NOT DISTINCT FROM v_prov
    LIMIT 1;

    IF NOT FOUND AND v_prov IS NOT NULL THEN
      SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_prod.id AND i.provincia_id IS NULL
      LIMIT 1;
    END IF;

    -- Última tentativa: o armazém-sede.
    IF v_inv.id IS NULL THEN
      SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
      FROM public.inventory i
      JOIN public.provincias pr ON pr.id = i.provincia_id
      WHERE i.product_id = v_prod.id AND pr.is_default
      ORDER BY i.updated_at DESC
      LIMIT 1;
    END IF;

    IF v_inv.id IS NOT NULL THEN
      UPDATE public.inventory i
      SET reserved_quantity = i.reserved_quantity + v_qty,
          updated_at = now()
      WHERE i.id = v_inv.id
        AND (i.quantity - i.reserved_quantity) >= v_qty;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente para %', v_prod.name;
      END IF;
    END IF;

    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, total_price)
    VALUES (v_order_id, v_prod.id, v_qty, v_price, v_price * v_qty);
  END LOOP;

  -- `recalc_order_total` já correu a cada linha e somou a taxa; este SELECT
  -- só serve para devolver ao cliente o mesmo número que ficou gravado.
  SELECT COALESCE(o.total_amount, 0) INTO v_total
  FROM public.orders o WHERE o.id = v_order_id;

  INSERT INTO public.order_status_history (order_id, status, previous_status, changed_by, notes)
  VALUES (v_order_id, 'pending', NULL, v_uid, 'Encomenda criada');

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'reference', v_ref,
    'total', v_total,
    'delivery_fee', v_taxa,
    'duplicated', false
  );
END;
$$;

-- ------------------------------------------- 5. A TAXA DE QUEM ESTÁ A VER
-- A app do telemóvel não sabe qual é a província do cliente (vem do perfil,
-- no servidor). Esta função devolve a taxa que lhe toca — 0 no Uíge — para o
-- carrinho poder mostrar o total certo antes de encomendar. É a mesma regra
-- de `taxa_entrega`, não uma segunda cópia.
CREATE OR REPLACE FUNCTION public.minha_taxa_entrega()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.taxa_entrega(public.my_province());
$$;

-- --------------------------------------------------------------- 6. ACESSOS
GRANT EXECUTE ON FUNCTION public.taxa_entrega(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.minha_taxa_entrega() TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb, text, text, text, text, text) TO authenticated;


-- ###########################################################################
-- ##  PARTE 11 de 15 — CHAT: CLIENTE FALA COM A GESTÃO, GRUPOS SÓ DA EQUIPA
-- ###########################################################################

-- =============================================================================
--  0011 — CHAT: O CLIENTE FALA EM PRIVADO COM A GESTÃO
-- =============================================================================
--  O QUE ESTAVA MAL
--    «Falar com a equipa» abria um grupo de três: cliente + colaborador +
--    gestor. O cliente via-se numa sala com duas pessoas da empresa, sem
--    saber quem respondia, e o colaborador ficava a par de tudo.
--
--  O QUE PASSA A ACONTECER
--    1. `abrir_conversa_equipa()` devolve uma conversa **directa** entre o
--       cliente e o gestor. Reutiliza a que já existir — nunca cria uma
--       segunda em cada clique.
--    2. **Grupos são só da empresa.** Um grupo aceita apenas colaboradores e
--       gestores activos; um cliente não entra, nem por convite. Quem cria e
--       quem mexe nos membros é a gestão:
--         · `criar_grupo_equipa(nome, membros)`
--         · `adicionar_membro_grupo(conversa, pessoa)`
--         · `remover_membro_grupo(conversa, pessoa)`
--    3. O gatilho `trg_conversation_members_so_equipa` fecha a porta a
--       qualquer outro caminho (INSERT directo, RPC futura, correcção à mão).
--    4. As conversas antigas «Equipa INUKA» (grupos com um cliente dentro)
--       são **convertidas em conversas directas** com o gestor, mantendo as
--       mensagens — ninguém perde o histórico.
--
--  Idempotente. Pode correr mais do que uma vez.
-- =============================================================================

-- ------------------------------------------------------- 1. QUEM É «EQUIPA»
-- Colaborador ou gestor, com a conta activa. É a única definição usada em
-- todos os sítios abaixo; se um dia houver mais papéis internos, muda-se aqui.
CREATE OR REPLACE FUNCTION public.e_membro_equipa(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user
      AND p.is_active
      AND p.role IN ('seller'::public.user_role, 'manager'::public.user_role)
  );
$$;

-- ------------------------------------- 2. CLIENTE ↔ GESTOR (EM PRIVADO)
-- O nome da função fica: é chamada em três sítios do site e mudá-lo obrigaria
-- a mexer em todos. O que muda é o que ela devolve.
CREATE OR REPLACE FUNCTION public.abrir_conversa_equipa()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_me        uuid := auth.uid();
  v_role      public.user_role;
  v_provincia uuid;
  v_gestor    uuid;
  v_conv      uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sessão necessária' USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.provincia_id INTO v_role, v_provincia
  FROM public.profiles p WHERE p.id = v_me;

  IF v_role = 'manager'::public.user_role THEN
    RAISE EXCEPTION 'A gestão usa «Nova conversa» para falar com alguém'
      USING ERRCODE = '42501';
  END IF;

  -- Gestor da mesma província; senão o mais antigo ainda activo.
  SELECT p.id INTO v_gestor
  FROM public.profiles p
  WHERE p.role = 'manager'::public.user_role AND p.is_active
  ORDER BY (p.provincia_id IS NOT DISTINCT FROM v_provincia) DESC, p.created_at
  LIMIT 1;

  IF v_gestor IS NULL THEN
    RAISE EXCEPTION 'Ainda não há gestão disponível para responder. Tente mais tarde.';
  END IF;

  -- Uma conversa directa por par: reutiliza-se em vez de criar outra.
  SELECT c.id INTO v_conv
  FROM public.conversations c
  WHERE c.type = 'direct'
    AND (SELECT count(*) FROM public.conversation_members m WHERE m.conversation_id = c.id) = 2
    AND EXISTS (SELECT 1 FROM public.conversation_members m
                WHERE m.conversation_id = c.id AND m.user_id = v_me)
    AND EXISTS (SELECT 1 FROM public.conversation_members m
                WHERE m.conversation_id = c.id AND m.user_id = v_gestor)
  LIMIT 1;

  IF v_conv IS NULL THEN
    INSERT INTO public.conversations (type, created_by)
    VALUES ('direct', v_me)
    RETURNING id INTO v_conv;

    INSERT INTO public.conversation_members (conversation_id, user_id)
    VALUES (v_conv, v_me), (v_conv, v_gestor);
  END IF;

  RETURN v_conv;
END;
$$;

-- ------------------------------------------------------- 3. GRUPOS DA EQUIPA
CREATE OR REPLACE FUNCTION public.criar_grupo_equipa(
  p_nome    text,
  p_membros uuid[] DEFAULT '{}'::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_me     uuid := auth.uid();
  v_nome   text := btrim(COALESCE(p_nome, ''));
  v_conv   uuid;
  v_membro uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sessão necessária' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão cria grupos' USING ERRCODE = '42501';
  END IF;

  IF v_nome = '' THEN
    RAISE EXCEPTION 'Dê um nome ao grupo';
  END IF;

  INSERT INTO public.conversations (type, title, created_by)
  VALUES ('group', v_nome, v_me)
  RETURNING id INTO v_conv;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (v_conv, v_me, 'admin');

  FOREACH v_membro IN ARRAY COALESCE(p_membros, '{}'::uuid[])
  LOOP
    CONTINUE WHEN v_membro = v_me;

    IF NOT public.e_membro_equipa(v_membro) THEN
      RAISE EXCEPTION 'Grupos são só para membros da empresa. O cliente fala em privado com a gestão.'
        USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (v_conv, v_membro, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END LOOP;

  INSERT INTO public.groups (conversation_id, name, created_by, is_private)
  VALUES (v_conv, v_nome, v_me, true);

  RETURN v_conv;
END;
$$;

CREATE OR REPLACE FUNCTION public.adicionar_membro_grupo(
  p_conversation_id uuid,
  p_user_id         uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_tipo text;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão acrescenta membros' USING ERRCODE = '42501';
  END IF;

  SELECT c.type INTO v_tipo FROM public.conversations c WHERE c.id = p_conversation_id;
  IF v_tipo IS DISTINCT FROM 'group' THEN
    RAISE EXCEPTION 'Esta conversa não é um grupo' USING ERRCODE = '42501';
  END IF;

  IF NOT public.e_membro_equipa(p_user_id) THEN
    RAISE EXCEPTION 'Grupos são só para membros da empresa. O cliente fala em privado com a gestão.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (p_conversation_id, p_user_id, 'member')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.remover_membro_grupo(
  p_conversation_id uuid,
  p_user_id         uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_tipo text;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão remove membros' USING ERRCODE = '42501';
  END IF;

  SELECT c.type INTO v_tipo FROM public.conversations c WHERE c.id = p_conversation_id;
  IF v_tipo IS DISTINCT FROM 'group' THEN
    RAISE EXCEPTION 'Esta conversa não é um grupo' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.conversation_members cm
  WHERE cm.conversation_id = p_conversation_id AND cm.user_id = p_user_id;
END;
$$;

-- --------------------------------------------- 4. O GATILHO QUE FECHA A PORTA
-- A regra vive aqui e não só nas funções: qualquer INSERT (interface, script,
-- correcção manual) passa por este gatilho. `SECURITY DEFINER` para poder ler
-- `profiles` mesmo quando quem escreve é o próprio cliente.
CREATE OR REPLACE FUNCTION public.validar_membro_de_grupo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_tipo text;
BEGIN
  SELECT c.type INTO v_tipo FROM public.conversations c WHERE c.id = NEW.conversation_id;
  IF v_tipo IS DISTINCT FROM 'group' THEN
    RETURN NEW;
  END IF;

  IF NOT public.e_membro_equipa(NEW.user_id) THEN
    RAISE EXCEPTION 'Grupos são só para membros da empresa. O cliente fala em privado com a gestão.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversation_members_so_equipa ON public.conversation_members;
CREATE TRIGGER trg_conversation_members_so_equipa
BEFORE INSERT OR UPDATE OF user_id ON public.conversation_members
FOR EACH ROW EXECUTE FUNCTION public.validar_membro_de_grupo();

-- --------------------------------------------------------------- 5. ACESSOS
-- Quem cria conversas é a gestão. As conversas directas nascem dentro de
-- funções `SECURITY DEFINER`, que não passam por estas políticas.
DROP POLICY IF EXISTS conversations_insert ON public.conversations;
CREATE POLICY conversations_insert ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager() AND conversations.created_by = auth.uid());

-- Só a gestão acrescenta participantes. Antes, qualquer membro podia meter
-- quem quisesse dentro de uma conversa — foi por aí que o cliente acabou num
-- grupo de três.
DROP POLICY IF EXISTS conversation_members_insert ON public.conversation_members;
CREATE POLICY conversation_members_insert ON public.conversation_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager());

-- ------------------------------- 6. CONVERSAS ANTIGAS: GRUPO → PRIVADO
-- Um grupo criado por um cliente passa a conversa directa com o gestor que
-- já lá estava. As mensagens ficam: muda o `type`, saem os restantes membros.
DO $$
DECLARE
  r         record;
  v_cliente uuid;
  v_gestor  uuid;
BEGIN
  FOR r IN
    SELECT c.id, c.created_by
    FROM public.conversations c
    JOIN public.profiles p ON p.id = c.created_by
    WHERE c.type = 'group' AND p.role = 'customer'::public.user_role
  LOOP
    v_cliente := r.created_by;

    SELECT m.user_id INTO v_gestor
    FROM public.conversation_members m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.conversation_id = r.id AND p.role = 'manager'::public.user_role
    LIMIT 1;

    IF v_gestor IS NULL THEN
      SELECT p.id INTO v_gestor
      FROM public.profiles p
      WHERE p.role = 'manager'::public.user_role AND p.is_active
      ORDER BY p.created_at
      LIMIT 1;
    END IF;

    -- Sem gestor não há para onde converter: deixa-se como está e a gestão
    -- resolve à mão.
    CONTINUE WHEN v_gestor IS NULL;

    DELETE FROM public.conversation_members m
    WHERE m.conversation_id = r.id
      AND m.user_id NOT IN (v_cliente, v_gestor);

    -- Primeiro deixa de ser grupo; só depois volta a entrar o cliente. Ao
    -- contrário, o gatilho da secção 4 recusava-o — e com razão.
    UPDATE public.conversations
    SET type = 'direct', title = NULL
    WHERE id = r.id;

    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (r.id, v_cliente, 'member'), (r.id, v_gestor, 'admin')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    DELETE FROM public.groups g WHERE g.conversation_id = r.id;
  END LOOP;
END $$;

-- ------------------------------------------------------------ 7. PERMISSÕES
GRANT EXECUTE ON FUNCTION public.e_membro_equipa(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.abrir_conversa_equipa()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_grupo_equipa(text, uuid[])        TO authenticated;
GRANT EXECUTE ON FUNCTION public.adicionar_membro_grupo(uuid, uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_membro_grupo(uuid, uuid)        TO authenticated;


-- ###########################################################################
-- ##  PARTE 12 de 15 — DISPONIBILIDADE VISÍVEL A QUEM NÃO TEM CONTA
-- ###########################################################################

-- =============================================================================
--  0012 — DISPONIBILIDADE VISÍVEL A QUEM NÃO TEM CONTA
-- =============================================================================
--  O QUE ESTAVA MAL
--    `inventory` só é legível por contas autenticadas (é a política certa: o
--    stock é informação da empresa). Mas a loja usava exactamente essa leitura
--    para decidir se mostrava «Esgotado». Resultado: um visitante — a maioria
--    de quem entra no catálogo — nunca via o produto esgotado e, na página do
--    produto, ficava sem o formulário de reserva. O aviso de rutura só existia
--    para quem já tinha sessão.
--
--  O QUE PASSA A ACONTECER
--    `stock_produtos(uuid[])` devolve, por produto, as unidades disponíveis
--    (quantidade menos reservado), em bloco e numa só chamada:
--      · número  → há inventário registado; é este o valor a mostrar;
--      · NULL    → não há linha de inventário (produto sem controlo de stock),
--                  que é diferente de zero — zero quer dizer esgotado.
--    `SECURITY DEFINER` para poder ler `inventory` mesmo sem sessão; expõe
--    apenas o número por produto, nunca o resto da tabela.
--
--  Idempotente. Pode correr mais do que uma vez.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.stock_produtos(p_ids uuid[])
RETURNS TABLE (product_id uuid, disponivel int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- `LEFT JOIN` para os produtos sem inventário aparecerem com NULL em vez
  -- de desaparecerem da resposta (o chamador distingue «sem controlo» de
  -- «esgotado»).
  SELECT t.pid AS product_id,
         CASE
           WHEN i.product_id IS NULL THEN NULL
           ELSE GREATEST(0, i.quantity - i.reserved_quantity)
         END AS disponivel
  FROM unnest(COALESCE(p_ids, '{}'::uuid[])) AS t(pid)
  LEFT JOIN public.inventory i ON i.product_id = t.pid;
$$;

-- ------------------------------------------------------------ PERMISSÕES
-- A loja pública é servida a `anon`; sem este GRANT o catálogo continuaria
-- cego para visitantes.
GRANT EXECUTE ON FUNCTION public.stock_produtos(uuid[]) TO anon, authenticated;


-- ###########################################################################
-- ##  PARTE 13 de 15 — PERFIS: VENDEDOR DE LOJA, ELIMINAÇÃO DE PRODUTOS E FEED
-- ###########################################################################

-- =============================================================================
--  INUKA ANGOLA — PERFIS, VENDEDOR DE LOJA, ELIMINAÇÃO DE PRODUTOS E FEED
-- =============================================================================
--  Esta migração fecha a separação de perfis. Cada um passa a ter exactamente
--  as competências que lhe pertencem:
--
--    manager       — tudo: catálogo, stock, encomendas, clientes, colaboradores,
--                    conteúdos, formação, relatórios, definições e designer.
--    seller        — colaborador/revendedor: carteira de clientes, vendas com
--                    comissão, formação e comunicados. NÃO mexe em stock.
--    store_seller  — vendedor de loja (novo): stock da sua província, vendas ao
--                    balcão e encomendas para preparar/entregar. Sem carteira
--                    de clientes e sem comissões.
--    customer      — compra, reserva, favoritos, feed de notícias e conversa
--                    privada com a gestão.
--
--  Também aqui:
--    • um produto pode ser eliminado mesmo tendo histórico. As referências em
--      encomendas, vendas, reservas e pedidos de desconto passam a ficar sem
--      produto (ON DELETE SET NULL) mas guardam nome/preço — o histórico não
--      se perde. A interface avisa antes de confirmar.
--    • o feed de notícias do cliente passa a mostrar também os comunicados da
--      gestão (antes eram só para colaboradores).
--
--  Idempotente: pode ser executado mais do que uma vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. O PAPEL NOVO
-- -----------------------------------------------------------------------------
-- `ADD VALUE` não pode ser usado como valor de enum na MESMA transacção em que
-- é criado. Por isso todas as verificações abaixo comparam `::text` — funcionam
-- na hora e depois de a transacção fechar.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'store_seller';

-- -----------------------------------------------------------------------------
-- 2. COMPETÊNCIAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_store_seller()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.current_user_role()::text = 'store_seller';
$$;

/** Quem trabalha na empresa: colaborador, vendedor de loja ou gestão. */
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.current_user_role()::text IN ('seller', 'store_seller', 'manager');
$$;

/** Stock é da loja: vendedor de loja e gestão. O colaborador de vendas não. */
CREATE OR REPLACE FUNCTION public.can_manage_stock()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.current_user_role()::text IN ('store_seller', 'manager');
$$;

/** Vendas ao balcão: as mesmas pessoas que mexem no stock. */
CREATE OR REPLACE FUNCTION public.can_sell_at_store()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.current_user_role()::text IN ('store_seller', 'manager');
$$;

GRANT EXECUTE ON FUNCTION public.is_store_seller()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_stock()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_sell_at_store() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. POLÍTICAS POR PERFIL
-- -----------------------------------------------------------------------------

-- 3.1 Catálogo: o vendedor de loja precisa de ver também os produtos desactivados
--     (para conferir stock antes de os reactivar).
DROP POLICY IF EXISTS products_public_read ON public.products;
CREATE POLICY products_public_read ON public.products
  FOR SELECT TO anon, authenticated
  USING (
    -- A administração nacional vê tudo, incluindo inactivos.
    public.is_national()
    OR (
      (
        products.is_active = true
        OR public.is_manager()
        OR public.is_seller()
        OR public.is_store_seller()
      )
      AND (
        auth.uid() IS NULL                      -- visitante: montra pública
        OR products.provincia_id IS NULL        -- produto nacional
        OR products.provincia_id = public.my_province()
      )
    )
  );

DROP POLICY IF EXISTS product_images_public_read ON public.product_images;
CREATE POLICY product_images_public_read ON public.product_images
  FOR SELECT TO anon, authenticated
  USING (
    public.is_manager()
    OR public.is_seller()
    OR public.is_store_seller()
    OR EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_images.product_id AND p.is_active = true
    )
  );

-- 3.2 Stock: escrita passa a ser da loja (antes era só gestão).
DROP POLICY IF EXISTS inventory_manager_write ON public.inventory;
CREATE POLICY inventory_manager_write ON public.inventory
  FOR ALL TO authenticated
  USING (public.can_manage_stock())
  WITH CHECK (public.can_manage_stock());

DROP POLICY IF EXISTS inventory_movements_read ON public.inventory_movements;
CREATE POLICY inventory_movements_read ON public.inventory_movements
  FOR SELECT TO authenticated
  USING (public.can_manage_stock() OR public.is_seller());

DROP POLICY IF EXISTS inventory_movements_manager_write ON public.inventory_movements;
CREATE POLICY inventory_movements_manager_write ON public.inventory_movements
  FOR ALL TO authenticated
  USING (public.can_manage_stock())
  WITH CHECK (public.can_manage_stock());

-- 3.3 Encomendas: a loja vê o que tem de preparar e entregar.
DROP POLICY IF EXISTS orders_select ON public.orders;
CREATE POLICY orders_select ON public.orders
  FOR SELECT TO authenticated
  USING (
    orders.customer_id = auth.uid()
    OR orders.seller_id = auth.uid()
    OR public.is_manager()
    OR public.is_store_seller()
    OR (public.is_seller() AND public.is_my_customer(orders.customer_id))
  );

DROP POLICY IF EXISTS orders_update_manager_seller ON public.orders;
CREATE POLICY orders_update_manager_seller ON public.orders
  FOR UPDATE TO authenticated
  USING (
    public.is_manager()
    OR public.is_store_seller()
    OR orders.seller_id = auth.uid()
    OR (orders.customer_id = auth.uid() AND orders.status = 'pending')
  )
  WITH CHECK (
    public.is_manager()
    OR public.is_store_seller()
    OR orders.seller_id = auth.uid()
    OR orders.customer_id = auth.uid()
  );

-- 3.4 Reservas: a loja tem de as ver para não vender stock reservado.
DROP POLICY IF EXISTS reservations_select ON public.reservations;
CREATE POLICY reservations_select ON public.reservations
  FOR SELECT TO authenticated
  USING (
    reservations.customer_id = auth.uid()
    OR reservations.seller_id = auth.uid()
    OR public.is_manager()
    OR public.is_store_seller()
    OR (public.is_seller() AND public.is_my_customer(reservations.customer_id))
  );

DROP POLICY IF EXISTS reservation_items_select ON public.reservation_items;
CREATE POLICY reservation_items_select ON public.reservation_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.id = reservation_items.reservation_id
        AND (
          r.customer_id = auth.uid()
          OR r.seller_id = auth.uid()
          OR public.is_manager()
          OR public.is_store_seller()
        )
    )
  );

-- -----------------------------------------------------------------------------
-- 4. AJUSTE DE STOCK (loja e gestão)
-- -----------------------------------------------------------------------------
-- Mantém a assinatura da 0005 (com província) para não quebrar chamadas.
CREATE OR REPLACE FUNCTION public.set_product_stock(
  p_product_id   uuid,
  p_quantity     int,
  p_reason       text DEFAULT NULL,
  p_provincia_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov uuid := COALESCE(p_provincia_id, public.my_province());
  v_prev int := 0;
  v_nome text;
BEGIN
  IF NOT public.can_manage_stock() THEN
    RAISE EXCEPTION 'Apenas a loja e a gerência podem alterar stock'
      USING ERRCODE = '42501';
  END IF;

  -- O vendedor de loja só mexe na província dele. A gestão segue a regra
  -- provincial que já existia (um gestor provincial não mexe fora da sua).
  IF public.is_manager() THEN
    IF NOT public.can_manage_province(v_prov) THEN
      RAISE EXCEPTION 'Só pode alterar stock da sua província' USING ERRCODE = '42501';
    END IF;
  ELSIF v_prov IS DISTINCT FROM public.my_province() THEN
    RAISE EXCEPTION 'Só pode alterar stock da sua província' USING ERRCODE = '42501';
  END IF;

  IF p_quantity < 0 THEN
    RAISE EXCEPTION 'A quantidade não pode ser negativa';
  END IF;

  SELECT name INTO v_nome FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto inexistente';
  END IF;

  SELECT COALESCE(i.quantity, 0) INTO v_prev
  FROM public.inventory i
  WHERE i.product_id = p_product_id
    AND i.provincia_id IS NOT DISTINCT FROM v_prov;

  v_prev := COALESCE(v_prev, 0);

  IF v_prov IS NULL THEN
    INSERT INTO public.inventory (product_id, provincia_id, quantity)
    VALUES (p_product_id, NULL, p_quantity)
    ON CONFLICT (product_id) WHERE provincia_id IS NULL
    DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();
  ELSE
    INSERT INTO public.inventory (product_id, provincia_id, quantity)
    VALUES (p_product_id, v_prov, p_quantity)
    ON CONFLICT (product_id, provincia_id) WHERE provincia_id IS NOT NULL
    DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();
  END IF;

  INSERT INTO public.inventory_movements (
    product_id, provincia_id, type, quantity, previous_quantity, new_quantity, notes, created_by
  )
  VALUES (
    p_product_id, v_prov, 'adjustment', p_quantity - v_prev, v_prev, p_quantity,
    COALESCE(NULLIF(btrim(p_reason), ''), 'Ajuste manual de stock'), auth.uid()
  );

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'product_name', v_nome,
    'provincia_id', v_prov,
    'quantity', p_quantity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_product_stock(uuid, int, text, uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. VENDA AO BALCÃO (POS)
-- -----------------------------------------------------------------------------
-- Uma venda de loja é diferente de uma venda de colaborador:
--   • o preço vem SEMPRE do produto (nunca do browser);
--   • o stock sai no momento (não há reserva nem encomenda pelo meio);
--   • não gera comissão — não é carteira de ninguém.
CREATE OR REPLACE FUNCTION public.registar_venda_loja(
  p_items          jsonb,
  p_payment_method text DEFAULT 'dinheiro',
  p_customer_phone text DEFAULT NULL,
  p_notes          text DEFAULT NULL,
  p_client_ref     text DEFAULT NULL,
  p_provincia_id   uuid DEFAULT NULL,
  p_payment_status public.payment_status DEFAULT 'paid'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_prov      uuid := COALESCE(p_provincia_id, public.my_province());
  v_item      jsonb;
  v_prod      public.products;
  v_qty       int;
  v_price     numeric(12,2);
  v_total     numeric(12,2) := 0;
  v_stock     int;
  v_sale_id   uuid;
  v_ref       text;
  v_existing  public.sales;
  v_telefone  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.can_sell_at_store() THEN
    RAISE EXCEPTION 'Apenas a loja e a gerência podem registar vendas ao balcão'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_manager() AND v_prov IS DISTINCT FROM public.my_province() THEN
    RAISE EXCEPTION 'Só pode vender na sua província' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum produto indicado';
  END IF;

  -- Idempotência: um duplo toque no botão não pode cobrar duas vezes.
  IF p_client_ref IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.sales s
    WHERE s.seller_id = v_uid AND s.client_ref = p_client_ref;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'sale_id', v_existing.id,
        'reference', v_existing.reference,
        'total', v_existing.total_amount,
        'duplicated', true
      );
    END IF;
  END IF;

  v_ref := public.generate_sale_reference();
  v_telefone := public.normalize_phone(p_customer_phone);

  INSERT INTO public.sales (
    reference, client_ref, seller_id, total_amount, payment_status,
    payment_method, notes, provincia_id, is_offline, sync_status
  )
  VALUES (
    v_ref, p_client_ref, v_uid, 0, p_payment_status,
    NULLIF(btrim(COALESCE(p_payment_method, '')), ''),
    NULLIF(btrim(COALESCE(p_notes, '')), ''), v_prov, false, 'synced'
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := GREATEST(COALESCE((v_item->>'quantity')::int, 0), 0);

    IF v_qty = 0 THEN
      RAISE EXCEPTION 'Quantidade inválida';
    END IF;

    SELECT * INTO v_prod FROM public.products
    WHERE id = (v_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto inexistente';
    END IF;

    -- Preço da base de dados. O que o browser manda é ignorado de propósito.
    v_price := COALESCE(v_prod.promotional_price, v_prod.official_price);

    SELECT COALESCE(i.quantity, 0) INTO v_stock
    FROM public.inventory i
    WHERE i.product_id = v_prod.id
      AND i.provincia_id IS NOT DISTINCT FROM v_prov
    FOR UPDATE;

    v_stock := COALESCE(v_stock, 0);

    IF v_stock < v_qty THEN
      RAISE EXCEPTION 'Stock insuficiente para «%»: pediu %, existem %',
        v_prod.name, v_qty, v_stock USING ERRCODE = '23514';
    END IF;

    UPDATE public.inventory i
    SET quantity = i.quantity - v_qty,
        updated_at = now()
    WHERE i.product_id = v_prod.id
      AND i.provincia_id IS NOT DISTINCT FROM v_prov;

    INSERT INTO public.inventory_movements (
      product_id, provincia_id, type, quantity, previous_quantity, new_quantity,
      reference, notes, created_by
    )
    VALUES (
      v_prod.id, v_prov, 'out', v_qty, v_stock, v_stock - v_qty,
      v_ref, 'Venda ao balcão', v_uid
    );

    INSERT INTO public.sale_items (
      sale_id, product_id, quantity, unit_price, total_price, product_snapshot
    )
    VALUES (
      v_sale_id, v_prod.id, v_qty, v_price, v_price * v_qty,
      jsonb_build_object('name', v_prod.name, 'sku', v_prod.sku)
    );

    v_total := v_total + (v_price * v_qty);
  END LOOP;

  UPDATE public.sales SET total_amount = v_total, updated_at = now()
  WHERE id = v_sale_id;

  -- Telefone do comprador (opcional): guarda-se na nota para a loja poder
  -- contactar sem inventar uma conta que a pessoa não pediu.
  IF v_telefone IS NOT NULL THEN
    UPDATE public.sales
    SET notes = concat_ws(' · ', NULLIF(notes, ''), 'Contacto: ' || v_telefone)
    WHERE id = v_sale_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'reference', v_ref,
    'total', v_total,
    'items', jsonb_array_length(p_items),
    'provincia_id', v_prov
  );
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.registar_venda_loja(jsonb, text, text, text, text, uuid, public.payment_status)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 5.1 ESTADO DA ENCOMENDA: A LOJA TAMBÉM PREPARA E ENTREGA
-- -----------------------------------------------------------------------------
-- Duas correcções em relação à 0008:
--   • o vendedor de loja passa a poder alterar o estado (é ele que prepara);
--   • o stock é mexido **na província da encomenda**, não em todas. A 0005
--     introduziu inventário por província e a 0008 continuava a actualizar
--     todas as linhas do produto — concluir uma encomenda em Luanda baixava
--     stock no Uíge.
CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id uuid,
  p_status   public.order_status,
  p_notes    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_order public.orders;
  v_item  record;
  v_sou_cliente boolean;
  v_loja  boolean := public.is_store_seller();
  v_alvo  record;
BEGIN
  SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Encomenda inexistente';
  END IF;

  IF NOT (
    public.is_manager()
    OR v_loja
    OR v_order.customer_id = auth.uid()
    OR COALESCE(v_order.seller_id = auth.uid(), false)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para alterar esta encomenda' USING ERRCODE = '42501';
  END IF;

  -- A loja só mexe nas encomendas da sua província (ou nas da sede).
  IF v_loja
     AND NOT public.is_manager()
     AND v_order.provincia_id IS NOT NULL
     AND v_order.provincia_id IS DISTINCT FROM public.my_province() THEN
    RAISE EXCEPTION 'Encomenda de outra província' USING ERRCODE = '42501';
  END IF;

  -- O comprador: pode cancelar ou confirmar a recepção. Não é um "gestor da
  -- encomenda" — não lhe compete escolher "em preparação" ou "em entrega".
  v_sou_cliente := COALESCE(v_order.customer_id = auth.uid(), false)
                   AND NOT public.is_manager()
                   AND NOT v_loja
                   AND NOT COALESCE(v_order.seller_id = auth.uid(), false);

  IF v_sou_cliente AND p_status NOT IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'O cliente apenas pode cancelar a encomenda ou confirmar a entrega'
      USING ERRCODE = '42501';
  END IF;

  IF v_sou_cliente AND p_status = 'completed'
     AND v_order.status NOT IN ('in_delivery', 'ready_pickup') THEN
    RAISE EXCEPTION 'Ainda não pode confirmar esta entrega' USING ERRCODE = '42501';
  END IF;

  IF v_order.status = 'completed' THEN
    RAISE EXCEPTION 'Encomenda já concluída não pode ser alterada';
  END IF;

  IF p_status = v_order.status THEN
    RETURN jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'changed', false);
  END IF;

  -- Concluir: converter reserva em saída efetiva de stock.
  --
  -- A linha certa é a da província da encomenda. Se essa província ainda não
  -- tem inventário próprio (a operação antiga só tinha armazém-sede), cai para
  -- a linha da sede — é lá que o `place_order` reservou. Sem esta queda, uma
  -- encomenda antiga concluía sem baixar stock nenhum.
  IF p_status = 'completed' THEN
    FOR v_item IN
      SELECT oi.product_id, oi.quantity FROM public.order_items oi WHERE oi.order_id = v_order.id
    LOOP
      FOR v_alvo IN
        SELECT DISTINCT prov
        FROM unnest(ARRAY[v_order.provincia_id, NULL::uuid]) AS prov
      LOOP
        UPDATE public.inventory i
        SET quantity = GREATEST(i.quantity - v_item.quantity, 0),
            reserved_quantity = GREATEST(i.reserved_quantity - v_item.quantity, 0),
            updated_at = now()
        WHERE i.product_id = v_item.product_id
          AND i.provincia_id IS NOT DISTINCT FROM v_alvo.prov;

        IF FOUND THEN
          INSERT INTO public.inventory_movements (
            product_id, provincia_id, type, quantity, previous_quantity, new_quantity,
            reference, notes, created_by
          )
          SELECT
            v_item.product_id,
            i.provincia_id,
            'out',
            v_item.quantity,
            i.quantity + v_item.quantity,
            i.quantity,
            v_order.reference,
            CASE WHEN v_sou_cliente THEN 'Entrega confirmada pelo cliente'
                 ELSE 'Encomenda concluída' END,
            auth.uid()
          FROM public.inventory i
          WHERE i.product_id = v_item.product_id
            AND i.provincia_id IS NOT DISTINCT FROM v_alvo.prov;

          EXIT;
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  -- Cancelar: libertar a reserva, com a mesma queda para a sede.
  IF p_status = 'cancelled' THEN
    FOR v_item IN
      SELECT oi.product_id, oi.quantity FROM public.order_items oi WHERE oi.order_id = v_order.id
    LOOP
      FOR v_alvo IN
        SELECT DISTINCT prov
        FROM unnest(ARRAY[v_order.provincia_id, NULL::uuid]) AS prov
      LOOP
        UPDATE public.inventory i
        SET reserved_quantity = GREATEST(i.reserved_quantity - v_item.quantity, 0),
            updated_at = now()
        WHERE i.product_id = v_item.product_id
          AND i.provincia_id IS NOT DISTINCT FROM v_alvo.prov;

        IF FOUND THEN
          EXIT;
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  UPDATE public.orders o
  SET status = p_status,
      notes = COALESCE(p_notes, o.notes),
      payment_status = CASE WHEN p_status = 'completed' THEN 'paid'::public.payment_status ELSE o.payment_status END,
      updated_at = now()
  WHERE o.id = v_order.id;

  UPDATE public.order_status_history h
  SET notes = p_notes
  WHERE h.order_id = v_order.id
    AND h.id = (
      SELECT h2.id FROM public.order_status_history h2
      WHERE h2.order_id = v_order.id
      ORDER BY h2.created_at DESC LIMIT 1
    );

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', p_status,
    'changed', true,
    'pelo_cliente', v_sou_cliente
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_order_status(uuid, public.order_status, text)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. ELIMINAR PRODUTO — MESMO COM HISTÓRICO
-- -----------------------------------------------------------------------------
-- As quatro tabelas abaixo apontavam para o produto sem ON DELETE. Passam a
-- aceitar NULL e a guardar o nome, para que a encomenda/venda continue legível
-- depois de o produto desaparecer do catálogo.
ALTER TABLE public.order_items       ADD COLUMN IF NOT EXISTS product_name text;
ALTER TABLE public.discount_requests ADD COLUMN IF NOT EXISTS product_name text;

ALTER TABLE public.order_items       ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.sale_items        ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.reservation_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.discount_requests ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE public.order_items       DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

ALTER TABLE public.sale_items        DROP CONSTRAINT IF EXISTS sale_items_product_id_fkey;
ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

ALTER TABLE public.reservation_items DROP CONSTRAINT IF EXISTS reservation_items_product_id_fkey;
ALTER TABLE public.reservation_items
  ADD CONSTRAINT reservation_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

ALTER TABLE public.discount_requests DROP CONSTRAINT IF EXISTS discount_requests_product_id_fkey;
ALTER TABLE public.discount_requests
  ADD CONSTRAINT discount_requests_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_produto      ON public.order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_produto       ON public.sale_items (product_id);
CREATE INDEX IF NOT EXISTS idx_reservation_items_produto ON public.reservation_items (product_id);

/**
 * Impacto da eliminação, para a interface poder avisar antes de confirmar.
 * Não apaga nada.
 */
CREATE OR REPLACE FUNCTION public.impacto_eliminar_produto(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_nome text;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode eliminar produtos' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_nome FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto inexistente';
  END IF;

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'name', v_nome,
    'order_items', (SELECT count(*) FROM public.order_items WHERE product_id = p_product_id),
    'sale_items', (SELECT count(*) FROM public.sale_items WHERE product_id = p_product_id),
    'reservation_items', (SELECT count(*) FROM public.reservation_items WHERE product_id = p_product_id),
    'discount_requests', (SELECT count(*) FROM public.discount_requests WHERE product_id = p_product_id),
    'images', (SELECT count(*) FROM public.product_images WHERE product_id = p_product_id),
    'favorites', (SELECT count(*) FROM public.favorites WHERE product_id = p_product_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.impacto_eliminar_produto(uuid) TO authenticated;

/**
 * Elimina o produto a todo o custo. Só a gestão, e só depois de a interface
 * avisar. O histórico de encomendas/vendas fica com o nome e o preço, sem o
 * produto — é o que permite apagar um artigo que já foi vendido.
 */
CREATE OR REPLACE FUNCTION public.eliminar_produto(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prod public.products;
  v_impacto jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode eliminar produtos' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto inexistente';
  END IF;

  v_impacto := jsonb_build_object(
    'order_items', (SELECT count(*) FROM public.order_items WHERE product_id = p_product_id),
    'sale_items', (SELECT count(*) FROM public.sale_items WHERE product_id = p_product_id),
    'reservation_items', (SELECT count(*) FROM public.reservation_items WHERE product_id = p_product_id),
    'discount_requests', (SELECT count(*) FROM public.discount_requests WHERE product_id = p_product_id)
  );

  -- Nome e preço ficam no registo histórico antes de o produto desaparecer.
  UPDATE public.order_items
  SET product_name = COALESCE(NULLIF(product_name, ''), v_prod.name)
  WHERE product_id = p_product_id;

  UPDATE public.sale_items
  SET product_snapshot = product_snapshot || jsonb_build_object(
    'name', v_prod.name,
    'sku', v_prod.sku,
    'official_price', v_prod.official_price
  )
  WHERE product_id = p_product_id
    AND NOT (product_snapshot ? 'name');

  UPDATE public.discount_requests
  SET product_name = COALESCE(NULLIF(product_name, ''), v_prod.name)
  WHERE product_id = p_product_id;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data)
  VALUES (
    auth.uid(), 'eliminar_produto', 'products', p_product_id,
    jsonb_build_object(
      'name', v_prod.name,
      'sku', v_prod.sku,
      'official_price', v_prod.official_price,
      'impacto', v_impacto
    )
  );

  -- As imagens, o stock, os movimentos, os favoritos, o carrinho e as
  -- associações a conteúdos caem por ON DELETE CASCADE.
  DELETE FROM public.products WHERE id = p_product_id;

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'name', v_prod.name,
    'impacto', v_impacto
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.eliminar_produto(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. FEED DE NOTÍCIAS DO CLIENTE
-- -----------------------------------------------------------------------------
-- O cliente passa a ver os comunicados da gestão no feed. A formação continua
-- interna (é conteúdo de colaborador), e um visitante sem sessão continua a
-- ver apenas testemunhos e promoções dentro das datas.
CREATE OR REPLACE FUNCTION public.pode_ver_conteudo(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.content_items c
    WHERE c.id = p_id
      AND (
        public.is_manager()
        OR (
          c.status = 'publicado'
          AND public.can_see_province(c.provincia_id)
          AND (
            c.kind IN ('testemunho', 'promocao', 'comunicado')
            OR public.is_seller()
          )
          AND (
            auth.uid() IS NOT NULL
            OR (
              c.kind IN ('testemunho', 'promocao')
              AND (
                c.kind <> 'promocao'
                OR (
                  (c.starts_at IS NULL OR c.starts_at <= now())
                  AND (c.ends_at IS NULL OR c.ends_at >= now())
                )
              )
            )
          )
        )
      )
  );
$$;

DROP POLICY IF EXISTS content_items_read ON public.content_items;
CREATE POLICY content_items_read ON public.content_items
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR (
      status = 'publicado'
      AND public.can_see_province(provincia_id)
      AND (
        kind IN ('testemunho', 'promocao', 'comunicado')
        OR public.is_seller()
      )
    )
  );

-- Reescrita da função do feed com a mesma regra de visibilidade. O corpo é o
-- da 0007; a única diferença é `comunicado` entrar na lista do cliente.
CREATE OR REPLACE FUNCTION public.conteudo_feed(
  p_kind  text DEFAULT NULL,
  p_limit int  DEFAULT 40
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(item ORDER BY fixado DESC, publicado DESC NULLS LAST), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT
      jsonb_build_object(
        'id',              c.id,
        'kind',            c.kind,
        'title',           c.title,
        'subtitle',        c.subtitle,
        'body',            c.body,
        'image_url',       c.image_url,
        'status',          c.status,
        'is_pinned',       c.is_pinned,
        'allow_reactions', c.allow_reactions,
        'allow_comments',  c.allow_comments,
        'author_name',     c.author_name,
        'author_photo',    c.author_photo,
        'starts_at',       c.starts_at,
        'ends_at',         c.ends_at,
        'published_at',    c.published_at,
        'cta_label',       c.cta_label,
        'cta_href',        c.cta_href,
        'metadata',        c.metadata,
        'provincia_id',    c.provincia_id,
        'provincia_nome',  pr.nome,
        'project_id',      c.project_id,
        'reacoes',         (SELECT count(*) FROM public.content_reactions r WHERE r.item_id = c.id),
        'comentarios',     (SELECT count(*) FROM public.content_comments m
                             WHERE m.item_id = c.id AND NOT m.is_hidden),
        'minha_reacao',    (SELECT r.reaction FROM public.content_reactions r
                             WHERE r.item_id = c.id AND r.user_id = auth.uid()),
        'produtos',        (
          SELECT coalesce(jsonb_agg(produto ORDER BY ordem), '[]'::jsonb)
          FROM (
            SELECT cp.sort_order AS ordem,
                   jsonb_build_object(
                     'id',    p.id,
                     'name',  p.name,
                     'sku',   p.sku,
                     'preco', coalesce(p.promotional_price, p.official_price),
                     'oficial', p.official_price,
                     'imagem', (
                       SELECT pi.url FROM public.product_images pi
                       WHERE pi.product_id = p.id
                       ORDER BY pi.is_primary DESC, pi.sort_order
                       LIMIT 1
                     )
                   ) AS produto
            FROM public.content_products cp
            JOIN public.products p ON p.id = cp.product_id
            WHERE cp.item_id = c.id
          ) t
        )
      ) AS item,
      c.is_pinned  AS fixado,
      c.published_at AS publicado
    FROM public.content_items c
    LEFT JOIN public.provincias pr ON pr.id = c.provincia_id
    WHERE (p_kind IS NULL OR c.kind = p_kind)
      AND (
        public.is_manager()
        OR (
          c.status = 'publicado'
          AND public.can_see_province(c.provincia_id)
          AND (
            c.kind IN ('testemunho', 'promocao', 'comunicado')
            OR public.is_seller()
          )
          AND (
            auth.uid() IS NOT NULL
            OR (
              c.kind IN ('testemunho', 'promocao')
              AND (
                c.kind <> 'promocao'
                OR (
                  (c.starts_at IS NULL OR c.starts_at <= now())
                  AND (c.ends_at IS NULL OR c.ends_at >= now())
                )
              )
            )
          )
        )
      )
    ORDER BY c.is_pinned DESC, c.published_at DESC NULLS LAST, c.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 40), 100))
  ) lista;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.conteudo_feed(text, int) TO authenticated, anon;

/**
 * Comentários de um conteúdo, com o nome de quem escreveu.
 *
 * `content_comments.user_id` aponta para `auth.users`, não para `profiles` —
 * o PostgREST não consegue embutir o nome. Esta função resolve isso numa só
 * chamada e respeita a visibilidade do conteúdo.
 */
CREATE OR REPLACE FUNCTION public.conteudo_comentarios(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.pode_ver_conteudo(p_item_id) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT coalesce(jsonb_agg(linha ORDER BY criado), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT
      jsonb_build_object(
        'id',         c.id,
        'body',       c.body,
        'created_at', c.created_at,
        'autor',      COALESCE(NULLIF(p.full_name, ''), 'Cliente'),
        'eu',         c.user_id = auth.uid()
      ) AS linha,
      c.created_at AS criado
    FROM public.content_comments c
    LEFT JOIN public.profiles p ON p.id = c.user_id
    WHERE c.item_id = p_item_id
      AND NOT c.is_hidden
    ORDER BY c.created_at ASC
    LIMIT 100
  ) t;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.conteudo_comentarios(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. COMISSÕES: O VENDEDOR DE LOJA NÃO GANHA COMISSÃO
-- -----------------------------------------------------------------------------
-- A venda ao balcão não é uma venda de carteira: o colaborador não trouxe o
-- cliente nem acompanhou a compra. A taxa efectiva passa a ser 0 para este
-- papel, o que faz o gatilho `fill_commission` gravar uma comissão de 0 em vez
-- de 10% da empresa. `seller_profiles` continua a ser só de quem vende por
-- carteira — o vendedor de loja não tem linha lá.
CREATE OR REPLACE FUNCTION public.taxa_comissao_efetiva(p_seller uuid DEFAULT auth.uid())
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT CASE
    WHEN (SELECT p.role::text FROM public.profiles p WHERE p.id = p_seller) = 'store_seller'
      THEN 0::numeric
    ELSE COALESCE(
      (SELECT sp.commission_rate FROM public.seller_profiles sp WHERE sp.id = p_seller),
      public.taxa_comissao_global()
    )
  END;
$$;

-- A interface mostra a taxa; para a loja a resposta tem de dizer 0 e porquê.
CREATE OR REPLACE FUNCTION public.taxa_comissao_de(p_seller uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_global  numeric := public.taxa_comissao_global();
  v_pessoal numeric;
  v_efetiva numeric;
  v_papel   text;
BEGIN
  IF NOT public.is_manager() AND p_seller IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sem permissão para ver a taxa de outra pessoa' USING ERRCODE = '42501';
  END IF;

  SELECT p.role::text INTO v_papel FROM public.profiles p WHERE p.id = p_seller;

  IF v_papel = 'store_seller' THEN
    RETURN jsonb_build_object(
      'global',  v_global,
      'pessoal', NULL,
      'efetiva', 0,
      'origem',  'loja'
    );
  END IF;

  SELECT sp.commission_rate INTO v_pessoal
  FROM public.seller_profiles sp WHERE sp.id = p_seller;

  v_efetiva := COALESCE(v_pessoal, v_global);

  RETURN jsonb_build_object(
    'global',  v_global,
    'pessoal', v_pessoal,
    'efetiva', v_efetiva,
    'origem',  CASE WHEN v_pessoal IS NULL THEN 'empresa' ELSE 'pessoal' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.taxa_comissao_efetiva(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.taxa_comissao_de(uuid)      TO authenticated;


-- ###########################################################################
-- ##  PARTE 14 de 15 — ELIMINAR PRODUTO COM O HISTÓRICO (MODO FORÇADO)
-- ###########################################################################

-- =============================================================================
--  0014 — ELIMINAR PRODUTO A SÉRIO (COM O HISTÓRICO)
-- =============================================================================
--  O QUE ESTAVA MAL
--    A 0013 deixou eliminar um produto que já estava em encomendas e vendas: as
--    linhas ficavam com o nome e o preço e perdiam a ligação ao catálogo. Isso
--    é o correcto para um produto real que sai de linha — o histórico não pode
--    desaparecer.
--
--    Mas há outro caso: produtos de demonstração, testes e encomendas feitas
--    para experimentar. Aí o histórico também é fictício e não deve continuar a
--    contar nos relatórios. O gestor ficava com um produto apagado e linhas
--    órfãs a somar dinheiro que nunca existiu.
--
--  O QUE PASSA A ACONTECER
--    `eliminar_produto(id, forcar)` ganha um segundo argumento:
--      · forcar = false (por omissão) → comportamento da 0013. As encomendas e
--        vendas ficam com o nome e o preço; o produto sai do catálogo.
--      · forcar = true → apaga também as linhas de encomenda, venda, reserva e
--        pedido de desconto desse produto. Os registos que ficarem SEM linhas
--        (encomenda/venda/reserva feita só com este produto) são apagados, e os
--        totais dos que sobrevivem são recalculados a partir das linhas que
--        restam. Nada fica a somar dinheiro que não existe.
--
--    `impacto_eliminar_produto` passa a dizer quantos registos inteiros
--    desapareceriam no modo forçado, para o aviso ser honesto.
--
--    Continua a ser só da gerência, e cada eliminação fica em `audit_logs` com
--    a contagem do que foi apagado.
--
--  Idempotente: pode ser executado mais do que uma vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. IMPACTO — quantas linhas e quantos registos inteiros
-- -----------------------------------------------------------------------------
-- `encomendas_apagadas` / `vendas_apagadas` / `reservas_apagadas` contam os
-- registos que só existem por causa deste produto. É o que o modo forçado
-- remove por completo; o resto fica com as linhas todas retiradas.
CREATE OR REPLACE FUNCTION public.impacto_eliminar_produto(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_nome text;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode eliminar produtos' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_nome FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto inexistente';
  END IF;

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'name', v_nome,
    'order_items', (SELECT count(*) FROM public.order_items WHERE product_id = p_product_id),
    'sale_items', (SELECT count(*) FROM public.sale_items WHERE product_id = p_product_id),
    'reservation_items', (SELECT count(*) FROM public.reservation_items WHERE product_id = p_product_id),
    'discount_requests', (SELECT count(*) FROM public.discount_requests WHERE product_id = p_product_id),
    'images', (SELECT count(*) FROM public.product_images WHERE product_id = p_product_id),
    'favorites', (SELECT count(*) FROM public.favorites WHERE product_id = p_product_id),

    -- Registos que ficariam vazios (só têm este produto).
    'orders_emptied', (
      SELECT count(*) FROM public.orders o
      WHERE EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.order_id = o.id AND oi.product_id = p_product_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.order_id = o.id AND oi.product_id <> p_product_id
      )
    ),
    'sales_emptied', (
      SELECT count(*) FROM public.sales s
      WHERE EXISTS (
        SELECT 1 FROM public.sale_items si
        WHERE si.sale_id = s.id AND si.product_id = p_product_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_items si
        WHERE si.sale_id = s.id AND si.product_id <> p_product_id
      )
    ),
    'reservations_emptied', (
      SELECT count(*) FROM public.reservations r
      WHERE EXISTS (
        SELECT 1 FROM public.reservation_items ri
        WHERE ri.reservation_id = r.id AND ri.product_id = p_product_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.reservation_items ri
        WHERE ri.reservation_id = r.id AND ri.product_id <> p_product_id
      )
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.impacto_eliminar_produto(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. ELIMINAÇÃO — com ou sem histórico
-- -----------------------------------------------------------------------------
-- A assinatura muda (passa a ter dois argumentos), por isso a versão de um só
-- argumento tem de sair: duas funções com o mesmo nome deixavam o PostgREST a
-- responder PGRST203 («função ambígua»). O `DEFAULT false` mantém válidas as
-- chamadas antigas com apenas `p_product_id`.
DROP FUNCTION IF EXISTS public.eliminar_produto(uuid);

CREATE OR REPLACE FUNCTION public.eliminar_produto(
  p_product_id uuid,
  p_forcar boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prod public.products;
  v_impacto jsonb;
  v_encomendas uuid[];
  v_vendas uuid[];
  v_reservas uuid[];
  v_n_encomendas int := 0;
  v_n_vendas int := 0;
  v_n_reservas int := 0;
  v_n_descontos int := 0;
  v_apagados jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode eliminar produtos' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto inexistente';
  END IF;

  v_impacto := jsonb_build_object(
    'order_items', (SELECT count(*) FROM public.order_items WHERE product_id = p_product_id),
    'sale_items', (SELECT count(*) FROM public.sale_items WHERE product_id = p_product_id),
    'reservation_items', (SELECT count(*) FROM public.reservation_items WHERE product_id = p_product_id),
    'discount_requests', (SELECT count(*) FROM public.discount_requests WHERE product_id = p_product_id)
  );

  -- Nome e preço ficam no registo histórico antes de o produto desaparecer.
  -- Mesmo em modo forçado: se alguma linha sobreviver (outra transacção, uma
  -- cópia de segurança), não fica sem saber de que produto se tratava.
  UPDATE public.order_items
  SET product_name = COALESCE(NULLIF(product_name, ''), v_prod.name)
  WHERE product_id = p_product_id;

  UPDATE public.sale_items
  SET product_snapshot = product_snapshot || jsonb_build_object(
    'name', v_prod.name,
    'sku', v_prod.sku,
    'official_price', v_prod.official_price
  )
  WHERE product_id = p_product_id
    AND NOT (product_snapshot ? 'name');

  UPDATE public.discount_requests
  SET product_name = COALESCE(NULLIF(product_name, ''), v_prod.name)
  WHERE product_id = p_product_id;

  -- ------------------------------------------------------------------ forçar
  IF p_forcar THEN
    -- Guardar os registos tocados antes de apagar as linhas.
    SELECT array_agg(DISTINCT order_id) INTO v_encomendas
    FROM public.order_items WHERE product_id = p_product_id;

    SELECT array_agg(DISTINCT sale_id) INTO v_vendas
    FROM public.sale_items WHERE product_id = p_product_id;

    SELECT array_agg(DISTINCT reservation_id) INTO v_reservas
    FROM public.reservation_items WHERE product_id = p_product_id;

    DELETE FROM public.order_items WHERE product_id = p_product_id;
    DELETE FROM public.sale_items WHERE product_id = p_product_id;
    DELETE FROM public.reservation_items WHERE product_id = p_product_id;

    DELETE FROM public.discount_requests WHERE product_id = p_product_id;
    GET DIAGNOSTICS v_n_descontos = ROW_COUNT;

    -- Encomendas que ficaram sem nenhuma linha: eram só deste produto.
    WITH apagadas AS (
      DELETE FROM public.orders o
      WHERE o.id = ANY (COALESCE(v_encomendas, ARRAY[]::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id)
      RETURNING 1
    )
    SELECT count(*) INTO v_n_encomendas FROM apagadas;

    -- As que sobrevivem ficam com o total certo (sem o produto que saiu).
    UPDATE public.orders o
    SET total_amount = COALESCE(
      (SELECT sum(oi.total_price) FROM public.order_items oi WHERE oi.order_id = o.id),
      0
    )
    WHERE o.id = ANY (COALESCE(v_encomendas, ARRAY[]::uuid[]));

    WITH apagadas AS (
      DELETE FROM public.sales s
      WHERE s.id = ANY (COALESCE(v_vendas, ARRAY[]::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM public.sale_items si WHERE si.sale_id = s.id)
      RETURNING 1
    )
    SELECT count(*) INTO v_n_vendas FROM apagadas;

    UPDATE public.sales s
    SET total_amount = COALESCE(
      (SELECT sum(si.total_price) FROM public.sale_items si WHERE si.sale_id = s.id),
      0
    )
    WHERE s.id = ANY (COALESCE(v_vendas, ARRAY[]::uuid[]));

    WITH apagadas AS (
      DELETE FROM public.reservations r
      WHERE r.id = ANY (COALESCE(v_reservas, ARRAY[]::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM public.reservation_items ri WHERE ri.reservation_id = r.id)
      RETURNING 1
    )
    SELECT count(*) INTO v_n_reservas FROM apagadas;
  END IF;

  v_apagados := jsonb_build_object(
    'encomendas', v_n_encomendas,
    'vendas', v_n_vendas,
    'reservas', v_n_reservas,
    'pedidos_desconto', v_n_descontos,
    'linhas_encomenda', COALESCE((v_impacto ->> 'order_items')::int, 0),
    'linhas_venda', COALESCE((v_impacto ->> 'sale_items')::int, 0),
    'linhas_reserva', COALESCE((v_impacto ->> 'reservation_items')::int, 0)
  );

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data)
  VALUES (
    auth.uid(),
    CASE WHEN p_forcar THEN 'eliminar_produto_forcado' ELSE 'eliminar_produto' END,
    'products',
    p_product_id,
    jsonb_build_object(
      'name', v_prod.name,
      'sku', v_prod.sku,
      'official_price', v_prod.official_price,
      'forcado', p_forcar,
      'impacto', v_impacto,
      'apagados', v_apagados
    )
  );

  -- As imagens, o stock, os movimentos, os favoritos, o carrinho e as
  -- associações a conteúdos caem por ON DELETE CASCADE.
  DELETE FROM public.products WHERE id = p_product_id;

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'name', v_prod.name,
    'forcado', p_forcar,
    'impacto', v_impacto,
    'apagados', v_apagados
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.eliminar_produto(uuid, boolean) TO authenticated;


-- ###########################################################################
-- ##  PARTE 15 de 15 — PROMOÇÕES POR PROVÍNCIA, COMISSÕES E LEVANTAMENTOS
-- ###########################################################################

-- =============================================================================
--  0015 — PROMOÇÕES POR PROVÍNCIA, COMISSÕES E LEVANTAMENTOS
-- =============================================================================
--  Três coisas que a plataforma prometia e não tinha:
--
--   1. PROMOÇÕES COM ÂMBITO. Até aqui a única promoção era
--      `products.promotional_price`, igual em todo o país. Passa a haver
--      campanhas com províncias, período de validade e produtos escolhidos.
--      O preço que o cliente paga sai de `preco_efetivo()` — uma regra só,
--      usada pela loja e por `place_order`.
--
--   2. ENTREGA «POR DEFINIR». A entrega é gratuita no Uíge. Nas outras
--      províncias não se inventa uma taxa: `taxa_entrega()` devolve NULL e a
--      encomenda fica com a taxa pendente, à espera que a gerência a defina.
--
--   3. LEVANTAMENTO DE COMISSÕES. O colaborador passa a pedir o dinheiro
--      (XPRESS ou transferência) e a gestão aprova, processa e paga. O saldo
--      nunca é um número guardado: é sempre calculado a partir das comissões
--      menos o que já foi pago e o que está reservado num pedido em curso.
--
--  O QUE NÃO SE TOCA
--   - `sale_commissions` e `commission_payouts` continuam a ser o livro de
--     comissões e de pagamentos. Os levantamentos são pedidos; o pagamento
--     continua a ser um `commission_payouts`. Não há dois livros.
--   - A taxa de 10% continua a vir de `taxa_comissao_efetiva()`.
--
--  Idempotente. Pode correr mais do que uma vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TIPOS
-- -----------------------------------------------------------------------------
-- Tipo novo (CREATE TYPE), não um valor acrescentado a um enum existente:
-- assim pode ser usado já nesta migração, na mesma transacção.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'levantamento_status') THEN
    CREATE TYPE public.levantamento_status AS ENUM (
      'pendente', 'aprovado', 'em_processamento', 'pago', 'rejeitado'
    );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. PROMOÇÕES
-- -----------------------------------------------------------------------------
-- `tipo='percentagem'` desconta `valor` por cento do preço base;
-- `tipo='preco'` fixa o preço final. Em ambos os casos o preço nunca sobe:
-- `preco_efetivo()` fica com o menor dos dois.
CREATE TABLE IF NOT EXISTS public.promocoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  descricao   text,
  tipo        text NOT NULL DEFAULT 'percentagem',
  valor       numeric(12,2) NOT NULL CHECK (valor >= 0),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  ativo       boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promocoes_nome_nao_vazio CHECK (length(btrim(nome)) > 0),
  CONSTRAINT promocoes_tipo_valido CHECK (tipo IN ('percentagem', 'preco')),
  CONSTRAINT promocoes_percentagem_valida CHECK (tipo <> 'percentagem' OR valor <= 100),
  CONSTRAINT promocoes_periodo_valido CHECK (ends_at IS NULL OR ends_at > starts_at)
);

COMMENT ON TABLE public.promocoes IS
  'Campanha promocional com âmbito de províncias e produtos. Sem linhas em promocao_provincias vale no país inteiro; sem linhas em promocao_produtos vale para todo o catálogo.';

-- Âmbito geográfico. Vazio = nacional.
CREATE TABLE IF NOT EXISTS public.promocao_provincias (
  promocao_id  uuid NOT NULL REFERENCES public.promocoes(id) ON DELETE CASCADE,
  provincia_id uuid NOT NULL REFERENCES public.provincias(id) ON DELETE CASCADE,
  PRIMARY KEY (promocao_id, provincia_id)
);

-- Âmbito de catálogo. Vazio = todos os produtos.
CREATE TABLE IF NOT EXISTS public.promocao_produtos (
  promocao_id uuid NOT NULL REFERENCES public.promocoes(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  PRIMARY KEY (promocao_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_promocoes_vigencia ON public.promocoes (ativo, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_promocao_provincias_prov ON public.promocao_provincias (provincia_id);
CREATE INDEX IF NOT EXISTS idx_promocao_produtos_prod ON public.promocao_produtos (product_id);

-- -----------------------------------------------------------------------------
-- 3. PREÇO EFECTIVO — A REGRA ÚNICA
-- -----------------------------------------------------------------------------
-- Devolve a promoção que dá o melhor preço a este produto nesta província.
-- `NULL` quando não há campanha aplicável.
--
--   base  = COALESCE(promotional_price, official_price)
--   promo = percentagem → base × (1 − valor/100)  |  preço → valor
--   final = LEAST(base, promo)
--
-- `p_provincia` NULL (visitante sem província) só apanha campanhas nacionais:
-- mostrar o preço de uma província a quem não está nela seria publicidade
-- enganosa.
CREATE OR REPLACE FUNCTION public.promocao_do_produto(
  p_product   uuid,
  p_provincia uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT COALESCE(pr.promotional_price, pr.official_price)::numeric AS preco
    FROM public.products pr
    WHERE pr.id = p_product
  ),
  candidatas AS (
    SELECT po.id,
           po.nome,
           po.tipo,
           po.valor,
           CASE
             WHEN po.tipo = 'percentagem' THEN round(b.preco * (1 - po.valor / 100.0), 2)
             ELSE po.valor
           END AS preco_promo
    FROM public.promocoes po
    CROSS JOIN base b
    WHERE po.ativo
      AND po.starts_at <= now()
      AND (po.ends_at IS NULL OR po.ends_at >= now())
      -- Província: campanha nacional (sem linhas) ou que inclua a do cliente.
      AND (
        NOT EXISTS (SELECT 1 FROM public.promocao_provincias pp WHERE pp.promocao_id = po.id)
        OR (p_provincia IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.promocao_provincias pp
              WHERE pp.promocao_id = po.id AND pp.provincia_id = p_provincia))
      )
      -- Catálogo: campanha de todo o catálogo (sem linhas) ou com este produto.
      AND (
        NOT EXISTS (SELECT 1 FROM public.promocao_produtos ppr WHERE ppr.promocao_id = po.id)
        OR EXISTS (SELECT 1 FROM public.promocao_produtos ppr
                   WHERE ppr.promocao_id = po.id AND ppr.product_id = p_product)
      )
  )
  SELECT jsonb_build_object(
           'promocao_id',  c.id,
           'nome',         c.nome,
           'tipo',         c.tipo,
           'valor',        c.valor,
           'preco_base',   b.preco,
           'preco_final',  GREATEST(LEAST(b.preco, c.preco_promo), 0)
         )
  FROM candidatas c
  CROSS JOIN base b
  WHERE c.preco_promo < b.preco          -- uma promoção nunca aumenta o preço
  ORDER BY GREATEST(c.preco_promo, 0) ASC, c.id
  LIMIT 1;
$$;

-- Preço que o cliente paga. É esta a função que `place_order` usa; a loja
-- mostra o mesmo número, por isso não há dois preços em lado nenhum.
CREATE OR REPLACE FUNCTION public.preco_efetivo(
  p_product   uuid,
  p_provincia uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (public.promocao_do_produto(p_product, p_provincia) ->> 'preco_final')::numeric,
    (SELECT COALESCE(pr.promotional_price, pr.official_price)::numeric
     FROM public.products pr WHERE pr.id = p_product)
  );
$$;

-- O mesmo preço, mas para uma lista inteira de produtos.
--
-- A montra mostra 24 cartões de uma vez; chamar `preco_efetivo` 24 vezes eram
-- 24 idas ao Supabase por visita. Devolve uma linha por produto pedido, com o
-- preço base ao lado para a loja poder mostrar o risco do desconto.
-- Produtos inexistentes são simplesmente ignorados.
CREATE OR REPLACE FUNCTION public.precos_efetivos(
  p_produtos  uuid[],
  p_provincia uuid DEFAULT NULL
)
RETURNS TABLE (
  product_id    uuid,
  preco_base    numeric,
  preco_final   numeric,
  promocao_id   uuid,
  promocao_nome text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pr.id,
         COALESCE(pr.promotional_price, pr.official_price)::numeric AS preco_base,
         public.preco_efetivo(pr.id, p_provincia)                   AS preco_final,
         (public.promocao_do_produto(pr.id, p_provincia) ->> 'promocao_id')::uuid AS promocao_id,
         public.promocao_do_produto(pr.id, p_provincia) ->> 'nome'               AS promocao_nome
  FROM public.products pr
  WHERE pr.id = ANY (COALESCE(p_produtos, ARRAY[]::uuid[]));
$$;
GRANT EXECUTE ON FUNCTION public.precos_efetivos(uuid[], uuid)   TO anon, authenticated;

-- Campanhas a decorrer numa província, para a montra e para o carrinho.
CREATE OR REPLACE FUNCTION public.promocoes_vigentes(p_provincia uuid DEFAULT NULL)
RETURNS TABLE (
  id          uuid,
  nome        text,
  descricao   text,
  tipo        text,
  valor       numeric,
  starts_at   timestamptz,
  ends_at     timestamptz,
  nacional    boolean,
  provincias  text[],
  produtos    int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT po.id,
         po.nome,
         po.descricao,
         po.tipo,
         po.valor,
         po.starts_at,
         po.ends_at,
         NOT EXISTS (SELECT 1 FROM public.promocao_provincias pp WHERE pp.promocao_id = po.id) AS nacional,
         COALESCE(ARRAY(
           SELECT pr.nome
           FROM public.promocao_provincias pp
           JOIN public.provincias pr ON pr.id = pp.provincia_id
           WHERE pp.promocao_id = po.id
           ORDER BY pr.nome
         ), ARRAY[]::text[]) AS provincias,
         (SELECT COUNT(*)::int FROM public.promocao_produtos ppr WHERE ppr.promocao_id = po.id) AS produtos
  FROM public.promocoes po
  WHERE po.ativo
    AND po.starts_at <= now()
    AND (po.ends_at IS NULL OR po.ends_at >= now())
    AND (
      NOT EXISTS (SELECT 1 FROM public.promocao_provincias pp WHERE pp.promocao_id = po.id)
      OR (p_provincia IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.promocao_provincias pp
            WHERE pp.promocao_id = po.id AND pp.provincia_id = p_provincia))
    )
  ORDER BY po.starts_at DESC;
$$;

-- -----------------------------------------------------------------------------
-- 4. GESTÃO DAS PROMOÇÕES (só gestão)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_promocao(
  p_nome       text,
  p_tipo       text,
  p_valor      numeric,
  p_starts_at  timestamptz DEFAULT NULL,
  p_ends_at    timestamptz DEFAULT NULL,
  p_provincias uuid[]      DEFAULT NULL,
  p_produtos   uuid[]      DEFAULT NULL,
  p_descricao  text        DEFAULT NULL,
  p_ativo      boolean     DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode criar promoções' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(btrim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Indique o nome da promoção';
  END IF;

  IF p_tipo NOT IN ('percentagem', 'preco') THEN
    RAISE EXCEPTION 'Tipo de promoção inválido';
  END IF;

  IF p_valor IS NULL OR p_valor < 0 THEN
    RAISE EXCEPTION 'Valor da promoção inválido';
  END IF;

  IF p_tipo = 'percentagem' AND p_valor > 100 THEN
    RAISE EXCEPTION 'O desconto não pode passar dos 100 %%';
  END IF;

  INSERT INTO public.promocoes (nome, descricao, tipo, valor, starts_at, ends_at, ativo, created_by)
  VALUES (
    btrim(p_nome),
    NULLIF(btrim(COALESCE(p_descricao, '')), ''),
    p_tipo,
    p_valor,
    COALESCE(p_starts_at, now()),
    p_ends_at,
    COALESCE(p_ativo, true),
    auth.uid()
  )
  RETURNING id INTO v_id;

  -- Âmbito: sem elementos = nacional / todo o catálogo.
  IF p_provincias IS NOT NULL AND array_length(p_provincias, 1) > 0 THEN
    INSERT INTO public.promocao_provincias (promocao_id, provincia_id)
    SELECT v_id, unnest(p_provincias)
    ON CONFLICT DO NOTHING;
  END IF;

  IF p_produtos IS NOT NULL AND array_length(p_produtos, 1) > 0 THEN
    INSERT INTO public.promocao_produtos (promocao_id, product_id)
    SELECT v_id, unnest(p_produtos)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'nome', btrim(p_nome));
END;
$$;

CREATE OR REPLACE FUNCTION public.actualizar_promocao(
  p_id         uuid,
  p_nome       text        DEFAULT NULL,
  p_tipo       text        DEFAULT NULL,
  p_valor      numeric     DEFAULT NULL,
  p_starts_at  timestamptz DEFAULT NULL,
  p_ends_at    timestamptz DEFAULT NULL,
  p_provincias uuid[]      DEFAULT NULL,
  p_produtos   uuid[]      DEFAULT NULL,
  p_descricao  text        DEFAULT NULL,
  p_ativo      boolean     DEFAULT NULL,
  p_limpar_fim boolean     DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode alterar promoções' USING ERRCODE = '42501';
  END IF;

  UPDATE public.promocoes po
  SET nome       = COALESCE(NULLIF(btrim(COALESCE(p_nome, '')), ''), po.nome),
      descricao  = CASE WHEN p_descricao IS NULL THEN po.descricao
                        ELSE NULLIF(btrim(p_descricao), '') END,
      tipo       = COALESCE(p_tipo, po.tipo),
      valor      = COALESCE(p_valor, po.valor),
      starts_at  = COALESCE(p_starts_at, po.starts_at),
      ends_at    = CASE WHEN p_limpar_fim THEN NULL
                        ELSE COALESCE(p_ends_at, po.ends_at) END,
      ativo      = COALESCE(p_ativo, po.ativo),
      updated_at = now()
  WHERE po.id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promoção inexistente';
  END IF;

  -- Âmbito só muda quando o parâmetro vem: `NULL` = «não mexas».
  IF p_provincias IS NOT NULL THEN
    DELETE FROM public.promocao_provincias WHERE promocao_id = p_id;
    IF array_length(p_provincias, 1) > 0 THEN
      INSERT INTO public.promocao_provincias (promocao_id, provincia_id)
      SELECT p_id, unnest(p_provincias) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF p_produtos IS NOT NULL THEN
    DELETE FROM public.promocao_produtos WHERE promocao_id = p_id;
    IF array_length(p_produtos, 1) > 0 THEN
      INSERT INTO public.promocao_produtos (promocao_id, product_id)
      SELECT p_id, unnest(p_produtos) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object('id', p_id, 'ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.eliminar_promocao(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode eliminar promoções' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.promocoes WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promoção inexistente';
  END IF;

  RETURN jsonb_build_object('id', p_id, 'eliminada', true);
END;
$$;

-- Lista completa para a gestão (inclui agendadas e desactivadas).
CREATE OR REPLACE FUNCTION public.promocoes_lista()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(linha ORDER BY linha->>'starts_at' DESC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
             'id',         po.id,
             'nome',       po.nome,
             'descricao',  po.descricao,
             'tipo',       po.tipo,
             'valor',      po.valor,
             'starts_at',  po.starts_at,
             'ends_at',    po.ends_at,
             'ativo',      po.ativo,
             'vigente',    po.ativo AND po.starts_at <= now()
                            AND (po.ends_at IS NULL OR po.ends_at >= now()),
             'nacional',   NOT EXISTS (SELECT 1 FROM public.promocao_provincias pp WHERE pp.promocao_id = po.id),
             'provincia_ids', COALESCE(ARRAY(
                SELECT pp.provincia_id FROM public.promocao_provincias pp WHERE pp.promocao_id = po.id
             ), ARRAY[]::uuid[]),
             'provincias', COALESCE(ARRAY(
                SELECT pr.nome FROM public.promocao_provincias pp
                JOIN public.provincias pr ON pr.id = pp.provincia_id
                WHERE pp.promocao_id = po.id ORDER BY pr.nome
             ), ARRAY[]::text[]),
             'product_ids', COALESCE(ARRAY(
                SELECT ppr.product_id FROM public.promocao_produtos ppr WHERE ppr.promocao_id = po.id
             ), ARRAY[]::uuid[]),
             'produtos',   (SELECT COUNT(*)::int FROM public.promocao_produtos ppr WHERE ppr.promocao_id = po.id)
           ) AS linha
    FROM public.promocoes po
    WHERE public.is_manager()
  ) t;
$$;

-- -----------------------------------------------------------------------------
-- 5. ENTREGA: «POR DEFINIR» FORA DO UÍGE
-- -----------------------------------------------------------------------------
-- A taxa deixa de ter um valor inventado por omissão. Sem configuração, só o
-- Uíge é gratuito; nas outras províncias `taxa_entrega` devolve NULL e a
-- encomenda fica com a taxa pendente.
INSERT INTO public.platform_settings (key, value)
VALUES ('entrega', '{"taxaPadrao": null, "gratis": ["uige"], "nota": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_fee_pendente boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.delivery_fee_pendente IS
  'true = a entrega ainda não tem preço definido (província sem taxa configurada). delivery_fee fica 0 até a gestão a definir.';

CREATE OR REPLACE FUNCTION public.taxa_entrega(p_provincia uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_def  jsonb;
  v_slug text;
BEGIN
  SELECT value INTO v_def FROM public.platform_settings WHERE key = 'entrega';

  IF v_def IS NULL OR jsonb_typeof(v_def) <> 'object' THEN
    v_def := '{"taxaPadrao": null, "gratis": ["uige"]}'::jsonb;
  END IF;

  IF p_provincia IS NOT NULL THEN
    SELECT pr.slug INTO v_slug FROM public.provincias pr WHERE pr.id = p_provincia;
  END IF;

  -- Província isenta (por omissão, o Uíge): entrega gratuita.
  IF v_slug IS NOT NULL
     AND jsonb_typeof(COALESCE(v_def->'gratis', '[]'::jsonb)) = 'array'
     AND (COALESCE(v_def->'gratis', '[]'::jsonb) @> to_jsonb(v_slug)) THEN
    RETURN 0;
  END IF;

  -- Sem taxa configurada devolve-se NULL — «por definir». Não é 0: zero é
  -- entrega grátis, e oferecer portes fora do Uíge não foi decidido.
  IF jsonb_typeof(v_def->'taxaPadrao') <> 'number' THEN
    RETURN NULL;
  END IF;

  RETURN GREATEST((v_def->>'taxaPadrao')::numeric, 0);
END;
$$;

-- Estado da entrega para quem está a ver (a app do telemóvel usa esta).
CREATE OR REPLACE FUNCTION public.minha_entrega()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov uuid := public.my_province();
  v_taxa numeric;
BEGIN
  v_taxa := public.taxa_entrega(v_prov);

  RETURN jsonb_build_object(
    'provincia_id', v_prov,
    'taxa',         v_taxa,
    'gratis',       (v_taxa IS NOT NULL AND v_taxa = 0),
    'por_definir',  (v_taxa IS NULL)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. LEVANTAMENTOS
-- -----------------------------------------------------------------------------
-- O pedido do colaborador. O pagamento em si continua a ser uma linha em
-- `commission_payouts` — este registo é o pedido, com o seu estado.
CREATE TABLE IF NOT EXISTS public.levantamentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referencia      text UNIQUE,
  seller_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provincia_id    uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  valor           numeric(12,2) NOT NULL CHECK (valor > 0),
  metodo          text NOT NULL,
  dados           jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado          public.levantamento_status NOT NULL DEFAULT 'pendente',
  notas           text,
  motivo_rejeicao text,
  payout_id       uuid REFERENCES public.commission_payouts(id) ON DELETE SET NULL,
  solicitado_em   timestamptz NOT NULL DEFAULT now(),
  decidido_por    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decidido_em     timestamptz,
  processado_em   timestamptz,
  pago_em         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT levantamentos_metodo_valido CHECK (metodo IN ('xpress', 'transferencia'))
);

CREATE INDEX IF NOT EXISTS idx_levantamentos_seller ON public.levantamentos (seller_id, solicitado_em DESC);
CREATE INDEX IF NOT EXISTS idx_levantamentos_estado ON public.levantamentos (estado, solicitado_em DESC);
CREATE INDEX IF NOT EXISTS idx_levantamentos_prov   ON public.levantamentos (provincia_id, estado);

-- Sequência das referências `LEV-2026-00001`.
CREATE SEQUENCE IF NOT EXISTS public.levantamento_seq START 1;

-- Dados de recebimento guardados no perfil do colaborador. Ficam em
-- `seller_profiles`, que já só é legível pelo próprio ou pela gestão — é o
-- sítio certo para dados bancários, e não uma tabela nova com RLS nova.
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS xpress_dados jsonb,
  ADD COLUMN IF NOT EXISTS banco_dados  jsonb;

-- ---------------------------------------------------------------- 6.1 SALDO
-- O saldo nunca é guardado: é sempre recalculado. Um número guardado fica
-- errado no dia em que uma venda é cancelada ou uma comissão muda.
--
--   ganho     = comissões de vendas CONCLUÍDAS e PAGAS
--   pendente  = comissões de vendas ainda não pagas (não levantáveis)
--   pago      = soma dos pagamentos já feitos (`commission_payouts`)
--   reservado = pedidos em curso (pendente/aprovado/em_processamento)
--   disponível = ganho − pago − reservado
--
-- VENDA = PRODUTO. Uma operação com três produtos são **três** vendas: o
-- colaborador recebe 10 % de cada produto, e o desbloqueio conta produtos e
-- não registos. `vendas_registadas` devolve o número de operações, para quem
-- quiser ver as duas leituras.
CREATE OR REPLACE FUNCTION public.levantamento_resumo(p_seller uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_minimo     int := 5;
  v_vendas     int;
  v_operacoes  int;
  v_ganho      numeric(12,2);
  v_pendente   numeric(12,2);
  v_pago       numeric(12,2);
  v_reservado  numeric(12,2);
  v_disponivel numeric(12,2);
  v_cfg        jsonb;
BEGIN
  IF p_seller IS DISTINCT FROM auth.uid() AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'Sem permissão para ver o saldo de outra pessoa' USING ERRCODE = '42501';
  END IF;

  SELECT value INTO v_cfg FROM public.platform_settings WHERE key = 'levantamento';
  IF v_cfg IS NOT NULL AND jsonb_typeof(v_cfg->'vendas_minimas') = 'number' THEN
    v_minimo := GREATEST((v_cfg->>'vendas_minimas')::int, 0);
  END IF;

  -- Vendas confirmadas e pagas: é o que conta para o desbloqueio.
  -- Cada unidade de produto é uma venda. Uma venda antiga, registada sem linhas
  -- de detalhe, continua a valer 1 — os dados existentes não mudam de leitura.
  SELECT COALESCE(SUM(GREATEST(COALESCE(it.unidades, 0), 1)), 0)::int INTO v_vendas
  FROM public.sales s
  LEFT JOIN LATERAL (
    SELECT SUM(si.quantity)::int AS unidades
    FROM public.sale_items si
    WHERE si.sale_id = s.id
  ) it ON TRUE
  WHERE s.seller_id = p_seller
    AND s.status = 'completed'
    AND s.payment_status = 'paid';

  -- Quantas operações (registos de venda) deram origem a essas vendas.
  SELECT COUNT(*)::int INTO v_operacoes
  FROM public.sales s
  WHERE s.seller_id = p_seller
    AND s.status = 'completed'
    AND s.payment_status = 'paid';

  SELECT COALESCE(SUM(c.amount), 0) INTO v_ganho
  FROM public.sale_commissions c
  JOIN public.sales s ON s.id = c.sale_id
  WHERE c.seller_id = p_seller
    AND c.status <> 'cancelled'
    AND s.status = 'completed'
    AND s.payment_status = 'paid';

  -- Ainda por pagar ao colaborador: vendas por confirmar/pagar, e vendas
  -- canceladas ficam de fora (o gatilho marca-as 'cancelled').
  SELECT COALESCE(SUM(c.amount), 0) INTO v_pendente
  FROM public.sale_commissions c
  JOIN public.sales s ON s.id = c.sale_id
  WHERE c.seller_id = p_seller
    AND c.status <> 'cancelled'
    AND NOT (s.status = 'completed' AND s.payment_status = 'paid');

  SELECT COALESCE(SUM(p.amount), 0) INTO v_pago
  FROM public.commission_payouts p
  WHERE p.seller_id = p_seller;

  SELECT COALESCE(SUM(l.valor), 0) INTO v_reservado
  FROM public.levantamentos l
  WHERE l.seller_id = p_seller
    AND l.estado IN ('pendente', 'aprovado', 'em_processamento');

  v_disponivel := GREATEST(v_ganho - v_pago - v_reservado, 0);

  RETURN jsonb_build_object(
    'seller_id',       p_seller,
    'vendas_pagas',    v_vendas,
    'vendas_registadas', v_operacoes,
    'vendas_minimas',  v_minimo,
    'vendas_faltam',   GREATEST(v_minimo - v_vendas, 0),
    'habilitado',      v_vendas >= v_minimo,
    'comissoes_ganhas',   v_ganho,
    'comissoes_pendentes', v_pendente,
    'total_pago',      v_pago,
    'reservado',       v_reservado,
    'disponivel',      v_disponivel,
    'taxa',            public.taxa_comissao_efetiva(p_seller)
  );
END;
$$;

-- ------------------------------------------------- 6.2 HISTÓRICO DE VENDAS
-- Uma linha por PRODUTO vendido, não por registo de venda. Quem vende um
-- perfume e um creme na mesma operação recebe duas comissões de 10 % e vê duas
-- linhas. Uma venda antiga, sem linhas de detalhe, aparece como uma só linha
-- com o valor total — assim os dados que já existem continuam a fazer sentido.
DROP FUNCTION IF EXISTS public.minhas_comissoes(int);

CREATE OR REPLACE FUNCTION public.minhas_comissoes(p_limite int DEFAULT 100)
RETURNS TABLE (
  sale_id     uuid,
  referencia  text,
  criada_em   timestamptz,
  produto     text,
  quantidade  int,
  total       numeric,
  taxa        numeric,
  comissao    numeric,
  estado      text,
  provincia   text,
  metodo      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT s.id,
         s.reference,
         s.created_at,
         COALESCE(NULLIF(it.nome, ''), 'Venda ' || s.reference),
         it.quantidade,
         it.valor,
         c.rate,
         ROUND(it.valor * c.rate, 2),
         CASE
           WHEN c.status = 'cancelled' THEN 'cancelada'
           WHEN s.status = 'cancelled' THEN 'cancelada'
           WHEN s.payment_status <> 'paid' THEN 'pendente'
           WHEN c.status = 'paid' THEN 'paga'
           ELSE 'disponivel'
         END,
         pr.nome,
         s.payment_method
  FROM public.sale_commissions c
  JOIN public.sales s ON s.id = c.sale_id
  LEFT JOIN public.provincias pr ON pr.id = c.provincia_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(NULLIF(si.product_snapshot->>'name', ''), p.name) AS nome,
           si.quantity::int AS quantidade,
           si.total_price   AS valor
    FROM public.sale_items si
    LEFT JOIN public.products p ON p.id = si.product_id
    WHERE si.sale_id = s.id
    UNION ALL
    SELECT NULL::text, 1, s.total_amount
    WHERE NOT EXISTS (SELECT 1 FROM public.sale_items x WHERE x.sale_id = s.id)
  ) it
  WHERE c.seller_id = auth.uid()
  ORDER BY s.created_at DESC, it.nome
  LIMIT GREATEST(COALESCE(p_limite, 100), 1);
$$;

-- ------------------------------------------------------- 6.3 DADOS DE RECEBIMENTO
CREATE OR REPLACE FUNCTION public.dados_recebimento()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  RETURN COALESCE(
    (SELECT jsonb_build_object('xpress', sp.xpress_dados, 'banco', sp.banco_dados)
     FROM public.seller_profiles sp WHERE sp.id = v_uid),
    '{"xpress": null, "banco": null}'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.guardar_dados_recebimento(
  p_metodo text,
  p_dados  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF p_metodo NOT IN ('xpress', 'transferencia') THEN
    RAISE EXCEPTION 'Método de recebimento inválido';
  END IF;

  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    RAISE EXCEPTION 'Dados de recebimento inválidos';
  END IF;

  -- A linha do colaborador pode não existir (vendedor de loja não tem). Só se
  -- cria para quem vende por carteira; os restantes não recebem comissão.
  INSERT INTO public.seller_profiles (id) VALUES (v_uid)
  ON CONFLICT (id) DO NOTHING;

  IF p_metodo = 'xpress' THEN
    UPDATE public.seller_profiles SET xpress_dados = p_dados, updated_at = now() WHERE id = v_uid;
  ELSE
    UPDATE public.seller_profiles SET banco_dados = p_dados, updated_at = now() WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'metodo', p_metodo);
END;
$$;

-- ------------------------------------------------------------ 6.4 PEDIR
CREATE OR REPLACE FUNCTION public.solicitar_levantamento(
  p_valor  numeric,
  p_metodo text,
  p_dados  jsonb DEFAULT NULL,
  p_notas  text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_resumo    jsonb;
  v_disponivel numeric;
  v_dados     jsonb;
  v_prov      uuid;
  v_id        uuid;
  v_ref       text;
  v_abertos   int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  -- Um pedido de cada vez por colaborador: dois cliques ao mesmo tempo não
  -- podem reservar o mesmo saldo duas vezes.
  PERFORM pg_advisory_xact_lock(hashtext('levantamento:' || v_uid::text));

  IF NOT public.is_seller() THEN
    RAISE EXCEPTION 'Apenas colaboradores com comissões podem levantar' USING ERRCODE = '42501';
  END IF;

  IF p_metodo NOT IN ('xpress', 'transferencia') THEN
    RAISE EXCEPTION 'Escolha o método de recebimento';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Indique um valor válido';
  END IF;

  v_resumo := public.levantamento_resumo(v_uid);

  IF NOT (v_resumo->>'habilitado')::boolean THEN
    RAISE EXCEPTION 'Faltam % vendas confirmadas e pagas para poder levantar',
      (v_resumo->>'vendas_faltam')::int USING ERRCODE = '42501';
  END IF;

  -- Dados: usa os enviados ou, se não vierem, os que estão guardados.
  v_dados := NULLIF(p_dados, 'null'::jsonb);
  IF v_dados IS NULL OR jsonb_typeof(v_dados) <> 'object' OR v_dados = '{}'::jsonb THEN
    SELECT CASE WHEN p_metodo = 'xpress' THEN sp.xpress_dados ELSE sp.banco_dados END
      INTO v_dados
    FROM public.seller_profiles sp WHERE sp.id = v_uid;
  END IF;

  IF v_dados IS NULL OR jsonb_typeof(v_dados) <> 'object' OR v_dados = '{}'::jsonb THEN
    RAISE EXCEPTION 'Indique os dados de recebimento';
  END IF;

  -- Validação mínima do destino, para não mandar dinheiro para o vazio.
  IF p_metodo = 'xpress' THEN
    IF COALESCE(btrim(v_dados->>'conta'), '') = ''
       AND COALESCE(btrim(v_dados->>'telefone'), '') = '' THEN
      RAISE EXCEPTION 'Indique a conta ou o telefone XPRESS';
    END IF;
  ELSE
    IF COALESCE(btrim(v_dados->>'titular'), '') = ''
       OR COALESCE(btrim(v_dados->>'banco'), '') = ''
       OR COALESCE(btrim(v_dados->>'conta'), '') = '' THEN
      RAISE EXCEPTION 'Indique o titular, o banco e o número de conta';
    END IF;
  END IF;

  v_disponivel := (v_resumo->>'disponivel')::numeric;

  IF p_valor > v_disponivel THEN
    RAISE EXCEPTION 'O valor pedido (%,00 Kz) é superior ao disponível (% Kz)',
      round(p_valor), round(v_disponivel) USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::int INTO v_abertos
  FROM public.levantamentos l
  WHERE l.seller_id = v_uid AND l.estado IN ('pendente', 'aprovado', 'em_processamento');

  IF v_abertos > 0 THEN
    RAISE EXCEPTION 'Já tem um levantamento em curso. Aguarde a decisão da gestão.';
  END IF;

  SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = v_uid;

  v_ref := 'LEV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.levantamento_seq')::text, 5, '0');

  INSERT INTO public.levantamentos (referencia, seller_id, provincia_id, valor, metodo, dados, notas)
  VALUES (v_ref, v_uid, v_prov, round(p_valor, 2), p_metodo, v_dados,
          NULLIF(btrim(COALESCE(p_notas, '')), ''))
  RETURNING id INTO v_id;

  -- Guarda os dados para a próxima vez (o colaborador não os escreve duas vezes).
  IF p_metodo = 'xpress' THEN
    UPDATE public.seller_profiles SET xpress_dados = v_dados, updated_at = now() WHERE id = v_uid;
  ELSE
    UPDATE public.seller_profiles SET banco_dados = v_dados, updated_at = now() WHERE id = v_uid;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, new_data)
  VALUES (v_uid, 'levantamento_pedido', 'levantamentos', v_id,
          jsonb_build_object('valor', round(p_valor, 2), 'metodo', p_metodo, 'referencia', v_ref));

  RETURN jsonb_build_object(
    'id', v_id,
    'referencia', v_ref,
    'valor', round(p_valor, 2),
    'metodo', p_metodo,
    'estado', 'pendente',
    'resumo', public.levantamento_resumo(v_uid)
  );
END;
$$;

-- ------------------------------------------------------- 6.5 DECIDIR
CREATE OR REPLACE FUNCTION public.decidir_levantamento(
  p_id      uuid,
  p_estado  public.levantamento_status,
  p_nota    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_lev    public.levantamentos;
  v_payout uuid;
  v_ok     boolean := false;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode decidir levantamentos' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lev FROM public.levantamentos l WHERE l.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Levantamento inexistente';
  END IF;

  IF NOT public.can_manage_province(v_lev.provincia_id) THEN
    RAISE EXCEPTION 'Só pode gerir levantamentos da província que gere' USING ERRCODE = '42501';
  END IF;

  -- Transições permitidas. Um pedido pago é final; um rejeitado também.
  v_ok := CASE v_lev.estado
            WHEN 'pendente'         THEN p_estado IN ('aprovado', 'rejeitado')
            WHEN 'aprovado'         THEN p_estado IN ('em_processamento', 'rejeitado')
            WHEN 'em_processamento' THEN p_estado IN ('pago', 'rejeitado')
            ELSE false
          END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Não é possível passar de % para %', v_lev.estado, p_estado;
  END IF;

  IF p_estado = 'rejeitado' AND COALESCE(btrim(COALESCE(p_nota, '')), '') = '' THEN
    RAISE EXCEPTION 'Indique o motivo da rejeição';
  END IF;

  -- Marcar como PAGO é o único passo que mexe no dinheiro. Aprovar não paga
  -- nada: só liberta o pedido para processamento.
  IF p_estado = 'pago' THEN
    INSERT INTO public.commission_payouts (seller_id, provincia_id, amount, method, notes, paid_by)
    VALUES (
      v_lev.seller_id,
      v_lev.provincia_id,
      v_lev.valor,
      v_lev.metodo,
      'Levantamento ' || COALESCE(v_lev.referencia, v_lev.id::text),
      auth.uid()
    )
    RETURNING id INTO v_payout;

    -- Fecha as comissões por ordem de antiguidade até cobrir o valor. Uma
    -- comissão maior do que o resto fica pendente e é paga no pedido seguinte.
    WITH pend AS (
      SELECT c.id,
             SUM(c.amount) OVER (ORDER BY c.created_at, c.id) AS acumulado
      FROM public.sale_commissions c
      JOIN public.sales s ON s.id = c.sale_id
      WHERE c.seller_id = v_lev.seller_id
        AND c.status = 'pending'
        AND c.amount > 0
        AND s.status = 'completed'
        AND s.payment_status = 'paid'
    )
    UPDATE public.sale_commissions c
    SET status = 'paid', paid_at = now(), payout_id = v_payout, updated_at = now()
    FROM pend
    WHERE c.id = pend.id AND pend.acumulado <= v_lev.valor;
  END IF;

  UPDATE public.levantamentos l
  SET estado          = p_estado,
      notas           = COALESCE(NULLIF(btrim(COALESCE(p_nota, '')), ''), l.notas),
      motivo_rejeicao = CASE WHEN p_estado = 'rejeitado' THEN btrim(p_nota) ELSE l.motivo_rejeicao END,
      payout_id       = COALESCE(v_payout, l.payout_id),
      decidido_por    = auth.uid(),
      decidido_em     = COALESCE(l.decidido_em, now()),
      processado_em   = CASE WHEN p_estado = 'em_processamento' THEN now() ELSE l.processado_em END,
      pago_em         = CASE WHEN p_estado = 'pago' THEN now() ELSE l.pago_em END,
      updated_at      = now()
  WHERE l.id = p_id;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data, new_data)
  VALUES (auth.uid(), 'levantamento_' || p_estado::text, 'levantamentos', p_id,
          jsonb_build_object('estado', v_lev.estado),
          jsonb_build_object('estado', p_estado, 'valor', v_lev.valor, 'nota', p_nota));

  RETURN jsonb_build_object(
    'id', p_id,
    'estado', p_estado,
    'payout_id', v_payout,
    'resumo', public.levantamento_resumo(v_lev.seller_id)
  );
END;
$$;

-- ------------------------------------------------------- 6.6 CONSULTAS
CREATE OR REPLACE FUNCTION public.meus_levantamentos(p_limite int DEFAULT 50)
RETURNS TABLE (
  id            uuid,
  referencia    text,
  valor         numeric,
  metodo        text,
  estado        public.levantamento_status,
  solicitado_em timestamptz,
  pago_em       timestamptz,
  motivo        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT l.id, l.referencia, l.valor, l.metodo, l.estado,
         l.solicitado_em, l.pago_em,
         COALESCE(l.motivo_rejeicao, l.notas)
  FROM public.levantamentos l
  WHERE l.seller_id = auth.uid()
  ORDER BY l.solicitado_em DESC
  LIMIT GREATEST(COALESCE(p_limite, 50), 1);
$$;

-- Painel da gestão: todos os pedidos, com quem pediu e para onde vai o dinheiro.
CREATE OR REPLACE FUNCTION public.levantamentos_equipa(p_estado text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode ver os levantamentos' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(linha ORDER BY (linha->>'solicitado_em') DESC), '[]'::jsonb)
  INTO v_res
  FROM (
    SELECT jsonb_build_object(
             'id',            l.id,
             'referencia',    l.referencia,
             'valor',         l.valor,
             'metodo',        l.metodo,
             'estado',        l.estado,
             'dados',         l.dados,
             'notas',         l.notas,
             'motivo',        l.motivo_rejeicao,
             'solicitado_em', l.solicitado_em,
             'pago_em',       l.pago_em,
             'seller_id',     l.seller_id,
             'seller_nome',   p.full_name,
             'seller_ref',    p.referencia,
             'seller_phone',  p.phone,
             'provincia',     pr.nome
           ) AS linha
    FROM public.levantamentos l
    JOIN public.profiles p   ON p.id  = l.seller_id
    LEFT JOIN public.provincias pr ON pr.id = l.provincia_id
    WHERE public.can_manage_province(l.provincia_id)
      AND (p_estado IS NULL OR l.estado::text = p_estado)
  ) t;

  RETURN v_res;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. `pagar_comissoes` PASSA A RESPEITAR VENDAS NÃO PAGAS
-- -----------------------------------------------------------------------------
-- Antes pagava qualquer comissão pendente, mesmo de uma venda por receber.
-- O requisito é claro: só contam vendas confirmadas e pagas.
CREATE OR REPLACE FUNCTION public.pagar_comissoes(
  p_seller_id uuid,
  p_method    text DEFAULT NULL,
  p_notes     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov   uuid;
  v_total  numeric(12,2);
  v_payout uuid;
  v_qtd    int;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode pagar comissões' USING ERRCODE = '42501';
  END IF;

  SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = p_seller_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador inexistente';
  END IF;
  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Só pode pagar comissões da província que gere' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(c.amount), 0), COUNT(*)
    INTO v_total, v_qtd
  FROM public.sale_commissions c
  JOIN public.sales s ON s.id = c.sale_id
  WHERE c.seller_id = p_seller_id
    AND c.status = 'pending'
    AND c.amount > 0
    AND s.status = 'completed'
    AND s.payment_status = 'paid';

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Não há comissões pendentes';
  END IF;

  INSERT INTO public.commission_payouts (seller_id, provincia_id, amount, method, notes, paid_by)
  VALUES (p_seller_id, v_prov, v_total, p_method, p_notes, auth.uid())
  RETURNING id INTO v_payout;

  UPDATE public.sale_commissions c
  SET status = 'paid', paid_at = now(), payout_id = v_payout, updated_at = now()
  FROM public.sales s
  WHERE s.id = c.sale_id
    AND c.seller_id = p_seller_id
    AND c.status = 'pending'
    AND c.amount > 0
    AND s.status = 'completed'
    AND s.payment_status = 'paid';

  RETURN jsonb_build_object('payout_id', v_payout, 'amount', v_total, 'comissoes', v_qtd);
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. `place_order` COBRA O PREÇO DA PROMOÇÃO DA PROVÍNCIA
-- -----------------------------------------------------------------------------
-- Antes lia `products.official_price` directamente. Passa a usar
-- `preco_efetivo()`, que já tem em conta as campanhas da província do cliente.
CREATE OR REPLACE FUNCTION public.place_order(
  p_items            jsonb,
  p_delivery_method  text DEFAULT 'pickup',
  p_delivery_address text DEFAULT NULL,
  p_contact_phone    text DEFAULT NULL,
  p_notes            text DEFAULT NULL,
  p_client_ref       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_order_id uuid;
  v_ref      text;
  v_item     jsonb;
  v_prod     record;
  v_inv      record;
  v_prov     uuid;
  v_qty      int;
  v_price    numeric(12,2);
  v_total    numeric(12,2) := 0;
  v_taxa     numeric(12,2);
  v_pendente boolean := false;
  v_existing public.orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_customer() THEN
    RAISE EXCEPTION 'Apenas clientes podem criar encomendas' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'O carrinho está vazio';
  END IF;

  IF p_delivery_method NOT IN ('pickup', 'delivery') THEN
    RAISE EXCEPTION 'Modalidade de entrega inválida';
  END IF;

  IF p_delivery_method = 'delivery' AND COALESCE(btrim(p_delivery_address), '') = '' THEN
    RAISE EXCEPTION 'Indique o endereço de entrega';
  END IF;

  IF p_client_ref IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.orders o
    WHERE o.customer_id = v_uid AND o.client_ref = p_client_ref;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id', v_existing.id,
        'reference', v_existing.reference,
        'total', v_existing.total_amount,
        'delivery_fee', v_existing.delivery_fee,
        'delivery_fee_pendente', v_existing.delivery_fee_pendente,
        'duplicated', true
      );
    END IF;
  END IF;

  v_ref := public.generate_order_reference();
  v_prov := public.my_province();

  -- Levantamento na delegação não paga entrega. Só a entrega ao domicílio
  -- paga — e só quando a província tem taxa definida. NULL = por definir.
  IF p_delivery_method = 'delivery' THEN
    v_taxa := public.taxa_entrega(v_prov);
    IF v_taxa IS NULL THEN
      v_taxa := 0;
      v_pendente := true;
    END IF;
  ELSE
    v_taxa := 0;
  END IF;

  INSERT INTO public.orders (
    reference, client_ref, customer_id, status, delivery_method,
    delivery_address, contact_phone, notes, payment_status, provincia_id,
    delivery_fee, delivery_fee_pendente
  )
  VALUES (
    v_ref, p_client_ref, v_uid, 'pending', p_delivery_method,
    NULLIF(btrim(p_delivery_address), ''), NULLIF(btrim(p_contact_phone), ''),
    NULLIF(btrim(p_notes), ''), 'pending', v_prov,
    v_taxa, v_pendente
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida';
    END IF;

    SELECT p.id, p.name, p.official_price, p.promotional_price, p.is_active, p.provincia_id
      INTO v_prod
    FROM public.products p
    WHERE p.id = (v_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto inexistente';
    END IF;

    IF NOT v_prod.is_active THEN
      RAISE EXCEPTION 'Produto indisponível: %', v_prod.name;
    END IF;

    -- Produto provincial só se vende na sua província.
    IF v_prod.provincia_id IS NOT NULL AND v_prod.provincia_id IS DISTINCT FROM v_prov THEN
      RAISE EXCEPTION 'O produto % não está disponível na sua província', v_prod.name
        USING ERRCODE = '42501';
    END IF;

    -- O preço é o da promoção que se aplica à província do cliente. A regra
    -- vive em `preco_efetivo()`; aqui não se repete.
    v_price := public.preco_efetivo(v_prod.id, v_prov);

    -- Linha de stock: a da província do cliente; se não existir, a da sede.
    SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
    FROM public.inventory i
    WHERE i.product_id = v_prod.id
      AND i.provincia_id IS NOT DISTINCT FROM v_prov
    LIMIT 1;

    IF NOT FOUND AND v_prov IS NOT NULL THEN
      SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_prod.id AND i.provincia_id IS NULL
      LIMIT 1;
    END IF;

    -- Última tentativa: o armazém-sede.
    IF v_inv.id IS NULL THEN
      SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
      FROM public.inventory i
      JOIN public.provincias pr ON pr.id = i.provincia_id
      WHERE i.product_id = v_prod.id AND pr.is_default
      ORDER BY i.updated_at DESC
      LIMIT 1;
    END IF;

    IF v_inv.id IS NOT NULL THEN
      UPDATE public.inventory i
      SET reserved_quantity = i.reserved_quantity + v_qty,
          updated_at = now()
      WHERE i.id = v_inv.id
        AND (i.quantity - i.reserved_quantity) >= v_qty;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente para %', v_prod.name;
      END IF;
    END IF;

    INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price)
    VALUES (v_order_id, v_prod.id, v_prod.name, v_qty, v_price, round(v_price * v_qty, 2));
  END LOOP;

  -- `recalc_order_total` já correu a cada linha e somou a taxa; este SELECT
  -- só serve para devolver ao cliente o mesmo número que ficou gravado.
  SELECT COALESCE(o.total_amount, 0) INTO v_total
  FROM public.orders o WHERE o.id = v_order_id;

  INSERT INTO public.order_status_history (order_id, status, previous_status, changed_by, notes)
  VALUES (v_order_id, 'pending', NULL, v_uid, 'Encomenda criada');

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'reference', v_ref,
    'total', v_total,
    'delivery_fee', v_taxa,
    'delivery_fee_pendente', v_pendente,
    'duplicated', false
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. RLS E ACESSOS
-- -----------------------------------------------------------------------------
ALTER TABLE public.promocoes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocao_provincias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocao_produtos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.levantamentos       ENABLE ROW LEVEL SECURITY;

-- Promoções: toda a gente lê as que estão a decorrer; a gestão lê tudo.
DROP POLICY IF EXISTS promocoes_select ON public.promocoes;
CREATE POLICY promocoes_select ON public.promocoes
  FOR SELECT TO authenticated, anon
  USING (
    (ativo AND starts_at <= now() AND (ends_at IS NULL OR ends_at >= now()))
    OR public.is_manager()
  );

DROP POLICY IF EXISTS promocoes_manager_write ON public.promocoes;
CREATE POLICY promocoes_manager_write ON public.promocoes
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS promocao_provincias_select ON public.promocao_provincias;
CREATE POLICY promocao_provincias_select ON public.promocao_provincias
  FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS promocao_provincias_manager_write ON public.promocao_provincias;
CREATE POLICY promocao_provincias_manager_write ON public.promocao_provincias
  FOR ALL TO authenticated
  USING (public.is_manager()) WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS promocao_produtos_select ON public.promocao_produtos;
CREATE POLICY promocao_produtos_select ON public.promocao_produtos
  FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS promocao_produtos_manager_write ON public.promocao_produtos;
CREATE POLICY promocao_produtos_manager_write ON public.promocao_produtos
  FOR ALL TO authenticated
  USING (public.is_manager()) WITH CHECK (public.is_manager());

-- Levantamentos: o colaborador vê os seus; a gestão vê os da sua província.
-- Não há INSERT/UPDATE directo: só pelas funções acima, que validam o saldo.
DROP POLICY IF EXISTS levantamentos_select ON public.levantamentos;
CREATE POLICY levantamentos_select ON public.levantamentos
  FOR SELECT TO authenticated
  USING (
    seller_id = auth.uid()
    OR (public.is_manager() AND public.can_see_province(provincia_id))
  );

GRANT SELECT ON public.promocoes           TO anon, authenticated;
GRANT SELECT ON public.promocao_provincias TO anon, authenticated;
GRANT SELECT ON public.promocao_produtos   TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.promocao_do_produto(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preco_efetivo(uuid, uuid)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promocoes_vigentes(uuid)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promocoes_lista()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_promocao(text, text, numeric, timestamptz, timestamptz, uuid[], uuid[], text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_promocao(uuid, text, text, numeric, timestamptz, timestamptz, uuid[], uuid[], text, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_promocao(uuid)         TO authenticated;

GRANT EXECUTE ON FUNCTION public.taxa_entrega(uuid)              TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.minha_entrega()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.levantamento_resumo(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.minhas_comissoes(int)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.meus_levantamentos(int)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.levantamentos_equipa(text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.dados_recebimento()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_dados_recebimento(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.solicitar_levantamento(numeric, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decidir_levantamento(uuid, public.levantamento_status, text) TO authenticated;

-- Os dados bancários não saem para ninguém além do próprio e da gestão:
-- `seller_profiles` já tem essa política desde a 0001, mas reforça-se aqui a
-- coluna, que é a mais sensível da tabela.
COMMENT ON COLUMN public.seller_profiles.banco_dados IS
  'Coordenadas bancárias do colaborador para levantamentos. Visível só ao próprio e à gestão (RLS de seller_profiles).';
COMMENT ON COLUMN public.seller_profiles.xpress_dados IS
  'Conta/telefone XPRESS do colaborador para levantamentos. Visível só ao próprio e à gestão.';
