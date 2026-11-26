-- =============================================================================
-- 0022 — ACTIVO DA PROVÍNCIA
-- =============================================================================
-- O PROBLEMA
-- A gestão via quanto vendeu e quanto gastou, mas não via o que sobra. Uma
-- despesa registada ficava numa lista, sem responder à pergunta que a direcção
-- faz todos os meses: «esta província ainda tem activo, ou já gastou mais do
-- que aquilo que gerou?» Sem esse número, gastar a mais só se descobria tarde.
--
-- A SOLUÇÃO
-- Uma função só — `activo_provincia()` — que devolve, para cada província:
--
--   activo_total    = vendas (não canceladas) + investimento já pago
--   despesas_total  = despesas pagas + investimento pago
--                     + o que já saiu do saldo da equipa
--                     + o que ainda falta pagar
--                     (as anuladas não contam: não aconteceram)
--   activo_liquido  = activo_total − despesas_total
--   excedido        = despesas_total > activo_total
--
-- «Por pagar» é o que falta mesmo: uma despesa de 12 000 já coberta em 5 000
-- por comissões deve 7 000, e não 12 000.
--
-- Porque é que o investimento entra dos dois lados: comprar equipamento não é
-- perder dinheiro — é trocar dinheiro por um bem que fica. Somando-o ao activo
-- e à despesa, o efeito no activo líquido é zero, que é o correcto. Só a
-- despesa corrente e o que está por pagar é que fazem o activo descer.
--
-- `activo_liquido` fica, por isso, igual a `vendas − despesas pagas − por pagar`.
--
-- QUEM VÊ O QUÊ
-- A administração nacional vê o país inteiro (e o maior activo de todas as
-- províncias). Um gestor provincial vê apenas a sua — a função ignora qualquer
-- `p_provincia_id` vindo de quem não é nacional.
--
-- NÃO GUARDA NADA
-- Tudo é derivado das vendas e das despesas no momento da leitura. Um número
-- guardado ficava errado no dia em que uma despesa fosse anulada ou paga.
--
-- IDEMPOTENTE: pode voltar a correr.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.activo_provincia(p_provincia_id uuid DEFAULT NULL)
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
  v_max    jsonb;
  v_risco  int;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gerência pode consultar o activo' USING ERRCODE = '42501';
  END IF;

  -- A administração nacional escolhe a província (ou vê o país inteiro);
  -- um gestor provincial vê sempre a sua, mesmo que peça outra.
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
           -- O que falta mesmo: uma despesa de 12 000 já coberta em 5 000 por
           -- comissões só deve 7 000. Contar os 12 000 inflacionava o passivo.
           COALESCE(SUM(GREATEST(d.valor - public.despesa_coberto(d.id), 0))
                    FILTER (WHERE d.estado = 'pendente'), 0)::numeric AS por_pagar,
           -- A parte de uma despesa por pagar que já saiu do saldo da equipa.
           COALESCE(SUM(LEAST(public.despesa_coberto(d.id), d.valor))
                    FILTER (WHERE d.estado = 'pendente'), 0)::numeric AS ja_coberto,
           COUNT(*) FILTER (WHERE d.estado = 'pendente') AS pendentes
    FROM public.despesas d
    WHERE d.estado <> 'anulada'
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
           COALESCE(g.pendentes, 0)    AS pendentes_count
    FROM public.provincias pr
    LEFT JOIN vendas v ON v.pid = pr.id
    LEFT JOIN gastos g ON g.pid = pr.id
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
             'despesas_total',    despesas_pagas + investimento_pago + ja_coberto + por_pagar,
             'activo_total',      vendas + investimento_pago,
             -- O investimento soma e subtrai: fica só o que sobra das vendas
             -- depois de pagar o corrente e o que está por pagar.
             'activo_liquido',    vendas - despesas_pagas - ja_coberto - por_pagar,
             'excedido',          (despesas_pagas + investimento_pago + ja_coberto + por_pagar)
                                    > (vendas + investimento_pago),
             'cobertura',         CASE
                                    WHEN (despesas_pagas + investimento_pago + ja_coberto + por_pagar) > 0
                                      THEN round(
                                        100 * (vendas + investimento_pago)
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
           'despesas_total',    COALESCE(SUM((l->>'despesas_total')::numeric), 0),
           'activo_total',      COALESCE(SUM((l->>'activo_total')::numeric), 0),
           'activo_liquido',    COALESCE(SUM((l->>'activo_liquido')::numeric), 0)
         )
  INTO v_total
  FROM jsonb_array_elements(v_linhas) l;

  IF v_total IS NULL THEN
    v_total := jsonb_build_object(
      'vendas', 0, 'vendas_count', 0,
      'despesas_pagas', 0, 'investimento_pago', 0,
      'por_pagar', 0, 'ja_coberto', 0, 'pendentes_count', 0,
      'despesas_total', 0, 'activo_total', 0, 'activo_liquido', 0
    );
  END IF;

  v_total := v_total || jsonb_build_object(
    'excedido',  (v_total->>'despesas_total')::numeric > (v_total->>'activo_total')::numeric,
    'cobertura', CASE
                   WHEN (v_total->>'despesas_total')::numeric > 0
                     THEN round(
                       100 * (v_total->>'activo_total')::numeric
                       / (v_total->>'despesas_total')::numeric
                     )
                   ELSE 100
                 END
  );

  -- A província com o activo total mais alto. É o número que a direcção pede:
  -- «qual é o máximo do país?» — e não uma média que esconde a melhor praça.
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
  'Activo por província: vendas + investimento pago − (despesas pagas + por pagar). Devolve o total, o máximo do país e quantas províncias já gastaram mais do que geraram.';

GRANT EXECUTE ON FUNCTION public.activo_provincia(uuid) TO authenticated;
