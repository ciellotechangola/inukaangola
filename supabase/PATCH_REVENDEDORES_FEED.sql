-- =============================================================================
--  INUKA ANGOLA — PATCH: REVENDEDORES EM GRUPOS, MENSAGENS E FEED INUKA
-- =============================================================================
--  Supabase -> SQL Editor -> New query -> colar tudo -> RUN
--  Idempotente. Pode ser executado mais do que uma vez sem perder dados.
--  Equivale à migração 0030_revendedores_grupos_e_feed.sql (mesmo conteúdo).
--  Requer a 0011 (chat da equipa) e a 0026 (revendedores) já aplicadas.
--
--  O QUE RESOLVE
--    · `e_membro_equipa()` passa a incluir revendedores e vendedores de loja.
--      Antes, o gestor escolhia um revendedor no ecrã de «Novo grupo» e a
--      criação falhava — o ecrã prometia o que a base recusava.
--    · `ve_feed_inuka()` — quem lê o feed interno: equipa + revendedores.
--    · `pode_ver_kind()` passa a chamá-la, por isso os comunicados e a
--      formação aparecem iguais no feed do colaborador e no do revendedor.
--
--  O que NÃO muda: o cliente continua fora dos grupos e continua a falar em
--  privado com a gestão; só a gestão publica e só a gestão cria grupos.
--
--  Sem este patch, /revenda/comunicados fica vazio e criar um grupo com um
--  revendedor dentro dá «Um cliente não entra em grupos».
-- =============================================================================


-- =============================================================================
-- 0030 — REVENDEDORES: GRUPOS, MENSAGENS E O MESMO FEED INUKA
-- =============================================================================
--  O QUE ESTAVA MAL
--    O revendedor ficou de fora de duas coisas que já existiam para a equipa:
--
--    1. **Grupos.** `e_membro_equipa()` só aceitava `seller` e `manager`. Um
--       gestor podia escolher um revendedor no ecrã de «Novo grupo» (a lista
--       de contactos mostra todos os não-clientes) e a criação falhava com
--       «Grupos são só para membros da empresa». O ecrã prometia o que a base
--       recusava. O mesmo acontecia com o vendedor de loja (`store_seller`):
--       aparecia na lista e não entrava.
--    2. **Feed Inuka.** `pode_ver_kind()` dava os comunicados e a formação a
--       `is_staff()` — colaborador, vendedor de loja e gestão. O revendedor
--       lia o feed público e ficava sem os avisos da marca.
--
--  O QUE PASSA A ACONTECER
--    1. `e_membro_equipa()` passa a incluir `reseller` e `store_seller`. A
--       função mantém o nome (é chamada em quatro sítios e num gatilho) mas o
--       sentido alarga-se: é «gente da casa», não «folha de pagamento».
--    2. `ve_feed_inuka()` é a nova definição de quem lê o feed interno:
--       `is_staff() OR is_reseller()`. `pode_ver_kind()` passa a chamá-la, e
--       como `pode_ver_conteudo()`, a política `content_items_read` e
--       `conteudo_feed()` já chamavam `pode_ver_kind()`, o feed inteiro abre
--       sem mais uma linha de SQL repetida.
--    3. Mensagens directas **não mudam**: `get_or_create_direct_conversation`
--       nunca olhou a papéis, e o gestor já via os revendedores em
--       `/api/contactos`. Isto só fecha o que faltava nos grupos.
--
--  O QUE **NÃO** MUDA
--    · O cliente continua fora dos grupos (gatilho `trg_conversation_members_so_equipa`)
--      e continua a falar em privado com a gestão.
--    · O visitante sem sessão continua a ver só promoções e testemunhos.
--    · Só a gestão publica (`content_items_write`) e só a gestão cria grupos
--      (`criar_grupo_equipa` exige `is_manager()`).
--
--  Idempotente. Pode correr mais do que uma vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. QUEM É «GENTE DA CASA»
-- -----------------------------------------------------------------------------
-- A lista antiga era `seller, manager`. Ficaram de fora o vendedor de loja
-- (que já aparecia no ecrã de grupos) e o revendedor. Os quatro papéis
-- internos entram; `customer` continua de fora, e é o único que fica.
CREATE OR REPLACE FUNCTION public.e_membro_equipa(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user
      AND p.is_active
      AND p.role::text IN ('seller', 'store_seller', 'manager', 'reseller')
  );
$$;

