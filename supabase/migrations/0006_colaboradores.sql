-- =============================================================================
-- INUKA ANGOLA — MIGRAÇÃO 6/6 : IDENTIDADE E GESTÃO DE COLABORADORES
-- =============================================================================
-- O que esta migração acrescenta, sem tocar no que já existe:
--
--   1. Referência por província (`INK-UIG-00005`), com contador próprio por
--      província — cada província tem a sua sequência.
--   2. Dados pessoais e profissionais do colaborador (BI, nascimento, WhatsApp,
--      morada, município, função, categoria, data de entrada).
--   3. Comissões: uma linha por venda (UNIQUE), taxa congelada no momento da
--      venda, estados pendente/paga/anulada e histórico de pagamentos.
--   4. Metas individuais e por província, com cumprimento calculado.
--   5. `sales.status` — uma venda cancelada deixa de contar para tudo.
--   6. RPCs de painel, ficha, pesquisa e visão geral.
--   7. RLS: cada colaborador só vê o que é seu; o BI nunca sai para terceiros.
--
-- Idempotente: pode ser colada sobre uma base que já tenha a 0005.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TIPOS NOVOS
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sale_status') THEN
    CREATE TYPE public.sale_status AS ENUM ('completed', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'commission_status') THEN
    CREATE TYPE public.commission_status AS ENUM ('pending', 'paid', 'cancelled');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. VENDA CANCELADA NÃO CONTA
-- -----------------------------------------------------------------------------
-- `payment_status` diz se foi paga; `status` diz se a venda existe. São coisas
-- diferentes: uma venda por pagar é válida, uma venda cancelada não é.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS status public.sale_status NOT NULL DEFAULT 'completed';

