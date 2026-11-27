-- =============================================================================
-- 0032 — PREÇO DE GROSSO POR REDUÇÃO ABSOLUTA E A TABELA DE LUCRO
-- =============================================================================
--  O QUE ESTAVA MAL
--    1. **O grosso era uma percentagem cega.** `preco_revendedor()` aplicava
--       35% (ou o desconto do revendedor) sobre o preço de montra, igual para
--       um perfume de 32.000 Kz e para um de 7.500 Kz. Numa tabela de grosso
--       isso é ao contrário do que se quer: 35% num artigo barato dava ao
--       revendedor mais de metade do preço, e 35% num artigo caro não lhe dava
--       margem suficiente para o trabalho de revenda.
--    2. **O revendedor não via o lucro.** O catálogo mostrava «preço de loja»
--       e «preço de grosso», e deixava a conta para o cliente. Quem compra em
--       quantidade decide com três números: quanto paga, quanto vende, quanto
--       sobra — por unidade e no pedido.
--
--  O QUE PASSA A ACONTECER
--    1. A redução é **absoluta**, escolhida entre as três alavancas que a
--       gestão definiu: 3.500, 4.000 e 5.000 Kz. `reducao_grosso()` escolhe a
--       que deixa o revendedor mais perto da margem-alvo (20% por omissão),
--       sem nunca passar o tecto (30% por omissão) — acima disso a INUKA
--       deixa de ganhar no grosso.
--    2. Regra fundamental: **preço de cliente − redução = preço de aquisição**.
--       Quando nenhuma das três cabe no tecto (artigos baratos), a redução
--       encolhe até ao tecto em vez de dar prejuízo.
--    3. A ordem de precedência continua a respeitar os acordos:
--         a. preço escrito pela gestão em `precos_revenda` (vence tudo);
--         b. desconto negociado do revendedor (é um acordo, não uma tabela);
--         c. tabela de reduções (o automático).
--    4. `revendedor_catalogo()` passa a devolver `reducao`, `lucro_unidade`,
--       `margem_pct` (lucro sobre o preço de compra) e `desconto_pct` (lucro
--       sobre o preço de loja). O ecrã do revendedor mostra a tabela de lucro.
--    5. `minha_revenda()` devolve as regras do grosso — reduções, margem-alvo
--       e tecto — para o ecrã não as inventar.
--
--  Idempotente. Pode correr mais do que uma vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. AS ALAVANCAS DO GROSSO
-- -----------------------------------------------------------------------------
-- Guardadas como lista (não como número): a gestão pode acrescentar uma
-- quarta alavanca sem tocar no código.
INSERT INTO public.platform_settings (key, value)
VALUES ('revenda_reducoes', '{"value": [3500, 4000, 5000]}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value)
VALUES ('revenda_margem_alvo', '{"value": 0.20}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.platform_settings (key, value)
VALUES ('revenda_margem_max', '{"value": 0.30}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reducoes_grosso()
RETURNS numeric[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT array_agg(t.x::numeric ORDER BY t.x::numeric)
     FROM public.platform_settings ps
     CROSS JOIN LATERAL jsonb_array_elements_text(ps.value -> 'value') AS t(x)
     WHERE ps.key = 'revenda_reducoes'
       AND jsonb_typeof(ps.value -> 'value') = 'array'),
    ARRAY[3500, 4000, 5000]::numeric[]
  );
$$;

-- -----------------------------------------------------------------------------
-- 2. A ESCOLHA DA REDUÇÃO
-- -----------------------------------------------------------------------------
-- Devolve a redução a aplicar a um preço de cliente. A conta é sempre a mesma
-- para cada preço — dois revendedores da mesma província vêem o mesmo preço
-- no mesmo produto.
--
--   · margem = redução ÷ (preço − redução) — o lucro do revendedor sobre
--     aquilo que ele paga;
--   · entre as reduções que cabem no tecto, ganha a mais próxima da alvo;
--   · empate → ganha a maior, que é a que interessa a quem revende;
--   · nenhuma cabe → a redução encolhe até ao tecto.
CREATE OR REPLACE FUNCTION public.reducao_grosso(p_preco_cliente numeric)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_alvo   numeric := COALESCE(public.config_revenda('revenda_margem_alvo', 0.20), 0.20);
  v_tecto  numeric := COALESCE(public.config_revenda('revenda_margem_max', 0.30), 0.30);
  v_tiers  numeric[] := public.reducoes_grosso();
  v_tier   numeric;
  v_margem numeric;
  v_melhor numeric := NULL;
  v_dist   numeric := NULL;
BEGIN
  IF p_preco_cliente IS NULL OR p_preco_cliente <= 0 THEN
    RETURN 0;
  END IF;

  -- Um valor mal escrito na configuração não pode dar produto de graça.
  IF v_tecto <= 0 OR v_tecto >= 1 THEN v_tecto := 0.30; END IF;
  IF v_alvo < 0 OR v_alvo >= 1 THEN v_alvo := 0.20; END IF;

  FOREACH v_tier IN ARRAY v_tiers LOOP
    CONTINUE WHEN v_tier IS NULL OR v_tier <= 0 OR v_tier >= p_preco_cliente;

    v_margem := v_tier / (p_preco_cliente - v_tier);

    -- Acima do tecto deixa de ser estratégia: é prejuízo para a INUKA.
    CONTINUE WHEN v_margem > v_tecto;

    IF v_melhor IS NULL
       OR abs(v_margem - v_alvo) < v_dist
       OR (abs(v_margem - v_alvo) = v_dist AND v_tier > v_melhor) THEN
      v_melhor := v_tier;
      v_dist   := abs(v_margem - v_alvo);
    END IF;
  END LOOP;

  IF v_melhor IS NULL THEN
    v_melhor := p_preco_cliente * v_tecto / (1 + v_tecto);
  END IF;

  -- Preço redondo ao cento de Kwanza: a tabela não mostra 11.154 Kz.
  -- Arredonda **para baixo** — para cima, um tecto de 30% podia sair a 30,1%
  -- (9.500 × 0,30 ÷ 1,30 = 2.192 → 2.200 dava 30,14% de margem).
  v_melhor := floor(v_melhor / 100) * 100;

  RETURN LEAST(GREATEST(v_melhor, 0), p_preco_cliente);
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. O PREÇO DE UMA UNIDADE PARA REVENDA
-- -----------------------------------------------------------------------------
-- Ordem de precedência (nunca do browser):
--   1. preço escrito pela gestão para o produto;
--   2. desconto negociado do revendedor (percentagem, é um acordo);
--   3. tabela de reduções sobre o preço normal de cliente final.
--
-- O preço de base é o **preço normal** do produto (`promotional_price` ou
-- `official_price`), não `preco_efetivo()`. Uma promoção de província é uma
-- campanha para o cliente final, com prazo; se ela também baixasse o preço de
-- grosso, a INUKA perdia duas vezes no mesmo artigo — no desconto da campanha
-- e na redução do revendedor. O revendedor compra ao preço de tabela, e a
-- campanha é dele para aproveitar na venda.
CREATE OR REPLACE FUNCTION public.preco_revendedor(
  p_produto    uuid,
  p_revendedor uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_escrito  numeric;
  v_desconto numeric;
  v_cliente  numeric;
BEGIN
  SELECT pr.preco INTO v_escrito
  FROM public.precos_revenda pr
  WHERE pr.product_id = p_produto;

  IF v_escrito IS NOT NULL THEN
    RETURN v_escrito;
  END IF;

  IF p_revendedor IS NOT NULL THEN
    SELECT r.desconto INTO v_desconto
    FROM public.revendedores r
    WHERE r.id = p_revendedor;
  END IF;

  SELECT COALESCE(p.promotional_price, p.official_price)::numeric
  INTO v_cliente
  FROM public.products p
  WHERE p.id = p_produto;

  IF v_cliente IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_desconto IS NOT NULL THEN
    -- Um erro de digitação (3,5 em vez de 0,35) não pode dar produto de graça.
    RETURN round(v_cliente * (1 - LEAST(0.9, GREATEST(0, v_desconto))), 2);
  END IF;

  RETURN GREATEST(0, v_cliente - public.reducao_grosso(v_cliente));
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. O CATÁLOGO DO REVENDEDOR, COM A CONTA FEITA
-- -----------------------------------------------------------------------------
-- `RETURNS TABLE` obriga a recriar: `CREATE OR REPLACE` não muda a lista de
-- colunas de saída. O `DROP` leva o `GRANT` atrás, e o `GRANT` volta no fim.
--
--   lucro_unidade = preço de cliente − preço de grosso
--   margem_pct    = lucro ÷ preço de grosso   (o que se ganha por cada Kz pago)
--   desconto_pct  = lucro ÷ preço de cliente  (o que se poupou na montra)
DROP FUNCTION IF EXISTS public.revendedor_catalogo(uuid);

CREATE OR REPLACE FUNCTION public.revendedor_catalogo(p_provincia uuid DEFAULT NULL)
RETURNS TABLE (
  product_id     uuid,
  nome           text,
  sku            text,
  categoria      text,
  imagem         text,
  preco_loja     numeric,
  preco_grosso   numeric,
  reducao        numeric,
  lucro_unidade  numeric,
  margem_pct     numeric,
  desconto_pct   numeric,
  minimo         int,
  stock          int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_rev     uuid := public.meu_revendedor();
  v_prov    uuid := p_provincia;
  v_minimo  int;
BEGIN
  IF NOT (public.is_reseller() OR public.is_manager()) THEN
    RAISE EXCEPTION 'Catálogo de grosso reservado a revendedores.'
      USING ERRCODE = '42501';
  END IF;

  IF v_prov IS NULL THEN
    SELECT COALESCE(r.provincia_id, public.my_province()) INTO v_prov
    FROM public.revendedores r WHERE r.id = v_rev;
    v_prov := COALESCE(v_prov, p_provincia);
  END IF;

  SELECT COALESCE(r.minimo_unidades,
                  public.config_revenda('revenda_minimo', 5)::int)
  INTO v_minimo
  FROM (SELECT 1) x
  LEFT JOIN public.revendedores r ON r.id = v_rev;

  RETURN QUERY
  SELECT p.id,
         p.name,
         p.sku,
         c.name,
         (SELECT pi.url FROM public.product_images pi
          WHERE pi.product_id = p.id AND pi.url IS NOT NULL
          ORDER BY pi.is_primary DESC, pi.sort_order LIMIT 1),
         b.loja,
         b.grosso,
         b.loja - b.grosso,
         b.loja - b.grosso,
         round(100 * (b.loja - b.grosso) / NULLIF(b.grosso, 0), 1),
         round(100 * (b.loja - b.grosso) / NULLIF(b.loja, 0), 1),
         v_minimo,
         (SELECT CASE WHEN count(*) = 0 THEN NULL
                      ELSE GREATEST(0, sum(i.quantity - i.reserved_quantity))::int
                 END
          FROM public.inventory i
          WHERE i.product_id = p.id
            AND (v_prov IS NULL OR i.provincia_id = v_prov))
  FROM public.products p
  JOIN public.precos_revenda pr ON pr.product_id = p.id
  LEFT JOIN public.categories c ON c.id = p.category_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(p.promotional_price, p.official_price)::numeric AS loja,
           public.preco_revendedor(p.id, v_rev)::numeric            AS grosso
  ) b
  WHERE p.is_active
  ORDER BY c.name NULLS LAST, p.name;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. O CADASTRO DA GESTÃO USA A MESMA CONTA
-- -----------------------------------------------------------------------------
-- Se o cadastro tivesse a sua própria fórmula, o preço que a gestão vê aqui
-- não era o preço que o revendedor paga. É a mesma função, o mesmo número.
CREATE OR REPLACE FUNCTION public.catalogo_revenda_gestao()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão vê o catálogo de grosso' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'minimo_produtos', public.config_revenda('revenda_minimo_produtos', 4)::int,
    'desconto',        public.config_revenda('revenda_desconto', 0.35),
    'reducoes',        to_jsonb(public.reducoes_grosso()),
    'margem_alvo',     public.config_revenda('revenda_margem_alvo', 0.20),
    'margem_max',      public.config_revenda('revenda_margem_max', 0.30),
    'totais', jsonb_build_object(
      'produtos',    count(*),
      'no_catalogo', count(*) FILTER (WHERE pr.product_id IS NOT NULL),
      'com_preco',   count(*) FILTER (WHERE pr.preco IS NOT NULL)
    ),
    'produtos', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id',   p.id,
          'nome',         p.name,
          'sku',          p.sku,
          'categoria',    c.name,
          'imagem',       (SELECT pi.url FROM public.product_images pi
                           WHERE pi.product_id = p.id AND pi.url IS NOT NULL
                           ORDER BY pi.is_primary DESC, pi.sort_order LIMIT 1),
          'preco_loja',   b.loja,
          'no_catalogo',  pr.product_id IS NOT NULL,
          'preco_proprio', pr.preco,
          'reducao',      b.loja - coalesce(pr.preco, b.loja - public.reducao_grosso(b.loja)),
          'preco_grosso', coalesce(pr.preco, b.loja - public.reducao_grosso(b.loja)),
          'margem_pct',   round(
                            100 * (b.loja - coalesce(pr.preco, b.loja - public.reducao_grosso(b.loja)))
                            / NULLIF(coalesce(pr.preco, b.loja - public.reducao_grosso(b.loja)), 0),
                            1
                          ),
          'nota',         pr.nota,
          'stock',        (SELECT CASE WHEN count(*) = 0 THEN NULL
                                       ELSE GREATEST(0, sum(i.quantity - i.reserved_quantity))::int
                                  END
                           FROM public.inventory i
                           WHERE i.product_id = p.id)
        )
        ORDER BY (pr.product_id IS NULL), c.name NULLS LAST, p.name
      ),
      '[]'::jsonb
    )
  )
  INTO v_out
  FROM public.products p
  LEFT JOIN public.categories c ON c.id = p.category_id
  LEFT JOIN public.precos_revenda pr ON pr.product_id = p.id
  CROSS JOIN LATERAL (
    SELECT COALESCE(p.promotional_price, p.official_price)::numeric AS loja
  ) b
  WHERE p.is_active;

  RETURN v_out;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. AS REGRAS DO GROSSO CHEGAM AO ECRÃ DO REVENDEDOR