-- -----------------------------------------------------------------------------
-- 2. QUEM LÊ O FEED INUKA
-- -----------------------------------------------------------------------------
-- Uma definição só, para o próximo papel não obrigar a mexer em quatro sítios.
-- Não se usa `is_staff()` em vez desta: `is_staff()` também governa stock e
-- vendas ao balcão, e o revendedor não mexe em nenhum dos dois. São perguntas
-- diferentes e ficam em funções diferentes.
CREATE OR REPLACE FUNCTION public.ve_feed_inuka()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.is_staff() OR public.is_reseller();
$$;

CREATE OR REPLACE FUNCTION public.pode_ver_kind(p_kind text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT NOT public.kind_so_equipa(p_kind) OR public.ve_feed_inuka();
$$;

GRANT EXECUTE ON FUNCTION public.e_membro_equipa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ve_feed_inuka()      TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. MENSAGENS DOS GRUPOS: O TEXTO DEIXA DE MENTIR
-- -----------------------------------------------------------------------------
-- O corpo das três funções é o da 0011; muda a mensagem de erro, que dizia
-- «só para membros da empresa» quando a regra passou a ser «só para quem não é
-- cliente». A regra em si já vem de `e_membro_equipa()`, actualizada acima.
CREATE OR REPLACE FUNCTION public.criar_grupo_equipa(
  p_nome    text,
  p_membros uuid[] DEFAULT '{}'::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_me     uuid := auth.uid();
  v_nome   text := btrim(COALESCE(p_nome, ''));
  v_conv   uuid;
  v_membro uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sessão necessária' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão cria grupos' USING ERRCODE = '42501';
  END IF;

  IF v_nome = '' THEN
    RAISE EXCEPTION 'Dê um nome ao grupo';
  END IF;

  INSERT INTO public.conversations (type, title, created_by)
  VALUES ('group', v_nome, v_me)
  RETURNING id INTO v_conv;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (v_conv, v_me, 'admin');

  FOREACH v_membro IN ARRAY COALESCE(p_membros, '{}'::uuid[])
  LOOP
    CONTINUE WHEN v_membro = v_me;

    IF NOT public.e_membro_equipa(v_membro) THEN
      RAISE EXCEPTION 'Um cliente não entra em grupos. Fale com ele em privado.'
        USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (v_conv, v_membro, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END LOOP;

  INSERT INTO public.groups (conversation_id, name, created_by, is_private)
  VALUES (v_conv, v_nome, v_me, true);

  RETURN v_conv;
END;
$$;

CREATE OR REPLACE FUNCTION public.adicionar_membro_grupo(
  p_conversation_id uuid,
  p_user_id         uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_tipo text;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão acrescenta membros' USING ERRCODE = '42501';
  END IF;

  SELECT c.type INTO v_tipo FROM public.conversations c WHERE c.id = p_conversation_id;
  IF v_tipo IS DISTINCT FROM 'group' THEN
    RAISE EXCEPTION 'Esta conversa não é um grupo' USING ERRCODE = '42501';
  END IF;

  IF NOT public.e_membro_equipa(p_user_id) THEN
    RAISE EXCEPTION 'Um cliente não entra em grupos. Fale com ele em privado.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (p_conversation_id, p_user_id, 'member')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_membro_de_grupo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_tipo text;
BEGIN
  SELECT c.type INTO v_tipo FROM public.conversations c WHERE c.id = NEW.conversation_id;
  IF v_tipo IS DISTINCT FROM 'group' THEN
    RETURN NEW;
  END IF;

  IF NOT public.e_membro_equipa(NEW.user_id) THEN
    RAISE EXCEPTION 'Um cliente não entra em grupos. Fale com ele em privado.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_grupo_equipa(text, uuid[])   TO authenticated;
GRANT EXECUTE ON FUNCTION public.adicionar_membro_grupo(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_membro_grupo(uuid, uuid)   TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. VERIFICAÇÃO
-- -----------------------------------------------------------------------------
-- As funções acima são `SECURITY DEFINER` e dependem de `profiles`, por isso
-- não se consegue provar o resultado sem sessão. O que se verifica aqui é que
-- ficaram todas no sítio — os casos por papel estão em
-- `tests/functional.test.mjs`, secção 31.
DO $$
DECLARE
  v_falta text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 've_feed_inuka'
  ) THEN
    v_falta := v_falta || 've_feed_inuka()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'criar_grupo_equipa'
  ) THEN
    v_falta := v_falta || 'criar_grupo_equipa()';
  END IF;

  IF array_length(v_falta, 1) > 0 THEN
    RAISE EXCEPTION '0030: funções em falta: %', array_to_string(v_falta, ', ');
  END IF;
END;
$$;