CREATE INDEX IF NOT EXISTS idx_sales_status ON public.sales (status, created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. DADOS DO COLABORADOR
-- -----------------------------------------------------------------------------
-- Ficam em `seller_profiles`, que já é 1:1 com o perfil e já tem a política
-- certa: só o próprio ou um gestor da província lê. É por isso que o BI não
-- precisa de uma tabela separada — nunca é exposto a um cliente.
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS bi_number   text,
  ADD COLUMN IF NOT EXISTS birth_date  date,
  ADD COLUMN IF NOT EXISTS whatsapp    text,
  ADD COLUMN IF NOT EXISTS address     text,
  ADD COLUMN IF NOT EXISTS municipio   text,
  ADD COLUMN IF NOT EXISTS job_title   text,
  ADD COLUMN IF NOT EXISTS category    text,
  ADD COLUMN IF NOT EXISTS hired_at    date;

-- O BI é único quando existe (comparação sem espaços e sem maiúsculas).
CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_bi
  ON public.seller_profiles (upper(btrim(bi_number)))
  WHERE bi_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_seller_municipio ON public.seller_profiles (municipio);
CREATE INDEX IF NOT EXISTS idx_seller_hired     ON public.seller_profiles (hired_at);

-- Quem já era colaborador entra hoje (não há data melhor e não se inventa).
UPDATE public.seller_profiles
SET hired_at = COALESCE(hired_at, created_at::date)
WHERE hired_at IS NULL;

-- -----------------------------------------------------------------------------
-- 4. REFERÊNCIA COM SEQUÊNCIA POR PROVÍNCIA
-- -----------------------------------------------------------------------------
-- Antes havia uma sequência global. Passa a haver um contador por província,
-- para que `INK-UIG-00001` e `INK-LDA-00001` possam coexistir: o número diz
-- "o 1.º colaborador desta província".
CREATE TABLE IF NOT EXISTS public.referencia_contadores (
  codigo     text PRIMARY KEY,
  ultimo     int NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Sem políticas: ninguém escreve aqui pelo cliente. Só a função abaixo, que é
-- SECURITY DEFINER, toca nesta tabela.
ALTER TABLE public.referencia_contadores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referencia_contadores FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.proxima_referencia(p_provincia_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_codigo text;
  v_num    int;
BEGIN
  SELECT pr.codigo INTO v_codigo
  FROM public.provincias pr WHERE pr.id = p_provincia_id;

  v_codigo := COALESCE(v_codigo, 'NAC');

  -- O `ON CONFLICT DO UPDATE` é atómico: dois pedidos simultâneos nunca
  -- recebem o mesmo número.
  INSERT INTO public.referencia_contadores AS c (codigo, ultimo)
  VALUES (v_codigo, 1)
  ON CONFLICT (codigo) DO UPDATE
    SET ultimo = c.ultimo + 1,
        updated_at = now()
  RETURNING c.ultimo INTO v_num;

  RETURN 'INK-' || v_codigo || '-' || lpad(v_num::text, 5, '0');
END;
$$;

-- `gerar_referencia` mantém-se como nome público (já é usada em testes e em
-- código antigo), mas passa a delegar no contador por província.
CREATE OR REPLACE FUNCTION public.gerar_referencia(p_provincia_id uuid)
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.proxima_referencia(p_provincia_id);
$$;

-- Arranque dos contadores: continuam a partir da referência mais alta que já
-- existe em cada província. Sem isto, o primeiro colaborador novo do Uíge
-- voltaria a receber `00001` e colidia com quem já lá está.
INSERT INTO public.referencia_contadores AS c (codigo, ultimo)
SELECT split_part(referencia, '-', 2) AS codigo,
       MAX((split_part(referencia, '-', 3))::int) AS ultimo
FROM public.profiles
WHERE referencia ~ '^INK-[A-Z]{3}-[0-9]+$'
GROUP BY 1
ON CONFLICT (codigo) DO UPDATE
  SET ultimo = GREATEST(c.ultimo, EXCLUDED.ultimo),
      updated_at = now();

-- -----------------------------------------------------------------------------
-- 5. COMISSÕES
-- -----------------------------------------------------------------------------
-- Uma linha por venda (`UNIQUE sale_id`): é isto que impede uma comissão
-- duplicada, e não uma verificação na aplicação.
CREATE TABLE IF NOT EXISTS public.commission_payouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  amount       numeric(12,2) NOT NULL CHECK (amount >= 0),
  method       text,
  notes        text,
  paid_at      timestamptz NOT NULL DEFAULT now(),
  paid_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_commissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id      uuid NOT NULL UNIQUE REFERENCES public.sales(id) ON DELETE CASCADE,
  seller_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  base_amount  numeric(12,2) NOT NULL DEFAULT 0 CHECK (base_amount >= 0),
  rate         numeric(5,4) NOT NULL DEFAULT 0 CHECK (rate >= 0 AND rate <= 1),
  amount       numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status       public.commission_status NOT NULL DEFAULT 'pending',
  paid_at      timestamptz,
  payout_id    uuid REFERENCES public.commission_payouts(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comissao_paga_tem_data CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_commissions_seller ON public.sale_commissions (seller_id, status);
CREATE INDEX IF NOT EXISTS idx_commissions_prov   ON public.sale_commissions (provincia_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commissions_payout ON public.sale_commissions (payout_id);
CREATE INDEX IF NOT EXISTS idx_payouts_seller     ON public.commission_payouts (seller_id, paid_at DESC);

-- Calcula a comissão de cada venda. Corre depois de a venda existir, por isso
-- uma venda criada por RPC ou por INSERT directo é tratada da mesma maneira.
CREATE OR REPLACE FUNCTION public.fill_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_rate numeric(5,4);
BEGIN
  -- Só reage ao que muda o valor: evita recalcular em cada UPDATE da venda.
  IF TG_OP = 'UPDATE'
     AND NEW.status       IS NOT DISTINCT FROM OLD.status
     AND NEW.total_amount IS NOT DISTINCT FROM OLD.total_amount
     AND NEW.seller_id    IS NOT DISTINCT FROM OLD.seller_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(sp.commission_rate, 0) INTO v_rate
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;
  v_rate := COALESCE(v_rate, 0);

  IF NEW.status = 'cancelled' THEN
    INSERT INTO public.sale_commissions AS c
      (sale_id, seller_id, provincia_id, base_amount, rate, amount, status)
    VALUES
      (NEW.id, NEW.seller_id, NEW.provincia_id, NEW.total_amount, v_rate, 0, 'cancelled')
    ON CONFLICT (sale_id) DO UPDATE
      SET status = 'cancelled', amount = 0, base_amount = EXCLUDED.base_amount,
          updated_at = now()
      WHERE c.status <> 'paid';   -- uma comissão já paga não se anula sozinha
  ELSE
    INSERT INTO public.sale_commissions AS c
      (sale_id, seller_id, provincia_id, base_amount, rate, amount, status)
    VALUES
      (NEW.id, NEW.seller_id, NEW.provincia_id, NEW.total_amount, v_rate,
       round(NEW.total_amount * v_rate, 2), 'pending')
    ON CONFLICT (sale_id) DO UPDATE
      SET seller_id = EXCLUDED.seller_id,
          provincia_id = EXCLUDED.provincia_id,
          base_amount = EXCLUDED.base_amount,
          rate = EXCLUDED.rate,
          amount = EXCLUDED.amount,
          updated_at = now()
      WHERE c.status = 'pending';  -- paga ou anulada fica como está
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_commission ON public.sales;
CREATE TRIGGER trg_fill_commission
AFTER INSERT OR UPDATE OF status, total_amount, seller_id ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.fill_commission();

-- Comissões das vendas que já existiam (a base é preservada, não se inventa).
INSERT INTO public.sale_commissions
  (sale_id, seller_id, provincia_id, base_amount, rate, amount, status)
SELECT s.id, s.seller_id, s.provincia_id, s.total_amount,
       COALESCE(sp.commission_rate, 0),
       round(s.total_amount * COALESCE(sp.commission_rate, 0), 2),
       CASE WHEN s.status = 'cancelled'
            THEN 'cancelled'::public.commission_status
            ELSE 'pending'::public.commission_status END
FROM public.sales s
LEFT JOIN public.seller_profiles sp ON sp.id = s.seller_id
ON CONFLICT (sale_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. METAS
-- -----------------------------------------------------------------------------
-- Uma meta é de um colaborador OU de uma província, nunca das duas coisas.
CREATE TABLE IF NOT EXISTS public.sales_goals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  provincia_id  uuid REFERENCES public.provincias(id) ON DELETE CASCADE,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  target_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (target_amount >= 0),
  target_sales  int NOT NULL DEFAULT 0 CHECK (target_sales >= 0),
  notes         text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_goals_scope CHECK (
    (seller_id IS NOT NULL AND provincia_id IS NULL) OR
    (seller_id IS NULL AND provincia_id IS NOT NULL)
  ),
  CONSTRAINT sales_goals_periodo CHECK (period_end >= period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_goal_seller
  ON public.sales_goals (seller_id, period_start, period_end)
  WHERE seller_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_goal_provincia
  ON public.sales_goals (provincia_id, period_start, period_end)
  WHERE provincia_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 7. DEFAULTS DO COLABORADOR
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fill_seller_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.hired_at := COALESCE(NEW.hired_at, CURRENT_DATE);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_seller_defaults ON public.seller_profiles;
CREATE TRIGGER trg_fill_seller_defaults
BEFORE INSERT ON public.seller_profiles
FOR EACH ROW EXECUTE FUNCTION public.fill_seller_defaults();

-- -----------------------------------------------------------------------------
-- 8. HISTÓRICO DE ALTERAÇÕES IMPORTANTES
-- -----------------------------------------------------------------------------
-- Só os campos que mudam direitos e dinheiro: papel, província, referência,
-- estado e taxa de comissão. Não se registam alterações de morada nem de nome.
CREATE OR REPLACE FUNCTION public.audit_collaborator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    IF OLD.role IS NOT DISTINCT FROM NEW.role
       AND OLD.provincia_id IS NOT DISTINCT FROM NEW.provincia_id
       AND OLD.referencia   IS NOT DISTINCT FROM NEW.referencia
       AND OLD.is_active    IS NOT DISTINCT FROM NEW.is_active THEN
      RETURN NULL;
    END IF;
    v_old := jsonb_build_object('role', OLD.role, 'provincia_id', OLD.provincia_id,
                                'referencia', OLD.referencia, 'is_active', OLD.is_active);
    v_new := jsonb_build_object('role', NEW.role, 'provincia_id', NEW.provincia_id,
                                'referencia', NEW.referencia, 'is_active', NEW.is_active);
  ELSE
    IF OLD.commission_rate IS NOT DISTINCT FROM NEW.commission_rate
       AND OLD.job_title IS NOT DISTINCT FROM NEW.job_title
       AND OLD.category  IS NOT DISTINCT FROM NEW.category THEN
      RETURN NULL;
    END IF;
    v_old := jsonb_build_object('commission_rate', OLD.commission_rate,
                                'job_title', OLD.job_title, 'category', OLD.category);
    v_new := jsonb_build_object('commission_rate', NEW.commission_rate,
                                'job_title', NEW.job_title, 'category', NEW.category);
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data, new_data)
  VALUES (auth.uid(), 'update', TG_TABLE_NAME, NEW.id, v_old, v_new);

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_collaborator ON public.profiles;
CREATE TRIGGER trg_audit_collaborator
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.audit_collaborator();

DROP TRIGGER IF EXISTS trg_audit_seller ON public.seller_profiles;
CREATE TRIGGER trg_audit_seller
AFTER UPDATE ON public.seller_profiles
FOR EACH ROW EXECUTE FUNCTION public.audit_collaborator();

-- -----------------------------------------------------------------------------
-- 9. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.sale_commissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_goals        ENABLE ROW LEVEL SECURITY;

-- Comissões: o colaborador vê as suas; o gestor vê as da província que gere.
DROP POLICY IF EXISTS sale_commissions_select ON public.sale_commissions;
CREATE POLICY sale_commissions_select ON public.sale_commissions
  FOR SELECT TO authenticated
  USING (
    seller_id = auth.uid()
    OR (public.is_manager() AND public.can_see_province(provincia_id))
  );

-- Escrita só pelas funções SECURITY DEFINER (o trigger e `pagar_comissoes`).
DROP POLICY IF EXISTS sale_commissions_manager_write ON public.sale_commissions;
CREATE POLICY sale_commissions_manager_write ON public.sale_commissions
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(provincia_id));

DROP POLICY IF EXISTS commission_payouts_select ON public.commission_payouts;
CREATE POLICY commission_payouts_select ON public.commission_payouts
  FOR SELECT TO authenticated
  USING (
    seller_id = auth.uid()
    OR (public.is_manager() AND public.can_see_province(provincia_id))
  );

DROP POLICY IF EXISTS commission_payouts_manager_write ON public.commission_payouts;
CREATE POLICY commission_payouts_manager_write ON public.commission_payouts
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(provincia_id));

-- Metas: a própria, a da província onde está, e o gestor vê as que gere.
DROP POLICY IF EXISTS sales_goals_select ON public.sales_goals;
CREATE POLICY sales_goals_select ON public.sales_goals
  FOR SELECT TO authenticated
  USING (
    seller_id = auth.uid()
    OR (provincia_id IS NOT NULL AND provincia_id = public.my_province())
    OR (public.is_manager() AND public.can_see_province(provincia_id))
  );

DROP POLICY IF EXISTS sales_goals_manager_write ON public.sales_goals;
CREATE POLICY sales_goals_manager_write ON public.sales_goals
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(provincia_id));

-- -----------------------------------------------------------------------------
-- 10. PERMISSÃO: QUEM PODE VER QUEM
-- -----------------------------------------------------------------------------
-- Regra única usada por todas as RPCs abaixo:
--   · o próprio;
--   · um gestor, dentro da província que gere (ou de todas, se for nacional).
CREATE OR REPLACE FUNCTION public.can_view_collaborator(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN p_id = auth.uid() THEN true
    WHEN NOT public.is_manager() THEN false
    ELSE public.can_see_province((SELECT p.provincia_id FROM public.profiles p WHERE p.id = p_id))
  END;
$$;

-- -----------------------------------------------------------------------------
-- 11. RPC: FICHA DO COLABORADOR
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.colaborador_ficha(p_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_id    uuid := COALESCE(p_id, auth.uid());
  v_p     public.profiles;
  v_sp    public.seller_profiles;
  v_prov  public.provincias;
  v_gestor text;
  v_pode  boolean;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501';
  END IF;

  v_pode := public.can_view_collaborator(v_id);
  IF NOT v_pode THEN
    RAISE EXCEPTION 'Sem permissão para ver esta ficha' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_p FROM public.profiles WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador inexistente';
  END IF;

  SELECT * INTO v_sp FROM public.seller_profiles WHERE id = v_id;
  IF v_p.provincia_id IS NOT NULL THEN
    SELECT * INTO v_prov FROM public.provincias WHERE id = v_p.provincia_id;
  END IF;
  IF v_sp.manager_id IS NOT NULL THEN
    SELECT p.full_name INTO v_gestor FROM public.profiles p WHERE p.id = v_sp.manager_id;
  END IF;

  RETURN jsonb_build_object(
    'id',            v_p.id,
    'full_name',     v_p.full_name,
    'role',          v_p.role,
    'avatar_url',    v_p.avatar_url,
    'phone',         v_p.phone,
    'email',         v_p.email,
    'is_active',     v_p.is_active,
    'created_at',    v_p.created_at,
    'referencia',    v_p.referencia,
    'provincia_id',  v_p.provincia_id,
    'provincia_nome',   v_prov.nome,
    'provincia_codigo', v_prov.codigo,
    'delegacao_nome',   v_prov.delegacao_nome,
    -- Dados pessoais: só chegam aqui depois da verificação acima.
    'bi_number',     v_sp.bi_number,
    'birth_date',    v_sp.birth_date,
    'whatsapp',      v_sp.whatsapp,
    'address',       v_sp.address,
    'municipio',     v_sp.municipio,
    -- Dados profissionais
    'job_title',     v_sp.job_title,
    'category',      v_sp.category,
    'hired_at',      v_sp.hired_at,
    'commission_rate', COALESCE(v_sp.commission_rate, 0),
    'manager_id',    v_sp.manager_id,
    'manager_name',  v_gestor,
    'region',        v_sp.region,
    'code',          v_sp.code
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. RPC: PAINEL INDIVIDUAL
-- -----------------------------------------------------------------------------
-- Devolve tudo o que o painel mostra, numa só chamada: identidade, cartões,
-- séries dos últimos 6 meses, histórico e alertas de meta.
CREATE OR REPLACE FUNCTION public.colaborador_painel(
  p_id   uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_id      uuid := COALESCE(p_id, auth.uid());
  v_from    timestamptz := COALESCE(p_from, date_trunc('month', now()));
  v_to      timestamptz := COALESCE(p_to, now());
  v_p       public.profiles;
  v_sp      public.seller_profiles;
  v_prov    public.provincias;
  v_meta    public.sales_goals;
  v_meta_pv public.sales_goals;
  v_valor   numeric(14,2) := 0;
  v_qtd     int := 0;
  v_com_total numeric(14,2) := 0;
  v_com_paga  numeric(14,2) := 0;
  v_com_pend  numeric(14,2) := 0;
  v_clientes  int := 0;
  v_ativos    int := 0;
  v_posicao   int := NULL;
  v_equipa    int := NULL;
  v_alvo      numeric(14,2) := 0;
  v_pct       numeric(6,2) := 0;
  v_meses     text[] := ARRAY[]::text[];
  v_serie_v   numeric[] := ARRAY[]::numeric[];
  v_serie_c   numeric[] := ARRAY[]::numeric[];
  v_mes       date;
  i           int;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_view_collaborator(v_id) THEN
    RAISE EXCEPTION 'Sem permissão para ver este painel' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_p FROM public.profiles WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador inexistente';
  END IF;
  SELECT * INTO v_sp FROM public.seller_profiles WHERE id = v_id;
  IF v_p.provincia_id IS NOT NULL THEN
    SELECT * INTO v_prov FROM public.provincias WHERE id = v_p.provincia_id;
  END IF;

  -- Vendas válidas do período (canceladas fora).
  SELECT COALESCE(SUM(s.total_amount), 0), COUNT(*)
    INTO v_valor, v_qtd
  FROM public.sales s
  WHERE s.seller_id = v_id
    AND s.status <> 'cancelled'
    AND s.created_at BETWEEN v_from AND v_to;

  SELECT COALESCE(SUM(c.amount), 0),
         COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'paid'), 0),
         COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'pending'), 0)
    INTO v_com_total, v_com_paga, v_com_pend
  FROM public.sale_commissions c
  WHERE c.seller_id = v_id;

  SELECT COUNT(*) INTO v_clientes
  FROM public.seller_customers sc WHERE sc.seller_id = v_id;
  SELECT COUNT(*) INTO v_ativos
  FROM public.seller_customers sc WHERE sc.seller_id = v_id AND sc.is_active = true;

  -- Meta individual do mês corrente; se não houver, a meta da província serve
  -- de referência (é o objectivo da equipa, não uma meta inventada).
  SELECT * INTO v_meta
  FROM public.sales_goals g
  WHERE g.seller_id = v_id
    AND CURRENT_DATE BETWEEN g.period_start AND g.period_end
  ORDER BY g.period_start DESC LIMIT 1;

  IF v_meta.id IS NULL AND v_p.provincia_id IS NOT NULL THEN
    SELECT * INTO v_meta_pv
    FROM public.sales_goals g
    WHERE g.provincia_id = v_p.provincia_id
      AND CURRENT_DATE BETWEEN g.period_start AND g.period_end
    ORDER BY g.period_start DESC LIMIT 1;
  END IF;

  v_alvo := COALESCE(NULLIF(v_meta.target_amount, 0), v_meta_pv.target_amount, 0);
  IF v_alvo > 0 THEN
    v_pct := round(LEAST(v_valor / v_alvo * 100, 999), 2);
  END IF;

  -- Posição no ranking da província (só faz sentido para colaboradores).
  IF v_p.provincia_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_equipa
    FROM public.profiles p
    WHERE p.role = 'seller' AND p.is_active = true AND p.provincia_id = v_p.provincia_id;

    SELECT COUNT(*) + 1 INTO v_posicao
    FROM (
      SELECT p.id, COALESCE(SUM(s.total_amount), 0) AS v
      FROM public.profiles p
      LEFT JOIN public.sales s
        ON s.seller_id = p.id AND s.status <> 'cancelled'
       AND s.created_at BETWEEN v_from AND v_to
      WHERE p.role = 'seller' AND p.is_active = true AND p.provincia_id = v_p.provincia_id
      GROUP BY p.id
    ) t
    WHERE t.v > v_valor;
  END IF;

  -- Séries dos últimos 6 meses (inclui o corrente).
  -- `REVERSE` é obrigatório: sem ele, `5..0` não itera nenhuma vez.
  FOR i IN REVERSE 5..0 LOOP
    v_mes := date_trunc('month', now())::date - (i || ' month')::interval;
    v_meses := v_meses || to_char(v_mes, 'YYYY-MM');
    v_serie_v := v_serie_v || COALESCE((
      SELECT SUM(s.total_amount) FROM public.sales s
      WHERE s.seller_id = v_id AND s.status <> 'cancelled'
        AND s.created_at >= v_mes AND s.created_at < (v_mes + interval '1 month')
    ), 0);
    v_serie_c := v_serie_c || COALESCE((
      SELECT SUM(c.amount) FROM public.sale_commissions c
      WHERE c.seller_id = v_id AND c.status <> 'cancelled'
        AND c.created_at >= v_mes AND c.created_at < (v_mes + interval '1 month')
    ), 0);
  END LOOP;

  RETURN jsonb_build_object(
    'identidade', jsonb_build_object(
      'id', v_p.id,
      'full_name', v_p.full_name,
      'avatar_url', v_p.avatar_url,
      'phone', v_p.phone,
      'whatsapp', v_sp.whatsapp,
      'email', v_p.email,
      'referencia', v_p.referencia,
      'role', v_p.role,
      'is_active', v_p.is_active,
      'created_at', v_p.created_at,
      'job_title', v_sp.job_title,
      'category', v_sp.category,
      'hired_at', v_sp.hired_at,
      'provincia_id', v_p.provincia_id,
      'provincia_nome', v_prov.nome,
      'provincia_codigo', v_prov.codigo,
      'delegacao_nome', v_prov.delegacao_nome,
      'delegacao_telefone', v_prov.delegacao_telefone
    ),
    'cartoes', jsonb_build_object(
      'clientes_total', v_clientes,
      'clientes_ativos', v_ativos,
      'vendas_count', v_qtd,
      'vendas_valor', v_valor,
      'comissao_total', v_com_total,
      'comissao_paga', v_com_paga,
      'comissao_pendente', v_com_pend,
      'meta_valor', v_alvo,
      'meta_pct', v_pct,
      'meta_origem', CASE WHEN v_meta.id IS NOT NULL THEN 'individual'
                          WHEN v_meta_pv.id IS NOT NULL THEN 'provincia'
                          ELSE NULL END,
      'posicao', v_posicao,
      'equipa', v_equipa
    ),
    'series', jsonb_build_object(
      'meses', to_jsonb(v_meses),
      'vendas', to_jsonb(v_serie_v),
      'comissoes', to_jsonb(v_serie_c)
    ),
    'historico', jsonb_build_object(
      'vendas', (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
          SELECT s.id, s.reference, s.total_amount, s.status, s.created_at,
                 COALESCE(c.amount, 0) AS comissao
          FROM public.sales s
          LEFT JOIN public.sale_commissions c ON c.sale_id = s.id
          WHERE s.seller_id = v_id
          ORDER BY s.created_at DESC LIMIT 8
        ) t
      ),
      'clientes', (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
          SELECT p.full_name, p.phone, sc.is_active, sc.assigned_at
          FROM public.seller_customers sc
          JOIN public.profiles p ON p.id = sc.customer_id
          WHERE sc.seller_id = v_id
          ORDER BY sc.assigned_at DESC LIMIT 8
        ) t
      ),
      'pagamentos', (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
          SELECT cp.id, cp.amount, cp.paid_at, cp.method, cp.notes
          FROM public.commission_payouts cp
          WHERE cp.seller_id = v_id
          ORDER BY cp.paid_at DESC LIMIT 8
        ) t
      )
    ),
    'alertas', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
        SELECT 'meta_atingida' AS tipo,
               'Meta mensal atingida: ' || v_pct || '%' AS texto
        WHERE v_alvo > 0 AND v_pct >= 100
        UNION ALL
        SELECT 'meta_perto',
               'Faltam ' || round(v_alvo - v_valor, 2) || ' AOA para a meta'
        WHERE v_alvo > 0 AND v_pct >= 80 AND v_pct < 100
        UNION ALL
        SELECT 'comissao_pendente',
               'Tem ' || v_com_pend || ' AOA de comissão por receber'
        WHERE v_com_pend > 0
      ) t
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 13. RPC: PESQUISA DE COLABORADORES (gestão)
-- -----------------------------------------------------------------------------
-- A pesquisa é feita no servidor: devolve só o que o gestor pode ver e já com
-- os indicadores, para a tabela não ter de cruzar tabelas no cliente.
CREATE OR REPLACE FUNCTION public.pesquisar_colaboradores(
  p_texto      text DEFAULT NULL,
  p_provincia  uuid DEFAULT NULL,
  p_municipio  text DEFAULT NULL,
  p_estado     text DEFAULT NULL,   -- 'ativos' | 'inativos' | NULL
  p_ordem      text DEFAULT NULL    -- 'nome' | 'vendas' | 'clientes' | 'comissao' | 'meta'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_texto  text := NULLIF(btrim(COALESCE(p_texto, '')), '');
  v_digitos text := regexp_replace(COALESCE(p_texto, ''), '[^0-9]', '', 'g');
  v_prov   uuid := CASE
                     WHEN public.is_national() THEN p_provincia
                     ELSE public.my_province()
                   END;
  v_mes    date := date_trunc('month', now())::date;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode pesquisar colaboradores' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(t ORDER BY
      CASE p_ordem
        WHEN 'vendas'   THEN t.vendas_valor
        WHEN 'clientes' THEN t.clientes::numeric
        WHEN 'comissao' THEN t.comissao_total
        WHEN 'meta'     THEN t.meta_pct
      END DESC NULLS LAST,
      t.nome ASC
    )
    FROM (
      SELECT
        p.id,
        p.full_name  AS nome,
        p.referencia,
        p.avatar_url,
        p.phone,
        p.is_active,
        p.created_at,
        p.provincia_id,
        pr.nome      AS provincia,
        pr.codigo    AS provincia_codigo,
        sp.municipio,
        sp.bi_number,
        sp.job_title,
        sp.category,
        sp.commission_rate,
        COALESCE(cl.total, 0)  AS clientes,
        COALESCE(cl.ativos, 0) AS clientes_ativos,
        COALESCE(v.qtd, 0)     AS vendas_count,
        COALESCE(v.valor, 0)   AS vendas_valor,
        COALESCE(cm.total, 0)  AS comissao_total,
        COALESCE(cm.pendente, 0) AS comissao_pendente,
        COALESCE(m.alvo, 0)    AS meta_valor,
        CASE WHEN COALESCE(m.alvo, 0) > 0
             THEN round(COALESCE(v.valor, 0) / m.alvo * 100, 2)
             ELSE 0 END        AS meta_pct
      FROM public.profiles p
      LEFT JOIN public.seller_profiles sp ON sp.id = p.id
      LEFT JOIN public.provincias pr      ON pr.id = p.provincia_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE sc.is_active) AS ativos
        FROM public.seller_customers sc WHERE sc.seller_id = p.id
      ) cl ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS qtd, SUM(s.total_amount) AS valor
        FROM public.sales s
        WHERE s.seller_id = p.id AND s.status <> 'cancelled'
      ) v ON true
      LEFT JOIN LATERAL (
        SELECT SUM(c.amount) AS total,
               SUM(c.amount) FILTER (WHERE c.status = 'pending') AS pendente
        FROM public.sale_commissions c
        WHERE c.seller_id = p.id AND c.status <> 'cancelled'
      ) cm ON true
      LEFT JOIN LATERAL (
        SELECT g.target_amount AS alvo
        FROM public.sales_goals g
        WHERE g.seller_id = p.id AND v_mes BETWEEN g.period_start AND g.period_end
        ORDER BY g.period_start DESC LIMIT 1
      ) m ON true
      WHERE p.role = 'seller'
        AND (v_prov IS NULL OR p.provincia_id = v_prov)
        AND (p_municipio IS NULL OR btrim(p_municipio) = '' OR sp.municipio = p_municipio)
        AND (p_estado IS NULL OR p_estado = ''
             OR (p_estado = 'ativos'   AND p.is_active)
             OR (p_estado = 'inativos' AND NOT p.is_active))
        AND (
          v_texto IS NULL
          OR p.referencia ILIKE '%' || v_texto || '%'
          OR p.full_name  ILIKE '%' || v_texto || '%'
          OR sp.bi_number ILIKE '%' || v_texto || '%'
          OR (length(v_digitos) >= 3 AND regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g') LIKE '%' || v_digitos || '%')
        )
    ) t
  ), '[]'::jsonb);
