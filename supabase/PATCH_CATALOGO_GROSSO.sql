-- =============================================================================
--  INUKA ANGOLA — PATCH: CATÁLOGO DE GROSSO PRÓPRIO
-- =============================================================================
--  Supabase -> SQL Editor -> New query -> colar tudo -> RUN
--  Idempotente. Pode ser executado mais do que uma vez sem perder dados.
--  Equivale à migração 0031_catalogo_grosso_proprio.sql (mesmo conteúdo).
--  Requer a 0026 (revendedores) já aplicada.
--
--  O QUE RESOLVE
--    · O catálogo de grosso deixa de ser o catálogo da loja. Em
--      `precos_revenda`, a linha passa a significar «está no grosso» e o preço
--      pode ser NULL (= desconto automático).
--    · `revendedor_catalogo()` só devolve o que a gestão inscreveu.
--    · A gestão ganha o cadastro: `catalogo_revenda_gestao()`,
--      `adicionar_produto_catalogo()`, `remover_produto_catalogo()` e
--      `adicionar_todos_catalogo()`.
--    · «Repor» deixa de apagar a linha — limpa o preço e mantém o produto.
--    · O pedido de grosso passa a exigir 4 produtos diferentes (chave
--      `revenda_minimo_produtos`), além do mínimo de unidades por linha.
--
--  Os produtos activos que existem hoje são inscritos automaticamente no
--  primeiro arranque — ninguém perde acesso. A partir daí manda a gestão, e
--  voltar a correr este patch não repõe o que foi retirado.
-- =============================================================================


-- =============================================================================
-- 0031 — CATÁLOGO DE GROSSO PRÓPRIO E MÍNIMO DE PRODUTOS POR PEDIDO
-- =============================================================================
--  O QUE ESTAVA MAL
--    1. **O catálogo de grosso era o catálogo da loja.** `revendedor_catalogo()`
--       devolvia todos os produtos activos, com o preço de grosso calculado por
--       cima. Não havia forma de a gestão decidir o que é que um revendedor
--       pode comprar: se um produto estava à venda na loja, estava à venda no
--       grosso. São duas decisões diferentes — um perfume de vitrina não é
--       mercadoria de caixa.
--    2. **A tabela `precos_revenda` era só de preços.** Uma linha existia
--       apenas quando a gestão escrevia um preço à mão, e «Repor» apagava a
--       linha. Não servia para dizer «este produto está no grosso»: apagar o
--       preço tinha de deixar o produto onde estava.
--    3. **O pedido mínimo era só por linha.** Cinco unidades de um produto já
--       faziam um pedido. Um pedido de grosso com uma linha só não é um
--       pedido de grosso — é uma compra ao balcão com desconto.
--
--  O QUE PASSA A ACONTECER
--    1. Em `precos_revenda`, **a linha passa a significar «está no catálogo de
--       grosso»** e `preco` passa a poder ser `NULL` (= «desconto da empresa»,
--       o produto continua listado). `limpar_preco_revenda` deixa de apagar a
--       linha: limpa o preço e mantém o produto.
--    2. `revendedor_catalogo()` passa a fazer `INNER JOIN precos_revenda`: o
--       revendedor só vê o que a gestão inscreveu.
--    3. A gestão ganha três funções para o cadastro do catálogo —
--       `catalogo_revenda_gestao()` (lista tudo, com o estado de cada produto),
--       `adicionar_produto_catalogo()`, `remover_produto_catalogo()` e
--       `adicionar_todos_catalogo()` (inscrever o catálogo inteiro de uma vez).
--    4. `registar_pedido_revendedor()` passa a exigir um **mínimo de produtos
--       diferentes** por pedido (chave `revenda_minimo_produtos`, 4 por
--       omissão), além do mínimo de unidades por linha, e recusa produtos que
--       não estejam no catálogo. A regra vive na base porque o browser não
--       decide regras de negócio.
--    5. `minha_revenda()` devolve `regras` — o ecrã do revendedor mostra o
--       mínimo sem o perguntar a ninguém.
--
--  MIGRAÇÃO DE DADOS
--    No primeiro arranque, todos os produtos activos são inscritos no catálogo
--    com preço automático. É exactamente o que o revendedor já via, por isso
--    ninguém perde acesso a nada. A partir daí manda a gestão, e voltar a
--    correr este patch **não** repõe o que foi retirado (a semente é marcada
--    por `revenda_catalogo_semeado`).
--
--  Idempotente. Pode correr mais do que uma vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A LINHA PASSA A SIGNIFICAR «ESTÁ NO CATÁLOGO»
-- -----------------------------------------------------------------------------
-- `preco` deixa de ser obrigatório. `NULL` não é zero: é «aplica o desconto da
-- empresa». O CHECK `preco >= 0` continua a valer quando há número (um CHECK
-- com NULL passa, que é o que queremos).
ALTER TABLE public.precos_revenda ALTER COLUMN preco DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. SEMENTE (UMA VEZ SÓ)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_settings WHERE key = 'revenda_catalogo_semeado'
  ) THEN
    INSERT INTO public.precos_revenda (product_id, preco)
    SELECT p.id, NULL
    FROM public.products p
    WHERE p.is_active
    ON CONFLICT (product_id) DO NOTHING;

    INSERT INTO public.platform_settings (key, value)
    VALUES ('revenda_catalogo_semeado', '{"value": 1}'::jsonb);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. OS NÚMEROS QUE MANDAM NO GROSSO
