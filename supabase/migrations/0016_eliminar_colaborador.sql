-- =============================================================================
--  0016 — ELIMINAR COLABORADOR (E AS SUAS VENDAS)
-- =============================================================================
--  A gestão passa a poder apagar um colaborador por completo. Não é
--  «desactivar»: é remover a conta, as vendas que fez e tudo o que pendia
--  dela. É irreversível, e por isso há duas funções:
--
--    `impacto_eliminar_colaborador(id)` — só lê. Diz exactamente o que vai
--    desaparecer (vendas, unidades, volume, comissões, pagamentos, pedidos de
--    levantamento, clientes, mensagens, encomendas). É o que a ficha mostra
--    antes de perguntar «tem a certeza?».
--
--    `eliminar_colaborador(id, motivo)` — apaga. Só gestão, nunca o próprio,
--    nunca outro gestor, e um gestor provincial só dentro da sua província.
--
--  PORQUE É QUE NÃO BASTA `DELETE FROM auth.users`
--  Várias tabelas apontam para `profiles` sem `ON DELETE`, e essas bloqueiam
--  o apagamento. A ordem abaixo limpa-as primeiro; o que é `ON DELETE
--  CASCADE` (comissões, carteira, reservas, levantamentos, favoritos,
--  conversas) cai sozinho quando o perfil sai. As que apontam para
--  `auth.users` sem regra e são NOT NULL (mensagens, publicações, encomendas
--  e reservas em nome próprio) têm de sair à mão.
-- =============================================================================

-- ------------------------------------------------------------------- IMPACTO
CREATE OR REPLACE FUNCTION public.impacto_eliminar_colaborador(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_perfil  record;
  v_vendas  int;
  v_unidades int;
  v_volume  numeric(12,2);
  v_comissoes int;
  v_comissoes_valor numeric(12,2);
  v_pagos   numeric(12,2);
  v_levanta int;
  v_clientes int;
  v_reservas int;
  v_encomendas int;
  v_mensagens int;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode eliminar colaboradores' USING ERRCODE = '42501';
  END IF;

  SELECT p.id, p.full_name, p.referencia, p.role, p.provincia_id, p.avatar_url
    INTO v_perfil
  FROM public.profiles p
  WHERE p.id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(s.total_amount), 0)
    INTO v_vendas, v_volume
  FROM public.sales s
  WHERE s.seller_id = p_id;

  SELECT COALESCE(SUM(si.quantity), 0) INTO v_unidades
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  WHERE s.seller_id = p_id;

  SELECT COUNT(*), COALESCE(SUM(c.amount), 0)
    INTO v_comissoes, v_comissoes_valor
  FROM public.sale_commissions c
  WHERE c.seller_id = p_id;

  SELECT COALESCE(SUM(cp.amount), 0) INTO v_pagos
  FROM public.commission_payouts cp
  WHERE cp.seller_id = p_id;

  SELECT COUNT(*) INTO v_levanta
  FROM public.levantamentos l
  WHERE l.seller_id = p_id;

  SELECT COUNT(*) INTO v_clientes
  FROM public.seller_customers sc
  WHERE sc.seller_id = p_id;

  SELECT COUNT(*) INTO v_reservas
  FROM public.reservations r
  WHERE r.customer_id = p_id OR r.seller_id = p_id;

  SELECT COUNT(*) INTO v_encomendas
  FROM public.orders o
  WHERE o.customer_id = p_id;

  SELECT COUNT(*) INTO v_mensagens
  FROM public.messages m
  WHERE m.sender_id = p_id;

  RETURN jsonb_build_object(
    'id',              v_perfil.id,
    'nome',            v_perfil.full_name,
    'referencia',      v_perfil.referencia,
    'papel',           v_perfil.role,
    'provincia_id',    v_perfil.provincia_id,
    'vendas',          v_vendas,
    'unidades',        v_unidades,
    'volume',          v_volume,
    'comissoes',       v_comissoes,
    'comissoes_valor', v_comissoes_valor,
    'total_pago',      v_pagos,
    'levantamentos',   v_levanta,
    'clientes',        v_clientes,
    'reservas',        v_reservas,
    'encomendas',      v_encomendas,
    'mensagens',       v_mensagens
  );
END;
$$;

