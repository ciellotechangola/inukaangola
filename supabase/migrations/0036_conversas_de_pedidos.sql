-- =============================================================================
--  0036 — CONVERSAS LIGADAS A PEDIDOS E CONTADORES DE NOTIFICAÇÃO
-- =============================================================================
--  O QUE ESTAVA MAL
--    · O revendedor e o cliente escreviam uma mensagem no pedido e a gestão
--      respondia **uma vez** (`revendedor_pedidos.resposta`). Não havia
--      conversa: a segunda pergunta não tinha onde cair.
--    · O chat existia (`conversations`/`messages`), mas nada o ligava a um
--      pedido — cada acesso criava uma conversa nova, ou nenhuma.
--    · Não havia contadores: o cabeçalho não sabia quantas mensagens estavam
--      por ler nem quantos pedidos tinham mudado.
--
--  O QUE PASSA A ACONTECER
--    1. Uma conversa pode pertencer a um pedido:
--         · `conversations.pedido_grosso_id` → pedido de grosso
--         · `conversations.order_id`         → encomenda de loja
--       Índice único parcial: **um pedido, uma conversa**. Nunca duas.
--    2. `abrir_conversa_pedido()` / `abrir_conversa_encomenda()` devolvem
--       sempre a mesma conversa — criam-na na primeira vez, reutilizam-na
--       nas seguintes. O histórico fica onde está.
--    3. Um gatilho cria a conversa no momento em que o pedido de grosso
--       nasce e guarda a mensagem que o revendedor escreveu como primeira
--       mensagem da conversa. A gestão vê-a na caixa de entrada sem ter de
--       abrir o pedido.
--    4. `contadores_nao_lidas()` devolve, de uma vez, o que o cabeçalho
--       precisa: mensagens por ler e pedidos com novidade (ou, para a
--       gestão, pedidos à espera de resposta).
--    5. `lida_ate_conversa()` diz até quando o outro lado leu — é o que
--       permite o ✓ (enviada) e o ✓✓ (lida).
--
--  O QUE NÃO MUDA
--    · Nenhuma mensagem, conversa ou pedido é apagado. As colunas novas
--      nascem vazias e as conversas antigas continuam exactamente iguais.
--    · `revendedor_pedidos.resposta` continua a existir e a ser escrita pelo
--      `responder_pedido_revendedor` — a conversa é um canal a mais, não
--      substitui a resposta formal que fica no pedido.
--
--  Idempotente. Pode correr mais do que uma vez.
-- =============================================================================

-- ------------------------------------------- 1. A CONVERSA SABE O SEU PEDIDO
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS pedido_grosso_id uuid
    REFERENCES public.revendedor_pedidos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_id uuid
    REFERENCES public.orders(id) ON DELETE SET NULL;

-- Um pedido tem uma só conversa. O índice é parcial porque a esmagadora
-- maioria das conversas não tem pedido nenhum (`NULL` não colide).
CREATE UNIQUE INDEX IF NOT EXISTS conversations_pedido_grosso_unico
  ON public.conversations (pedido_grosso_id)
  WHERE pedido_grosso_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_order_unico
  ON public.conversations (order_id)
  WHERE order_id IS NOT NULL;

COMMENT ON COLUMN public.conversations.pedido_grosso_id IS
  'Pedido de grosso a que esta conversa pertence (um pedido, uma conversa).';
COMMENT ON COLUMN public.conversations.order_id IS
  'Encomenda de loja a que esta conversa pertence (uma encomenda, uma conversa).';

-- ------------------------------- 2. QUANDO FOI A ÚLTIMA VEZ QUE VI OS PEDIDOS
-- O contador de «pedidos com novidade» precisa de um marco: sem ele, ou se
-- conta tudo desde sempre, ou nada. É por utilizador e não por pedido — uma
-- linha em vez de uma tabela.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pedidos_visto_em timestamptz;

COMMENT ON COLUMN public.profiles.pedidos_visto_em IS
  'Última vez que a pessoa abriu a área de pedidos. Serve o contador de novidades.';

