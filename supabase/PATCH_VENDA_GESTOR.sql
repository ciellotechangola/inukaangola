-- =============================================================================
--  INUKA ANGOLA — PATCH: A GESTÃO REGISTA VENDAS (COM OU SEM COLABORADOR)
-- =============================================================================
--  Supabase -> SQL Editor -> New query -> colar tudo -> RUN
--  Idempotente. Pode ser executado mais do que uma vez sem perder dados.
--  Equivale à migração 0020_venda_do_gestor.sql (mesmo conteúdo).
--
--  O QUE RESOLVE
--    A gestão passa a poder escolher o colaborador de cada venda que regista.
--    Sem escolha, a venda fica com quem a registou (como sempre). Com escolha,
--    a comissão, a carteira do cliente e a reserva do telefone vão para esse
--    colaborador — e um gestor provincial só atribui dentro da sua província.
--
--  Sem este patch a gestão regista vendas, mas sempre em nome próprio, e o
--  colaborador que vendeu não recebe a comissão.

-- =============================================================================
-- 0020 — A GESTÃO REGISTA VENDAS, COM OU SEM COLABORADOR
-- =============================================================================
-- Um gestor já conseguia registar uma venda: `is_seller()` inclui o papel
-- `manager` desde a 0001. O que não conseguia era **atribuí-la a outra
-- pessoa** — `register_sale` escrevia sempre `seller_id = auth.uid()`. Na
-- prática, uma venda feita ao balcão da gestão em nome de um colaborador ficava
-- com a comissão do gestor, que não tem taxa nenhuma, e o colaborador não
-- recebia o que lhe competia.
--
-- O que muda:
--
--   1. `register_sale` ganha `p_seller_id` (sétimo argumento, com omissão
--      nula). Nulo = fica com quem registou, como sempre foi. Preenchido = a
--      venda é de quem ali está, com a comissão dele.
--   2. Só a gestão pode escolher outra pessoa; um colaborador que mande o id
--      de outro leva 42501. O alvo tem de ser um colaborador **activo** com
--      ficha em `seller_profiles`, e um gestor provincial só atribui dentro da
--      sua província.
--   3. `register_sale_by_phone` passa o mesmo `p_seller_id`. A carteira e a
--      reserva do telefone vão para o colaborador escolhido — é ele que fica
--      com o cliente, não quem carregou no botão.
--
-- `inventory_movements.created_by` continua a ser quem registou: a mercadoria
-- saiu com essa pessoa à frente, mesmo que a venda conte para outra.
--
-- A assinatura muda (sete argumentos em vez de seis), por isso a função antiga
-- tem de sair — `CREATE OR REPLACE` criava uma segunda ao lado e as chamadas
-- passavam a ser ambíguas.
-- =============================================================================

DROP FUNCTION IF EXISTS public.register_sale(jsonb, uuid, text, public.payment_status, text, text);

