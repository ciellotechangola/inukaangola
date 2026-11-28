-- =============================================================================
--  INUKA ANGOLA — PATCH: SITUAÇÃO DA VENDA E SALDOS POR COLABORADOR
-- =============================================================================
--  Supabase -> SQL Editor -> New query -> colar tudo -> RUN
--  Idempotente. Pode ser executado mais do que uma vez sem perder dados.
--  Equivale à migração 0034_situacao_da_venda.sql (mesmo conteúdo).
--  Requer a 0001 a 0024 já aplicadas (vendas, comissões, levantamentos).
--
--  O QUE RESOLVE
--    · A venda passa a ter uma situação que muda: PENDENTE -> PAGO, com quem
--      confirmou e quando. Antes nascia «paga» ou «pendente» e ficava assim.
--    · Três saldos separados por colaborador:
--          contabilístico (todas as vendas — desempenho, meta)
--          pendente       (vendas por confirmar — dinheiro possível)
--          activo         (vendas confirmadas — dinheiro recebido)
--      e, ao lado, a comissão: por pagar / ganho / pago / reservado /
--      disponível para levantamento.
--    · Histórico: `sale_events` guarda registo, confirmação, reabertura,
--      correcção e anulação — com autor, data e motivo. Ninguém o pode editar.
--    · Confirmar o pagamento **não** cria vendas nem soma outra vez: move o
--      mesmo valor de «pendente» para «activo».
--
--  O QUE NÃO MUDA
--    · Preços, stock, comissões e regras de levantamento. A comissão continua
--      a ser calculada pelo `fill_commission()` e paga pelo `pagar_comissoes()`.
--
--  DEPOIS DE CORRER
--    SELECT public.saldo_colaborador('<uuid do colaborador>');
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. A CONFIRMAÇÃO DO PAGAMENTO NA PRÓPRIA VENDA
-- -----------------------------------------------------------------------------
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_confirmed_by uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.sales.payment_confirmed_at IS
  'Quando a gestão confirmou que o dinheiro da venda entrou. NULL = por confirmar.';
COMMENT ON COLUMN public.sales.payment_confirmed_by IS
  'Quem confirmou o pagamento (gestão). NULL nas vendas confirmadas antes da 0034.';

-- Uma venda marcada como paga antes desta migração não tem data de confirmação.
-- Usa-se a última alteração como aproximação — é melhor do que inventar `now()`,
-- que faria parecer que todas foram confirmadas hoje.
UPDATE public.sales
SET payment_confirmed_at = COALESCE(updated_at, created_at)
WHERE payment_status = 'paid' AND payment_confirmed_at IS NULL;

-- Índice do que o gerente filtra: «as pendentes desta pessoa».
CREATE INDEX IF NOT EXISTS idx_sales_seller_estado
  ON public.sales (seller_id, payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_pendentes
  ON public.sales (provincia_id, payment_status, created_at DESC)
  WHERE payment_status <> 'paid';


-- -----------------------------------------------------------------------------
-- 2. O LIVRO DE ALTERAÇÕES DA VENDA
-- -----------------------------------------------------------------------------
-- Não se apaga: `ON DELETE CASCADE` só dispara se a venda desaparecer, e uma
-- venda com histórico não se apaga (a gestão anula, não elimina).
CREATE TABLE IF NOT EXISTS public.sale_events (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id  uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  tipo     text NOT NULL,
  de       text,
  para     text,
  detalhe  text,
  por      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  em       timestamptz NOT NULL DEFAULT now(),
  -- `em` não ordena sozinho: dois acontecimentos do mesmo instante (o registo e
  -- o cálculo do total, ambos dentro da mesma transacção) ficariam à sorte.
  -- `ordem` é a ordem real em que foram escritos.
  ordem    bigserial,
  CONSTRAINT sale_event_tipo_valido CHECK (tipo IN (
    'registo', 'pagamento_confirmado', 'pagamento_reaberto',
    'correcao', 'anulacao', 'reabertura'
  ))
);

-- Uma base onde a tabela já exista (corrida anterior desta migração) ganha a
-- coluna na mesma.
ALTER TABLE public.sale_events ADD COLUMN IF NOT EXISTS ordem bigserial;

CREATE INDEX IF NOT EXISTS idx_sale_events_sale
  ON public.sale_events (sale_id, ordem);

COMMENT ON TABLE public.sale_events IS
  'Histórico financeiro de cada venda: quem mudou o quê, quando e porquê.';

ALTER TABLE public.sale_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_events_read ON public.sale_events;
CREATE POLICY sale_events_read ON public.sale_events
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_events.sale_id AND s.seller_id = auth.uid()
    )
  );

