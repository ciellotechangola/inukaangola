-- =============================================================================
--  INUKA ANGOLA — PATCH: SALDO CONTABILÍSTICO E VISÃO DA EMPRESA
-- =============================================================================
--  Supabase -> SQL Editor -> New query -> colar tudo -> RUN
--  Idempotente. Pode ser executado mais do que uma vez sem perder dados.
--  Equivale à migração 0023_saldo_contabilistico.sql (mesmo conteúdo).
--  Requer a 0021 (despesas) e a 0022 (activo da província) já aplicadas.
--
--  O QUE RESOLVE
--    A gestão passa a escrever o saldo contabilístico da empresa (ou de cada
--    província) com base na análise ao stock. Esse valor é a meta: substitui o
--    cálculo automático como activo total, e as despesas reais descontam dele.
--    O cálculo automático continua visível para comparação.
--
--  Sem este patch a página /gerente/empresa não grava nem mostra o saldo
--  (o PostgREST responde «Could not find the function definir_saldo_...»).

-- =============================================================================
-- 0023 — SALDO CONTABILÍSTICO E VISÃO DA EMPRESA
-- =============================================================================
-- O PROBLEMA
-- O activo era sempre calculado pela máquina: vendas + investimento. Mas quem
-- conhece o valor real da empresa é o gestor — ele olha para o stock, para o
-- que está na delegação, e sabe quanto aquilo vale. Uma fórmula automática
-- nunca chega lá: o stock pode estar avaliado abaixo do preço de venda, pode
-- haver material que não passou por aqui, pode haver dívidas que ninguém
-- registou.
--
-- A SOLUÇÃO
-- Uma tabela `saldos_contabilisticos` onde a gestão **escreve** o valor que
-- apurou. Esse valor passa a ser o activo da província (ou da empresa toda, se
-- for a administração nacional) e funciona como **meta**: é contra ele que as
-- despesas são descontadas e é ele que diz se a província está acima ou abaixo.
--
-- NÃO É AUTOMÁTICO — MAS NÃO SE PERDE O AUTOMÁTICO
-- Quando há saldo definido, `activo_total` é o valor do gestor (`origem =
-- 'gestor'`). O cálculo automático continua a ser devolvido em
-- `activo_calculado` (vendas + investimento), para o gestor poder comparar o
-- que declarou com o que o sistema vê. Sem saldo definido, tudo funciona como
-- antes (`origem = 'automatico'`) — nenhuma província fica sem número.
--
-- O STOCK AO LADO DO FORMULÁRIO
-- `activo_provincia()` passa a devolver também o valor do stock a preço
-- oficial. É a análise que o gestor faz para escrever o saldo; tê-la ao lado
-- do campo evita andar a somar à mão noutra página.
--
-- UM SALDO POR PROVÍNCIA, E UM DA EMPRESA
-- `provincia_id` nulo = saldo da empresa toda (só a administração nacional o
-- define). Um gestor provincial define apenas o da sua província.
--
-- IDEMPOTENTE: pode voltar a correr.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABELA
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saldos_contabilisticos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = saldo da empresa toda (sede / administração nacional).
  provincia_id  uuid REFERENCES public.provincias(id) ON DELETE CASCADE,
  valor         numeric(14,2) NOT NULL CHECK (valor >= 0),
  nota          text,
  definido_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saldo_nota_preenchida CHECK (nota IS NULL OR btrim(nota) <> '')
);

-- Um saldo por província, e um só da empresa. Índices parciais porque, em SQL,
-- dois NULL não colidem num índice único normal — a empresa acabaria com
-- vários saldos «nacionais».
CREATE UNIQUE INDEX IF NOT EXISTS saldos_provincia_unico
  ON public.saldos_contabilisticos (provincia_id) WHERE provincia_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS saldos_empresa_unico
  ON public.saldos_contabilisticos ((true)) WHERE provincia_id IS NULL;

DROP TRIGGER IF EXISTS trg_saldos_updated ON public.saldos_contabilisticos;
CREATE TRIGGER trg_saldos_updated
  BEFORE UPDATE ON public.saldos_contabilisticos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.saldos_contabilisticos IS
  'Saldo contabilístico declarado pela gestão (meta do activo). Substitui o cálculo automático como activo total; o automático continua visível em activo_calculado.';

