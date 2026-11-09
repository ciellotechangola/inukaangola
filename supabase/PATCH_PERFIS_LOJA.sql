-- =============================================================================
--  INUKA ANGOLA — PATCH: PERFIS, VENDEDOR DE LOJA, ELIMINAÇÃO E FEED
-- =============================================================================
--  Supabase -> SQL Editor -> New query -> colar tudo -> RUN
--  Idempotente. Pode ser executado mais do que uma vez sem perder dados.
--  Equivale à migração 0013_perfis_loja.sql (mesmo conteúdo).
--
--  O QUE RESOLVE
--    1. Cria o perfil «vendedor de loja» (store_seller): stock da província,
--       venda ao balcão e encomendas. Sem carteira de clientes e sem comissão.
--    2. Fecha a separação de competências nas políticas de acesso.
--    3. Permite eliminar um produto mesmo que já esteja em encomendas ou
--       vendas: o histórico fica com o nome e o preço, sem ligação ao catálogo.
--    4. O feed de notícias do cliente passa a incluir os comunicados da gestão.
--    5. Corrige a conclusão de encomendas para mexer no stock da província
--       certa (antes actualizava todas as províncias).
--
--  NOTA: a primeira instrução acrescenta um valor ao tipo `user_role`. Se o
--  editor recusar («ALTER TYPE ... ADD VALUE cannot run inside a transaction
--  block»), execute essa linha sozinha e depois corra o resto do ficheiro.
-- =============================================================================

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
