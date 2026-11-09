-- =============================================================================
--  0011 — CHAT: O CLIENTE FALA EM PRIVADO COM A GESTÃO
-- =============================================================================
--  O QUE ESTAVA MAL
--    «Falar com a equipa» abria um grupo de três: cliente + colaborador +
--    gestor. O cliente via-se numa sala com duas pessoas da empresa, sem
--    saber quem respondia, e o colaborador ficava a par de tudo.
--
--  O QUE PASSA A ACONTECER
--    1. `abrir_conversa_equipa()` devolve uma conversa **directa** entre o
--       cliente e o gestor. Reutiliza a que já existir — nunca cria uma
--       segunda em cada clique.
--    2. **Grupos são só da empresa.** Um grupo aceita apenas colaboradores e
--       gestores activos; um cliente não entra, nem por convite. Quem cria e
--       quem mexe nos membros é a gestão:
--         · `criar_grupo_equipa(nome, membros)`
--         · `adicionar_membro_grupo(conversa, pessoa)`
--         · `remover_membro_grupo(conversa, pessoa)`
--    3. O gatilho `trg_conversation_members_so_equipa` fecha a porta a
--       qualquer outro caminho (INSERT directo, RPC futura, correcção à mão).
--    4. As conversas antigas «Equipa INUKA» (grupos com um cliente dentro)
--       são **convertidas em conversas directas** com o gestor, mantendo as
--       mensagens — ninguém perde o histórico.
--
--  Idempotente. Pode correr mais do que uma vez.
-- =============================================================================

-- ------------------------------------------------------- 1. QUEM É «EQUIPA»
-- Colaborador ou gestor, com a conta activa. É a única definição usada em
-- todos os sítios abaixo; se um dia houver mais papéis internos, muda-se aqui.
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
      AND p.role IN ('seller'::public.user_role, 'manager'::public.user_role)
  );
$$;

-- ------------------------------------- 2. CLIENTE ↔ GESTOR (EM PRIVADO)
-- O nome da função fica: é chamada em três sítios do site e mudá-lo obrigaria
-- a mexer em todos. O que muda é o que ela devolve.
CREATE OR REPLACE FUNCTION public.abrir_conversa_equipa()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_me        uuid := auth.uid();
  v_role      public.user_role;
  v_provincia uuid;
  v_gestor    uuid;
  v_conv      uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sessão necessária' USING ERRCODE = '42501';
  END IF;

  SELECT p.role, p.provincia_id INTO v_role, v_provincia
  FROM public.profiles p WHERE p.id = v_me;

  IF v_role = 'manager'::public.user_role THEN
    RAISE EXCEPTION 'A gestão usa «Nova conversa» para falar com alguém'
      USING ERRCODE = '42501';
  END IF;

  -- Gestor da mesma província; senão o mais antigo ainda activo.
  SELECT p.id INTO v_gestor
  FROM public.profiles p
  WHERE p.role = 'manager'::public.user_role AND p.is_active
  ORDER BY (p.provincia_id IS NOT DISTINCT FROM v_provincia) DESC, p.created_at
  LIMIT 1;

  IF v_gestor IS NULL THEN
    RAISE EXCEPTION 'Ainda não há gestão disponível para responder. Tente mais tarde.';
  END IF;

  -- Uma conversa directa por par: reutiliza-se em vez de criar outra.
  SELECT c.id INTO v_conv
  FROM public.conversations c
  WHERE c.type = 'direct'
    AND (SELECT count(*) FROM public.conversation_members m WHERE m.conversation_id = c.id) = 2
    AND EXISTS (SELECT 1 FROM public.conversation_members m
                WHERE m.conversation_id = c.id AND m.user_id = v_me)
    AND EXISTS (SELECT 1 FROM public.conversation_members m
                WHERE m.conversation_id = c.id AND m.user_id = v_gestor)
  LIMIT 1;

  IF v_conv IS NULL THEN
    INSERT INTO public.conversations (type, created_by)
    VALUES ('direct', v_me)
    RETURNING id INTO v_conv;

    INSERT INTO public.conversation_members (conversation_id, user_id)
    VALUES (v_conv, v_me), (v_conv, v_gestor);
  END IF;

  RETURN v_conv;
END;
$$;

