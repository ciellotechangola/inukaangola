-- =============================================================================
--  INUKA ANGOLA — PATCH: REDE DE VENDEDORES E FICHA DO REVENDEDOR
-- =============================================================================
--  Supabase -> SQL Editor -> New query -> colar tudo -> RUN
--  Idempotente. Pode ser executado mais do que uma vez sem perder dados.
--  Equivale à migração 0029_rede_revendedores.sql (mesmo conteúdo).
--  Requer a 0026 (revendedores) e a 0027 (candidaturas) já aplicadas.
--
--  O QUE RESOLVE
--    · `rede_revendedores()` — todos os revendedores cadastrados com os
--      números do mês corrente, tabela por província e ranking. Nacional vê
--      o país; gestor provincial vê a sua província.
--    · `revendedor_ficha(id)` — identidade, condições de grosso, números
--      totais e do mês, histórico de 6 meses, pedidos com itens e a
--      candidatura de origem. O próprio revendedor também a pode abrir.
--    · `actualizar_revendedor` passa a permitir apagar a nota da ficha.
--
--  Sem este patch, /gerente/rede e /revenda/perfil ficam vazios.
-- =============================================================================

-- =============================================================================
-- 0029 — REDE DE VENDEDORES (REVENDEDORES): VISÃO DA GESTÃO E FICHA
-- =============================================================================
-- A gestão precisava de ver os revendedores como vê os colaboradores: uma
-- rede, por província, com os números do mês corrente — e não apenas uma
-- lista de candidaturas pendentes.
--
-- O que entra:
--   1. `rede_revendedores(from, to)` — totais, tabela por província, todos os
--      revendedores com os números do período e ranking.
--   2. `revendedor_ficha(id)` — a ficha completa de um revendedor: identidade,
--      condições comerciais, números totais e do mês, histórico de 6 meses,
--      pedidos com itens e a candidatura que lhe deu origem.
--
-- Âmbito: a administração nacional vê todo o país; o gestor provincial vê a
-- sua província. O revendedor vê a sua própria ficha (é a mesma função que
-- alimenta o perfil dele em /revenda/perfil).
--
-- Só leitura. Nada aqui escreve nem apaga.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A REDE
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rede_revendedores(
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
  -- Nacional vê tudo (`NULL`); provincial fica preso à sua província.
  v_prov uuid := CASE WHEN public.is_national() THEN NULL ELSE public.my_province() END;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode ver a rede de vendedores'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'period_from',  v_from,
    'period_to',    v_to,
    'scope',        CASE WHEN v_prov IS NULL THEN 'nacional' ELSE 'provincial' END,
    'provincia_id', v_prov,

    'totais', jsonb_build_object(
      'revendedores', (
        SELECT count(*) FROM public.revendedores r
        WHERE v_prov IS NULL OR r.provincia_id = v_prov),
      'activos', (
        SELECT count(*) FROM public.revendedores r
        WHERE r.status = 'activo' AND (v_prov IS NULL OR r.provincia_id = v_prov)),
      'suspensos', (
        SELECT count(*) FROM public.revendedores r
        WHERE r.status = 'suspenso' AND (v_prov IS NULL OR r.provincia_id = v_prov)),
      'pedidos', (
        SELECT count(*) FROM public.revendedor_pedidos p
        WHERE p.status <> 'cancelado' AND p.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR p.provincia_id = v_prov)),
      'unidades', (
        SELECT COALESCE(sum(p.total_unidades), 0) FROM public.revendedor_pedidos p
        WHERE p.status <> 'cancelado' AND p.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR p.provincia_id = v_prov)),
      'valor', (
        SELECT COALESCE(sum(p.valor_estimado), 0) FROM public.revendedor_pedidos p
        WHERE p.status <> 'cancelado' AND p.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR p.provincia_id = v_prov)),
      'em_curso', (
        SELECT count(*) FROM public.revendedor_pedidos p
        WHERE p.status IN ('novo', 'em_analise', 'cotado', 'aprovado')
          AND (v_prov IS NULL OR p.provincia_id = v_prov)),
      'valor_em_curso', (
        SELECT COALESCE(sum(p.valor_estimado), 0) FROM public.revendedor_pedidos p
        WHERE p.status IN ('novo', 'em_analise', 'cotado', 'aprovado')
          AND (v_prov IS NULL OR p.provincia_id = v_prov)),
      'entregues', (
        SELECT count(*) FROM public.revendedor_pedidos p
        WHERE p.status = 'entregue' AND p.created_at BETWEEN v_from AND v_to
          AND (v_prov IS NULL OR p.provincia_id = v_prov)),
      'candidaturas', (
        SELECT count(*) FROM public.revendedor_candidaturas c
        WHERE c.status = 'novo' AND (v_prov IS NULL OR c.provincia_id = v_prov)),
      'ultimo_pedido', (
        SELECT max(p.created_at) FROM public.revendedor_pedidos p
        WHERE v_prov IS NULL OR p.provincia_id = v_prov)
    ),

    'provincias', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.valor DESC, t.nome), '[]'::jsonb)
      FROM (
        SELECT pr.id, pr.nome, pr.codigo,
          (SELECT count(*) FROM public.revendedores r
           WHERE r.provincia_id = pr.id) AS revendedores,
          (SELECT count(*) FROM public.revendedores r
           WHERE r.provincia_id = pr.id AND r.status = 'activo') AS activos,
          (SELECT count(*) FROM public.revendedor_pedidos p
           WHERE p.provincia_id = pr.id AND p.status <> 'cancelado'
             AND p.created_at BETWEEN v_from AND v_to) AS pedidos,
          COALESCE((SELECT sum(p.valor_estimado) FROM public.revendedor_pedidos p
           WHERE p.provincia_id = pr.id AND p.status <> 'cancelado'
             AND p.created_at BETWEEN v_from AND v_to), 0) AS valor
        FROM public.provincias pr
        WHERE pr.is_active AND (v_prov IS NULL OR pr.id = v_prov)
      ) t
    ),

    -- Todos os revendedores cadastrados, com os números do período. Quem não
    -- comprou este mês aparece a zeros — e isso também é informação.
    'revendedores', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.valor DESC, t.nome), '[]'::jsonb)
      FROM (
        SELECT r.id, r.nome, r.tipo, r.telefone, r.email, r.nif, r.status,
               r.desconto, r.minimo_unidades, r.created_at AS desde,
               pr.nome AS provincia, pr.codigo AS provincia_codigo,
               l.codigo AS loja_codigo, l.nome AS loja_nome,
               COALESCE(m.pedidos, 0)  AS pedidos,
               COALESCE(m.unidades, 0) AS unidades,
               COALESCE(m.valor, 0)    AS valor,
               COALESCE(a.em_curso, 0) AS em_curso,
               a.ultimo_pedido
        FROM public.revendedores r
        LEFT JOIN public.provincias pr ON pr.id = r.provincia_id
        LEFT JOIN public.lojas l       ON l.id  = r.loja_id
        LEFT JOIN LATERAL (
          SELECT count(*) AS pedidos,
                 COALESCE(sum(p.total_unidades), 0) AS unidades,
                 COALESCE(sum(p.valor_estimado), 0) AS valor
          FROM public.revendedor_pedidos p
          WHERE p.revendedor_id = r.id AND p.status <> 'cancelado'
            AND p.created_at BETWEEN v_from AND v_to
        ) m ON true
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (
                   WHERE p.status IN ('novo', 'em_analise', 'cotado', 'aprovado')
                 ) AS em_curso,
                 max(p.created_at) AS ultimo_pedido
          FROM public.revendedor_pedidos p
          WHERE p.revendedor_id = r.id
        ) a ON true
        WHERE v_prov IS NULL OR r.provincia_id = v_prov
      ) t
    ),

    'ranking', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.valor DESC, t.nome), '[]'::jsonb)
      FROM (
        SELECT r.id, r.nome, pr.nome AS provincia,
               COALESCE(sum(p.valor_estimado), 0) AS valor,
               count(p.id) AS pedidos
        FROM public.revendedores r
        JOIN public.revendedor_pedidos p
          ON p.revendedor_id = r.id AND p.status <> 'cancelado'
         AND p.created_at BETWEEN v_from AND v_to
        LEFT JOIN public.provincias pr ON pr.id = r.provincia_id
        WHERE v_prov IS NULL OR r.provincia_id = v_prov
        GROUP BY r.id, r.nome, pr.nome
        ORDER BY 4 DESC, 5 DESC
        LIMIT 10
      ) t
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. A FICHA DE UM REVENDEDOR
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revendedor_ficha(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_rev public.revendedores;
BEGIN
  SELECT * INTO v_rev FROM public.revendedores WHERE id = p_id;
  IF v_rev.id IS NULL THEN
    RAISE EXCEPTION 'Revendedor não encontrado';
  END IF;

  -- A gestão vê as fichas daquilo que pode ver; o próprio vê a sua.
  IF NOT (
    (public.is_manager() AND public.can_see_province(v_rev.provincia_id))
    OR v_rev.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Sem acesso a esta ficha' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'revendedor', (
      SELECT jsonb_build_object(
        'id', r.id, 'user_id', r.user_id, 'tipo', r.tipo, 'nome', r.nome,
        'nif', r.nif, 'telefone', r.telefone, 'email', r.email,
        'status', r.status, 'desconto', r.desconto,
        'minimo_unidades', r.minimo_unidades, 'nota', r.nota,
        'desde', r.created_at,
        'provincia_id', r.provincia_id, 'provincia', pr.nome,
        'provincia_codigo', pr.codigo,
        'loja_id', r.loja_id, 'loja', l.nome, 'loja_codigo', l.codigo,
        'manager_id', r.manager_id, 'gestor', g.full_name,
        'conta_activa', pf.is_active
      )
      FROM public.revendedores r
      LEFT JOIN public.provincias pr ON pr.id = r.provincia_id
      LEFT JOIN public.lojas l       ON l.id  = r.loja_id
      LEFT JOIN public.profiles g    ON g.id  = r.manager_id
      LEFT JOIN public.profiles pf   ON pf.id = r.user_id
      WHERE r.id = p_id
    ),

    'stats', (
      SELECT jsonb_build_object(
        'pedidos',        count(*) FILTER (WHERE p.status <> 'cancelado'),
        'unidades',       COALESCE(sum(p.total_unidades) FILTER (WHERE p.status <> 'cancelado'), 0),
        'valor',          COALESCE(sum(p.valor_estimado) FILTER (WHERE p.status <> 'cancelado'), 0),
        'entregues',      count(*) FILTER (WHERE p.status = 'entregue'),
        'cancelados',     count(*) FILTER (WHERE p.status = 'cancelado'),
        'em_curso',       count(*) FILTER (WHERE p.status IN ('novo', 'em_analise', 'cotado', 'aprovado')),
        'valor_em_curso', COALESCE(sum(p.valor_estimado) FILTER (
                            WHERE p.status IN ('novo', 'em_analise', 'cotado', 'aprovado')), 0),
        'ticket_medio',   COALESCE(round(avg(p.valor_estimado) FILTER (
                            WHERE p.status <> 'cancelado'), 2), 0),
        'primeiro_pedido', min(p.created_at),
        'ultimo_pedido',   max(p.created_at)
      )
      FROM public.revendedor_pedidos p
      WHERE p.revendedor_id = p_id
    ),

    'mes', (
      SELECT jsonb_build_object(
        'pedidos',  count(*) FILTER (WHERE p.status <> 'cancelado'),
        'unidades', COALESCE(sum(p.total_unidades) FILTER (WHERE p.status <> 'cancelado'), 0),
        'valor',    COALESCE(sum(p.valor_estimado) FILTER (WHERE p.status <> 'cancelado'), 0)
      )
      FROM public.revendedor_pedidos p
      WHERE p.revendedor_id = p_id
        AND p.created_at >= date_trunc('month', now())
        AND p.created_at <  date_trunc('month', now()) + interval '1 month'
    ),

    -- Seis meses, do mais antigo ao corrente: dá para ver se está a crescer.
    'historico', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'mes',      to_char(m.mes, 'YYYY-MM'),
               'pedidos',  COALESCE(x.pedidos, 0),
               'unidades', COALESCE(x.unidades, 0),
               'valor',    COALESCE(x.valor, 0)
             ) ORDER BY m.mes), '[]'::jsonb)
      FROM generate_series(
             date_trunc('month', now()) - interval '5 months',
             date_trunc('month', now()),
             interval '1 month') AS m(mes)
      LEFT JOIN LATERAL (
        SELECT count(*) AS pedidos,
               COALESCE(sum(p.total_unidades), 0) AS unidades,
               COALESCE(sum(p.valor_estimado), 0) AS valor
        FROM public.revendedor_pedidos p
        WHERE p.revendedor_id = p_id AND p.status <> 'cancelado'
          AND p.created_at >= m.mes
          AND p.created_at <  m.mes + interval '1 month'
      ) x ON true
    ),

    'pedidos', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', p.id, 'numero', p.numero, 'status', p.status,
               'unidades', p.total_unidades, 'valor', p.valor_estimado,
               'mensagem', p.mensagem, 'resposta', p.resposta,
               'created_at', p.created_at,
               'itens', (
                 SELECT COALESCE(jsonb_agg(jsonb_build_object(
                          'nome', i.nome_produto, 'sku', i.sku,
                          'quantidade', i.quantidade,
                          'preco', i.preco_unitario,
                          'subtotal', i.subtotal) ORDER BY i.nome_produto), '[]'::jsonb)
                 FROM public.revendedor_pedido_itens i
                 WHERE i.pedido_id = p.id
               )
             ) ORDER BY p.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT * FROM public.revendedor_pedidos
        WHERE revendedor_id = p_id
        ORDER BY created_at DESC
        LIMIT 40
      ) p
    ),

    'candidatura', (
      SELECT jsonb_build_object(
        'id', c.id, 'tipo', c.tipo, 'nome', c.nome, 'telefone', c.telefone,
        'email', c.email, 'nif', c.nif, 'area_atuacao', c.area_atuacao,
        'representante', c.representante, 'mensagem', c.mensagem,
        'status', c.status, 'resposta', c.resposta, 'created_at', c.created_at
      )
      FROM public.revendedor_candidaturas c
      WHERE c.revendedor_id = p_id
      ORDER BY c.created_at DESC
      LIMIT 1
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. A NOTA DA FICHA PASSA A PODER SER APAGADA
-- -----------------------------------------------------------------------------
-- `actualizar_revendedor` tratava a nota com `COALESCE(NULLIF(…), nota)`: dava
-- para escrever e substituir, nunca para apagar. Numa ficha profissional isso
-- é um defeito — quem apaga uma nota errada fica com ela para sempre.
--
-- A assinatura antiga é removida e recriada com a bandeira `p_limpar_nota` no
-- fim, para não ficarem duas funções iguais com aridades diferentes.
DROP FUNCTION IF EXISTS public.actualizar_revendedor(uuid, numeric, int, text, text, boolean);

CREATE OR REPLACE FUNCTION public.actualizar_revendedor(
  p_id              uuid,
  p_desconto        numeric DEFAULT NULL,
  p_minimo          int     DEFAULT NULL,
  p_status          text    DEFAULT NULL,
  p_nota            text    DEFAULT NULL,
  p_limpar_desconto boolean DEFAULT false,
  p_limpar_nota     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_rev public.revendedores;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão altera fichas de revendedor' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rev FROM public.revendedores WHERE id = p_id;
  IF v_rev.id IS NULL THEN
    RAISE EXCEPTION 'Revendedor não encontrado';
  END IF;

  IF NOT public.can_manage_province(v_rev.provincia_id) THEN
    RAISE EXCEPTION 'Este revendedor não é da província que gere.'
      USING ERRCODE = '42501';
  END IF;

  IF p_status IS NOT NULL
     AND p_status NOT IN ('activo', 'suspenso', 'encerrado') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status;
  END IF;

  UPDATE public.revendedores
  SET desconto = CASE
        WHEN p_limpar_desconto THEN NULL
        WHEN p_desconto IS NULL THEN desconto
        ELSE LEAST(0.9, GREATEST(0, p_desconto))
      END,
      minimo_unidades = COALESCE(p_minimo, minimo_unidades),
      status = COALESCE(p_status, status),
      nota = CASE
               WHEN p_limpar_nota THEN NULL
               ELSE COALESCE(NULLIF(btrim(COALESCE(p_nota, '')), ''), nota)
             END,
      updated_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. PERMISSÕES
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.rede_revendedores(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revendedor_ficha(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_revendedor(uuid, numeric, int, text, text, boolean, boolean) TO authenticated;