-- Sem política de INSERT/UPDATE/DELETE: só o gatilho (SECURITY DEFINER)
-- escreve. Um histórico que o próprio pode editar não é um histórico.

-- O gatilho que escreve o livro. A RPC pode deixar uma nota em
-- `inuka.evento_detalhe`, que é lida aqui e limpa logo a seguir.
CREATE OR REPLACE FUNCTION public.sale_regista_evento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_det text := NULLIF(current_setting('inuka.evento_detalhe', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.sale_events (sale_id, tipo, de, para, detalhe, por, em)
    VALUES (NEW.id, 'registo', NULL, NEW.payment_status::text, v_det,
            COALESCE(auth.uid(), NEW.seller_id), NEW.created_at);
    RETURN NEW;
  END IF;

  -- Confirmação / reabertura do pagamento.
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    INSERT INTO public.sale_events (sale_id, tipo, de, para, detalhe, por, em)
    VALUES (
      NEW.id,
      CASE WHEN NEW.payment_status = 'paid' THEN 'pagamento_confirmado'
           ELSE 'pagamento_reaberto' END,
      OLD.payment_status::text,
      NEW.payment_status::text,
      v_det,
      auth.uid(),
      now()
    );
  END IF;

  -- Anulação.
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    INSERT INTO public.sale_events (sale_id, tipo, de, para, detalhe, por, em)
    VALUES (NEW.id, 'anulacao', OLD.status::text, 'cancelled', v_det, auth.uid(), now());
  END IF;

  -- Correcção do valor (sem mudança de estado).
  -- `OLD.total_amount <> 0` porque uma venda nasce a zero e é o totalizador dos
  -- itens que lhe põe o valor: isso não é uma correcção, é o parto da venda.
  -- Sem esta condição, todas as vendas traziam uma «correcção» 0 → valor que
  -- ninguém fez.
  IF NEW.total_amount IS DISTINCT FROM OLD.total_amount
     AND OLD.total_amount <> 0
     AND NEW.payment_status IS NOT DISTINCT FROM OLD.payment_status
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    INSERT INTO public.sale_events (sale_id, tipo, de, para, detalhe, por, em)
    VALUES (NEW.id, 'correcao', OLD.total_amount::text, NEW.total_amount::text,
            v_det, auth.uid(), now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_evento ON public.sales;
CREATE TRIGGER trg_sale_evento
AFTER INSERT OR UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.sale_regista_evento();

-- Uma venda antiga não tem histórico nenhum. Em vez de a mostrar «sem
-- registos», escreve-se a entrada de origem — a partir daqui todas têm pelo
-- menos uma linha, e o ecrã não precisa de um caso especial.
INSERT INTO public.sale_events (sale_id, tipo, de, para, detalhe, por, em)
SELECT s.id, 'registo', NULL, s.payment_status::text,
       'Venda anterior ao histórico (0034)', s.seller_id, s.created_at
FROM public.sales s
WHERE NOT EXISTS (SELECT 1 FROM public.sale_events e WHERE e.sale_id = s.id);

INSERT INTO public.sale_events (sale_id, tipo, de, para, detalhe, por, em)
SELECT s.id, 'pagamento_confirmado', 'pending', 'paid',
       'Confirmada antes de haver registo de autor', NULL,
       COALESCE(s.payment_confirmed_at, s.updated_at, s.created_at)
FROM public.sales s
WHERE s.payment_status = 'paid'
  AND NOT EXISTS (
    SELECT 1 FROM public.sale_events e
    WHERE e.sale_id = s.id AND e.tipo = 'pagamento_confirmado'
  );


-- -----------------------------------------------------------------------------
-- 3. QUEM PODE CONFIRMAR — E O QUE NÃO PODE ACONTECER
-- -----------------------------------------------------------------------------
-- Regras, todas na base (o browser não decide nada):
--   · só a gestão, e só dentro do seu âmbito provincial;
--   · a linha é trancada (`FOR UPDATE`) — dois cliques ao mesmo tempo não
--     confirmam duas vezes;
--   · venda já paga → erro explícito, não um «ok» silencioso que faria crer
--     que se somou outra vez;
--   · venda anulada → erro.
CREATE OR REPLACE FUNCTION public.confirmar_pagamento_venda(p_venda uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_s   public.sales;
  v_por text;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão confirma pagamentos.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_s FROM public.sales WHERE id = p_venda FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda inexistente.';
  END IF;

  IF NOT public.can_see_province(v_s.provincia_id) THEN
    RAISE EXCEPTION 'Esta venda é de outra província.' USING ERRCODE = '42501';
  END IF;

  IF v_s.status = 'cancelled' THEN
    RAISE EXCEPTION 'Esta venda está anulada — não há pagamento a confirmar.';
  END IF;

  IF v_s.payment_status = 'paid' THEN
    RAISE EXCEPTION 'Esta venda já está confirmada como paga.';
  END IF;

  UPDATE public.sales
  SET payment_status       = 'paid',
      payment_confirmed_at = now(),
      payment_confirmed_by = auth.uid(),
      updated_at           = now()
  WHERE id = p_venda;

  SELECT p.full_name INTO v_por FROM public.profiles p WHERE p.id = auth.uid();

  RETURN jsonb_build_object(
    'venda_id', p_venda,
    'estado', 'paid',
    'confirmado_em', now(),
    'confirmado_por', COALESCE(v_por, 'Gestão'),
    'valor', v_s.total_amount,
    'saldo', public.saldo_colaborador(v_s.seller_id)
  );
END;
$$;

-- Reabrir é o contrário — e é uma operação de risco: se a comissão já foi paga
-- ao colaborador, o dinheiro saiu duas vezes. A base recusa nesse caso.
CREATE OR REPLACE FUNCTION public.reabrir_pagamento_venda(
  p_venda  uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_s public.sales;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão reabre pagamentos.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_s FROM public.sales WHERE id = p_venda FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda inexistente.';
  END IF;

  IF NOT public.can_see_province(v_s.provincia_id) THEN
    RAISE EXCEPTION 'Esta venda é de outra província.' USING ERRCODE = '42501';
  END IF;

  IF v_s.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Esta venda ainda não estava confirmada.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sale_commissions c
    WHERE c.sale_id = p_venda AND c.status = 'paid'
  ) THEN
    RAISE EXCEPTION
      'A comissão desta venda já foi paga ao colaborador. Anule o levantamento antes de reabrir.'
      USING ERRCODE = '42501';
  END IF;

  -- A nota do evento viaja por aqui: o gatilho lê e o valor é limpo a seguir.
  PERFORM set_config('inuka.evento_detalhe', COALESCE(p_motivo, ''), true);

  UPDATE public.sales
  SET payment_status       = 'pending',
      payment_confirmed_at = NULL,
      payment_confirmed_by = NULL,
      updated_at           = now()
  WHERE id = p_venda;

  PERFORM set_config('inuka.evento_detalhe', '', true);

  RETURN jsonb_build_object(
    'venda_id', p_venda,
    'estado', 'pending',
    'saldo', public.saldo_colaborador(v_s.seller_id)
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. OS TRÊS SALDOS DE UM COLABORADOR
-- -----------------------------------------------------------------------------
-- Duas leituras do mesmo dinheiro, de propósito separadas:
--
--   VENDA (o que o colaborador vendeu)
--     contabilistico = todas as vendas não anuladas  (desempenho, meta)
--     pendente       = as que ainda não estão pagas  (por receber)
--     activo         = as confirmadas como pagas     (recebido)
--
--   COMISSÃO (o que o colaborador tem a receber)
--     por_pagar  = comissões de vendas ainda não confirmadas
--     ganho      = comissões de vendas confirmadas
--     pago       = o que já lhe foi entregue
--     reservado  = levantamentos em curso
--     disponivel = ganho − pago − reservado  (é o que se pode levantar)
--
-- O valor de venda **não** é dinheiro do colaborador: o que ele recebe é a
-- comissão. Misturar os dois era o que fazia um colaborador pensar que tinha
-- 30.000 Kz disponíveis por uma venda de 30.000 Kz.
CREATE OR REPLACE FUNCTION public.saldo_colaborador(p_seller uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_id        uuid := COALESCE(p_seller, auth.uid());
  v_p         public.profiles;
  v_contab    numeric(14,2) := 0;
  v_pendente  numeric(14,2) := 0;
  v_activo    numeric(14,2) := 0;
  v_n_contab  int := 0;
  v_n_pend    int := 0;
  v_n_activo  int := 0;
  v_levant    jsonb;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_view_collaborator(v_id) THEN
    RAISE EXCEPTION 'Sem permissão para ver este saldo' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_p FROM public.profiles WHERE id = v_id;

  SELECT COALESCE(SUM(s.total_amount), 0), COUNT(*)
  INTO v_contab, v_n_contab
  FROM public.sales s
  WHERE s.seller_id = v_id AND s.status <> 'cancelled';

  SELECT COALESCE(SUM(s.total_amount), 0), COUNT(*)
  INTO v_pendente, v_n_pend
  FROM public.sales s
  WHERE s.seller_id = v_id AND s.status <> 'cancelled' AND s.payment_status <> 'paid';

  SELECT COALESCE(SUM(s.total_amount), 0), COUNT(*)
  INTO v_activo, v_n_activo
  FROM public.sales s
  WHERE s.seller_id = v_id AND s.status <> 'cancelled' AND s.payment_status = 'paid';

  -- A parte do dinheiro que se levanta é a mesma de sempre: `levantamento_resumo`.
  v_levant := public.levantamento_resumo(v_id);

  RETURN jsonb_build_object(
    'seller_id', v_id,
    'nome', v_p.full_name,
    'vendas', jsonb_build_object(
      'contabilistico', v_contab,
      'pendente', v_pendente,
      'activo', v_activo,
      'count', v_n_contab,
      'count_pendente', v_n_pend,
      'count_activo', v_n_activo
    ),
    'comissoes', jsonb_build_object(
      'por_pagar', v_levant -> 'comissoes_pendentes',
      'ganho', v_levant -> 'comissoes_ganhas',
      'pago', v_levant -> 'total_pago',
      'reservado', v_levant -> 'reservado',
      'disponivel', v_levant -> 'disponivel',
      'taxa', v_levant -> 'taxa'
    ),
    'levantamento', jsonb_build_object(
      'habilitado', v_levant -> 'habilitado',
      'vendas_faltam', v_levant -> 'vendas_faltam',
      'vendas_minimas', v_levant -> 'vendas_minimas'
    )
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 5. A LISTA DE VENDAS DA GESTÃO
-- -----------------------------------------------------------------------------
-- Uma chamada devolve os totais do âmbito e as linhas já filtradas — a página
-- não tem de somar nada no cliente nem pedir duas vezes.
CREATE OR REPLACE FUNCTION public.vendas_gestao(
  p_estado  text DEFAULT NULL,
  p_seller  uuid DEFAULT NULL,
  p_limite  int  DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov  uuid := CASE WHEN public.is_national() THEN NULL ELSE public.my_province() END;
  v_lim   int  := LEAST(GREATEST(COALESCE(p_limite, 200), 1), 1000);
  v_est   text := CASE WHEN p_estado IN ('pendente', 'pago') THEN p_estado ELSE NULL END;
  v_out   jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão vê as vendas da rede' USING ERRCODE = '42501';
  END IF;

  WITH base AS (
    SELECT s.id, s.reference, s.total_amount, s.payment_status, s.status,
           s.created_at, s.payment_method,
           s.payment_confirmed_at,
           s.seller_id,
           p.full_name  AS seller_nome,
           p.phone      AS seller_telefone,
           cb.full_name AS confirmado_por,
           COALESCE(s.provincia_id, p.provincia_id) AS prov,
           (SELECT count(*) FROM public.sale_items si WHERE si.sale_id = s.id) AS linhas,
           (SELECT count(*) FROM public.sale_events ev WHERE ev.sale_id = s.id) AS eventos
    FROM public.sales s
    JOIN public.profiles p ON p.id = s.seller_id
    LEFT JOIN public.profiles cb ON cb.id = s.payment_confirmed_by
    WHERE (v_prov IS NULL OR COALESCE(s.provincia_id, p.provincia_id) = v_prov)
      AND (p_seller IS NULL OR s.seller_id = p_seller)
  ),
  filtrado AS (
    SELECT * FROM base
    WHERE v_est IS NULL
       OR (v_est = 'pago' AND payment_status = 'paid')
       OR (v_est = 'pendente' AND payment_status <> 'paid')
  )
  SELECT jsonb_build_object(
    'scope', CASE WHEN v_prov IS NULL THEN 'nacional' ELSE 'provincial' END,
    'totais', jsonb_build_object(
      'vendas',          (SELECT count(*) FROM base),
      'valor',           (SELECT COALESCE(SUM(total_amount), 0) FROM base),
      'pendentes',       (SELECT count(*) FROM base WHERE payment_status <> 'paid'),
      'valor_pendente',  (SELECT COALESCE(SUM(total_amount), 0) FROM base WHERE payment_status <> 'paid'),
      'pagas',           (SELECT count(*) FROM base WHERE payment_status = 'paid'),
      'valor_pago',      (SELECT COALESCE(SUM(total_amount), 0) FROM base WHERE payment_status = 'paid')
    ),
    'linhas', COALESCE((
      SELECT jsonb_agg(t ORDER BY t.created_at DESC)
      FROM (
        SELECT id, reference, total_amount, payment_status::text AS payment_status,
               status::text AS status, created_at, payment_method,
               payment_confirmed_at, seller_id, seller_nome, seller_telefone,
               confirmado_por, linhas, eventos
        FROM filtrado
        ORDER BY created_at DESC
        LIMIT v_lim
      ) t
    ), '[]'::jsonb)
  )
  INTO v_out;

  RETURN v_out;
END;
$$;


-- -----------------------------------------------------------------------------
-- 5b. OS SALDOS DA EQUIPA, UMA LINHA POR COLABORADOR
-- -----------------------------------------------------------------------------
-- A lista que a gestão abre primeiro: quem vendeu quanto, quanto está por
-- confirmar, quanto já entrou e quanto cada um pode levantar. É a mesma conta
-- do `saldo_colaborador()`, feita de uma vez para toda a gente — uma chamada
-- em vez de uma por pessoa.
CREATE OR REPLACE FUNCTION public.saldos_equipa(p_provincia uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  -- Um gestor provincial não escolhe província: vê a dele, e mais nada.
  v_prov uuid := CASE WHEN public.is_national() THEN p_provincia
                      ELSE public.my_province() END;
  v_out  jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão vê os saldos da equipa' USING ERRCODE = '42501';
  END IF;

  WITH equipa AS (
    -- Quem é «colaborador»: tem o papel, tem ficha de vendedor, ou já vendeu.
    -- O último critério apanha o gestor que também vende — o dinheiro dele não
    -- pode desaparecer da lista só por causa do papel.
    SELECT p.id, p.full_name, p.phone, p.is_active, p.provincia_id,
           pr.nome AS provincia_nome, pr.codigo AS provincia_codigo
    FROM public.profiles p
    LEFT JOIN public.provincias pr ON pr.id = p.provincia_id
    WHERE (p.role = 'seller'
           OR EXISTS (SELECT 1 FROM public.seller_profiles sp WHERE sp.id = p.id)
           OR EXISTS (SELECT 1 FROM public.sales s WHERE s.seller_id = p.id))
      AND (v_prov IS NULL OR p.provincia_id = v_prov)
  ),
  vendas AS (
    SELECT s.seller_id,
           COUNT(*) FILTER (WHERE s.status <> 'cancelled') AS n,
           COALESCE(SUM(s.total_amount)
             FILTER (WHERE s.status <> 'cancelled'), 0) AS contabilistico,
           COALESCE(SUM(s.total_amount)
             FILTER (WHERE s.status <> 'cancelled'
                       AND s.payment_status <> 'paid'), 0) AS pendente,
           COALESCE(SUM(s.total_amount)
             FILTER (WHERE s.status <> 'cancelled'
                       AND s.payment_status = 'paid'), 0) AS activo,
           COUNT(*) FILTER (WHERE s.status <> 'cancelled'
                              AND s.payment_status <> 'paid') AS n_pendente,
           COUNT(*) FILTER (WHERE s.status <> 'cancelled'
                              AND s.payment_status = 'paid') AS n_activo
    FROM public.sales s
    GROUP BY s.seller_id
  ),
  comissoes AS (
    SELECT c.seller_id,
           COALESCE(SUM(c.amount) FILTER (WHERE c.status <> 'cancelled'
             AND s.status = 'completed' AND s.payment_status = 'paid'), 0) AS ganho,
           COALESCE(SUM(c.amount) FILTER (WHERE c.status <> 'cancelled'
             AND NOT (s.status = 'completed'
                      AND s.payment_status = 'paid')), 0) AS por_pagar
    FROM public.sale_commissions c
    JOIN public.sales s ON s.id = c.sale_id
    GROUP BY c.seller_id
  ),
  pagos AS (
    SELECT p.seller_id, COALESCE(SUM(p.amount), 0) AS pago
    FROM public.commission_payouts p
    GROUP BY p.seller_id
  ),
  reservas AS (
    SELECT l.seller_id, COALESCE(SUM(l.valor), 0) AS reservado
    FROM public.levantamentos l
    WHERE l.estado IN ('pendente', 'aprovado', 'em_processamento')
    GROUP BY l.seller_id
  ),
  linhas AS (
    SELECT e.id AS seller_id, e.full_name AS nome, e.phone AS telefone,
           e.provincia_id, e.provincia_nome, e.provincia_codigo,
           e.is_active AS ativo,
           COALESCE(v.n, 0)            AS vendas,
           COALESCE(v.contabilistico, 0) AS contabilistico,
           COALESCE(v.pendente, 0)     AS pendente,
           COALESCE(v.activo, 0)       AS activo,
           COALESCE(v.n_pendente, 0)   AS count_pendente,
           COALESCE(v.n_activo, 0)     AS count_activo,
           COALESCE(c.ganho, 0)        AS comissao_ganha,
           COALESCE(c.por_pagar, 0)    AS comissao_por_pagar,
           COALESCE(pg.pago, 0)        AS comissao_paga,
           COALESCE(rs.reservado, 0)   AS reservado,
           -- A mesma fórmula do `levantamento_resumo`: o que se pode levantar
           -- é a comissão ganha menos o que já saiu menos o que está pedido.
           GREATEST(COALESCE(c.ganho, 0) - COALESCE(pg.pago, 0)
                    - COALESCE(rs.reservado, 0), 0) AS disponivel
    FROM equipa e
    LEFT JOIN vendas    v  ON v.seller_id  = e.id
    LEFT JOIN comissoes c  ON c.seller_id  = e.id
    LEFT JOIN pagos     pg ON pg.seller_id = e.id
    LEFT JOIN reservas  rs ON rs.seller_id = e.id
  )
  SELECT jsonb_build_object(
    'scope', CASE WHEN v_prov IS NULL THEN 'nacional' ELSE 'provincial' END,
    'totais', jsonb_build_object(
      'colaboradores',  (SELECT count(*) FROM linhas),
      'contabilistico', (SELECT COALESCE(SUM(contabilistico), 0) FROM linhas),
      'pendente',       (SELECT COALESCE(SUM(pendente), 0) FROM linhas),
      'activo',         (SELECT COALESCE(SUM(activo), 0) FROM linhas),
      'disponivel',     (SELECT COALESCE(SUM(disponivel), 0) FROM linhas),
      'pago',           (SELECT COALESCE(SUM(comissao_paga), 0) FROM linhas),
      'por_confirmar',  (SELECT COALESCE(SUM(count_pendente), 0) FROM linhas)
    ),
    'linhas', COALESCE((
      SELECT jsonb_agg(t ORDER BY t.contabilistico DESC, t.nome)
      FROM linhas t
    ), '[]'::jsonb)
  )
  INTO v_out;

  RETURN v_out;
END;
$$;


-- -----------------------------------------------------------------------------
-- 6. PERMISSÕES
-- -----------------------------------------------------------------------------
GRANT SELECT ON public.sale_events TO authenticated;

GRANT EXECUTE ON FUNCTION public.confirmar_pagamento_venda(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.reabrir_pagamento_venda(uuid, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.saldo_colaborador(uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendas_gestao(text, uuid, int)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.saldos_equipa(uuid)                      TO authenticated;


-- -----------------------------------------------------------------------------
-- 7. VERIFICAÇÃO
-- -----------------------------------------------------------------------------
--   SELECT count(*) FILTER (WHERE payment_status = 'paid')      AS pagas,
--          count(*) FILTER (WHERE payment_status <> 'paid')     AS pendentes,
--          count(*) FILTER (WHERE payment_confirmed_by IS NULL
--                             AND payment_status = 'paid')     AS pagas_sem_autor
--   FROM public.sales;
--
--   SELECT public.saldo_colaborador('<uuid do colaborador>');
