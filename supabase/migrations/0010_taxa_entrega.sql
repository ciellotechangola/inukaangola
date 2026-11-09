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
