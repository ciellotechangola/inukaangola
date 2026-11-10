-- =============================================================================
--  INUKA ANGOLA — PATCH: TAREFAS, GESTOR RESPONSÁVEL E CORRECÇÃO DE VENDAS
-- =============================================================================
--  Supabase -> SQL Editor -> New query -> colar tudo -> RUN
--  Idempotente. Pode ser executado mais do que uma vez sem perder dados.
--  Equivale à migração 0018_tarefas_e_gestor.sql (mesmo conteúdo).
--
--  O QUE RESOLVE
--    A ficha do colaborador ganha três coisas que faltavam: a gestão passa a
--    poder atribuir TAREFAS (com prazo e prioridade) que aparecem no perfil do
--    colaborador; passa a poder definir o GESTOR RESPONSÁVEL — a ficha dizia
--    «Gestor: não definido» e não havia forma de o escolher; e passa a poder
--    CORRIGIR UMA VENDA errada, mexendo nas linhas (quantidade e preço), com o
--    total e a comissão a acompanharem sozinhos.
--
--  Sem este patch a ficha mostra as secções vazias (PGRST205 na tabela nova).
--

-- =============================================================================
-- 0018 — Tarefas do colaborador, gestor responsável e correcção de vendas
-- =============================================================================
--
-- Três coisas que faltavam na ficha do colaborador:
--
--   1. TAREFAS. A gestão não tinha onde pedir uma coisa concreta a uma pessoa
--      («entregar o BI até sexta», «visitar a delegação do Negage»). O
--      colaborador tem agora uma lista no perfil dele, com prazo e prioridade,
--      e marca o que já fez. Só a gestão cria e apaga; o colaborador só muda o
--      estado — é o que separa «tarefa» de «campo livre».
--
--   2. GESTOR RESPONSÁVEL. `seller_profiles.manager_id` existia desde a 0001 e
--      nunca teve interface: a ficha dizia «Gestor: não definido» e não havia
--      como o definir. Passa a haver lista de candidatos (o gestor máximo e os
--      gestores da província do colaborador) e uma RPC que valida a escolha.
--
--   3. CORRIGIR VENDAS. O total de uma venda não é um campo livre: é a soma das
--      linhas (`trg_recalc_sale_total`) e é dela que sai a comissão
--      (`trg_fill_commission`). Por isso a correcção faz-se nas LINHAS —
--      quantidade e preço unitário — e o resto acompanha sozinho. Falta a
--      política que deixa a gestão escrever nas linhas e uma guarda para não
--      mexer em vendas cuja comissão já foi paga.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. TAREFAS DO COLABORADOR
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.colaborador_tarefas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  titulo       text NOT NULL,
  descricao    text,
  prazo        date,
  prioridade   text NOT NULL DEFAULT 'normal',
  estado       text NOT NULL DEFAULT 'pendente',
  criado_por   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  concluida_em timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tarefa_titulo_nao_vazio CHECK (length(btrim(titulo)) > 0),
  CONSTRAINT tarefa_prioridade_valida CHECK (prioridade IN ('baixa', 'normal', 'alta')),
  CONSTRAINT tarefa_estado_valido     CHECK (estado IN ('pendente', 'concluida', 'cancelada'))
);

-- A lista que interessa é sempre «as tarefas de uma pessoa, por fazer».
CREATE INDEX IF NOT EXISTS idx_tarefas_seller ON public.colaborador_tarefas (seller_id, estado, prazo);

COMMENT ON TABLE public.colaborador_tarefas IS
  'Tarefas que a gestão atribui a um colaborador. O colaborador só pode mudar o estado.';


-- A data de conclusão acompanha o estado: não se pede a ninguém que a escreva.
CREATE OR REPLACE FUNCTION public.tarefa_marca_conclusao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.estado = 'concluida' AND NEW.concluida_em IS NULL THEN
    NEW.concluida_em := now();
  ELSIF NEW.estado <> 'concluida' THEN
    NEW.concluida_em := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tarefa_conclusao ON public.colaborador_tarefas;
CREATE TRIGGER trg_tarefa_conclusao
BEFORE INSERT OR UPDATE ON public.colaborador_tarefas
FOR EACH ROW EXECUTE FUNCTION public.tarefa_marca_conclusao();


