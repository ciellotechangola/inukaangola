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