CREATE OR REPLACE FUNCTION public.register_sale(
  p_items          jsonb,
  p_customer_id    uuid DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_payment_status public.payment_status DEFAULT 'pending',
  p_notes          text DEFAULT NULL,
  p_client_ref     text DEFAULT NULL,
  p_seller_id      uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_seller   uuid;
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

  -- Quem fica com a venda. Sem escolha, é quem registou — o comportamento de
  -- sempre, que o colaborador e a app continuam a usar sem mudar nada.
  v_seller := COALESCE(p_seller_id, v_uid);

  IF v_seller <> v_uid THEN
    IF NOT public.is_manager() THEN
      RAISE EXCEPTION 'Só a gestão regista vendas em nome de outra pessoa'
        USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.seller_profiles sp
      JOIN public.profiles p ON p.id = sp.id
      WHERE sp.id = v_seller
        AND p.is_active
    ) THEN
      RAISE EXCEPTION 'Esse colaborador não existe ou está inactivo'
        USING ERRCODE = '22023';
    END IF;

    -- Um gestor provincial só atribui a quem é da sua província: a venda entra
    -- nos indicadores dela, e não se mexe no que não é seu.
    IF NOT public.is_national()
       AND public.my_province() IS NOT NULL
       AND (SELECT p.provincia_id FROM public.profiles p WHERE p.id = v_seller)
           IS DISTINCT FROM public.my_province() THEN
      RAISE EXCEPTION 'Esse colaborador não é da sua província' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Nenhum produto indicado';
  END IF;

  IF p_customer_id IS NOT NULL
     AND NOT public.is_manager()
     AND NOT public.is_my_customer(p_customer_id) THEN
    RAISE EXCEPTION 'Cliente não associado a este vendedor' USING ERRCODE = '42501';
  END IF;

  -- Idempotência por par (colaborador, referência do cliente): o mesmo toque
  -- duplo não cobra duas vezes. Passa a ser o colaborador da venda, e não quem
  -- registou, senão a gestão duplicava vendas que o colaborador já tinha.
  IF p_client_ref IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.sales s
    WHERE s.seller_id = v_seller AND s.client_ref = p_client_ref;

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

  -- A administração nacional não tem província no perfil, e uma venda tem de
  -- sair de algum sítio. Usa-se a sede, como nas encomendas de clientes sem
  -- província — sem isto, a venda de um gestor nacional não mexia no stock.
  IF v_prov IS NULL AND public.is_manager() THEN
    SELECT pr.id INTO v_prov FROM public.provincias pr WHERE pr.is_default LIMIT 1;
  END IF;

  INSERT INTO public.sales (
    reference, client_ref, seller_id, customer_id, payment_method,
    payment_status, notes, is_offline, sync_status, provincia_id
  )
  VALUES (
    v_ref, p_client_ref, v_seller, p_customer_id,
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
    'duplicated', false,
    'seller_id', v_seller
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. VENDA COM TELEFONE: A CARTEIRA VAI PARA QUEM VENDEU
-- -----------------------------------------------------------------------------
-- A assinatura ganha o oitavo argumento, por isso a função antiga sai primeiro
-- (mesma razão da `register_sale`: `CREATE OR REPLACE` com assinatura diferente
-- criava uma segunda função ao lado).
DROP FUNCTION IF EXISTS public.register_sale_by_phone(jsonb, text, text, public.payment_status, text, text, text);

CREATE OR REPLACE FUNCTION public.register_sale_by_phone(
  p_items          jsonb,
  p_customer_phone text,
  p_payment_method text DEFAULT NULL,
  p_payment_status public.payment_status DEFAULT 'pending',
  p_notes          text DEFAULT NULL,
  p_client_ref     text DEFAULT NULL,
  p_customer_name  text DEFAULT NULL,
  p_seller_id      uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_seller      uuid := COALESCE(p_seller_id, auth.uid());
  v_phone       text;
  v_nome        text := NULLIF(btrim(COALESCE(p_customer_name, '')), '');
  v_cliente     uuid;
  v_carteira    jsonb;
  v_sale        jsonb;
  v_sale_id     uuid;
  v_reservado   boolean := false;
  v_conquistado boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_seller() THEN
    RAISE EXCEPTION 'Apenas vendedores podem registar vendas' USING ERRCODE = '42501';
  END IF;

  -- Quem fica com o cliente é o colaborador da venda, não quem carregou no
  -- botão: a carteira, a reserva e a comissão têm de ser todas da mesma pessoa.
  IF v_seller <> v_uid AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão regista vendas em nome de outra pessoa'
      USING ERRCODE = '42501';
  END IF;

  v_phone := public.normalize_phone(p_customer_phone);
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Telefone inválido. Use o formato +244 9xx xxx xxx'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.id INTO v_cliente FROM public.profiles p WHERE p.phone = v_phone;

  IF v_cliente IS NOT NULL THEN
    -- O vínculo tem de existir **antes** da venda: `register_sale` recusa um
    -- `customer_id` que ainda não esteja na carteira de quem vende.
    v_carteira := public.garantir_cliente_na_carteira(v_cliente, v_seller);

    IF NOT (v_carteira->>'ok')::boolean THEN
      RAISE EXCEPTION '%', COALESCE(
        v_carteira->>'message',
        'Este cliente já está associado a outro colaborador.'
      ) USING ERRCODE = '42501';
    END IF;

    v_conquistado := true;
  END IF;

  v_sale := public.register_sale(
    p_items, v_cliente, p_payment_method, p_payment_status, p_notes, p_client_ref, v_seller
  );

  v_sale_id := (v_sale->>'sale_id')::uuid;

  -- O telefone fica na venda nos dois casos: é o que liga a compra à pessoa
  -- mesmo que o `customer_id` falte por algum motivo.
  UPDATE public.sales s
  SET customer_phone = v_phone, updated_at = now()
  WHERE s.id = v_sale_id;

  IF v_cliente IS NOT NULL THEN
    -- Havia uma reserva antiga com este número (o cliente era uma promessa e
    -- já abriu conta)? Fecha-se aqui. O erro é engolido de propósito: a venda
    -- já está gravada e uma reserva que fique aberta resolve-se no próximo
    -- registo, ao passo que perder a venda não se resolve.
    BEGIN
      PERFORM public.ligar_reserva_ao_cliente(v_cliente);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  ELSE
    -- Conta por abrir: reserva-se o número para o colaborador da venda, já com
    -- o nome que ele escreveu. Se o número já estiver reservado por outro, não
    -- se lhe toca — a exclusividade vale também para quem ainda não tem conta.
    INSERT INTO public.reserved_customers (
      seller_id, created_by, full_name, phone, provincia_id, status
    )
    VALUES (v_seller, v_uid, v_nome, v_phone, public.my_province(), 'reservado')
    ON CONFLICT (phone) DO UPDATE
      SET full_name = COALESCE(reserved_customers.full_name, EXCLUDED.full_name)
      WHERE reserved_customers.seller_id = v_seller;

    SELECT EXISTS (
      SELECT 1 FROM public.reserved_customers r
      WHERE r.phone = v_phone AND r.seller_id = v_seller AND r.status = 'reservado'
    ) INTO v_reservado;
  END IF;

  RETURN v_sale || jsonb_build_object(
    'customer_phone', v_phone,
    'customer_id', v_cliente,
    'customer_name', v_nome,
    'conquistado', v_conquistado,
    'reservado', v_reservado,
    'carteira', v_carteira
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. PERMISSÕES
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.register_sale(jsonb, uuid, text, public.payment_status, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_sale_by_phone(jsonb, text, text, public.payment_status, text, text, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.register_sale(jsonb, uuid, text, public.payment_status, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_sale_by_phone(jsonb, text, text, public.payment_status, text, text, text, uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. CONFERÊNCIA
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'register_sale'
      AND pg_get_function_identity_arguments(p.oid)
          = 'p_items jsonb, p_customer_id uuid, p_payment_method text, p_payment_status payment_status, p_notes text, p_client_ref text, p_seller_id uuid'
  ) THEN
    RAISE EXCEPTION '0020: register_sale não ficou com a assinatura de sete argumentos';
  END IF;
END $$;