-- -----------------------------------------------------------------------------
-- 2. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.saldos_contabilisticos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saldos_read ON public.saldos_contabilisticos;
CREATE POLICY saldos_read ON public.saldos_contabilisticos
  FOR SELECT TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id));

DROP POLICY IF EXISTS saldos_write ON public.saldos_contabilisticos;
CREATE POLICY saldos_write ON public.saldos_contabilisticos
  FOR ALL TO authenticated
  USING (public.is_manager() AND public.can_manage_province(provincia_id))
  WITH CHECK (public.is_manager() AND public.can_manage_province(provincia_id));

-- -----------------------------------------------------------------------------
-- 3. DEFINIR O SALDO
-- -----------------------------------------------------------------------------
-- `p_valor` é o número que o gestor apurou. Fica a ser a meta da província
-- (ou da empresa, quando `p_provincia_id` é nulo e quem chama é nacional).
CREATE OR REPLACE FUNCTION public.definir_saldo_contabilistico(
  p_valor        numeric,
  p_provincia_id uuid DEFAULT NULL,
  p_nota         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_prov     uuid := p_provincia_id;
  v_nota     text := NULLIF(btrim(COALESCE(p_nota, '')), '');
  v_anterior numeric;
  v_id       uuid;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão define o saldo contabilístico' USING ERRCODE = '42501';
  END IF;

  IF p_valor IS NULL OR p_valor < 0 THEN
    RAISE EXCEPTION 'Indique um valor válido para o saldo' USING ERRCODE = '22023';
  END IF;

  -- Um gestor provincial define sempre o saldo da província que gere, mesmo
  -- que peça outra. A nacional escolhe (ou deixa nulo = empresa toda).
  IF NOT public.is_national() THEN
    v_prov := public.my_province();
  END IF;

  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Só pode definir o saldo da província que gere' USING ERRCODE = '42501';
  END IF;

  SELECT valor INTO v_anterior
  FROM public.saldos_contabilisticos
  WHERE provincia_id IS NOT DISTINCT FROM v_prov;

  UPDATE public.saldos_contabilisticos
     SET valor = round(p_valor, 2),
         nota = v_nota,
         definido_por = v_uid,
         updated_at = now()
   WHERE provincia_id IS NOT DISTINCT FROM v_prov
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.saldos_contabilisticos (provincia_id, valor, nota, definido_por)
    VALUES (v_prov, round(p_valor, 2), v_nota, v_uid)
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data, new_data)
  VALUES (v_uid, 'saldo_contabilistico_definido', 'saldos_contabilisticos', v_id,
          jsonb_build_object('valor', v_anterior, 'provincia_id', v_prov),
          jsonb_build_object('valor', round(p_valor, 2), 'nota', v_nota));

  RETURN jsonb_build_object(
    'id', v_id,
    'provincia_id', v_prov,
    'provincia', (SELECT pr.nome FROM public.provincias pr WHERE pr.id = v_prov),
    'valor', round(p_valor, 2),
    'anterior', v_anterior,
    'nota', v_nota
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. VOLTAR AO AUTOMÁTICO
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.limpar_saldo_contabilistico(p_provincia_id uuid DEFAULT NULL)
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
    RAISE EXCEPTION 'Apenas a gestão altera o saldo contabilístico' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_national() THEN
    v_prov := public.my_province();
  END IF;

  IF NOT public.can_manage_province(v_prov) THEN
    RAISE EXCEPTION 'Só pode alterar o saldo da província que gere' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.saldos_contabilisticos
  WHERE provincia_id IS NOT DISTINCT FROM v_prov;
  GET DIAGNOSTICS v_apagado = ROW_COUNT;

  IF v_apagado > 0 THEN
    INSERT INTO public.audit_logs (user_id, action, entity, old_data)
    VALUES (v_uid, 'saldo_contabilistico_removido', 'saldos_contabilisticos',
            jsonb_build_object('provincia_id', v_prov));
  END IF;

  RETURN jsonb_build_object(
    'removido', v_apagado > 0,
    'provincia_id', v_prov
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. LER O QUE ESTÁ DEFINIDO
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.saldo_contabilistico(p_provincia_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov uuid;
  v_res  jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão consulta o saldo contabilístico' USING ERRCODE = '42501';
  END IF;

  IF public.is_national() THEN
    v_prov := p_provincia_id;
  ELSE
    v_prov := public.my_province();
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id',           s.id,
             'provincia_id', s.provincia_id,
             'provincia',    pr.nome,
             'valor',        s.valor,
             'nota',         s.nota,
             'definido_por', (SELECT p.full_name FROM public.profiles p WHERE p.id = s.definido_por),
             'updated_at',   s.updated_at
           ) ORDER BY pr.nome NULLS FIRST
         ), '[]'::jsonb)
  INTO v_res
  FROM public.saldos_contabilisticos s
  LEFT JOIN public.provincias pr ON pr.id = s.provincia_id
  WHERE public.can_manage_province(s.provincia_id)
    AND (v_prov IS NULL OR s.provincia_id = v_prov);

  RETURN v_res;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. QUANTO VALE O STOCK