-- ------------------------------------------------------------------ ELIMINAR
CREATE OR REPLACE FUNCTION public.eliminar_colaborador(
  p_id     uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_resumo   jsonb;
  v_alvo     record;
  v_eu       uuid := auth.uid();
  v_nacional boolean;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode eliminar colaboradores' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Indique o colaborador a eliminar' USING ERRCODE = '22023';
  END IF;

  -- Ninguém se apaga a si próprio: é o gestor que ficaria sem conta a meio.
  IF p_id = v_eu THEN
    RAISE EXCEPTION 'Não pode eliminar a sua própria conta' USING ERRCODE = '42501';
  END IF;

  SELECT p.id, p.full_name, p.referencia, p.role, p.provincia_id
    INTO v_alvo
  FROM public.profiles p
  WHERE p.id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Outro gestor não se apaga por aqui: primeiro muda-se o papel.
  IF v_alvo.role = 'manager' THEN
    RAISE EXCEPTION 'Para eliminar um gestor, mude primeiro o papel dele'
      USING ERRCODE = '42501';
  END IF;

  -- Um gestor provincial só mexe na sua província.
  SELECT (p.is_national_admin OR p.provincia_id IS NULL) INTO v_nacional
  FROM public.profiles p
  WHERE p.id = v_eu;

  IF NOT COALESCE(v_nacional, false) THEN
    IF v_alvo.provincia_id IS DISTINCT FROM (SELECT p.provincia_id FROM public.profiles p WHERE p.id = v_eu) THEN
      RAISE EXCEPTION 'Sem permissão para eliminar colaboradores de outra província'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- O retrato do que vai desaparecer, guardado antes de tocar em nada.
  v_resumo := public.impacto_eliminar_colaborador(p_id);

  -- 1. O que aponta para `auth.users` sem regra e não pode ficar órfão.
  DELETE FROM public.messages   WHERE sender_id = p_id;
  DELETE FROM public.posts      WHERE author_id = p_id;
  DELETE FROM public.orders     WHERE customer_id = p_id;
  DELETE FROM public.reservations WHERE customer_id = p_id;

  -- 2. O que aponta para `auth.users` e só precisa de perder o autor.
  UPDATE public.order_status_history SET changed_by = NULL WHERE changed_by = p_id;
  UPDATE public.seller_customers     SET assigned_by = NULL WHERE assigned_by = p_id;
  UPDATE public.discount_requests    SET decided_by  = NULL WHERE decided_by  = p_id;
  UPDATE public.conversations        SET created_by  = NULL WHERE created_by  = p_id;
  UPDATE public.groups               SET created_by  = NULL WHERE created_by  = p_id;
  UPDATE public.user_roles           SET assigned_by = NULL WHERE assigned_by = p_id;
  UPDATE public.platform_settings    SET updated_by  = NULL WHERE updated_by  = p_id;
  -- O histórico de auditoria fica: perde o autor, guarda o que aconteceu.
  UPDATE public.audit_logs           SET user_id     = NULL WHERE user_id     = p_id;

  -- 3. O que aponta para `profiles` sem `ON DELETE` e é NOT NULL: as vendas.
  --    É o que o requisito pede — o colaborador sai com o que vendeu.
  DELETE FROM public.sales WHERE seller_id = p_id;

  -- 4. O que aponta para `profiles` e pode ficar sem dono.
  UPDATE public.orders            SET seller_id = NULL WHERE seller_id = p_id;
  UPDATE public.reservations      SET seller_id = NULL WHERE seller_id = p_id;
  UPDATE public.discount_requests SET seller_id = NULL WHERE seller_id = p_id;
  UPDATE public.seller_profiles   SET manager_id = NULL WHERE manager_id = p_id;

  -- 5. O perfil. As tabelas com `ON DELETE CASCADE` (comissões, pagamentos,
  --    levantamentos, carteira, reservas guardadas, metas, favoritos,
  --    conversas, notificações, formação) caem com ele.
  DELETE FROM public.profiles WHERE id = p_id;

  -- 6. A conta de autenticação, para o telefone voltar a poder registar-se e
  --    o login deixar de existir. Só se o schema `auth` estiver presente
  --    (nas bases de teste pode não estar).
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users') THEN
    DELETE FROM auth.users WHERE id = p_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data, new_data)
  VALUES (
    v_eu,
    'delete',
    'colaboradores',
    p_id,
    v_resumo,
    jsonb_build_object(
      'motivo', COALESCE(NULLIF(btrim(p_motivo), ''), 'não indicado'),
      'nome', v_alvo.full_name,
      'referencia', v_alvo.referencia
    )
  );

  RETURN v_resumo;
END;
$$;

REVOKE ALL ON FUNCTION public.impacto_eliminar_colaborador(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eliminar_colaborador(uuid, text)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.impacto_eliminar_colaborador(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_colaborador(uuid, text)  TO authenticated;