-- ------------------------------------------ 3. QUEM RESPONDE POR ESTA PESSOA
-- Preferência: o gestor atribuído ao revendedor → o gestor da província →
-- a administração nacional → o gestor activo mais antigo. A mesma ordem em
-- todos os sítios, para a conversa não saltar de gestor a cada abertura.
CREATE OR REPLACE FUNCTION public.gestor_do_utilizador(p_user uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_provincia uuid;
  v_gestor    uuid;
BEGIN
  IF p_user IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.provincia_id INTO v_provincia
  FROM public.profiles p WHERE p.id = p_user;

  -- Revendedor com gestor atribuído: é ele, sem discussão.
  SELECT r.manager_id INTO v_gestor
  FROM public.revendedores r
  WHERE r.user_id = p_user
    AND r.status = 'activo'
    AND r.manager_id IS NOT NULL
  LIMIT 1;

  IF v_gestor IS NOT NULL THEN
    RETURN v_gestor;
  END IF;

  SELECT p.id INTO v_gestor
  FROM public.profiles p
  WHERE p.role = 'manager'::public.user_role
    AND p.is_active
  ORDER BY
    (p.provincia_id IS NOT DISTINCT FROM v_provincia) DESC,
    (p.provincia_id IS NULL) DESC,
    p.created_at
  LIMIT 1;

  RETURN v_gestor;
END;
$$;

-- --------------------------------- 4. ABRIR A CONVERSA DE UM PEDIDO DE GROSSO
-- Devolve sempre a mesma conversa para o mesmo pedido. Pode ser chamada pelo
-- revendedor dono do pedido ou por qualquer gestor que o possa ver.
CREATE OR REPLACE FUNCTION public.abrir_conversa_pedido(p_pedido uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_me     uuid := auth.uid();
  v_pedido public.revendedor_pedidos;
  v_rev    public.revendedores;
  v_dono   uuid;
  v_gestor uuid;
  v_conv   uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sessão necessária' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pedido FROM public.revendedor_pedidos WHERE id = p_pedido;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rev FROM public.revendedores WHERE id = v_pedido.revendedor_id;
  v_dono := v_rev.user_id;

  IF NOT (v_dono = v_me OR public.is_manager()) THEN
    RAISE EXCEPTION 'Sem acesso a este pedido' USING ERRCODE = '42501';
  END IF;

  -- Duas aberturas ao mesmo tempo não podem criar duas conversas. O índice
  -- único também impede, mas com uma excepção feia; a fechadura resolve antes.
  PERFORM pg_advisory_xact_lock(hashtext('conversa-pedido:' || p_pedido::text));

  SELECT c.id INTO v_conv
  FROM public.conversations c
  WHERE c.pedido_grosso_id = p_pedido
  LIMIT 1;

  v_gestor := COALESCE(v_rev.manager_id, public.gestor_do_utilizador(v_dono));

  IF v_conv IS NULL THEN
    INSERT INTO public.conversations (type, title, created_by, pedido_grosso_id)
    VALUES ('direct', 'Pedido ' || v_pedido.numero, v_me, p_pedido)
    RETURNING id INTO v_conv;
  END IF;

  IF v_dono IS NOT NULL THEN
    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (v_conv, v_dono, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  IF v_gestor IS NOT NULL THEN
    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (v_conv, v_gestor, 'admin')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  -- Um gestor de outra província que abra o pedido entra na conversa: sem
  -- isto não podia responder (a política de INSERT em `messages` exige ser
  -- membro) e via-a em modo de observação.
  IF v_me <> COALESCE(v_dono, v_me) AND v_me <> COALESCE(v_gestor, v_me) THEN
    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (v_conv, v_me, 'admin')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN v_conv;
END;
$$;

-- ------------------------------ 5. ABRIR A CONVERSA DE UMA ENCOMENDA DE LOJA
CREATE OR REPLACE FUNCTION public.abrir_conversa_encomenda(p_order uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_me     uuid := auth.uid();
  v_order  public.orders;
  v_gestor uuid;
  v_conv   uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sessão necessária' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Encomenda não encontrada' USING ERRCODE = '42501';
  END IF;

  IF NOT (v_order.customer_id = v_me OR public.is_manager()) THEN
    RAISE EXCEPTION 'Sem acesso a esta encomenda' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('conversa-encomenda:' || p_order::text));

  SELECT c.id INTO v_conv
  FROM public.conversations c
  WHERE c.order_id = p_order
  LIMIT 1;

  v_gestor := public.gestor_do_utilizador(v_order.customer_id);

  IF v_conv IS NULL THEN
    INSERT INTO public.conversations (type, title, created_by, order_id)
    VALUES ('direct', 'Encomenda ' || v_order.reference, v_me, p_order)
    RETURNING id INTO v_conv;
  END IF;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (v_conv, v_order.customer_id, 'member')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  IF v_gestor IS NOT NULL THEN
    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (v_conv, v_gestor, 'admin')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  IF public.is_manager()
     AND v_me <> v_order.customer_id
     AND v_me <> COALESCE(v_gestor, v_me) THEN
    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (v_conv, v_me, 'admin')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN v_conv;
END;
$$;

-- ---------------------- 6. O PEDIDO DE GROSSO NASCE COM A CONVERSA ABERTA
-- A mensagem que o revendedor escreve ao enviar o pedido passa a ser a
-- primeira mensagem da conversa. Sem isto, a gestão só veria a conversa
-- depois de alguém clicar em «Abrir conversa» — e a mensagem ficava órfã no
-- pedido, sem resposta possível.
--
-- Um erro aqui **nunca** pode impedir o pedido de existir: o pedido é a
-- operação; a conversa é recuperável (a RPC da secção 4 cria-a à primeira
-- abertura). Daí o `EXCEPTION`.
CREATE OR REPLACE FUNCTION public.criar_conversa_do_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_dono   uuid;
  v_gestor uuid;
  v_conv   uuid;
  v_texto  text;
BEGIN
  BEGIN
    v_texto := btrim(COALESCE(NEW.mensagem, ''));

    SELECT r.user_id INTO v_dono
    FROM public.revendedores r WHERE r.id = NEW.revendedor_id;

    -- Revendedor sem conta de acesso: não há quem fale. A conversa nasce
    -- quando a conta existir.
    IF v_dono IS NULL THEN
      RETURN NEW;
    END IF;

    v_gestor := public.gestor_do_utilizador(v_dono);

    INSERT INTO public.conversations (type, title, created_by, pedido_grosso_id)
    VALUES ('direct', 'Pedido ' || NEW.numero, v_dono, NEW.id)
    ON CONFLICT (pedido_grosso_id) WHERE pedido_grosso_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_conv;

    IF v_conv IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (v_conv, v_dono, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    IF v_gestor IS NOT NULL THEN
      INSERT INTO public.conversation_members (conversation_id, user_id, role)
      VALUES (v_conv, v_gestor, 'admin')
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
    END IF;

    IF v_texto <> '' THEN
      INSERT INTO public.messages (conversation_id, sender_id, content)
      VALUES (v_conv, v_dono, v_texto);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- O pedido segue. A conversa é criada na primeira abertura.
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedido_cria_conversa ON public.revendedor_pedidos;
CREATE TRIGGER trg_pedido_cria_conversa
AFTER INSERT ON public.revendedor_pedidos
FOR EACH ROW EXECUTE FUNCTION public.criar_conversa_do_pedido();

-- ------------------------- 6b. UMA MENSAGEM NOVA TOCA A CONVERSA
-- `conversations.updated_at` nunca mudava ao inserir uma mensagem, por isso a
-- caixa de entrada não podia ordenar por ela e trazia as primeiras 60 linhas
-- que o Postgres devolvesse. Com centenas de conversas de pedido isso deixava
-- conversas vivas de fora. O gatilho dá sentido à coluna; a ordem fina
-- continua a ser feita pela última mensagem, no cliente.
CREATE OR REPLACE FUNCTION public.tocar_conversa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  UPDATE public.conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id
    AND updated_at < now() - interval '1 second'; -- evita reescrever a mesma linha em rajada

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mensagem_toca_conversa ON public.messages;
CREATE TRIGGER trg_mensagem_toca_conversa
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.tocar_conversa();

REVOKE ALL ON FUNCTION public.tocar_conversa() FROM PUBLIC, anon, authenticated;

-- -------------------------------------------- 7. O QUE O CABEÇALHO PRECISA
-- Uma chamada, dois números. Contar no browser obrigava a trazer mensagens
-- e pedidos todos para o cliente só para somar.
CREATE OR REPLACE FUNCTION public.contadores_nao_lidas()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_me       uuid := auth.uid();
  v_papel    public.user_role;
  v_visto    timestamptz;
  v_mensagens int := 0;
  v_pedidos   int := 0;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('mensagens', 0, 'pedidos', 0);
  END IF;

  SELECT p.role, p.pedidos_visto_em INTO v_papel, v_visto
  FROM public.profiles p WHERE p.id = v_me;

  -- Mensagens por ler: nas minhas conversas, de outra pessoa, depois da
  -- última vez que as abri. A mesma regra do `carregarInbox`.
  SELECT count(*) INTO v_mensagens
  FROM public.messages m
  JOIN public.conversation_members cm
    ON cm.conversation_id = m.conversation_id
   AND cm.user_id = v_me
  WHERE m.sender_id <> v_me
    AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at);

  IF v_papel = 'manager'::public.user_role THEN
    -- Para a gestão o número é trabalho à espera, não novidade: pedidos de
    -- grosso por tratar e encomendas por confirmar.
    SELECT
      (SELECT count(*)
         FROM public.revendedor_pedidos rp
        WHERE rp.status IN ('novo', 'em_analise')
          AND public.can_see_province(rp.provincia_id))
      +
      (SELECT count(*)
         FROM public.orders o
        WHERE o.status = 'pending'::public.order_status)
    INTO v_pedidos;
  ELSIF v_papel = 'reseller'::public.user_role THEN
    -- O revendedor quer saber o que mexeu nos pedidos dele desde a última
    -- visita. Um pedido ainda «novo» não é novidade: foi ele que o criou.
    SELECT count(*) INTO v_pedidos
    FROM public.revendedor_pedidos rp
    JOIN public.revendedores r ON r.id = rp.revendedor_id
    WHERE r.user_id = v_me
      AND rp.status <> 'novo'
      AND rp.updated_at > COALESCE(v_visto, rp.created_at);
  ELSE
    SELECT count(*) INTO v_pedidos
    FROM public.orders o
    WHERE o.customer_id = v_me
      AND o.status <> 'pending'::public.order_status
      AND o.updated_at > COALESCE(v_visto, o.created_at);
  END IF;

  RETURN jsonb_build_object(
    'mensagens', COALESCE(v_mensagens, 0),
    'pedidos',   COALESCE(v_pedidos, 0)
  );
END;
$$;

-- Abrir a área de pedidos zera o contador. Não se faz por gatilho de leitura
-- de página (o servidor não sabe o que o browser mostrou): o ecrã chama isto
-- quando a lista já está à vista.
CREATE OR REPLACE FUNCTION public.marcar_pedidos_vistos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.profiles
  SET pedidos_visto_em = now()
  WHERE id = auth.uid();
END;
$$;

-- ------------------------------------------- 8. ATÉ QUANDO O OUTRO LADO LEU
-- O mínimo entre os restantes membros: num grupo, ✓✓ só quando todos leram.
-- `NULL` = ninguém leu (ou a conversa tem só uma pessoa).
CREATE OR REPLACE FUNCTION public.lida_ate_conversa(p_conversation_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT min(cm.last_read_at)
  FROM public.conversation_members cm
  WHERE cm.conversation_id = p_conversation_id
    AND cm.user_id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    AND public.is_conversation_member(p_conversation_id);
$$;

-- ------------------------------------------------------------ 9. PERMISSÕES
GRANT EXECUTE ON FUNCTION public.gestor_do_utilizador(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.abrir_conversa_pedido(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.abrir_conversa_encomenda(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.contadores_nao_lidas()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_pedidos_vistos()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.lida_ate_conversa(uuid)           TO authenticated;

-- O gatilho não é chamado pelo browser.
REVOKE ALL ON FUNCTION public.criar_conversa_do_pedido() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------- 10. O QUE O TEMPO REAL PRECISA
-- `messages` e `orders` já estavam publicados (0003). Faltavam as duas
-- tabelas que mudam sem mensagem nenhuma: o «lido» (✓✓) e o estado do pedido.
-- Sem elas o contador só se corrigia no ciclo de 30 segundos.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY['conversation_members', 'revendedor_pedidos'];
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

-- ----------------------------------------- 11. AS CONVERSAS JÁ EXISTENTES
-- Quem já tinha uma resposta escrita no pedido não perde nada: o pedido
-- continua a mostrá-la. A conversa é criada quando alguém a abrir. Nada é
-- apagado nem reescrito aqui.