-- ------------------------------------------------------- 3. GRUPOS DA EQUIPA
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
      RAISE EXCEPTION 'Grupos são só para membros da empresa. O cliente fala em privado com a gestão.'
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
    RAISE EXCEPTION 'Grupos são só para membros da empresa. O cliente fala em privado com a gestão.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (p_conversation_id, p_user_id, 'member')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.remover_membro_grupo(
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
    RAISE EXCEPTION 'Só a gestão remove membros' USING ERRCODE = '42501';
  END IF;

  SELECT c.type INTO v_tipo FROM public.conversations c WHERE c.id = p_conversation_id;
  IF v_tipo IS DISTINCT FROM 'group' THEN
    RAISE EXCEPTION 'Esta conversa não é um grupo' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.conversation_members cm
  WHERE cm.conversation_id = p_conversation_id AND cm.user_id = p_user_id;
END;
$$;

-- --------------------------------------------- 4. O GATILHO QUE FECHA A PORTA
-- A regra vive aqui e não só nas funções: qualquer INSERT (interface, script,
-- correcção manual) passa por este gatilho. `SECURITY DEFINER` para poder ler
-- `profiles` mesmo quando quem escreve é o próprio cliente.
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
    RAISE EXCEPTION 'Grupos são só para membros da empresa. O cliente fala em privado com a gestão.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversation_members_so_equipa ON public.conversation_members;
CREATE TRIGGER trg_conversation_members_so_equipa
BEFORE INSERT OR UPDATE OF user_id ON public.conversation_members
FOR EACH ROW EXECUTE FUNCTION public.validar_membro_de_grupo();

-- --------------------------------------------------------------- 5. ACESSOS
-- Quem cria conversas é a gestão. As conversas directas nascem dentro de
-- funções `SECURITY DEFINER`, que não passam por estas políticas.
DROP POLICY IF EXISTS conversations_insert ON public.conversations;
CREATE POLICY conversations_insert ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager() AND conversations.created_by = auth.uid());

-- Só a gestão acrescenta participantes. Antes, qualquer membro podia meter
-- quem quisesse dentro de uma conversa — foi por aí que o cliente acabou num
-- grupo de três.
DROP POLICY IF EXISTS conversation_members_insert ON public.conversation_members;
CREATE POLICY conversation_members_insert ON public.conversation_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager());

-- ------------------------------- 6. CONVERSAS ANTIGAS: GRUPO → PRIVADO
-- Um grupo criado por um cliente passa a conversa directa com o gestor que
-- já lá estava. As mensagens ficam: muda o `type`, saem os restantes membros.
DO $$
DECLARE
  r         record;
  v_cliente uuid;
  v_gestor  uuid;
BEGIN
  FOR r IN
    SELECT c.id, c.created_by
    FROM public.conversations c
    JOIN public.profiles p ON p.id = c.created_by
    WHERE c.type = 'group' AND p.role = 'customer'::public.user_role
  LOOP
    v_cliente := r.created_by;

    SELECT m.user_id INTO v_gestor
    FROM public.conversation_members m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.conversation_id = r.id AND p.role = 'manager'::public.user_role
    LIMIT 1;

    IF v_gestor IS NULL THEN
      SELECT p.id INTO v_gestor
      FROM public.profiles p
      WHERE p.role = 'manager'::public.user_role AND p.is_active
      ORDER BY p.created_at
      LIMIT 1;
    END IF;

    -- Sem gestor não há para onde converter: deixa-se como está e a gestão
    -- resolve à mão.
    CONTINUE WHEN v_gestor IS NULL;

    DELETE FROM public.conversation_members m
    WHERE m.conversation_id = r.id
      AND m.user_id NOT IN (v_cliente, v_gestor);

    -- Primeiro deixa de ser grupo; só depois volta a entrar o cliente. Ao
    -- contrário, o gatilho da secção 4 recusava-o — e com razão.
    UPDATE public.conversations
    SET type = 'direct', title = NULL
    WHERE id = r.id;

    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (r.id, v_cliente, 'member'), (r.id, v_gestor, 'admin')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    DELETE FROM public.groups g WHERE g.conversation_id = r.id;
  END LOOP;
END $$;

-- ------------------------------------------------------------ 7. PERMISSÕES
GRANT EXECUTE ON FUNCTION public.e_membro_equipa(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.abrir_conversa_equipa()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_grupo_equipa(text, uuid[])        TO authenticated;
GRANT EXECUTE ON FUNCTION public.adicionar_membro_grupo(uuid, uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_membro_grupo(uuid, uuid)        TO authenticated;
