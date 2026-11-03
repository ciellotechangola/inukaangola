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
