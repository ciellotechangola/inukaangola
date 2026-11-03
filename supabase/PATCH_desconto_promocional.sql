-- ============================================================
-- PATCH 2026-10-26 — decide_discount: limite sobre o preço ATUAL
--
-- PROBLEMA: request_discount validava o pedido contra o preço atual
-- (promocional, se existir), mas decide_discount recalculava o limite
-- sobre official_price. Num produto com promoção, um desconto pequeno
-- (ex.: 10% sobre o preço promocional) passava a representar >20%
-- sobre o preço oficial e a aprovação era recusada.
--
-- Cole este ficheiro no SQL Editor do Supabase. É idempotente.
-- ============================================================

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

GRANT EXECUTE ON FUNCTION public.decide_discount(uuid, boolean, numeric) TO authenticated;
