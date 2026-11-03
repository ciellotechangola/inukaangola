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
