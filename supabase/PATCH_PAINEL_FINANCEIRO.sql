-- =============================================================================
--  INUKA ANGOLA — PATCH: PAINEL FINANCEIRO EDITÁVEL
-- =============================================================================
--  Supabase -> SQL Editor -> New query -> colar tudo -> RUN
--  Idempotente. Pode ser executado mais do que uma vez sem perder dados.
--  Equivale à migração 0024_painel_financeiro.sql (mesmo conteúdo).
--  Requer a 0021 (despesas), a 0022 (activo) e a 0023 (saldo) já aplicadas.
--
--  O QUE RESOLVE
--    O gestor passa a escrever os oito indicadores do painel financeiro:
--    activo total (caixa), activo contabilístico, investimentos, valores a
--    pagar, meta financeira, vendas, despesas reais e activo líquido.
--    Cada campo é opcional: vazio = automático; um número = é esse o valor.
--    O automático continua visível para comparação e nunca substitui o que o
--    gestor escreveu. Todas as alterações ficam em histórico.
--
--  Sem este patch a página /gerente/empresa não grava nem mostra o painel
--  (o PostgREST responde «Could not find the function guardar_indicadores»).

-- =============================================================================
-- 0024 — PAINEL FINANCEIRO: O GESTOR MANDA NOS NÚMEROS
-- =============================================================================
-- O QUE MUDA
-- Até aqui só o saldo contabilístico era escrito à mão. Todos os outros
-- indicadores (vendas, despesas, investimento, dívidas) vinham sempre da
-- máquina. Quem olha para a empresa todos os dias sabe que a máquina não vê
-- tudo: há dinheiro em caixa que não passou por aqui, há stock avaliado de
-- outra forma, há dívidas que ninguém registou.
--
-- A partir desta migração, os oito indicadores do painel financeiro podem ser
-- escritos pelo gestor:
--
--   activo_total            dinheiro efectivamente disponível em caixa
--   activo_contabilistico   bens + stock + investimentos
--   investimentos           o que já foi investido
--   valores_a_pagar         dívidas e pagamentos pendentes
--   meta_financeira         objectivo definido à mão
--   vendas                  total vendido (ou o valor ajustado)
--   despesas_reais          despesas tal como o gestor as vê
--   activo_liquido          o que sobra (calculado ou escrito à mão)
--
-- COMO FUNCIONA
-- Cada campo é opcional. `NULL` significa «usa o automático»; um número
-- significa «é este o valor». O automático nunca desaparece: continua a ser
-- devolvido em cada indicador (`automatico`) para o gestor comparar, mas
-- **nunca substitui** um valor escrito por ele. Sem valores escritos, tudo
-- funciona exactamente como antes.
--
-- HISTÓRICO
-- Cada alteração fica em `indicadores_financeiros_hist` (campo, valor anterior,
-- valor novo, quem, quando, nota). Nada é apagado: o histórico é append-only.
-- A tabela de valores tem uma linha por província (e uma da empresa toda, com
-- `provincia_id` nulo).
--
-- PERMISSÕES
-- Só a gestão escreve, e só na província que gere. A administração nacional
-- escreve em qualquer província e no total da empresa. Os restantes perfis não
-- chegam a esta função — mantêm as vistas que já tinham.
--
-- O SALDO ANTIGO CONTINUA A VALER
-- `saldos_contabilisticos` (0023) não é apagada: enquanto o painel não escrever
-- o activo total, o saldo antigo continua a ser lido (é o valor que o gestor já
-- tinha declarado). A partir do momento em que o painel grava o activo total, a
-- linha antiga é removida — passa a haver uma só verdade, e a meta deixa de ser
-- herdada do activo.
--
-- IDEMPOTENTE: pode voltar a correr.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. VALORES ACTUAIS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.indicadores_financeiros (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = empresa toda (só a administração nacional escreve).
  provincia_id          uuid REFERENCES public.provincias(id) ON DELETE CASCADE,
  activo_total          numeric(14,2) CHECK (activo_total          IS NULL OR activo_total          >= 0),
  activo_contabilistico numeric(14,2) CHECK (activo_contabilistico IS NULL OR activo_contabilistico >= 0),
  investimentos         numeric(14,2) CHECK (investimentos         IS NULL OR investimentos         >= 0),
  valores_a_pagar       numeric(14,2) CHECK (valores_a_pagar       IS NULL OR valores_a_pagar       >= 0),
  meta_financeira       numeric(14,2) CHECK (meta_financeira       IS NULL OR meta_financeira       >= 0),
  vendas                numeric(14,2) CHECK (vendas                IS NULL OR vendas                >= 0),
  despesas_reais        numeric(14,2) CHECK (despesas_reais        IS NULL OR despesas_reais        >= 0),
  -- Pode ser negativo: uma empresa pode dever mais do que tem.
  activo_liquido        numeric(14,2),
  nota                  text,
  definido_por          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT indicadores_nota_preenchida CHECK (nota IS NULL OR btrim(nota) <> '')
);

-- Um registo por província e um só da empresa (NULL não colide num índice
-- único normal, daí os índices parciais).
CREATE UNIQUE INDEX IF NOT EXISTS indicadores_provincia_unico
  ON public.indicadores_financeiros (provincia_id) WHERE provincia_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS indicadores_empresa_unico
  ON public.indicadores_financeiros ((true)) WHERE provincia_id IS NULL;

DROP TRIGGER IF EXISTS trg_indicadores_updated ON public.indicadores_financeiros;
CREATE TRIGGER trg_indicadores_updated
  BEFORE UPDATE ON public.indicadores_financeiros
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.indicadores_financeiros IS
  'Indicadores do painel financeiro escritos pela gestão. NULL = usar o cálculo automático.';

-- -----------------------------------------------------------------------------
-- 2. HISTÓRICO (append-only)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.indicadores_financeiros_hist (
  id             bigserial PRIMARY KEY,
  provincia_id   uuid REFERENCES public.provincias(id) ON DELETE CASCADE,
  -- Nome da coluna alterada, ou 'todos' quando o painel foi reposto.
  campo          text NOT NULL,
  valor_anterior numeric(14,2),
  valor_novo     numeric(14,2),
  nota           text,
  alterado_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_indicadores_hist
  ON public.indicadores_financeiros_hist (provincia_id, created_at DESC);

COMMENT ON TABLE public.indicadores_financeiros_hist IS
  'Histórico das alterações aos indicadores financeiros. Só cresce: nada é apagado nem reescrito.';

-- -----------------------------------------------------------------------------
-- 3. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.indicadores_financeiros      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indicadores_financeiros_hist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS indicadores_read ON public.indicadores_financeiros;
CREATE POLICY indicadores_read ON public.indicadores_financeiros
  FOR SELECT TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id));

