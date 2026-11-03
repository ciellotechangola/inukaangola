-- =============================================================================
--  INUKA ANGOLA — PATCH ÚNICO: APLICAR TUDO O QUE FALTA NA BASE DE DADOS
-- =============================================================================
--  COMO USAR
--    1. Supabase -> SQL Editor -> New query
--    2. Colar TODO este ficheiro
--    3. RUN  (pode demorar alguns segundos)
--
--  O QUE APLICA
--    PARTE 1 — Correções de 2026-10-31 (5 defeitos reais, um deles de segurança)
--              * verificação de permissões à prova de NULL em update_order_status
--                e cancel_reservation (antes, qualquer autenticado podia alterar
--                encomendas e reservas alheias)
--              * histórico inicial da encomenda em place_order
--              * limite de desconto validado no pedido (não só na decisão)
--              * ON DELETE SET NULL em products/inventory_movements
--              * profiles_select passa a mostrar o interlocutor do chat
--    PARTE 2 — Estúdio de design (5 tabelas, 9 funções, bucket design-assets)
--              design_projects, design_templates, design_assets,
--              design_versions (histórico), designer_preferences
--
--  É IDEMPOTENTE: pode correr sobre a base atual sem apagar dados.
--  Se já colou os dois patches em separado, correr isto não estraga nada.
-- =============================================================================


-- ############################################################################
-- ##  PARTE 1 de 2 — CORREÇÕES
-- ############################################################################
-- =============================================================================
--  INUKA ANGOLA — PATCH DE CORREÇÕES (2026-10-31)
-- =============================================================================
--  Aplicar a uma base JÁ criada com SETUP_COMPLETO.sql.
--  Cole este ficheiro inteiro no SQL Editor do Supabase e clique em RUN.
--  É idempotente: pode ser executado mais do que uma vez.
--
--  CORREÇÕES
--  1. update_order_status / cancel_reservation
--     NOT (is_manager OR seller_id = uid OR customer_id = uid) com seller_id
--     NULL avaliava a NULL e o IF não disparava: qualquer utilizador
--     autenticado podia alterar encomendas e cancelar reservas de terceiros.
--     Passa a usar COALESCE(..., false).
--  2. place_order
--     O histórico de estados não registava a entrada inicial "pending"
--     (o trigger só dispara em UPDATE). O rasto da encomenda começava no
--     segundo estado.
--  3. request_discount
--     Não validava o limite comercial configurado — o cliente podia submeter
--     valores impossíveis e só descobria na decisão da gerência.
--  4. products.created_by / updated_by e inventory_movements.created_by
--     Sem ON DELETE SET NULL, qualquer conta que tivesse criado um produto ou
--     um movimento de stock nunca podia ser apagada.
--  5. profiles_select
--     Quem partilha uma conversa não conseguia ler o nome do interlocutor:
--     o chat mostrava conversas sem nome.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FUNÇÕES CORRIGIDAS
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

GRANT EXECUTE ON FUNCTION public.place_order(jsonb, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_status(uuid, public.order_status, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_reservation(uuid)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_discount(uuid, numeric, text)                 TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. CHAVES ESTRANGEIRAS — permitir apagar contas sem perder histórico
-- -----------------------------------------------------------------------------
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_created_by_fkey;
ALTER TABLE public.products ADD CONSTRAINT products_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_updated_by_fkey;
ALTER TABLE public.products ADD CONSTRAINT products_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_created_by_fkey;
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 3. PERFIS — nome do interlocutor visível dentro de uma conversa partilhada
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    profiles.id = auth.uid()
    OR public.is_manager()
    OR (public.is_seller() AND public.is_my_customer(profiles.id))
    OR EXISTS (
      SELECT 1
      FROM public.conversation_members me
      JOIN public.conversation_members outro
        ON outro.conversation_id = me.conversation_id
      WHERE me.user_id = auth.uid()
        AND outro.user_id = profiles.id
    )
  );



-- ############################################################################
-- ##  PARTE 2 de 2 — ESTÚDIO DE DESIGN
-- ############################################################################
-- =============================================================================
--  INUKA ANGOLA — PATCH: ESTÚDIO DE DESIGN
-- =============================================================================
--  Supabase -> SQL Editor -> New query -> colar tudo -> RUN
--  Idempotente. 5 tabelas, 10 políticas RLS (+4 no Storage), 9 funções, 1 bucket.
--  Equivale à migração 0004_designer.sql.
-- =============================================================================


-- =============================================================================
-- PARTE ÚNICA — DESIGNER (estúdio de design)
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
