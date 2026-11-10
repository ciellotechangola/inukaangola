-- =============================================================================
--  INUKA ANGOLA — PATCH: O CLIENTE DA VENDA ENTRA SOZINHO NA CARTEIRA
-- =============================================================================
--  Supabase -> SQL Editor -> New query -> colar tudo -> RUN
--  Idempotente. Pode ser executado mais do que uma vez sem perder dados.
--  Equivale à migração 0017_cliente_da_venda_na_carteira.sql (mesmo conteúdo).
--
--  O QUE RESOLVE
--    Registar uma venda com o telefone do cliente passa a ser o cadastro dele.
--    Se o número já tiver conta, o cliente entra na carteira do colaborador e
--    a venda fica com o `customer_id` dele — sem passo nenhum à parte. Se ainda
--    não tiver conta, fica a reserva com o nome escrito no formulário.
--
--    Isto corrige o telemóvel, que recusava a venda com «Este telefone já tem
--    conta», e o colaborador que associava um número já registado e ficava com
--    a mesma pessoa duas vezes na carteira (reserva aberta + cliente).
--
--    Uma função nova — `garantir_cliente_na_carteira(id, colaborador)` — passa
--    a ser a única regra de «um cliente pertence a um colaborador».
--
--  Depois de correr, `npm run estado` deve ficar todo OK.
-- =============================================================================