-- Posso gerir as tarefas desta pessoa? (gestão + província)
--
-- Vive numa função porque a mesma pergunta aparece em cinco políticas e, escrita
-- à mão em cada uma, a província acabava por ser esquecida numa delas.
CREATE OR REPLACE FUNCTION public.pode_gerir_colaborador(p_seller uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.is_manager()
     AND public.can_manage_province(
           (SELECT p.provincia_id FROM public.profiles p WHERE p.id = p_seller)
         );
$$;

GRANT EXECUTE ON FUNCTION public.pode_gerir_colaborador(uuid) TO authenticated;


-- O colaborador muda o estado; o resto do texto é da gestão.
--
-- A política de UPDATE não consegue comparar o valor antigo com o novo, por
-- isso a regra fica num trigger: sem ele, um colaborador podia reescrever o
-- título da tarefa que a gestão lhe deu.
CREATE OR REPLACE FUNCTION public.tarefa_so_estado_pelo_colaborador()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF public.is_manager() THEN
    RETURN NEW;
  END IF;

  IF NEW.seller_id  IS DISTINCT FROM OLD.seller_id
     OR NEW.titulo    IS DISTINCT FROM OLD.titulo
     OR NEW.descricao IS DISTINCT FROM OLD.descricao
     OR NEW.prazo     IS DISTINCT FROM OLD.prazo
     OR NEW.prioridade IS DISTINCT FROM OLD.prioridade
     OR NEW.criado_por IS DISTINCT FROM OLD.criado_por THEN
    RAISE EXCEPTION 'O colaborador só pode marcar a tarefa como concluída'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tarefa_so_estado ON public.colaborador_tarefas;
CREATE TRIGGER trg_tarefa_so_estado
BEFORE UPDATE ON public.colaborador_tarefas
FOR EACH ROW EXECUTE FUNCTION public.tarefa_so_estado_pelo_colaborador();


ALTER TABLE public.colaborador_tarefas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tarefas_select ON public.colaborador_tarefas;
CREATE POLICY tarefas_select ON public.colaborador_tarefas
  FOR SELECT TO authenticated
  USING (
    colaborador_tarefas.seller_id = auth.uid()
    OR public.pode_gerir_colaborador(colaborador_tarefas.seller_id)
  );

DROP POLICY IF EXISTS tarefas_insert_gestor ON public.colaborador_tarefas;
CREATE POLICY tarefas_insert_gestor ON public.colaborador_tarefas
  FOR INSERT TO authenticated
  WITH CHECK (
    public.pode_gerir_colaborador(colaborador_tarefas.seller_id)
    AND colaborador_tarefas.criado_por = auth.uid()
  );

DROP POLICY IF EXISTS tarefas_update ON public.colaborador_tarefas;
CREATE POLICY tarefas_update ON public.colaborador_tarefas
  FOR UPDATE TO authenticated
  USING (
    colaborador_tarefas.seller_id = auth.uid()
    OR public.pode_gerir_colaborador(colaborador_tarefas.seller_id)
  )
  WITH CHECK (
    colaborador_tarefas.seller_id = auth.uid()
    OR public.pode_gerir_colaborador(colaborador_tarefas.seller_id)
  );

DROP POLICY IF EXISTS tarefas_delete_gestor ON public.colaborador_tarefas;
CREATE POLICY tarefas_delete_gestor ON public.colaborador_tarefas
  FOR DELETE TO authenticated
  USING (public.pode_gerir_colaborador(colaborador_tarefas.seller_id));


-- -----------------------------------------------------------------------------
-- 2. GESTOR RESPONSÁVEL
-- -----------------------------------------------------------------------------

-- Quem pode ser gestor desta pessoa?
--
-- O gestor máximo (administração nacional) serve qualquer colaborador; um
-- gestor provincial só faz sentido para quem é da mesma província — atribuir
-- alguém de outro província daria acesso que a pessoa não tem sobre o território.
CREATE OR REPLACE FUNCTION public.gestores_para_colaborador(p_seller uuid)
RETURNS TABLE (
  id           uuid,
  nome         text,
  provincia_id uuid,
  provincia    text,
  nacional     boolean,
  eu           boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_eu       uuid := auth.uid();
  v_prov     uuid;
BEGIN
  IF v_eu IS NULL THEN
    RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501';
  END IF;

  SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = p_seller;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Quem não é da gestão desta pessoa não tem nada a fazer com esta lista.
  IF NOT public.pode_gerir_colaborador(p_seller) THEN
    RAISE EXCEPTION 'Sem permissão para gerir este colaborador' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    g.id,
    g.full_name,
    g.provincia_id,
    pr.nome,
    (g.is_national_admin OR g.provincia_id IS NULL) AS nacional,
    (g.id = v_eu) AS eu
  FROM public.profiles g
  LEFT JOIN public.provincias pr ON pr.id = g.provincia_id
  WHERE g.role = 'manager'
    AND g.is_active
    AND g.id <> p_seller
    AND (
      g.is_national_admin
      OR g.provincia_id IS NULL
      OR (v_prov IS NOT NULL AND g.provincia_id = v_prov)
    )
  ORDER BY (g.is_national_admin OR g.provincia_id IS NULL) DESC, g.full_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gestores_para_colaborador(uuid) TO authenticated;


-- Atribuir (ou limpar) o gestor responsável.
--
-- Existe em vez de deixar o formulário escrever `manager_id` às cegas: sem esta
-- validação, um id qualquer — de um cliente, de outra província, de uma conta
-- desativada — entrava na ficha e a coluna aceitava-o.
CREATE OR REPLACE FUNCTION public.definir_gestor_colaborador(
  p_seller  uuid,
  p_manager uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_eu     uuid := auth.uid();
  v_prov   uuid;
  v_alvo   record;
  v_antigo uuid;
  v_nome   text;
BEGIN
  IF v_eu IS NULL THEN
    RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão define o gestor responsável' USING ERRCODE = '42501';
  END IF;

  SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = p_seller;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Sem permissão para gerir colaboradores de outra província'
      USING ERRCODE = '42501';
  END IF;

  IF p_manager IS NOT NULL AND p_manager = p_seller THEN
    RAISE EXCEPTION 'Uma pessoa não pode ser gestora de si própria' USING ERRCODE = '22023';
  END IF;

  SELECT p.id, p.full_name, p.role, p.is_active, p.provincia_id, p.is_national_admin
    INTO v_alvo
  FROM public.profiles p
  WHERE p.id = p_manager;

  IF p_manager IS NOT NULL THEN
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gestor não encontrado' USING ERRCODE = 'P0002';
    END IF;
    IF v_alvo.role <> 'manager' THEN
      RAISE EXCEPTION '% não é gestor', v_alvo.full_name USING ERRCODE = '22023';
    END IF;
    IF NOT v_alvo.is_active THEN
      RAISE EXCEPTION 'A conta de % está desativada', v_alvo.full_name USING ERRCODE = '22023';
    END IF;
    IF NOT (v_alvo.is_national_admin OR v_alvo.provincia_id IS NULL)
       AND v_alvo.provincia_id IS DISTINCT FROM v_prov THEN
      RAISE EXCEPTION 'Esse gestor é de outra província' USING ERRCODE = '22023';
    END IF;
    v_nome := v_alvo.full_name;
  END IF;

  -- A ficha pode não existir (colaborador criado antes da 0006, por exemplo).
  INSERT INTO public.seller_profiles (id) VALUES (p_seller)
  ON CONFLICT (id) DO NOTHING;

  SELECT sp.manager_id INTO v_antigo FROM public.seller_profiles sp WHERE sp.id = p_seller;

  UPDATE public.seller_profiles
  SET manager_id = p_manager, updated_at = now()
  WHERE id = p_seller;

  RETURN jsonb_build_object(
    'ok', true,
    'seller_id', p_seller,
    'anterior', v_antigo,
    'gestor_id', p_manager,
    'gestor_nome', v_nome
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.definir_gestor_colaborador(uuid, uuid) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. CORRIGIR VENDAS
-- -----------------------------------------------------------------------------

-- A gestão passa a poder escrever nas linhas da venda (quantidade e preço).
-- Sem isto, o painel de correcção não tinha como gravar: só existiam políticas
-- de leitura e de inserção pelo próprio colaborador.
DROP POLICY IF EXISTS sale_items_update_manager ON public.sale_items;
CREATE POLICY sale_items_update_manager ON public.sale_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND public.is_manager()
        AND public.can_manage_province(s.provincia_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND public.is_manager()
        AND public.can_manage_province(s.provincia_id)
    )
  );

DROP POLICY IF EXISTS sale_items_delete_manager ON public.sale_items;
CREATE POLICY sale_items_delete_manager ON public.sale_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND public.is_manager()
        AND public.can_manage_province(s.provincia_id)
    )
  );


-- Dinheiro já pago não se reescreve.
--
-- O `trg_fill_commission` já recusa anular uma comissão paga, mas deixa passar a
-- alteração da venda — e ficava uma venda de 50 000 Kz com uma comissão de
-- 36 000. Aqui a operação inteira é recusada, com uma mensagem que diz o que
-- fazer primeiro.
CREATE OR REPLACE FUNCTION public.venda_com_comissao_paga_nao_muda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.total_amount IS NOT DISTINCT FROM OLD.total_amount
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sale_commissions c
    WHERE c.sale_id = NEW.id AND c.status = 'paid'
  ) THEN
    RAISE EXCEPTION
      'Esta venda já tem a comissão paga. Anule o pagamento antes de a corrigir.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_venda_paga_nao_muda ON public.sales;
CREATE TRIGGER trg_venda_paga_nao_muda
BEFORE UPDATE OF total_amount, status ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.venda_com_comissao_paga_nao_muda();