-- -----------------------------------------------------------------------------
-- A preço oficial: é o valor estável de referência, não o preço de campanha.
-- `quantidade` é o que está fisicamente na prateleira (reservas incluídas —
-- o produto existe, está é prometido a alguém).
CREATE OR REPLACE FUNCTION public.stock_valor(p_provincia_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov uuid;
  v_res  jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão consulta o valor do stock' USING ERRCODE = '42501';
  END IF;

  IF public.is_national() THEN
    v_prov := p_provincia_id;
  ELSE
    v_prov := public.my_province();
  END IF;

  WITH linhas AS (
    SELECT i.id,
           i.quantity,
           i.low_stock_threshold,
           p.name,
           p.official_price,
           COALESCE(i.quantity * p.official_price, 0)::numeric AS valor
    FROM public.inventory i
    JOIN public.products p ON p.id = i.product_id
    WHERE p.is_active
      AND (v_prov IS NULL OR COALESCE(i.provincia_id, public.default_province()) = v_prov)
  )
  SELECT jsonb_build_object(
           'unidades',   COALESCE(SUM(quantity), 0),
           'valor',      COALESCE(SUM(valor), 0),
           'produtos',   COUNT(DISTINCT name),
           'sem_stock',  COUNT(*) FILTER (WHERE quantity = 0),
           'baixo',      COUNT(*) FILTER (WHERE quantity > 0 AND quantity <= low_stock_threshold),
           'top',        COALESCE((
             SELECT jsonb_agg(t ORDER BY (t->>'valor')::numeric DESC)
             FROM (
               SELECT jsonb_build_object(
                        'nome', name,
                        'unidades', SUM(quantity),
                        'valor', SUM(valor)
                      ) AS t
               FROM linhas
               GROUP BY name
               ORDER BY SUM(valor) DESC
               LIMIT 8
             ) x
           ), '[]'::jsonb)
         )
  INTO v_res
  FROM linhas;

  RETURN v_res;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. ACTIVO — COM O SALDO DO GESTOR À FRENTE
-- -----------------------------------------------------------------------------
-- Substitui a versão da 0022. Assinatura igual, por isso `CREATE OR REPLACE`
-- chega — não ficam duas versões ambíguas.
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
           sa.valor                    AS saldo_manual
    FROM public.provincias pr
    LEFT JOIN vendas v   ON v.pid = pr.id
    LEFT JOIN gastos g   ON g.pid = pr.id
    LEFT JOIN stock st   ON st.pid = pr.id
    LEFT JOIN public.saldos_contabilisticos sa ON sa.provincia_id = pr.id
    WHERE v_prov IS NULL OR pr.id = v_prov
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
             'vendas',            vendas,
             'vendas_count',      vendas_count,
             'despesas_pagas',    despesas_pagas,
             'investimento_pago', investimento_pago,
             'por_pagar',         por_pagar,
             'ja_coberto',        ja_coberto,
             'pendentes_count',   pendentes_count,
             'stock_unidades',    stock_unidades,
             'stock_valor',       stock_valor,
             'despesas_total',    despesas_pagas + investimento_pago + ja_coberto + por_pagar,
             -- O automático nunca desaparece: é a referência com que o gestor
             -- compara o valor que declarou.
             'activo_calculado',  vendas + investimento_pago,
             'saldo_manual',      saldo_manual,
             'meta',              saldo_manual,
             'origem',            CASE WHEN saldo_manual IS NULL THEN 'automatico' ELSE 'gestor' END,
             'activo_total',      COALESCE(saldo_manual, vendas + investimento_pago),
             'activo_liquido',    COALESCE(saldo_manual, vendas + investimento_pago)
                                    - (despesas_pagas + investimento_pago + ja_coberto + por_pagar),
             'progresso',         CASE
                                    WHEN saldo_manual IS NULL OR saldo_manual <= 0 THEN NULL
                                    ELSE round(
                                      100 * (saldo_manual
                                             - (despesas_pagas + investimento_pago + ja_coberto + por_pagar))
                                      / saldo_manual
                                    )
                                  END,
             'excedido',          (despesas_pagas + investimento_pago + ja_coberto + por_pagar)
                                    > COALESCE(saldo_manual, vendas + investimento_pago),
             'cobertura',         CASE
                                    WHEN (despesas_pagas + investimento_pago + ja_coberto + por_pagar) > 0
                                      THEN round(
                                        100 * COALESCE(saldo_manual, vendas + investimento_pago)
                                        / (despesas_pagas + investimento_pago + ja_coberto + por_pagar)
                                      )
                                    ELSE 100
                                  END
           ) AS linha
    FROM base
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
           'despesas_total',    COALESCE(SUM((l->>'despesas_total')::numeric), 0),
           'activo_calculado',  COALESCE(SUM((l->>'activo_calculado')::numeric), 0)
         )
  INTO v_total
  FROM jsonb_array_elements(v_linhas) l;

  IF v_total IS NULL THEN
    v_total := jsonb_build_object(
      'vendas', 0, 'vendas_count', 0,
      'despesas_pagas', 0, 'investimento_pago', 0,
      'por_pagar', 0, 'ja_coberto', 0, 'pendentes_count', 0,
      'stock_unidades', 0, 'stock_valor', 0,
      'despesas_total', 0, 'activo_calculado', 0
    );
  END IF;

  -- O saldo da empresa toda (provincia_id nulo) manda no total nacional: é o
  -- valor que a direcção declarou, não a soma das províncias.
  IF v_prov IS NULL THEN
    SELECT valor INTO v_saldo_nac
    FROM public.saldos_contabilisticos
    WHERE provincia_id IS NULL;
  END IF;

  v_total := v_total || jsonb_build_object(
    'saldo_manual', v_saldo_nac,
    'meta',         v_saldo_nac,
    'origem',       CASE WHEN v_saldo_nac IS NULL THEN 'automatico' ELSE 'gestor' END,
    'activo_total', COALESCE(v_saldo_nac, (v_total->>'activo_calculado')::numeric),
    'activo_liquido', COALESCE(v_saldo_nac, (v_total->>'activo_calculado')::numeric)
                      - (v_total->>'despesas_total')::numeric,
    'progresso',    CASE
                      WHEN v_saldo_nac IS NULL OR v_saldo_nac <= 0 THEN NULL
                      ELSE round(
                        100 * (v_saldo_nac - (v_total->>'despesas_total')::numeric)
                        / v_saldo_nac
                      )
                    END,
    'excedido',     (v_total->>'despesas_total')::numeric
                    > COALESCE(v_saldo_nac, (v_total->>'activo_calculado')::numeric),
    'cobertura',    CASE
                      WHEN (v_total->>'despesas_total')::numeric > 0
                        THEN round(
                          100 * COALESCE(v_saldo_nac, (v_total->>'activo_calculado')::numeric)
                          / (v_total->>'despesas_total')::numeric
                        )
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
  'Activo por província. Usa o saldo contabilístico definido pela gestão como activo total (meta); sem saldo, cai no cálculo automático (vendas + investimento). Devolve também o valor do stock e o activo calculado, para comparação.';

-- -----------------------------------------------------------------------------
-- 8. PERMISSÕES
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.definir_saldo_contabilistico(numeric, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.limpar_saldo_contabilistico(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.saldo_contabilistico(uuid)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_valor(uuid)                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.activo_provincia(uuid)                            TO authenticated;