-- =============================================================================
--  INUKA ANGOLA — PARTE 17
--  O CLIENTE DA VENDA ENTRA SOZINHO NA CARTEIRA
-- =============================================================================
--  O QUE MUDA E PORQUÊ
--
--  Registar uma venda já dizia quem comprou. Mas o cliente só aparecia em
--  «Clientes conquistados» se o colaborador fizesse um segundo passo — associar
--  o telefone à carteira — e, no telemóvel, nem isso: `register_sale_by_phone`
--  recusava a venda quando o número já tinha conta («Este telefone já tem
--  conta»). O colaborador via a venda falhar por uma razão que não era culpa
--  dele, e o cliente que ele tinha conquistado não ficava registado como dele.
--
--  A partir daqui, a venda é o cadastro. Um telefone na venda significa:
--
--    · conta existente → o cliente entra na carteira do colaborador e a venda
--                        fica com o `customer_id` dele (`conquistado = true`);
--    · conta por abrir  → fica a reserva, como já acontecia (`reservado`).
--
--  A regra de exclusividade não muda: um cliente só pertence a um colaborador.
--  Se já for de outro, a venda é recusada com uma mensagem que diz o que fazer.
--
--  O nome escrito no formulário passa a ser gravado na própria reserva. Antes
--  era uma segunda chamada (`POST /api/vendedor/clientes/nome`) que podia
--  falhar em silêncio e deixar a carteira com «Cliente por activar».
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. UMA SÓ REGRA PARA PÔR ALGUÉM NA CARTEIRA
-- -----------------------------------------------------------------------------
--  Existia dentro de `link_customer_by_phone` e passaria a ser precisa também
--  no registo de venda. Em vez de duas cópias da mesma regra (que um dia
--  divergem), fica uma função só.
--
--  Devolve sempre jsonb — nunca lança por o cliente ser de outro colaborador,
--  porque quem chama decide o que fazer com isso (a venda recusa, o formulário
--  da carteira mostra uma mensagem).
CREATE OR REPLACE FUNCTION public.garantir_cliente_na_carteira(
  p_customer_id uuid,
  p_seller_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_seller uuid := COALESCE(p_seller_id, auth.uid());
  v_dono   uuid;
  v_novo   boolean;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sem_cliente');
  END IF;

  IF v_seller IS NULL THEN
    RAISE EXCEPTION 'É necessário indicar o colaborador' USING ERRCODE = '22023';
  END IF;

  -- O servidor (auth.uid() nulo) actua em nome de quem lhe disserem; uma
  -- sessão normal só mexe na própria carteira, a não ser que seja gestão.
  IF v_uid IS NOT NULL AND v_uid <> v_seller AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'Sem permissão para mexer na carteira de outro colaborador'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_seller) THEN
    RAISE EXCEPTION 'Colaborador não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Um cliente só pode estar na carteira de um colaborador. Estar inactivo
  -- (transferência antiga, por exemplo) não conta como pertencer.
  SELECT sc.seller_id INTO v_dono
  FROM public.seller_customers sc
  WHERE sc.customer_id = p_customer_id
    AND sc.is_active = true
    AND sc.seller_id <> v_seller
  LIMIT 1;

  IF v_dono IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'outro_colaborador',
      'dono', v_dono,
      'message', 'Este cliente já está associado a outro colaborador. Solicite transferência à gerência.'
    );
  END IF;

  -- `novo` diz a quem chama se foi um vínculo criado agora ou um reencontro:
  -- é o que permite à interface dizer «entrou nos seus clientes» só quando é
  -- verdade.
  SELECT NOT EXISTS (
    SELECT 1 FROM public.seller_customers sc
    WHERE sc.customer_id = p_customer_id
      AND sc.seller_id = v_seller
      AND sc.is_active = true
  ) INTO v_novo;

  INSERT INTO public.seller_customers (seller_id, customer_id, assigned_by, is_active)
  VALUES (v_seller, p_customer_id, COALESCE(v_uid, v_seller), true)
  ON CONFLICT (seller_id, customer_id) DO UPDATE SET is_active = true;

  RETURN jsonb_build_object(
    'ok', true,
    'seller_id', v_seller,
    'customer_id', p_customer_id,
    'novo', v_novo
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 2. ASSOCIAR POR TELEFONE PASSA A USAR A MESMA REGRA
-- -----------------------------------------------------------------------------
--  Mesma resposta de antes (`found` / `linked` / `customer_id`), agora sem uma
--  segunda cópia da regra de exclusividade.
CREATE OR REPLACE FUNCTION public.link_customer_by_phone(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_phone    text;
  v_target   uuid;
  v_carteira jsonb;
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

  v_carteira := public.garantir_cliente_na_carteira(v_target, v_uid);

  IF NOT (v_carteira->>'ok')::boolean THEN
    RETURN jsonb_build_object(
      'found', true,
      'linked', false,
      'reason', 'already_assigned',
      'message', 'Este cliente já está associado a outro vendedor. Solicite transferência à gerência.'
    );
  END IF;

  RETURN jsonb_build_object('found', true, 'linked', true, 'customer_id', v_target);
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. A RESERVA PODE SER FECHADA POR QUEM A FEZ
-- -----------------------------------------------------------------------------
--  `ligar_reserva_ao_cliente` só aceitava o próprio cliente ou a gestão. Isso
--  deixava o colaborador de fora: quando associava um número que tinha acabado
--  de abrir conta, a chamada era recusada (o erro era engolido no browser) e a
--  reserva ficava «por activar» para sempre — a mesma pessoa aparecia duas
--  vezes na carteira, uma como reserva e outra como cliente.
--
--  Quem reservou o número é dono dessa reserva e pode fechá-la. O telefone é
--  único em `reserved_customers`, por isso «ser dono da reserva» é exactamente
--  «ter uma reserva com este número em seu nome».
DROP FUNCTION IF EXISTS public.ligar_reserva_ao_cliente(uuid);

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

  SELECT public.normalize_phone(p.phone) INTO v_phone
  FROM public.profiles p WHERE p.id = p_customer_id;

  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'sem_telefone');
  END IF;

  -- Só o próprio, a gestão, o servidor (auth.uid() nulo) ou o colaborador que
  -- fez a reserva. Sem isto, qualquer sessão autenticada podia passar o uuid de
  -- outra pessoa e fechar-lhe a reserva.
  IF v_uid IS NOT NULL
     AND v_uid <> p_customer_id
     AND NOT public.is_manager()
     AND NOT EXISTS (
       SELECT 1 FROM public.reserved_customers r
       WHERE r.phone = v_phone AND r.seller_id = v_uid
     )
  THEN
    RAISE EXCEPTION 'Sem permissão para ligar reservas deste cliente' USING ERRCODE = '42501';
  END IF;

  -- 3.1 Vendas registadas com este telefone passam a ter dono.
  WITH actualizadas AS (
    UPDATE public.sales s
    SET customer_id = p_customer_id, updated_at = now()
    WHERE s.customer_id IS NULL
      AND public.normalize_phone(s.customer_phone) = v_phone
    RETURNING 1
  )
  SELECT count(*) INTO v_vendas FROM actualizadas;

  -- 3.2 Reservas: vínculo com a carteira e fecho da reserva.
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
-- 4. REGISTAR VENDA: O TELEFONE É O CADASTRO
-- -----------------------------------------------------------------------------
--  Deixa de haver dois caminhos para o colaborador («associe primeiro o
--  cliente»). O telefone resolve tudo:
--
--    · conta existente  → carteira + venda com `customer_id`;
--    · conta por abrir  → reserva com o nome, como antes.
--
--  A assinatura ganha `p_customer_name` **no fim**: as chamadas antigas (que
--  passam seis argumentos) continuam a bater no mesmo sítio. Como a lista de
--  argumentos mudou, a função antiga tem de sair — `CREATE OR REPLACE` não
--  substitui uma assinatura diferente, criava uma segunda função ao lado.
DROP FUNCTION IF EXISTS public.register_sale_by_phone(jsonb, text, text, public.payment_status, text, text);

CREATE OR REPLACE FUNCTION public.register_sale_by_phone(
  p_items          jsonb,
  p_customer_phone text,
  p_payment_method text DEFAULT NULL,
  p_payment_status public.payment_status DEFAULT 'pending',
  p_notes          text DEFAULT NULL,
  p_client_ref     text DEFAULT NULL,
  p_customer_name  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid         uuid := auth.uid();
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

  v_phone := public.normalize_phone(p_customer_phone);
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Telefone inválido. Use o formato +244 9xx xxx xxx'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.id INTO v_cliente FROM public.profiles p WHERE p.phone = v_phone;

  IF v_cliente IS NOT NULL THEN
    -- O vínculo tem de existir **antes** da venda: `register_sale` recusa um
    -- `customer_id` que ainda não esteja na carteira de quem vende.
    v_carteira := public.garantir_cliente_na_carteira(v_cliente, v_uid);

    IF NOT (v_carteira->>'ok')::boolean THEN
      RAISE EXCEPTION '%', COALESCE(
        v_carteira->>'message',
        'Este cliente já está associado a outro colaborador.'
      ) USING ERRCODE = '42501';
    END IF;

    v_conquistado := true;
  END IF;

  v_sale := public.register_sale(
    p_items, v_cliente, p_payment_method, p_payment_status, p_notes, p_client_ref
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
    -- Conta por abrir: reserva-se o número para este colaborador, já com o
    -- nome que ele escreveu. Se o número já estiver reservado por outro, não
    -- se lhe toca — a exclusividade vale também para quem ainda não tem conta.
    INSERT INTO public.reserved_customers (
      seller_id, created_by, full_name, phone, provincia_id, status
    )
    VALUES (v_uid, v_uid, v_nome, v_phone, public.my_province(), 'reservado')
    ON CONFLICT (phone) DO UPDATE
      SET full_name = COALESCE(reserved_customers.full_name, EXCLUDED.full_name)
      WHERE reserved_customers.seller_id = v_uid;

    SELECT EXISTS (
      SELECT 1 FROM public.reserved_customers r
      WHERE r.phone = v_phone AND r.seller_id = v_uid AND r.status = 'reservado'
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
-- 5. PERMISSÕES
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.garantir_cliente_na_carteira(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ligar_reserva_ao_cliente(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_sale_by_phone(jsonb, text, text, public.payment_status, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.garantir_cliente_na_carteira(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ligar_reserva_ao_cliente(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_sale_by_phone(jsonb, text, text, public.payment_status, text, text, text) TO authenticated, service_role;
