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