-- -----------------------------------------------------------------------------
INSERT INTO public.platform_settings (key, value)
VALUES ('revenda_minimo_produtos', '{"value": 4}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. «REPOR» DEIXA DE RETIRAR O PRODUTO DO CATÁLOGO
-- -----------------------------------------------------------------------------
-- Antes apagava a linha. Com o novo significado, apagar a linha era tirar o
-- produto do grosso — e o botão diz «voltar ao desconto da empresa», não
-- «retirar». Agora limpa o preço e mantém a inscrição.
CREATE OR REPLACE FUNCTION public.limpar_preco_revenda(p_produto uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão define preços de grosso' USING ERRCODE = '42501';
  END IF;

  UPDATE public.precos_revenda
  SET preco = NULL,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE product_id = p_produto;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. CADASTRO DO CATÁLOGO (GESTÃO)
-- -----------------------------------------------------------------------------
-- Uma lista só, com tudo o que o ecrã precisa: o produto, o preço de loja, o
-- preço de grosso que está a valer, e se já está inscrito. Os não inscritos
-- vêm no fim, para o trabalho pendente ficar à vista.
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
          'preco_loja',   coalesce(p.promotional_price, p.official_price),
          'no_catalogo',  pr.product_id IS NOT NULL,
          'preco_proprio', pr.preco,
          'preco_grosso', coalesce(
                            pr.preco,
                            round(
                              p.official_price * (1 - LEAST(0.9, GREATEST(0,
                                public.config_revenda('revenda_desconto', 0.35)))),
                              2
                            )
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
  WHERE p.is_active;

  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.adicionar_produto_catalogo(p_produto uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão inscreve produtos no grosso' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = p_produto AND p.is_active
  ) THEN
    RAISE EXCEPTION 'Produto inexistente ou fora de venda.';
  END IF;

  INSERT INTO public.precos_revenda (product_id, preco, updated_by, updated_at)
  VALUES (p_produto, NULL, auth.uid(), now())
  ON CONFLICT (product_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.remover_produto_catalogo(p_produto uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão retira produtos do grosso' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.precos_revenda WHERE product_id = p_produto;
END;
$$;

-- Inscrever o catálogo inteiro. Devolve quantos entraram agora, para o ecrã
-- poder dizer «+18 produtos» em vez de um silêncio.
CREATE OR REPLACE FUNCTION public.adicionar_todos_catalogo()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_n int := 0;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Só a gestão inscreve produtos no grosso' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.precos_revenda (product_id, preco, updated_by, updated_at)
  SELECT p.id, NULL, auth.uid(), now()
  FROM public.products p
  WHERE p.is_active
  ON CONFLICT (product_id) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. O CATÁLOGO DO REVENDEDOR PASSA A SER O DA GESTÃO
-- -----------------------------------------------------------------------------
-- A única mudança em relação à 0026 é o `JOIN`: `LEFT JOIN` (tudo) passa a
-- `JOIN` (só o que está inscrito). Os preços continuam a vir de
-- `preco_revendedor()`, que já trata do `NULL` — nunca do browser.
CREATE OR REPLACE FUNCTION public.revendedor_catalogo(p_provincia uuid DEFAULT NULL)
RETURNS TABLE (
  product_id     uuid,
  nome           text,
  sku            text,
  categoria      text,
  imagem         text,
  preco_loja     numeric,
  preco_grosso   numeric,
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
         COALESCE(p.promotional_price, p.official_price)::numeric,
         public.preco_revendedor(p.id, v_rev),
         round(
           100 * (1 - public.preco_revendedor(p.id, v_rev)
                      / NULLIF(COALESCE(p.promotional_price, p.official_price), 0)),
           1
         ),
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
  WHERE p.is_active
  ORDER BY c.name NULLS LAST, p.name;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. O PEDIDO: MÍNIMO DE PRODUTOS DIFERENTES
-- -----------------------------------------------------------------------------
-- Duas regras novas, ambas na base:
--   · o pedido tem de ter pelo menos `revenda_minimo_produtos` produtos
--     diferentes (4 por omissão);
--   · cada linha tem de estar no catálogo de grosso.
-- A validação acontece **antes** de consumir o número do pedido, para um
-- pedido recusado não gastar uma sequência.
CREATE OR REPLACE FUNCTION public.registar_pedido_revendedor(
  p_itens    jsonb,
  p_mensagem text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_rev        public.revendedores;
  v_item       jsonb;
  v_prod       uuid;
  v_qtd        int;
  v_preco      numeric;
  v_nome       text;
  v_sku        text;
  v_pedido     uuid;
  v_numero     text;
  v_min_prod   int;
  v_distintos  int;
  v_linhas     int;
  v_total_u    int := 0;
  v_total_v    numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão necessária' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rev
  FROM public.revendedores r
  WHERE r.user_id = auth.uid() AND r.status = 'activo';

  IF v_rev.id IS NULL THEN
    RAISE EXCEPTION 'Só revendedores activos podem fazer pedidos.'
      USING ERRCODE = '42501';
  END IF;

  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array'
     OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'O pedido está vazio.';
  END IF;

  -- --- mínimo de produtos diferentes ---
  v_min_prod := public.config_revenda('revenda_minimo_produtos', 4)::int;

  SELECT count(DISTINCT (i ->> 'product_id'))::int,
         count(*)::int
  INTO v_distintos, v_linhas
  FROM jsonb_array_elements(p_itens) i;

  IF v_linhas <> v_distintos THEN
    RAISE EXCEPTION 'Há produtos repetidos no pedido. Junte as quantidades numa linha só.';
  END IF;

  IF v_distintos < v_min_prod THEN
    RAISE EXCEPTION 'O pedido de grosso exige pelo menos % produtos diferentes (tem %).',
      v_min_prod, v_distintos;
  END IF;

  v_numero := 'RV-' || to_char(now(), 'YYYY') || '-' ||
              lpad(nextval('public.revendedor_pedido_numero')::text, 4, '0');

  INSERT INTO public.revendedor_pedidos
    (numero, revendedor_id, provincia_id, loja_id, mensagem)
  VALUES
    (v_numero, v_rev.id, v_rev.provincia_id,
     COALESCE(v_rev.loja_id, public.loja_da_provincia(v_rev.provincia_id)),
     NULLIF(btrim(COALESCE(p_mensagem, '')), ''))
  RETURNING id INTO v_pedido;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
  LOOP
    v_prod := NULLIF(v_item ->> 'product_id', '')::uuid;
    v_qtd  := COALESCE(NULLIF(v_item ->> 'quantidade', '')::int, 0);

    IF v_prod IS NULL THEN
      RAISE EXCEPTION 'Há uma linha sem produto.';
    END IF;

    IF v_qtd < v_rev.minimo_unidades THEN
      RAISE EXCEPTION 'Cada produto exige pelo menos % unidades.',
        v_rev.minimo_unidades;
    END IF;

    SELECT p.name, p.sku INTO v_nome, v_sku
    FROM public.products p
    WHERE p.id = v_prod AND p.is_active;

    IF v_nome IS NULL THEN
      RAISE EXCEPTION 'Há um produto indisponível no pedido.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.precos_revenda pr WHERE pr.product_id = v_prod
    ) THEN
      RAISE EXCEPTION 'O produto «%» não está no catálogo de grosso.', v_nome;
    END IF;

    v_preco := public.preco_revendedor(v_prod, v_rev.id);

    INSERT INTO public.revendedor_pedido_itens
      (pedido_id, product_id, nome_produto, sku, quantidade, preco_unitario, subtotal)
    VALUES
      (v_pedido, v_prod, v_nome, v_sku, v_qtd, v_preco, round(v_preco * v_qtd, 2));

    v_total_u := v_total_u + v_qtd;
    v_total_v := v_total_v + round(v_preco * v_qtd, 2);
  END LOOP;

  UPDATE public.revendedor_pedidos
  SET total_unidades = v_total_u,
      valor_estimado = v_total_v,
      updated_at = now()
  WHERE id = v_pedido;

  RETURN jsonb_build_object(
    'id', v_pedido,
    'numero', v_numero,
    'total_unidades', v_total_u,
    'valor_estimado', v_total_v
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. AS REGRAS VÃO PARA O ECRÃ DO REVENDEDOR
-- -----------------------------------------------------------------------------
-- O catálogo mostra o mínimo de unidades e o mínimo de produtos. Em vez de a
-- página perguntar duas vezes à configuração, `minha_revenda()` já os traz —
-- é a chamada que a página do catálogo faz de qualquer maneira.
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
      'desconto', COALESCE(v_rev.desconto,
                           public.config_revenda('revenda_desconto', 0.35)),
      'minimo_unidades', v_rev.minimo_unidades,
      'status', v_rev.status,
      'nota', v_rev.nota
    ),
    'regras', jsonb_build_object(
      'minimo_unidades', v_rev.minimo_unidades,
      'minimo_produtos', public.config_revenda('revenda_minimo_produtos', 4)::int
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
-- 9. PERMISSÕES
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.catalogo_revenda_gestao()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.adicionar_produto_catalogo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_produto_catalogo(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.adicionar_todos_catalogo()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.limpar_preco_revenda(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.revendedor_catalogo(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.registar_pedido_revendedor(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.minha_revenda()                  TO authenticated;

-- -----------------------------------------------------------------------------
-- 10. VERIFICAÇÃO
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'catalogo_revenda_gestao'
  ) THEN
    RAISE EXCEPTION '0031: catalogo_revenda_gestao() não foi criada.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_settings WHERE key = 'revenda_minimo_produtos'
  ) THEN
    RAISE EXCEPTION '0031: revenda_minimo_produtos não foi gravado.';
  END IF;
END;
$$;