END;
$$;

-- -----------------------------------------------------------------------------
-- 14. RPC: VISÃO GERAL DA REDE (gestão)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.colaboradores_overview(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_from timestamptz := COALESCE(p_from, date_trunc('month', now()));
  v_to   timestamptz := COALESCE(p_to, now());
  v_prov uuid := CASE WHEN public.is_national() THEN NULL ELSE public.my_province() END;
  v_mes  date := date_trunc('month', now())::date;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode ver a rede' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'period_from', v_from,
    'period_to', v_to,
    'scope', CASE WHEN v_prov IS NULL THEN 'nacional' ELSE 'provincial' END,
    'totais', jsonb_build_object(
      'colaboradores', (
        SELECT COUNT(*) FROM public.profiles p
        WHERE p.role = 'seller' AND (v_prov IS NULL OR p.provincia_id = v_prov)
      ),
      'colaboradores_ativos', (
        SELECT COUNT(*) FROM public.profiles p
        WHERE p.role = 'seller' AND p.is_active AND (v_prov IS NULL OR p.provincia_id = v_prov)
      ),
      'colaboradores_inativos', (
        SELECT COUNT(*) FROM public.profiles p
        WHERE p.role = 'seller' AND NOT p.is_active AND (v_prov IS NULL OR p.provincia_id = v_prov)
      ),
      'clientes', (
        SELECT COUNT(*) FROM public.profiles p
        WHERE p.role = 'customer' AND (v_prov IS NULL OR p.provincia_id = v_prov)
      ),
      'vendas_count', (
        SELECT COUNT(*) FROM public.sales s
        WHERE s.status <> 'cancelled' AND s.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR s.provincia_id = v_prov)
      ),
      'vendas_valor', (
        SELECT COALESCE(SUM(s.total_amount), 0) FROM public.sales s
        WHERE s.status <> 'cancelled' AND s.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR s.provincia_id = v_prov)
      ),
      'comissao_gerada', (
        SELECT COALESCE(SUM(c.amount), 0) FROM public.sale_commissions c
        WHERE c.status <> 'cancelled' AND c.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR c.provincia_id = v_prov)
      ),
      'comissao_paga', (
        SELECT COALESCE(SUM(c.amount), 0) FROM public.sale_commissions c
        WHERE c.status = 'paid'
          AND (v_prov IS NULL OR c.provincia_id = v_prov)
      ),
      'comissao_pendente', (
        SELECT COALESCE(SUM(c.amount), 0) FROM public.sale_commissions c
        WHERE c.status = 'pending'
          AND (v_prov IS NULL OR c.provincia_id = v_prov)
      ),
      'metas_atingidas', (
        SELECT COUNT(*) FROM (
          SELECT g.seller_id, g.target_amount
          FROM public.sales_goals g
          WHERE g.seller_id IS NOT NULL
            AND v_mes BETWEEN g.period_start AND g.period_end
            AND (v_prov IS NULL OR EXISTS (
              SELECT 1 FROM public.profiles p
              WHERE p.id = g.seller_id AND p.provincia_id = v_prov))
        ) g
        WHERE g.target_amount > 0 AND COALESCE((
          SELECT SUM(s.total_amount) FROM public.sales s
          WHERE s.seller_id = g.seller_id AND s.status <> 'cancelled'
            AND s.created_at BETWEEN v_from AND v_to
        ), 0) >= g.target_amount
      ),
      'metas_em_curso', (
        SELECT COUNT(*) FROM public.sales_goals g
        WHERE g.seller_id IS NOT NULL
          AND v_mes BETWEEN g.period_start AND g.period_end
          AND (v_prov IS NULL OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = g.seller_id AND p.provincia_id = v_prov))
      )
    ),
    'provincias', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.vendas_valor DESC), '[]'::jsonb)
      FROM (
        SELECT
          pr.id, pr.nome, pr.codigo,
          (SELECT COUNT(*) FROM public.profiles p
           WHERE p.role = 'seller' AND p.provincia_id = pr.id) AS colaboradores,
          (SELECT COUNT(*) FROM public.profiles p
           WHERE p.role = 'seller' AND p.is_active AND p.provincia_id = pr.id) AS colaboradores_ativos,
          (SELECT COUNT(*) FROM public.profiles p
           WHERE p.role = 'customer' AND p.provincia_id = pr.id) AS clientes,
          (SELECT COUNT(*) FROM public.sales s
           WHERE s.provincia_id = pr.id AND s.status <> 'cancelled'
             AND s.created_at BETWEEN v_from AND v_to) AS vendas_count,
          COALESCE((SELECT SUM(s.total_amount) FROM public.sales s
           WHERE s.provincia_id = pr.id AND s.status <> 'cancelled'
             AND s.created_at BETWEEN v_from AND v_to), 0) AS vendas_valor,
          COALESCE((SELECT SUM(c.amount) FROM public.sale_commissions c
           WHERE c.provincia_id = pr.id AND c.status <> 'cancelled'), 0) AS comissao,
          COALESCE((SELECT SUM(c.amount) FROM public.sale_commissions c
           WHERE c.provincia_id = pr.id AND c.status = 'pending'), 0) AS comissao_pendente
        FROM public.provincias pr
        WHERE pr.is_active AND (v_prov IS NULL OR pr.id = v_prov)
      ) t
    ),
    'ranking', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT p.id, p.full_name AS nome, p.referencia, p.avatar_url,
               pr.nome AS provincia,
               COALESCE(SUM(s.total_amount), 0) AS vendas_valor,
               COUNT(s.id) AS vendas_count,
               COALESCE(SUM(c.amount) FILTER (WHERE c.status <> 'cancelled'), 0) AS comissao
        FROM public.profiles p
        LEFT JOIN public.provincias pr ON pr.id = p.provincia_id
        LEFT JOIN public.sales s
          ON s.seller_id = p.id AND s.status <> 'cancelled'
         AND s.created_at BETWEEN v_from AND v_to
        LEFT JOIN public.sale_commissions c ON c.sale_id = s.id
        WHERE p.role = 'seller' AND p.is_active
          AND (v_prov IS NULL OR p.provincia_id = v_prov)
        GROUP BY p.id, p.full_name, p.referencia, p.avatar_url, pr.nome
        ORDER BY COALESCE(SUM(s.total_amount), 0) DESC, p.full_name
        LIMIT 10
      ) t
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 15. RPC: METAS E PAGAMENTOS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.definir_meta(
  p_seller_id     uuid DEFAULT NULL,
  p_provincia_id  uuid DEFAULT NULL,
  p_inicio        date DEFAULT NULL,
  p_fim           date DEFAULT NULL,
  p_valor         numeric DEFAULT 0,
  p_vendas        int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_inicio date := COALESCE(p_inicio, date_trunc('month', now())::date);
  v_fim    date := COALESCE(p_fim, (date_trunc('month', now()) + interval '1 month - 1 day')::date);
  v_prov   uuid;
  v_id     uuid;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode definir metas' USING ERRCODE = '42501';
  END IF;

  IF (p_seller_id IS NULL) = (p_provincia_id IS NULL) THEN
    RAISE EXCEPTION 'Indique um colaborador OU uma província';
  END IF;

  IF p_seller_id IS NOT NULL THEN
    SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = p_seller_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Colaborador inexistente';
    END IF;
  ELSE
    v_prov := p_provincia_id;
  END IF;

  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Só pode definir metas na província que gere' USING ERRCODE = '42501';
  END IF;

  IF p_seller_id IS NOT NULL THEN
    INSERT INTO public.sales_goals AS g
      (seller_id, period_start, period_end, target_amount, target_sales, created_by)
    VALUES (p_seller_id, v_inicio, v_fim, COALESCE(p_valor, 0), COALESCE(p_vendas, 0), auth.uid())
    ON CONFLICT (seller_id, period_start, period_end) WHERE seller_id IS NOT NULL
    DO UPDATE SET target_amount = EXCLUDED.target_amount,
                  target_sales  = EXCLUDED.target_sales,
                  updated_at = now()
    RETURNING g.id INTO v_id;
  ELSE
    INSERT INTO public.sales_goals AS g
      (provincia_id, period_start, period_end, target_amount, target_sales, created_by)
    VALUES (p_provincia_id, v_inicio, v_fim, COALESCE(p_valor, 0), COALESCE(p_vendas, 0), auth.uid())
    ON CONFLICT (provincia_id, period_start, period_end) WHERE provincia_id IS NOT NULL
    DO UPDATE SET target_amount = EXCLUDED.target_amount,
                  target_sales  = EXCLUDED.target_sales,
                  updated_at = now()
    RETURNING g.id INTO v_id;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'inicio', v_inicio, 'fim', v_fim,
                            'valor', COALESCE(p_valor, 0), 'vendas', COALESCE(p_vendas, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.pagar_comissoes(
  p_seller_id uuid,
  p_method    text DEFAULT NULL,
  p_notes     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov   uuid;
  v_total  numeric(12,2);
  v_payout uuid;
  v_qtd    int;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode pagar comissões' USING ERRCODE = '42501';
  END IF;

  SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = p_seller_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador inexistente';
  END IF;
  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Só pode pagar comissões da província que gere' USING ERRCODE = '42501';
  END IF;

  -- Só comissões com valor: uma venda a 0% gera uma linha de 0 AOA, e pagar
  -- zero não é um pagamento.
  SELECT COALESCE(SUM(c.amount), 0), COUNT(*)
    INTO v_total, v_qtd
  FROM public.sale_commissions c
  WHERE c.seller_id = p_seller_id AND c.status = 'pending' AND c.amount > 0;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Não há comissões pendentes';
  END IF;

  INSERT INTO public.commission_payouts (seller_id, provincia_id, amount, method, notes, paid_by)
  VALUES (p_seller_id, v_prov, v_total, p_method, p_notes, auth.uid())
  RETURNING id INTO v_payout;

  UPDATE public.sale_commissions c
  SET status = 'paid', paid_at = now(), payout_id = v_payout, updated_at = now()
  WHERE c.seller_id = p_seller_id AND c.status = 'pending' AND c.amount > 0;

  RETURN jsonb_build_object('payout_id', v_payout, 'amount', v_total, 'comissoes', v_qtd);
END;
$$;

-- -----------------------------------------------------------------------------
-- 16. RPC: ACTUALIZAR DADOS DO COLABORADOR
-- -----------------------------------------------------------------------------
-- O próprio só mexe em contactos e morada. Tudo o resto (BI, função, categoria,
-- taxa de comissão, estado) é da gestão. A lista é explícita: um campo novo no
-- formulário não passa a ser editável só por existir.
CREATE OR REPLACE FUNCTION public.atualizar_perfil_colaborador(
  p_id     uuid,
  p_campos jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_eu      uuid := auth.uid();
  v_gestor  boolean := public.is_manager();
  v_prov    uuid;
  v_pode    boolean;
BEGIN
  IF v_eu IS NULL THEN
    RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501';
  END IF;

  SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador inexistente';
  END IF;

  v_pode := (p_id = v_eu) OR (v_gestor AND public.can_manage_province(v_prov));
  IF NOT v_pode THEN
    RAISE EXCEPTION 'Sem permissão para alterar este perfil' USING ERRCODE = '42501';
  END IF;

  -- A ficha tem de existir para se guardar dados de colaborador.
  INSERT INTO public.seller_profiles (id) VALUES (p_id)
  ON CONFLICT (id) DO NOTHING;

  -- --- campos que o próprio pode alterar ---
  IF p_campos ? 'whatsapp' THEN
    UPDATE public.seller_profiles SET whatsapp = NULLIF(btrim(p_campos->>'whatsapp'), ''), updated_at = now() WHERE id = p_id;
  END IF;
  IF p_campos ? 'address' THEN
    UPDATE public.seller_profiles SET address = NULLIF(btrim(p_campos->>'address'), ''), updated_at = now() WHERE id = p_id;
  END IF;
  IF p_campos ? 'municipio' THEN
    UPDATE public.seller_profiles SET municipio = NULLIF(btrim(p_campos->>'municipio'), ''), updated_at = now() WHERE id = p_id;
  END IF;
  IF p_campos ? 'avatar_url' THEN
    UPDATE public.profiles SET avatar_url = NULLIF(btrim(p_campos->>'avatar_url'), ''), updated_at = now() WHERE id = p_id;
  END IF;

  -- --- campos reservados à gestão ---
  -- Recusar é melhor do que ignorar em silêncio: um formulário que envie o BI
  -- tem de saber que não foi guardado.
  IF NOT (v_gestor AND public.can_manage_province(v_prov))
     AND p_campos ?| ARRAY['full_name','bi_number','birth_date','job_title',
                           'category','hired_at','manager_id','commission_rate','is_active'] THEN
    RAISE EXCEPTION 'Só a gestão pode alterar estes campos' USING ERRCODE = '42501';
  END IF;

  IF v_gestor AND public.can_manage_province(v_prov) THEN
    IF p_campos ? 'full_name' THEN
      UPDATE public.profiles SET full_name = btrim(p_campos->>'full_name'), updated_at = now() WHERE id = p_id;
    END IF;
    IF p_campos ? 'bi_number' THEN
      UPDATE public.seller_profiles SET bi_number = NULLIF(upper(btrim(p_campos->>'bi_number')), ''), updated_at = now() WHERE id = p_id;
    END IF;
    IF p_campos ? 'birth_date' THEN
      UPDATE public.seller_profiles SET birth_date = NULLIF(p_campos->>'birth_date', '')::date, updated_at = now() WHERE id = p_id;
    END IF;
    IF p_campos ? 'job_title' THEN
      UPDATE public.seller_profiles SET job_title = NULLIF(btrim(p_campos->>'job_title'), ''), updated_at = now() WHERE id = p_id;
    END IF;
    IF p_campos ? 'category' THEN
      UPDATE public.seller_profiles SET category = NULLIF(btrim(p_campos->>'category'), ''), updated_at = now() WHERE id = p_id;
    END IF;
    IF p_campos ? 'hired_at' THEN
      UPDATE public.seller_profiles SET hired_at = NULLIF(p_campos->>'hired_at', '')::date, updated_at = now() WHERE id = p_id;
    END IF;
    IF p_campos ? 'manager_id' THEN
      UPDATE public.seller_profiles SET manager_id = NULLIF(p_campos->>'manager_id', '')::uuid, updated_at = now() WHERE id = p_id;
    END IF;
    IF p_campos ? 'commission_rate' THEN
      UPDATE public.seller_profiles
      SET commission_rate = LEAST(GREATEST(COALESCE((p_campos->>'commission_rate')::numeric, 0), 0), 1),
          updated_at = now()
      WHERE id = p_id;
    END IF;
    IF p_campos ? 'is_active' THEN
      UPDATE public.profiles SET is_active = COALESCE((p_campos->>'is_active')::boolean, true), updated_at = now() WHERE id = p_id;
    END IF;
  END IF;

  RETURN public.colaborador_ficha(p_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 17. INDICADORES EXISTENTES PASSAM A IGNORAR VENDAS CANCELADAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seller_stats(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_from  timestamptz := COALESCE(p_from, date_trunc('month', now()));
  v_to    timestamptz := COALESCE(p_to, now());
  v_total numeric(14,2);
  v_count int;
  v_units int;
  v_customers int;
  v_top jsonb;
BEGIN
  SELECT COALESCE(SUM(s.total_amount), 0), COUNT(*)
    INTO v_total, v_count
  FROM public.sales s
  WHERE s.seller_id = v_uid AND s.status <> 'cancelled'
    AND s.created_at BETWEEN v_from AND v_to;

  SELECT COALESCE(SUM(si.quantity), 0)
    INTO v_units
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  WHERE s.seller_id = v_uid AND s.status <> 'cancelled'
    AND s.created_at BETWEEN v_from AND v_to;

  SELECT COUNT(*) INTO v_customers
  FROM public.seller_customers sc
  WHERE sc.seller_id = v_uid AND sc.is_active = true;

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_top
  FROM (
    SELECT si.product_snapshot->>'name' AS name, SUM(si.quantity) AS units, SUM(si.total_price) AS value
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE s.seller_id = v_uid AND s.status <> 'cancelled'
      AND s.created_at BETWEEN v_from AND v_to
    GROUP BY si.product_snapshot->>'name'
    ORDER BY SUM(si.quantity) DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'period_from', v_from,
    'period_to', v_to,
    'total_sales_value', v_total,
    'sales_count', v_count,
    'units_sold', v_units,
    'customers_count', v_customers,
    'top_products', v_top
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 18. INDICADORES DA GERÊNCIA (mesma função, agora sem vendas canceladas)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_stats(
  p_from         timestamptz DEFAULT NULL,
  p_to           timestamptz DEFAULT NULL,
  p_provincia_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_from timestamptz := COALESCE(p_from, date_trunc('month', now()));
  v_to   timestamptz := COALESCE(p_to, now());
  v_prov uuid := CASE
                   WHEN public.is_national() THEN p_provincia_id
                   ELSE public.my_province()
                 END;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode consultar indicadores' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'period_from', v_from,
    'period_to', v_to,
    'provincia_id', v_prov,
    'scope', CASE WHEN v_prov IS NULL THEN 'nacional' ELSE 'provincial' END,
    'sales_total_value', (
      SELECT COALESCE(SUM(s.total_amount), 0) FROM public.sales s
      WHERE s.created_at BETWEEN v_from AND v_to
        AND s.status <> 'cancelled'
        AND (v_prov IS NULL OR s.provincia_id = v_prov)
    ),
    'sales_count', (
      SELECT COUNT(*) FROM public.sales s
      WHERE s.created_at BETWEEN v_from AND v_to
        AND s.status <> 'cancelled'
        AND (v_prov IS NULL OR s.provincia_id = v_prov)
    ),
    'orders_count', (
      SELECT COUNT(*) FROM public.orders o
      WHERE o.created_at BETWEEN v_from AND v_to
        AND (v_prov IS NULL OR o.provincia_id = v_prov)
    ),
    'orders_by_status', (
      SELECT COALESCE(jsonb_object_agg(t.status, t.qty), '{}'::jsonb)
      FROM (
        SELECT o.status::text AS status, COUNT(*) AS qty
        FROM public.orders o
        WHERE o.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR o.provincia_id = v_prov)
        GROUP BY o.status
      ) t
    ),
    'customers_count', (
      SELECT COUNT(*) FROM public.profiles p
      WHERE p.role = 'customer'
        AND (v_prov IS NULL OR p.provincia_id = v_prov)
    ),
    'sellers_count', (
      SELECT COUNT(*) FROM public.profiles p
      WHERE p.role = 'seller' AND p.is_active = true
        AND (v_prov IS NULL OR p.provincia_id = v_prov)
    ),
    'active_reservations', (
      SELECT COUNT(*) FROM public.reservations r
      WHERE r.status = 'active'
        AND (v_prov IS NULL OR r.provincia_id = v_prov)
    ),
    'pending_discounts', (
      SELECT COUNT(*) FROM public.discount_requests d
      WHERE d.status = 'pending'
        AND (v_prov IS NULL OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = d.customer_id AND p.provincia_id = v_prov
        ))
    ),
    'low_stock_products', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT p.name, i.quantity, i.low_stock_threshold, pr.nome AS provincia
        FROM public.inventory i
        JOIN public.products p ON p.id = i.product_id
        LEFT JOIN public.provincias pr ON pr.id = i.provincia_id
        WHERE i.quantity <= i.low_stock_threshold
          AND (v_prov IS NULL OR i.provincia_id = v_prov)
        ORDER BY i.quantity ASC
        LIMIT 20
      ) t
    ),
    'sales_by_seller', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT pr.full_name AS seller, COUNT(*) AS sales, SUM(s.total_amount) AS value
        FROM public.sales s
        JOIN public.profiles pr ON pr.id = s.seller_id
        WHERE s.created_at BETWEEN v_from AND v_to
          AND s.status <> 'cancelled'
          AND (v_prov IS NULL OR s.provincia_id = v_prov)
        GROUP BY pr.full_name
        ORDER BY SUM(s.total_amount) DESC
        LIMIT 20
      ) t
    ),
    'top_products', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT si.product_snapshot->>'name' AS name, SUM(si.quantity) AS units, SUM(si.total_price) AS value
        FROM public.sale_items si
        JOIN public.sales s ON s.id = si.sale_id
        WHERE s.created_at BETWEEN v_from AND v_to
          AND s.status <> 'cancelled'
          AND (v_prov IS NULL OR s.provincia_id = v_prov)
        GROUP BY si.product_snapshot->>'name'
        ORDER BY SUM(si.quantity) DESC
        LIMIT 10
      ) t
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 19. PERMISSÕES
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.proxima_referencia(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_collaborator(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.colaborador_ficha(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.colaborador_painel(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pesquisar_colaboradores(text, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.colaboradores_overview(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.definir_meta(uuid, uuid, date, date, numeric, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pagar_comissoes(uuid, text, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.atualizar_perfil_colaborador(uuid, jsonb) TO authenticated;

-- Realtime: o painel do colaborador reage a novas comissões.
DO $$
BEGIN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.sale_commissions';
EXCEPTION WHEN duplicate_object THEN NULL;
        WHEN undefined_object THEN NULL;
END $$;