DROP POLICY IF EXISTS indicadores_write ON public.indicadores_financeiros;
CREATE POLICY indicadores_write ON public.indicadores_financeiros
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(provincia_id));

DROP POLICY IF EXISTS indicadores_hist_read ON public.indicadores_financeiros_hist;
CREATE POLICY indicadores_hist_read ON public.indicadores_financeiros_hist
  FOR SELECT TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id));

-- -----------------------------------------------------------------------------
-- 4. GRAVAR OS INDICADORES
-- -----------------------------------------------------------------------------
-- `p_valores` é um objecto jsonb. Só as chaves presentes são tocadas:
--   { "vendas": 1500000 }            -> muda as vendas, deixa o resto
--   { "vendas": null }               -> vendas voltam ao automático
--   { "meta_financeira": 3000000 }   -> define a meta
-- Chaves desconhecidas são ignoradas de propósito: o painel pode crescer sem
-- partir chamadas antigas.
CREATE OR REPLACE FUNCTION public.guardar_indicadores(
  p_valores     jsonb,
  p_provincia_id uuid DEFAULT NULL,
  p_nota        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_prov      uuid := p_provincia_id;
  v_nota      text := NULLIF(btrim(COALESCE(p_nota, '')), '');
  v_row       public.indicadores_financeiros%ROWTYPE;
  v_id        uuid;
  v_at        numeric;
  v_ac        numeric;
  v_inv       numeric;
  v_vp        numeric;
  v_meta      numeric;
  v_vendas    numeric;
  v_dr        numeric;
  v_al        numeric;
  v_campo     text;
  v_ant       numeric;
  v_nov       numeric;
  v_alterados jsonb := '[]'::jsonb;
  v_antes     jsonb;
  v_depois    jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão altera o painel financeiro' USING ERRCODE = '42501';
  END IF;

  IF p_valores IS NULL OR jsonb_typeof(p_valores) <> 'object' THEN
    RAISE EXCEPTION 'Indique os indicadores a guardar' USING ERRCODE = '22023';
  END IF;

  -- Um gestor provincial escreve sempre na província que gere.
  IF NOT public.is_national() THEN
    v_prov := public.my_province();
  END IF;

  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Só pode alterar o painel da província que gere' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.indicadores_financeiros
  WHERE provincia_id IS NOT DISTINCT FROM v_prov;

  v_antes := to_jsonb(v_row) - 'id' - 'created_at' - 'updated_at';

  -- Chave ausente = mantém. Chave presente com null/vazio = volta ao automático.
  v_at     := CASE WHEN p_valores ? 'activo_total'
                   THEN NULLIF(p_valores->>'activo_total', '')::numeric
                   ELSE v_row.activo_total END;
  v_ac     := CASE WHEN p_valores ? 'activo_contabilistico'
                   THEN NULLIF(p_valores->>'activo_contabilistico', '')::numeric
                   ELSE v_row.activo_contabilistico END;
  v_inv    := CASE WHEN p_valores ? 'investimentos'
                   THEN NULLIF(p_valores->>'investimentos', '')::numeric
                   ELSE v_row.investimentos END;
  v_vp     := CASE WHEN p_valores ? 'valores_a_pagar'
                   THEN NULLIF(p_valores->>'valores_a_pagar', '')::numeric
                   ELSE v_row.valores_a_pagar END;
  v_meta   := CASE WHEN p_valores ? 'meta_financeira'
                   THEN NULLIF(p_valores->>'meta_financeira', '')::numeric
                   ELSE v_row.meta_financeira END;
  v_vendas := CASE WHEN p_valores ? 'vendas'
                   THEN NULLIF(p_valores->>'vendas', '')::numeric
                   ELSE v_row.vendas END;
  v_dr     := CASE WHEN p_valores ? 'despesas_reais'
                   THEN NULLIF(p_valores->>'despesas_reais', '')::numeric
                   ELSE v_row.despesas_reais END;
  v_al     := CASE WHEN p_valores ? 'activo_liquido'
                   THEN NULLIF(p_valores->>'activo_liquido', '')::numeric
                   ELSE v_row.activo_liquido END;

  -- Nada pode ser negativo, excepto o activo líquido (dívida maior que activo).
  IF v_at IS NOT NULL AND v_at < 0 THEN
    RAISE EXCEPTION 'O activo total não pode ser negativo' USING ERRCODE = '22023';
  END IF;
  IF v_ac IS NOT NULL AND v_ac < 0 THEN
    RAISE EXCEPTION 'O activo contabilístico não pode ser negativo' USING ERRCODE = '22023';
  END IF;
  IF v_inv IS NOT NULL AND v_inv < 0 THEN
    RAISE EXCEPTION 'Os investimentos não podem ser negativos' USING ERRCODE = '22023';
  END IF;
  IF v_vp IS NOT NULL AND v_vp < 0 THEN
    RAISE EXCEPTION 'Os valores a pagar não podem ser negativos' USING ERRCODE = '22023';
  END IF;
  IF v_meta IS NOT NULL AND v_meta < 0 THEN
    RAISE EXCEPTION 'A meta financeira não pode ser negativa' USING ERRCODE = '22023';
  END IF;
  IF v_vendas IS NOT NULL AND v_vendas < 0 THEN
    RAISE EXCEPTION 'As vendas não podem ser negativas' USING ERRCODE = '22023';
  END IF;
  IF v_dr IS NOT NULL AND v_dr < 0 THEN
    RAISE EXCEPTION 'As despesas reais não podem ser negativas' USING ERRCODE = '22023';
  END IF;

  -- Histórico: uma linha por campo que mudou mesmo.
  FOR v_campo, v_ant, v_nov IN
    SELECT * FROM (VALUES
      ('activo_total',          v_row.activo_total,          v_at),
      ('activo_contabilistico', v_row.activo_contabilistico, v_ac),
      ('investimentos',         v_row.investimentos,         v_inv),
      ('valores_a_pagar',       v_row.valores_a_pagar,       v_vp),
      ('meta_financeira',       v_row.meta_financeira,       v_meta),
      ('vendas',                v_row.vendas,                v_vendas),
      ('despesas_reais',        v_row.despesas_reais,        v_dr),
      ('activo_liquido',        v_row.activo_liquido,        v_al)
    ) AS t(campo, anterior, novo)
    WHERE anterior IS DISTINCT FROM novo
  LOOP
    INSERT INTO public.indicadores_financeiros_hist
      (provincia_id, campo, valor_anterior, valor_novo, nota, alterado_por)
    VALUES (v_prov, v_campo, v_ant, v_nov, v_nota, v_uid);
    v_alterados := v_alterados || to_jsonb(v_campo);
  END LOOP;

  -- Sem nenhum valor escrito, a linha não faz falta: apaga-se para que o
  -- painel volte a dizer «automático» em vez de mostrar zeros.
  IF v_at IS NULL AND v_ac IS NULL AND v_inv IS NULL AND v_vp IS NULL
     AND v_meta IS NULL AND v_vendas IS NULL AND v_dr IS NULL AND v_al IS NULL THEN
    DELETE FROM public.indicadores_financeiros
    WHERE provincia_id IS NOT DISTINCT FROM v_prov;
    v_id := NULL;
  ELSIF v_row.id IS NULL THEN
    INSERT INTO public.indicadores_financeiros
      (provincia_id, activo_total, activo_contabilistico, investimentos,
       valores_a_pagar, meta_financeira, vendas, despesas_reais, activo_liquido,
       nota, definido_por)
    VALUES
      (v_prov, v_at, v_ac, v_inv, v_vp, v_meta, v_vendas, v_dr, v_al, v_nota, v_uid)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.indicadores_financeiros
       SET activo_total          = v_at,
           activo_contabilistico = v_ac,
           investimentos         = v_inv,
           valores_a_pagar       = v_vp,
           meta_financeira       = v_meta,
           vendas                = v_vendas,
           despesas_reais        = v_dr,
           activo_liquido        = v_al,
           nota                  = v_nota,
           definido_por          = v_uid,
           updated_at            = now()
     WHERE id = v_row.id
    RETURNING id INTO v_id;
  END IF;

  -- Compatibilidade: a partir do momento em que o painel escreve o activo
  -- total, o saldo contabilístico antigo deixa de ser uma segunda verdade.
  -- O valor já está em `indicadores_financeiros`; a linha antiga sai para não
  -- voltar a aparecer como meta quando o activo for limpo.
  IF p_valores ? 'activo_total' THEN
    DELETE FROM public.saldos_contabilisticos
    WHERE provincia_id IS NOT DISTINCT FROM v_prov;
  END IF;

  SELECT to_jsonb(f) - 'id' - 'created_at' - 'updated_at'
  INTO v_depois
  FROM public.indicadores_financeiros f
  WHERE provincia_id IS NOT DISTINCT FROM v_prov;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data, new_data)
  VALUES (v_uid, 'indicadores_financeiros_guardados', 'indicadores_financeiros', v_id,
          jsonb_build_object('provincia_id', v_prov, 'valores', v_antes),
          jsonb_build_object('provincia_id', v_prov, 'valores', v_depois,
                             'alterados', v_alterados, 'nota', v_nota));

  RETURN jsonb_build_object(
    'id',         v_id,
    'provincia_id', v_prov,
    'provincia',  (SELECT pr.nome FROM public.provincias pr WHERE pr.id = v_prov),
    'alterados',  v_alterados,
    'valores',    v_depois
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. REPOR TUDO NO AUTOMÁTICO
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.limpar_indicadores(p_provincia_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_prov    uuid := p_provincia_id;
  v_apagado int := 0;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão altera o painel financeiro' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_national() THEN
    v_prov := public.my_province();
  END IF;

  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Só pode alterar o painel da província que gere' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.indicadores_financeiros
  WHERE provincia_id IS NOT DISTINCT FROM v_prov;
  GET DIAGNOSTICS v_apagado = ROW_COUNT;

  DELETE FROM public.saldos_contabilisticos
  WHERE provincia_id IS NOT DISTINCT FROM v_prov;

  IF v_apagado > 0 THEN
    INSERT INTO public.indicadores_financeiros_hist
      (provincia_id, campo, valor_anterior, valor_novo, nota, alterado_por)
    VALUES (v_prov, 'todos', NULL, NULL, 'Painel reposto no automático', v_uid);

    INSERT INTO public.audit_logs (user_id, action, entity, old_data)
    VALUES (v_uid, 'indicadores_financeiros_repostos', 'indicadores_financeiros',
            jsonb_build_object('provincia_id', v_prov));
  END IF;

  RETURN jsonb_build_object('removido', v_apagado > 0, 'provincia_id', v_prov);
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. LER O PAINEL
-- -----------------------------------------------------------------------------
-- Devolve, por província, cada indicador com três números:
--   automatico  o que a máquina calcula
--   manual      o que o gestor escreveu (null = não escreveu)
--   valor       o que conta: manual, ou o automático quando não há manual
-- Mais o total do âmbito, o histórico recente e o valor do stock.
CREATE OR REPLACE FUNCTION public.painel_financeiro(p_provincia_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov   uuid;
  v_linhas jsonb;
  v_total  jsonb;
  v_hist   jsonb;
  v_nac    public.indicadores_financeiros%ROWTYPE;
  v_saldo  numeric;
  v_soma   record;
  v_at     numeric;
  v_ac     numeric;
  v_inv    numeric;
  v_vp     numeric;
  v_meta   numeric;
  v_vendas numeric;
  v_dr     numeric;
  v_al     numeric;
  v_auto_at numeric;
  v_auto_ac numeric;
  v_auto_inv numeric;
  v_auto_vp numeric;
  v_auto_vendas numeric;
  v_auto_dr numeric;
  v_auto_al numeric;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode consultar o painel financeiro' USING ERRCODE = '42501';
  END IF;

  IF public.is_national() THEN
    v_prov := p_provincia_id;
  ELSE
    v_prov := public.my_province();
  END IF;

  WITH vendas AS (
    SELECT COALESCE(s.provincia_id, public.default_province()) AS pid,
           COALESCE(SUM(s.total_amount), 0)::numeric AS valor,
           COUNT(*) AS qtd
    FROM public.sales s
    WHERE s.status <> 'cancelled'
    GROUP BY 1
  ),
  gastos AS (
    SELECT COALESCE(d.provincia_id, public.default_province()) AS pid,
           COALESCE(SUM(d.valor) FILTER (WHERE d.estado = 'paga' AND d.tipo = 'despesa'), 0)::numeric AS pagas,
           COALESCE(SUM(d.valor) FILTER (WHERE d.estado = 'paga' AND d.tipo = 'investimento'), 0)::numeric AS investimento,
           COALESCE(SUM(GREATEST(d.valor - public.despesa_coberto(d.id), 0))
                    FILTER (WHERE d.estado = 'pendente'), 0)::numeric AS por_pagar,
           COALESCE(SUM(LEAST(public.despesa_coberto(d.id), d.valor))
                    FILTER (WHERE d.estado = 'pendente'), 0)::numeric AS ja_coberto,
           COUNT(*) FILTER (WHERE d.estado = 'pendente') AS pendentes
    FROM public.despesas d
    WHERE d.estado <> 'anulada'
    GROUP BY 1
  ),
  stock AS (
    SELECT COALESCE(i.provincia_id, public.default_province()) AS pid,
           COALESCE(SUM(i.quantity), 0)::int AS unidades,
           COALESCE(SUM(i.quantity * p.official_price), 0)::numeric AS valor
    FROM public.inventory i
    JOIN public.products p ON p.id = i.product_id
    WHERE p.is_active
    GROUP BY 1
  ),
  comissoes AS (
    SELECT COALESCE(c.provincia_id, s.provincia_id, public.default_province()) AS pid,
           COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'pending'), 0)::numeric AS pendente
    FROM public.sale_commissions c
    JOIN public.sales s ON s.id = c.sale_id
    GROUP BY 1
  ),
  base AS (
    SELECT pr.id,
           pr.nome,
           pr.codigo,
           COALESCE(v.valor, 0)        AS vendas_auto,
           COALESCE(v.qtd, 0)          AS vendas_count,
           COALESCE(g.pagas, 0)        AS despesas_pagas,
           COALESCE(g.investimento, 0) AS investimento_auto,
           COALESCE(g.por_pagar, 0)    AS por_pagar,
           COALESCE(g.ja_coberto, 0)   AS ja_coberto,
           COALESCE(g.pendentes, 0)    AS pendentes_count,
           COALESCE(st.unidades, 0)    AS stock_unidades,
           COALESCE(st.valor, 0)       AS stock_valor,
           COALESCE(cm.pendente, 0)    AS comissoes_pendentes,
           fi.activo_total             AS m_at,
           fi.activo_contabilistico    AS m_ac,
           fi.investimentos            AS m_inv,
           fi.valores_a_pagar          AS m_vp,
           fi.meta_financeira          AS m_meta,
           fi.vendas                   AS m_vendas,
           fi.despesas_reais           AS m_dr,
           fi.activo_liquido           AS m_al,
           fi.nota,
           fi.updated_at,
           fi.definido_por,
           (SELECT p.full_name FROM public.profiles p WHERE p.id = fi.definido_por) AS definido_por_nome,
           sa.valor                    AS saldo_antigo
    FROM public.provincias pr
    LEFT JOIN vendas v    ON v.pid = pr.id
    LEFT JOIN gastos g    ON g.pid = pr.id
    LEFT JOIN stock st    ON st.pid = pr.id
    LEFT JOIN comissoes cm ON cm.pid = pr.id
    LEFT JOIN public.indicadores_financeiros fi ON fi.provincia_id = pr.id
    LEFT JOIN public.saldos_contabilisticos  sa ON sa.provincia_id = pr.id
    WHERE v_prov IS NULL OR pr.id = v_prov
  ),
  ef AS (
    SELECT *,
           -- O saldo antigo é tratado como um activo total escrito à mão.
           COALESCE(m_at, saldo_antigo) AS man_at,
           COALESCE(m_meta, saldo_antigo) AS man_meta,
           COALESCE(m_at, saldo_antigo, vendas_auto + investimento_auto) AS at_ef,
           COALESCE(m_ac, stock_valor + investimento_auto) AS ac_ef,
           COALESCE(m_inv, investimento_auto) AS inv_ef,
           COALESCE(m_vp, por_pagar + comissoes_pendentes) AS vp_ef,
           COALESCE(m_vendas, vendas_auto) AS vendas_ef,
           COALESCE(m_dr, despesas_pagas + investimento_auto + ja_coberto + por_pagar) AS dr_ef
    FROM base
  )
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'id',                id,
               'nome',              nome,
               'codigo',            codigo,
               'stock_unidades',    stock_unidades,
               'stock_valor',       stock_valor,
               'vendas_count',      vendas_count,
               'pendentes_count',   pendentes_count,
               'comissoes_pendentes', comissoes_pendentes,
               'despesas_pagas',    despesas_pagas,
               'ja_coberto',        ja_coberto,
               'nota',              nota,
               'definido_por',      definido_por_nome,
               'updated_at',        updated_at,
               'indicadores', jsonb_build_object(
                 'activo_total', jsonb_build_object(
                   'automatico', vendas_auto + investimento_auto,
                   'manual',     man_at,
                   'valor',      at_ef,
                   'origem',     CASE WHEN man_at IS NULL THEN 'automatico' ELSE 'gestor' END),
                 'activo_contabilistico', jsonb_build_object(
                   'automatico', stock_valor + investimento_auto,
                   'manual',     m_ac,
                   'valor',      ac_ef,
                   'origem',     CASE WHEN m_ac IS NULL THEN 'automatico' ELSE 'gestor' END),
                 'investimentos', jsonb_build_object(
                   'automatico', investimento_auto,
                   'manual',     m_inv,
                   'valor',      inv_ef,
                   'origem',     CASE WHEN m_inv IS NULL THEN 'automatico' ELSE 'gestor' END),
                 'valores_a_pagar', jsonb_build_object(
                   'automatico', por_pagar + comissoes_pendentes,
                   'manual',     m_vp,
                   'valor',      vp_ef,
                   'origem',     CASE WHEN m_vp IS NULL THEN 'automatico' ELSE 'gestor' END),
                 'meta_financeira', jsonb_build_object(
                   'automatico', NULL,
                   'manual',     man_meta,
                   'valor',      man_meta,
                   'origem',     CASE WHEN man_meta IS NULL THEN 'vazio' ELSE 'gestor' END),
                 'vendas', jsonb_build_object(
                   'automatico', vendas_auto,
                   'manual',     m_vendas,
                   'valor',      vendas_ef,
                   'origem',     CASE WHEN m_vendas IS NULL THEN 'automatico' ELSE 'gestor' END),
                 'despesas_reais', jsonb_build_object(
                   'automatico', despesas_pagas + investimento_auto + ja_coberto + por_pagar,
                   'manual',     m_dr,
                   'valor',      dr_ef,
                   'origem',     CASE WHEN m_dr IS NULL THEN 'automatico' ELSE 'gestor' END),
                 'activo_liquido', jsonb_build_object(
                   'automatico', (vendas_auto + investimento_auto)
                                 - (despesas_pagas + investimento_auto + ja_coberto + por_pagar),
                   'manual',     m_al,
                   'valor',      COALESCE(m_al, at_ef - dr_ef),
                   'origem',     CASE WHEN m_al IS NULL THEN 'automatico' ELSE 'gestor' END)
               )
             )
             ORDER BY at_ef DESC, nome
           ),
           '[]'::jsonb
         )
  INTO v_linhas
  FROM ef;

  SELECT SUM((l->'indicadores'->'activo_total'->>'automatico')::numeric)          AS auto_at,
         SUM((l->'indicadores'->'activo_contabilistico'->>'automatico')::numeric) AS auto_ac,
         SUM((l->'indicadores'->'investimentos'->>'automatico')::numeric)         AS auto_inv,
         SUM((l->'indicadores'->'valores_a_pagar'->>'automatico')::numeric)       AS auto_vp,
         SUM((l->'indicadores'->'vendas'->>'automatico')::numeric)                AS auto_vendas,
         SUM((l->'indicadores'->'despesas_reais'->>'automatico')::numeric)        AS auto_dr,
         SUM((l->'indicadores'->'activo_liquido'->>'automatico')::numeric)        AS auto_al,
         SUM((l->'indicadores'->'activo_total'->>'valor')::numeric)               AS val_at,
         SUM((l->'indicadores'->'activo_contabilistico'->>'valor')::numeric)      AS val_ac,
         SUM((l->'indicadores'->'investimentos'->>'valor')::numeric)              AS val_inv,
         SUM((l->'indicadores'->'valores_a_pagar'->>'valor')::numeric)            AS val_vp,
         SUM((l->'indicadores'->'vendas'->>'valor')::numeric)                     AS val_vendas,
         SUM((l->'indicadores'->'despesas_reais'->>'valor')::numeric)             AS val_dr,
         SUM((l->'indicadores'->'activo_liquido'->>'valor')::numeric)             AS val_al,
         SUM((l->>'vendas_count')::int)                                           AS vendas_count,
         SUM((l->>'pendentes_count')::int)                                        AS pendentes_count,
         SUM((l->>'stock_valor')::numeric)                                        AS stock_valor,
         SUM((l->>'stock_unidades')::int)                                         AS stock_unidades
  INTO v_soma
  FROM jsonb_array_elements(v_linhas) l;

  v_auto_at     := COALESCE(v_soma.auto_at, 0);
  v_auto_ac     := COALESCE(v_soma.auto_ac, 0);
  v_auto_inv    := COALESCE(v_soma.auto_inv, 0);
  v_auto_vp     := COALESCE(v_soma.auto_vp, 0);
  v_auto_vendas := COALESCE(v_soma.auto_vendas, 0);
  v_auto_dr     := COALESCE(v_soma.auto_dr, 0);
  v_auto_al     := COALESCE(v_soma.auto_al, 0);
  v_at          := COALESCE(v_soma.val_at, 0);
  v_ac          := COALESCE(v_soma.val_ac, 0);
  v_inv         := COALESCE(v_soma.val_inv, 0);
  v_vp          := COALESCE(v_soma.val_vp, 0);
  v_vendas      := COALESCE(v_soma.val_vendas, 0);
  v_dr          := COALESCE(v_soma.val_dr, 0);
  v_al          := COALESCE(v_soma.val_al, 0);

  -- O valor da empresa toda, quando escrito, manda no total nacional.
  IF v_prov IS NULL THEN
    SELECT * INTO v_nac
    FROM public.indicadores_financeiros
    WHERE provincia_id IS NULL;

    SELECT valor INTO v_saldo
    FROM public.saldos_contabilisticos
    WHERE provincia_id IS NULL;

    v_at     := COALESCE(v_nac.activo_total,          v_saldo, v_at);
    v_ac     := COALESCE(v_nac.activo_contabilistico, v_ac);
    v_inv    := COALESCE(v_nac.investimentos,         v_inv);
    v_vp     := COALESCE(v_nac.valores_a_pagar,       v_vp);
    v_meta   := COALESCE(v_nac.meta_financeira,       v_saldo);
    v_vendas := COALESCE(v_nac.vendas,                v_vendas);
    v_dr     := COALESCE(v_nac.despesas_reais,        v_dr);
    v_al     := COALESCE(v_nac.activo_liquido,        v_at - v_dr);
  ELSE
    -- Âmbito provincial: a meta é a da província (já vem no somatório).
    SELECT (l->'indicadores'->'meta_financeira'->>'valor')::numeric
    INTO v_meta
    FROM jsonb_array_elements(v_linhas) l
    LIMIT 1;
  END IF;

  v_total := jsonb_build_object(
    'indicadores', jsonb_build_object(
      'activo_total', jsonb_build_object(
        'automatico', v_auto_at,
        'manual',     CASE WHEN v_prov IS NULL THEN COALESCE(v_nac.activo_total, v_saldo) ELSE NULL END,
        'valor',      v_at,
        'origem',     CASE WHEN (v_prov IS NULL AND (v_nac.activo_total IS NOT NULL OR v_saldo IS NOT NULL))
                           THEN 'gestor' ELSE 'automatico' END),
      'activo_contabilistico', jsonb_build_object(
        'automatico', v_auto_ac,
        'manual',     CASE WHEN v_prov IS NULL THEN v_nac.activo_contabilistico ELSE NULL END,
        'valor',      v_ac,
        'origem',     CASE WHEN v_prov IS NULL AND v_nac.activo_contabilistico IS NOT NULL
                           THEN 'gestor' ELSE 'automatico' END),
      'investimentos', jsonb_build_object(
        'automatico', v_auto_inv,
        'manual',     CASE WHEN v_prov IS NULL THEN v_nac.investimentos ELSE NULL END,
        'valor',      v_inv,
        'origem',     CASE WHEN v_prov IS NULL AND v_nac.investimentos IS NOT NULL
                           THEN 'gestor' ELSE 'automatico' END),
      'valores_a_pagar', jsonb_build_object(
        'automatico', v_auto_vp,
        'manual',     CASE WHEN v_prov IS NULL THEN v_nac.valores_a_pagar ELSE NULL END,
        'valor',      v_vp,
        'origem',     CASE WHEN v_prov IS NULL AND v_nac.valores_a_pagar IS NOT NULL
                           THEN 'gestor' ELSE 'automatico' END),
      'meta_financeira', jsonb_build_object(
        'automatico', NULL,
        'manual',     v_meta,
        'valor',      v_meta,
        'origem',     CASE WHEN v_meta IS NULL THEN 'vazio' ELSE 'gestor' END),
      'vendas', jsonb_build_object(
        'automatico', v_auto_vendas,
        'manual',     CASE WHEN v_prov IS NULL THEN v_nac.vendas ELSE NULL END,
        'valor',      v_vendas,
        'origem',     CASE WHEN v_prov IS NULL AND v_nac.vendas IS NOT NULL
                           THEN 'gestor' ELSE 'automatico' END),
      'despesas_reais', jsonb_build_object(
        'automatico', v_auto_dr,
        'manual',     CASE WHEN v_prov IS NULL THEN v_nac.despesas_reais ELSE NULL END,
        'valor',      v_dr,
        'origem',     CASE WHEN v_prov IS NULL AND v_nac.despesas_reais IS NOT NULL
                           THEN 'gestor' ELSE 'automatico' END),
      'activo_liquido', jsonb_build_object(
        'automatico', v_auto_al,
        'manual',     CASE WHEN v_prov IS NULL THEN v_nac.activo_liquido ELSE NULL END,
        'valor',      v_al,
        'origem',     CASE WHEN v_prov IS NULL AND v_nac.activo_liquido IS NOT NULL
                           THEN 'gestor' ELSE 'automatico' END)
    ),
    'activo_bruto',   v_at + v_ac,
    'excedido',       v_dr > v_at,
    'progresso',      CASE
                        WHEN v_meta IS NULL OR v_meta <= 0 THEN NULL
                        ELSE round(100 * v_al / v_meta)
                      END,
    'vendas_count',   COALESCE(v_soma.vendas_count, 0),
    'pendentes_count', COALESCE(v_soma.pendentes_count, 0),
    'stock_valor',    COALESCE(v_soma.stock_valor, 0),
    'stock_unidades', COALESCE(v_soma.stock_unidades, 0)
  );

  SELECT COALESCE(jsonb_agg(h ORDER BY ordem DESC, id DESC), '[]'::jsonb)
  INTO v_hist
  FROM (
    SELECT hi.created_at AS ordem,
           hi.id,
           jsonb_build_object(
             'id',             hi.id,
             'provincia_id',   hi.provincia_id,
             'provincia',      pr.nome,
             'campo',          hi.campo,
             'valor_anterior', hi.valor_anterior,
             'valor_novo',     hi.valor_novo,
             'nota',           hi.nota,
             'quem',           p.full_name,
             'quando',         hi.created_at
           ) AS h
    FROM public.indicadores_financeiros_hist hi
    LEFT JOIN public.provincias pr ON pr.id = hi.provincia_id
    LEFT JOIN public.profiles   p  ON p.id  = hi.alterado_por
    WHERE public.can_manage_province(hi.provincia_id)
      AND (v_prov IS NULL OR hi.provincia_id = v_prov)
    ORDER BY hi.created_at DESC, hi.id DESC
    LIMIT 40
  ) x;

  RETURN jsonb_build_object(
    'scope',        CASE WHEN v_prov IS NULL THEN 'nacional' ELSE 'provincial' END,
    'provincia_id', v_prov,
    'provincia',    (SELECT pr.nome FROM public.provincias pr WHERE pr.id = v_prov),
    'pode_editar',  public.is_manager() AND public.can_manage_province(v_prov),
    'linhas',       v_linhas,
    'total',        v_total,
    'historico',    v_hist
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. ACTIVO — PASSA A LER OS INDICADORES DO GESTOR
-- -----------------------------------------------------------------------------
-- Substitui a versão da 0023. A assinatura é a mesma. Os campos antigos
-- continuam todos lá (as páginas que já os usam não mudam); o que muda é que
-- cada um prefere o valor escrito pelo gestor e só cai no automático quando
-- ele não escreveu nada. `*_automatico` e `*_manual` ficam disponíveis para
-- quem quiser comparar.
CREATE OR REPLACE FUNCTION public.activo_provincia(p_provincia_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov       uuid;
  v_linhas     jsonb;
  v_total      jsonb;
  v_max        jsonb;
  v_risco      int;
  v_saldo_nac  numeric;
  v_nac        public.indicadores_financeiros%ROWTYPE;
  v_tot_at     numeric;
  v_tot_dr     numeric;
  v_tot_meta   numeric;
  v_tot_al     numeric;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode consultar o activo' USING ERRCODE = '42501';
  END IF;

  IF public.is_national() THEN
    v_prov := p_provincia_id;
  ELSE
    v_prov := public.my_province();
  END IF;

  WITH vendas AS (
    SELECT COALESCE(s.provincia_id, public.default_province()) AS pid,
           COALESCE(SUM(s.total_amount), 0)::numeric AS valor,
           COUNT(*) AS qtd
    FROM public.sales s
    WHERE s.status <> 'cancelled'
    GROUP BY 1
  ),
  gastos AS (
    SELECT COALESCE(d.provincia_id, public.default_province()) AS pid,
           COALESCE(SUM(d.valor) FILTER (WHERE d.estado = 'paga' AND d.tipo = 'despesa'), 0)::numeric AS pagas,
           COALESCE(SUM(d.valor) FILTER (WHERE d.estado = 'paga' AND d.tipo = 'investimento'), 0)::numeric AS investimento,
           COALESCE(SUM(GREATEST(d.valor - public.despesa_coberto(d.id), 0))
                    FILTER (WHERE d.estado = 'pendente'), 0)::numeric AS por_pagar,
           COALESCE(SUM(LEAST(public.despesa_coberto(d.id), d.valor))
                    FILTER (WHERE d.estado = 'pendente'), 0)::numeric AS ja_coberto,
           COUNT(*) FILTER (WHERE d.estado = 'pendente') AS pendentes
    FROM public.despesas d
    WHERE d.estado <> 'anulada'
    GROUP BY 1
  ),
  stock AS (
    SELECT COALESCE(i.provincia_id, public.default_province()) AS pid,
           COALESCE(SUM(i.quantity), 0)::int AS unidades,
           COALESCE(SUM(i.quantity * p.official_price), 0)::numeric AS valor
    FROM public.inventory i
    JOIN public.products p ON p.id = i.product_id
    WHERE p.is_active
    GROUP BY 1
  ),
  base AS (
    SELECT pr.id,
           pr.nome,
           pr.codigo,
           COALESCE(v.valor, 0)        AS vendas,
           COALESCE(v.qtd, 0)          AS vendas_count,
           COALESCE(g.pagas, 0)        AS despesas_pagas,
           COALESCE(g.investimento, 0) AS investimento_pago,
           COALESCE(g.por_pagar, 0)    AS por_pagar,
           COALESCE(g.ja_coberto, 0)   AS ja_coberto,
           COALESCE(g.pendentes, 0)    AS pendentes_count,
           COALESCE(st.unidades, 0)    AS stock_unidades,
           COALESCE(st.valor, 0)       AS stock_valor,
           sa.valor                    AS saldo_manual,
           fi.activo_total             AS i_at,
           fi.activo_contabilistico    AS i_ac,
           fi.investimentos            AS i_inv,
           fi.valores_a_pagar          AS i_vp,
           fi.meta_financeira          AS i_meta,
           fi.vendas                   AS i_vendas,
           fi.despesas_reais           AS i_dr,
           fi.activo_liquido           AS i_al
    FROM public.provincias pr
    LEFT JOIN vendas v   ON v.pid = pr.id
    LEFT JOIN gastos g   ON g.pid = pr.id
    LEFT JOIN stock st   ON st.pid = pr.id
    LEFT JOIN public.saldos_contabilisticos   sa ON sa.provincia_id = pr.id
    LEFT JOIN public.indicadores_financeiros  fi ON fi.provincia_id = pr.id
    WHERE v_prov IS NULL OR pr.id = v_prov
  ),
  ef AS (
    SELECT *,
           COALESCE(i_vendas, vendas)                AS vendas_ef,
           COALESCE(i_inv, investimento_pago)        AS inv_ef,
           COALESCE(i_vp, por_pagar)                 AS vp_ef,
           COALESCE(i_dr, despesas_pagas + COALESCE(i_inv, investimento_pago)
                          + ja_coberto + por_pagar)  AS desp_ef,
           COALESCE(i_at, saldo_manual,
                    COALESCE(i_vendas, vendas)
                    + COALESCE(i_inv, investimento_pago)) AS at_ef
    FROM base
  )
  SELECT COALESCE(
           jsonb_agg(linha ORDER BY (linha->>'activo_total')::numeric DESC, linha->>'nome'),
           '[]'::jsonb
         )
  INTO v_linhas
  FROM (
    SELECT jsonb_build_object(
             'id',                id,
             'nome',              nome,
             'codigo',            codigo,
             'vendas',            vendas_ef,
             'vendas_automatico', vendas,
             'vendas_manual',     i_vendas,
             'vendas_count',      vendas_count,
             'despesas_pagas',    despesas_pagas,
             'investimento_pago', inv_ef,
             'investimento_automatico', investimento_pago,
             'por_pagar',         vp_ef,
             'por_pagar_automatico', por_pagar,
             'ja_coberto',        ja_coberto,
             'pendentes_count',   pendentes_count,
             'stock_unidades',    stock_unidades,
             'stock_valor',       stock_valor,
             'activo_contabilistico', COALESCE(i_ac, stock_valor + inv_ef),
             'activo_contabilistico_manual', i_ac,
             'despesas_total',    desp_ef,
             'despesas_manual',   i_dr,
             -- O automático nunca desaparece: é a referência com que o gestor
             -- compara o valor que declarou.
             'activo_calculado',  vendas + investimento_pago,
             'saldo_manual',      i_at,
             'meta',              COALESCE(i_meta, saldo_manual),
             'meta_manual',       i_meta,
             'origem',            CASE
                                    WHEN i_at IS NOT NULL OR i_ac IS NOT NULL
                                      OR i_inv IS NOT NULL OR i_vp IS NOT NULL
                                      OR i_meta IS NOT NULL OR i_vendas IS NOT NULL
                                      OR i_dr IS NOT NULL OR i_al IS NOT NULL
                                      OR saldo_manual IS NOT NULL
                                      THEN 'gestor'
                                    ELSE 'automatico'
                                  END,
             'activo_total',      at_ef,
             'activo_liquido',    COALESCE(i_al, at_ef - desp_ef),
             'activo_liquido_manual', i_al,
             'progresso',         CASE
                                    WHEN COALESCE(i_meta, saldo_manual) IS NULL
                                      OR COALESCE(i_meta, saldo_manual) <= 0 THEN NULL
                                    ELSE round(
                                      100 * COALESCE(i_al, at_ef - desp_ef)
                                      / COALESCE(i_meta, saldo_manual)
                                    )
                                  END,
             'excedido',          desp_ef > at_ef,
             'cobertura',         CASE
                                    WHEN desp_ef > 0
                                      THEN round(100 * at_ef / desp_ef)
                                    ELSE 100
                                  END
           ) AS linha
    FROM ef
  ) t;

  SELECT jsonb_build_object(
           'vendas',            COALESCE(SUM((l->>'vendas')::numeric), 0),
           'vendas_count',      COALESCE(SUM((l->>'vendas_count')::int), 0),
           'despesas_pagas',    COALESCE(SUM((l->>'despesas_pagas')::numeric), 0),
           'investimento_pago', COALESCE(SUM((l->>'investimento_pago')::numeric), 0),
           'por_pagar',         COALESCE(SUM((l->>'por_pagar')::numeric), 0),
           'ja_coberto',        COALESCE(SUM((l->>'ja_coberto')::numeric), 0),
           'pendentes_count',   COALESCE(SUM((l->>'pendentes_count')::int), 0),
           'stock_unidades',    COALESCE(SUM((l->>'stock_unidades')::int), 0),
           'stock_valor',       COALESCE(SUM((l->>'stock_valor')::numeric), 0),
           'activo_contabilistico', COALESCE(SUM((l->>'activo_contabilistico')::numeric), 0),
           'despesas_total',    COALESCE(SUM((l->>'despesas_total')::numeric), 0),
           'activo_calculado',  COALESCE(SUM((l->>'activo_calculado')::numeric), 0),
           'activo_total',      COALESCE(SUM((l->>'activo_total')::numeric), 0),
           'activo_liquido',    COALESCE(SUM((l->>'activo_liquido')::numeric), 0),
           'saldo_manual',      COALESCE(SUM((l->>'saldo_manual')::numeric), 0),
           'meta',              SUM((l->>'meta')::numeric),
           'tem_manual',        COALESCE(BOOL_OR((l->>'origem') = 'gestor'), false)
         )
  INTO v_total
  FROM jsonb_array_elements(v_linhas) l;

  IF v_total IS NULL THEN
    v_total := jsonb_build_object(
      'vendas', 0, 'vendas_count', 0,
      'despesas_pagas', 0, 'investimento_pago', 0,
      'por_pagar', 0, 'ja_coberto', 0, 'pendentes_count', 0,
      'stock_unidades', 0, 'stock_valor', 0, 'activo_contabilistico', 0,
      'despesas_total', 0, 'activo_calculado', 0,
      'activo_total', 0, 'activo_liquido', 0,
      'saldo_manual', 0, 'meta', NULL, 'tem_manual', false
    );
  END IF;

  IF v_prov IS NULL THEN
    SELECT * INTO v_nac
    FROM public.indicadores_financeiros
    WHERE provincia_id IS NULL;

    SELECT valor INTO v_saldo_nac
    FROM public.saldos_contabilisticos
    WHERE provincia_id IS NULL;
  END IF;

  -- O valor da empresa toda, quando escrito, manda no total nacional. Sem ele,
  -- o total é a soma das províncias — e cada província pode ter o seu manual.
  v_tot_at   := COALESCE(v_nac.activo_total, v_saldo_nac,
                         (v_total->>'activo_total')::numeric, 0);
  v_tot_dr   := COALESCE(v_nac.despesas_reais,
                         (v_total->>'despesas_total')::numeric, 0);
  v_tot_meta := COALESCE(v_nac.meta_financeira, v_saldo_nac,
                         (v_total->>'meta')::numeric);
  v_tot_al   := COALESCE(
                  v_nac.activo_liquido,
                  CASE WHEN v_nac.activo_total IS NOT NULL OR v_saldo_nac IS NOT NULL
                       THEN v_tot_at - v_tot_dr
                       ELSE (v_total->>'activo_liquido')::numeric END,
                  0);

  v_total := v_total || jsonb_build_object(
    'saldo_manual', COALESCE(v_nac.activo_total, v_saldo_nac,
                             (v_total->>'saldo_manual')::numeric),
    'meta',         v_tot_meta,
    'origem',       CASE WHEN v_nac.id IS NOT NULL OR v_saldo_nac IS NOT NULL
                              OR (v_total->>'tem_manual')::boolean
                         THEN 'gestor' ELSE 'automatico' END,
    'vendas',       COALESCE(v_nac.vendas, (v_total->>'vendas')::numeric),
    'investimento_pago', COALESCE(v_nac.investimentos, (v_total->>'investimento_pago')::numeric),
    'por_pagar',    COALESCE(v_nac.valores_a_pagar, (v_total->>'por_pagar')::numeric),
    'despesas_total', v_tot_dr,
    'activo_contabilistico', COALESCE(v_nac.activo_contabilistico,
                                      (v_total->>'activo_contabilistico')::numeric),
    'activo_total', v_tot_at,
    'activo_liquido', v_tot_al,
    'progresso',    CASE
                      WHEN v_tot_meta IS NULL OR v_tot_meta <= 0 THEN NULL
                      ELSE round(100 * v_tot_al / v_tot_meta)
                    END,
    'excedido',     v_tot_dr > v_tot_at,
    'cobertura',    CASE
                      WHEN v_tot_dr > 0 THEN round(100 * v_tot_at / v_tot_dr)
                      ELSE 100
                    END
  );

  SELECT x INTO v_max
  FROM jsonb_array_elements(v_linhas) AS e(x)
  ORDER BY (x->>'activo_total')::numeric DESC
  LIMIT 1;

  SELECT COUNT(*) INTO v_risco
  FROM jsonb_array_elements(v_linhas) l
  WHERE (l->>'excedido')::boolean;

  RETURN jsonb_build_object(
    'scope',        CASE WHEN v_prov IS NULL THEN 'nacional' ELSE 'provincial' END,
    'provincia_id', v_prov,
    'provincia',    (SELECT pr.nome FROM public.provincias pr WHERE pr.id = v_prov),
    'linhas',       v_linhas,
    'total',        v_total,
    'maximo',       v_max,
    'em_risco',     v_risco
  );
END;
$$;

COMMENT ON FUNCTION public.activo_provincia(uuid) IS
  'Activo por província. Cada indicador prefere o valor escrito pela gestão (indicadores_financeiros) e cai no automático quando não há valor. Devolve o automático e o manual lado a lado para comparação.';

-- -----------------------------------------------------------------------------
-- 8. PERMISSÕES
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.guardar_indicadores(jsonb, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.limpar_indicadores(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_financeiro(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.activo_provincia(uuid)                 TO authenticated;