-- -----------------------------------------------------------------------------
-- `desconto` deixa de ter um valor inventado: quando é `NULL`, o revendedor
-- não tem acordo próprio e o preço vem da tabela de reduções. O ecrã mostra
-- «tabela de reduções» em vez de «35%», que já não é verdade.
CREATE OR REPLACE FUNCTION public.minha_revenda()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_rev      public.revendedores;
  v_prov     text;
  v_gestor   uuid;
  v_gestor_n text;
  v_nac      uuid;
  v_nac_n    text;
BEGIN
  SELECT * INTO v_rev FROM public.revendedores r WHERE r.user_id = auth.uid();
  IF v_rev.id IS NULL THEN
    RETURN jsonb_build_object('revendedor', NULL);
  END IF;

  SELECT pr.nome INTO v_prov
  FROM public.provincias pr WHERE pr.id = v_rev.provincia_id;

  -- Gerente da província (o que acompanha este revendedor, se existir). A
  -- administração nacional fica de fora desta escolha mesmo quando está
  -- sediada na província: quem responde ao revendedor é o gerente local.
  SELECT p.id, p.full_name INTO v_gestor, v_gestor_n
  FROM public.profiles p
  WHERE p.role = 'manager'::public.user_role
    AND p.is_active
    AND (
      p.id = v_rev.manager_id
      OR (v_rev.manager_id IS NULL
          AND p.provincia_id = v_rev.provincia_id
          AND NOT p.is_national_admin)
    )
  ORDER BY (p.id = v_rev.manager_id) DESC, p.created_at
  LIMIT 1;

  -- Província sem gerente próprio: aceita-se qualquer gestor da província,
  -- para o revendedor não ficar sem ninguém com quem falar.
  IF v_gestor IS NULL THEN
    SELECT p.id, p.full_name INTO v_gestor, v_gestor_n
    FROM public.profiles p
    WHERE p.role = 'manager'::public.user_role
      AND p.is_active
      AND p.provincia_id = v_rev.provincia_id
    ORDER BY p.created_at
    LIMIT 1;
  END IF;

  -- Administração nacional: sem província ou marcada como nacional.
  SELECT p.id, p.full_name INTO v_nac, v_nac_n
  FROM public.profiles p
  WHERE p.role = 'manager'::public.user_role
    AND p.is_active
    AND (p.is_national_admin OR p.provincia_id IS NULL)
    AND p.id <> COALESCE(v_gestor, '00000000-0000-0000-0000-000000000000'::uuid)
  ORDER BY p.created_at
  LIMIT 1;

  RETURN jsonb_build_object(
    'revendedor', jsonb_build_object(
      'id', v_rev.id,
      'tipo', v_rev.tipo,
      'nome', v_rev.nome,
      'nif', v_rev.nif,
      'telefone', v_rev.telefone,
      'email', v_rev.email,
      'provincia_id', v_rev.provincia_id,
      'provincia', v_prov,
      'loja_id', v_rev.loja_id,
      'desconto', v_rev.desconto,
      'minimo_unidades', v_rev.minimo_unidades,
      'status', v_rev.status,
      'nota', v_rev.nota
    ),
    'regras', jsonb_build_object(
      'minimo_unidades', v_rev.minimo_unidades,
      'minimo_produtos', public.config_revenda('revenda_minimo_produtos', 4)::int,
      'reducoes', to_jsonb(public.reducoes_grosso()),
      'margem_alvo', public.config_revenda('revenda_margem_alvo', 0.20),
      'margem_max', public.config_revenda('revenda_margem_max', 0.30)
    ),
    'stats', jsonb_build_object(
      'pedidos', (SELECT count(*) FROM public.revendedor_pedidos p
                  WHERE p.revendedor_id = v_rev.id),
      'em_curso', (SELECT count(*) FROM public.revendedor_pedidos p
                   WHERE p.revendedor_id = v_rev.id
                     AND p.status IN ('novo','em_analise','cotado','aprovado')),
      'entregues', (SELECT count(*) FROM public.revendedor_pedidos p
                    WHERE p.revendedor_id = v_rev.id AND p.status = 'entregue'),
      'valor_total', (SELECT COALESCE(sum(p.valor_estimado), 0)
                      FROM public.revendedor_pedidos p
                      WHERE p.revendedor_id = v_rev.id AND p.status <> 'cancelado'),
      'valor_em_curso', (SELECT COALESCE(sum(p.valor_estimado), 0)
                         FROM public.revendedor_pedidos p
                         WHERE p.revendedor_id = v_rev.id
                           AND p.status IN ('novo','em_analise','cotado','aprovado'))
    ),
    'gestores', jsonb_build_object(
      'provincia', CASE WHEN v_gestor IS NULL THEN NULL
                        ELSE jsonb_build_object('id', v_gestor, 'nome', v_gestor_n) END,
      'nacional',  CASE WHEN v_nac IS NULL THEN NULL
                        ELSE jsonb_build_object('id', v_nac, 'nome', v_nac_n) END
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. PERMISSÕES
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.reducoes_grosso()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.reducao_grosso(numeric)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.preco_revendedor(uuid, uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.revendedor_catalogo(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_revenda_gestao()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.minha_revenda()                  TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. VERIFICAÇÃO
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_alvo numeric;
  v_reducoes numeric[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reducao_grosso'
  ) THEN
    RAISE EXCEPTION '0032: reducao_grosso() não foi criada.';
  END IF;

  v_reducoes := public.reducoes_grosso();
  IF v_reducoes IS NULL OR array_length(v_reducoes, 1) <> 3 THEN
    RAISE EXCEPTION '0032: a tabela de reduções não tem três alavancas (tem %).',
      COALESCE(array_length(v_reducoes, 1), 0);
  END IF;

  -- A conta que o negócio pediu, conferida na criação da migração: 30.000 Kz
  -- com a redução escolhida tem de dar uma margem dentro do tecto.
  v_alvo := public.reducao_grosso(30000);
  IF v_alvo <= 0 OR v_alvo > 30000 * 0.35 THEN
    RAISE EXCEPTION '0032: redução de 30.000 Kz fora do razoável (%).', v_alvo;
  END IF;
END;
$$;
