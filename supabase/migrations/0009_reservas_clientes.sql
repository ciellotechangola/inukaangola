-- =============================================================================
--  INUKA ANGOLA — PARTE 9
--  RESERVA DE CLIENTES
-- =============================================================================
--  O QUE MUDA E PORQUÊ
--
--  Até aqui, o colaborador que acrescentava alguém à carteira criava uma conta
--  de utilizador com uma palavra-passe provisória (`INUKA######`). Isso tem
--  três problemas:
--
--   1. A pessoa nunca pediu conta nenhuma. Ficava com um acesso que não
--      controla e com uma palavra-passe que circula por telefone.
--   2. Quem cria a conta é o colaborador, mas quem a usa é o cliente — e o
--      cliente não escolhe a palavra-passe, não confirma o número e não sabe
--      que a conta existe até alguém lhe dizer.
--   3. As compras feitas antes do registo ficavam sem dono: `sales.customer_id`
--      só aceita contas existentes.
--
--  A partir daqui, o colaborador **reserva** o cliente: guarda nome, telefone,
--  bairro e província, sem tocar em `auth.users`. Quando a pessoa se regista
--  com esse número, `ligar_reserva_ao_cliente` faz o resto — vincula a carteira
--  e entrega-lhe as vendas que já tinham sido registadas com o seu telefone.
--
--  Nenhuma conta é criada por quem não é o próprio.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. CLIENTES RESERVADOS (por activar)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reserved_customers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Fica nulo quando a reserva nasce de uma venda a um telefone desconhecido:
  -- o nome verdadeiro só aparece quando o cliente se registar.
  full_name    text,
  phone        text NOT NULL UNIQUE,
  neighborhood text,
  provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  notes        text,
  status       text NOT NULL DEFAULT 'reservado',
  customer_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  linked_at    timestamptz,
  CONSTRAINT reserved_customers_status_check
    CHECK (status IN ('reservado', 'ligado', 'cancelado', 'conflito')),
  CONSTRAINT reserved_customers_phone_format
    CHECK (phone ~ '^\+244[0-9]{9}$')
);

CREATE INDEX IF NOT EXISTS reserved_customers_seller_idx
  ON public.reserved_customers (seller_id, status);

CREATE INDEX IF NOT EXISTS reserved_customers_phone_idx
  ON public.reserved_customers (phone);


-- -----------------------------------------------------------------------------
-- 2. VENDA COM TELEFONE MAS SEM CONTA
-- -----------------------------------------------------------------------------
--  `sales.customer_id` referencia `auth.users`: não aceita um telefone. Esta
--  coluna guarda o número de quem comprou antes de ter conta, para que a venda
--  possa ser entregue mais tarde, no registo.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_phone text;

CREATE INDEX IF NOT EXISTS sales_customer_phone_idx
  ON public.sales (customer_phone)
  WHERE customer_phone IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 3. RLS — reservas
-- -----------------------------------------------------------------------------
ALTER TABLE public.reserved_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reserved_customers_select ON public.reserved_customers;
CREATE POLICY reserved_customers_select ON public.reserved_customers
  FOR SELECT TO authenticated
  USING (reserved_customers.seller_id = auth.uid() OR public.is_manager());

DROP POLICY IF EXISTS reserved_customers_insert ON public.reserved_customers;
CREATE POLICY reserved_customers_insert ON public.reserved_customers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_manager()
    OR (reserved_customers.seller_id = auth.uid() AND public.is_seller())
  );

DROP POLICY IF EXISTS reserved_customers_update ON public.reserved_customers;
CREATE POLICY reserved_customers_update ON public.reserved_customers
  FOR UPDATE TO authenticated
  USING (reserved_customers.seller_id = auth.uid() OR public.is_manager())
  WITH CHECK (reserved_customers.seller_id = auth.uid() OR public.is_manager());

DROP POLICY IF EXISTS reserved_customers_delete ON public.reserved_customers;
CREATE POLICY reserved_customers_delete ON public.reserved_customers
  FOR DELETE TO authenticated
  USING (reserved_customers.seller_id = auth.uid() OR public.is_manager());


