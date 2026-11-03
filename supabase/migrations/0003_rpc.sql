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