-- -----------------------------------------------------------------------------
-- 4. REGISTAR VENDA COM TELEFONE
-- -----------------------------------------------------------------------------
--  Não repete a lógica de stock, preço e comissão: chama `register_sale` e
--  limita-se a gravar o telefone na venda que ela acabou de criar. Assim há um
--  único sítio onde o stock é validado e descontado.
CREATE OR REPLACE FUNCTION public.register_sale_by_phone(
  p_items          jsonb,
  p_customer_phone text,
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
  v_uid       uuid := auth.uid();
  v_phone     text;
  v_sale      jsonb;
  v_sale_id   uuid;
  v_reservado boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_seller() THEN
    RAISE EXCEPTION 'Apenas vendedores podem registar vendas' USING ERRCODE = '42501';
  END IF;

  v_phone := public.normalize_phone(p_customer_phone);
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Telefone inválido. Use o formato +244 9xx xxx xxx'
      USING ERRCODE = '22023';
  END IF;

  -- Uma conta que já exista não passa por aqui: o chamador usa
  -- `link_customer_by_phone` e `register_sale` com o `customer_id`.
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.phone = v_phone) THEN
    RAISE EXCEPTION 'Este telefone já tem conta. Associe o cliente antes de registar a venda.'
      USING ERRCODE = '23505';
  END IF;

  v_sale := public.register_sale(
    p_items, NULL, p_payment_method, p_payment_status, p_notes, p_client_ref
  );

  v_sale_id := (v_sale->>'sale_id')::uuid;

  -- Numa venda duplicada a linha já tem telefone; reescrever é inofensivo.
  UPDATE public.sales s
  SET customer_phone = v_phone, updated_at = now()
  WHERE s.id = v_sale_id;

  -- Reserva automática: quem vende a um telefone desconhecido fica com o
  -- cliente na carteira, à espera do registo. `DO NOTHING` respeita uma reserva
  -- que já exista (de outro colaborador, por exemplo).
  IF NOT EXISTS (
    SELECT 1 FROM public.reserved_customers r WHERE r.phone = v_phone
  ) THEN
    INSERT INTO public.reserved_customers (
      seller_id, created_by, full_name, phone, provincia_id, status
    )
    VALUES (v_uid, v_uid, NULL, v_phone, public.my_province(), 'reservado')
    ON CONFLICT (phone) DO NOTHING;
    v_reservado := true;
  END IF;

  RETURN v_sale || jsonb_build_object(
    'customer_phone', v_phone,
    'reservado', v_reservado
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 5. LIGAR A RESERVA QUANDO O CLIENTE SE REGISTA
-- -----------------------------------------------------------------------------
--  Idempotente: pode correr duas vezes sem duplicar vínculos nem vendas.
--  Chamada no fim de `/api/auth/registo` e sempre que um colaborador associa
--  uma conta que já existe.
CREATE OR REPLACE FUNCTION public.ligar_reserva_ao_cliente(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_phone    text;
  v_res      public.reserved_customers;
  v_vendas   int := 0;
  v_ligados  int := 0;
  v_carteira int := 0;
  v_conflito int := 0;
  v_tocado   int := 0;
  v_uid      uuid := auth.uid();
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sem_cliente');
  END IF;

  -- Só o próprio, a gestão, ou o servidor (auth.uid() nulo) podem pedir a
  -- ligação. Sem isto, qualquer sessão autenticada podia passar o uuid de
  -- outra pessoa e fechar-lhe a reserva.
  IF v_uid IS NOT NULL AND v_uid <> p_customer_id AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'Sem permissão para ligar reservas deste cliente' USING ERRCODE = '42501';
  END IF;

  SELECT public.normalize_phone(p.phone) INTO v_phone
  FROM public.profiles p WHERE p.id = p_customer_id;

  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'sem_telefone');
  END IF;

  -- 5.1 Vendas registadas com este telefone passam a ter dono.
  WITH actualizadas AS (
    UPDATE public.sales s
    SET customer_id = p_customer_id, updated_at = now()
    WHERE s.customer_id IS NULL
      AND public.normalize_phone(s.customer_phone) = v_phone
    RETURNING 1
  )
  SELECT count(*) INTO v_vendas FROM actualizadas;

  -- 5.2 Reservas: vínculo com a carteira e fecho da reserva.
  FOR v_res IN
    SELECT * FROM public.reserved_customers r
    WHERE r.phone = v_phone AND r.status = 'reservado'
  LOOP
    -- Um cliente só pode estar na carteira de um colaborador. Se já estiver
    -- noutra, a reserva fecha como conflito e a transferência é da gestão.
    IF EXISTS (
      SELECT 1 FROM public.seller_customers sc
      WHERE sc.customer_id = p_customer_id
        AND sc.is_active = true
        AND sc.seller_id <> v_res.seller_id
    ) THEN
      UPDATE public.reserved_customers
      SET status = 'conflito', customer_id = p_customer_id, linked_at = now()
      WHERE id = v_res.id;
      v_conflito := v_conflito + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.seller_customers (seller_id, customer_id, assigned_by, is_active)
    VALUES (
      v_res.seller_id,
      p_customer_id,
      COALESCE(v_res.created_by, v_res.seller_id),
      true
    )
    ON CONFLICT (seller_id, customer_id) DO UPDATE SET is_active = true;
    v_carteira := v_carteira + 1;

    -- Quem se registou sem escolher província fica com a da reserva. É a mesma
    -- regra que a carteira já impunha quando criava a conta: o cliente pertence
    -- à delegação de quem o registou.
    IF v_res.provincia_id IS NOT NULL THEN
      UPDATE public.profiles p
      SET provincia_id = v_res.provincia_id, updated_at = now()
      WHERE p.id = p_customer_id AND p.provincia_id IS NULL;
    END IF;

    UPDATE public.reserved_customers
    SET status = 'ligado', customer_id = p_customer_id, linked_at = now()
    WHERE id = v_res.id;
    v_ligados := v_ligados + 1;
  END LOOP;

  SELECT count(*) INTO v_tocado
  FROM public.seller_customers sc
  WHERE sc.customer_id = p_customer_id AND sc.is_active = true;

  RETURN jsonb_build_object(
    'ok', true,
    'telefone', v_phone,
    'reservas_ligadas', v_ligados,
    'reservas_em_conflito', v_conflito,
    'vendas_atribuidas', v_vendas,
    'na_carteira', v_tocado
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 6. AS COMPRAS DO CLIENTE
-- -----------------------------------------------------------------------------
--  `sales_select` só deixa ver ao vendedor e à gestão, e o cliente não pode
--  ler o perfil do colaborador (é o RLS de `profiles`). Em vez de abrir as
--  tabelas, devolve-se exactamente o que é do próprio — nada mais.
CREATE OR REPLACE FUNCTION public.minhas_compras(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'id',             s.id,
      'reference',      s.reference,
      'created_at',     s.created_at,
      'total',          s.total_amount,
      'payment_status', s.payment_status,
      'payment_method', s.payment_method,
      'seller_name',    p.full_name,
      'seller_phone',   p.phone,
      'provincia',      pr.nome,
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name',        COALESCE(si.product_snapshot->>'name', prd.name),
          'sku',         COALESCE(si.product_snapshot->>'sku', prd.sku),
          'quantity',    si.quantity,
          'unit_price',  si.unit_price,
          'total_price', si.total_price
        ) ORDER BY si.created_at)
        FROM public.sale_items si
        LEFT JOIN public.products prd ON prd.id = si.product_id
        WHERE si.sale_id = s.id
      ), '[]'::jsonb)
    ) AS x
    FROM public.sales s
    LEFT JOIN public.profiles p   ON p.id = s.seller_id
    LEFT JOIN public.provincias pr ON pr.id = s.provincia_id
    WHERE s.customer_id = v_uid
    ORDER BY s.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  ) t;

  RETURN v_out;
END;
$$;


-- -----------------------------------------------------------------------------
-- 7. PERMISSÕES
-- -----------------------------------------------------------------------------
--  `REVOKE ... FROM PUBLIC` não é decoração: no Supabase as funções nascem
--  executáveis por PUBLIC, e `ligar_reserva_ao_cliente` recebe um uuid de
--  cliente. Sem isto, um pedido anónimo podia tentar ligar reservas alheias.
REVOKE ALL ON FUNCTION public.register_sale_by_phone(jsonb, text, text, public.payment_status, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ligar_reserva_ao_cliente(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.minhas_compras(int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.register_sale_by_phone(jsonb, text, text, public.payment_status, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ligar_reserva_ao_cliente(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.minhas_compras(int) TO authenticated;
