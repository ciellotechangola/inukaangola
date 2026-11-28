-- =============================================================================
-- 0033 — PREÇO DE REVENDA OFICIAL: A TABELA 2026 MANDA SOZINHA
-- =============================================================================
--  O QUE ESTAVA MAL
--    1. O grosso tinha três fontes de preço: um preço escrito pela gestão, o
--       desconto negociado do revendedor e, por baixo de tudo, a tabela de
--       reduções da 0032. Só a primeira era oficial. As outras duas eram
--       contas — e o revendedor via um número que não era o preço da tabela
--       INUKA 2026.
--    2. O revendedor via, ao lado do preço dele, o preço de cliente, o lucro
--       por unidade e a margem. A decisão de compra ficava a meio caminho
--       entre o catálogo e uma folha de cálculo.
--    3. Faltavam preços: dos 99 produtos activos, só 18 estavam no grosso, e
--       nenhum tinha preço escrito.
--
--  O QUE PASSA A ACONTECER
--    1. **O PREÇO DE REVENDA DA TABELA 2026 É O PREÇO.** Escrito em
--       `precos_revenda.preco`, um por produto, sem cálculo nenhum por cima.
--       O desconto negociado do revendedor e a tabela de reduções deixam de
--       tocar no preço do catálogo de grosso.
--    2. **Sem preço escrito, o produto não se vende a grosso.** Um produto no
--       catálogo sem preço não aparece ao revendedor e não entra em pedidos —
--       é uma linha pendente, à espera de decisão da gestão. Não se inventa
--       um preço para tapar o buraco.
--    3. O preço de cliente final continua a ser o preço de cliente final: esta
--       migração não toca em `official_price` nem em `promotional_price`. O
--       que muda é só o que o revendedor paga.
--    4. Os produtos que a tabela 2026 não lista ficam no catálogo **sem
--       preço** (a linha não se apaga): a gestão vê-os como pendentes e
--       decide. Nada é eliminado.
--
--  Os preços entram por SKU, não por `id`: o `id` muda de base para base, o
--  SKU é o mesmo em qualquer instalação. O bloco de dados só preenche preços
--  em falta (`preco IS NULL`) — um preço já escrito pela gestão nunca é
--  substituído por uma segunda execução.
--
--  Idempotente. Pode correr mais do que uma vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A TABELA OFICIAL DE PREÇO DE REVENDA (INUKA 2026)
-- -----------------------------------------------------------------------------
-- 81 produtos, 43 páginas do portfólio, o valor do campo «PREÇO REVENDA».
-- Soma a preço de loja: 1.238.000 Kz. Soma a preço de revenda: 920.500 Kz.
WITH oficial (sku, preco) AS (
  VALUES
    ('INUKA-2026-001', 6500),
    ('INUKA-2026-002', 6500),
    ('INUKA-2026-003', 15000),
    ('INUKA-2026-004', 5000),
    ('INUKA-2026-005', 8500),
    ('INUKA-2026-006', 55000),
    ('INUKA-2026-007', 15000),
    ('INUKA-2026-008', 9000),
    ('INUKA-2026-009', 15000),
    ('INUKA-2026-010', 11000),
    ('INUKA-2026-011', 15000),
    ('INUKA-2026-012', 5000),
    ('INUKA-2026-013', 8500),
    ('INUKA-2026-014', 15000),
    ('INUKA-2026-015', 11000),
    ('INUKA-2026-016', 10000),
    ('INUKA-2026-017', 14000),
    ('INUKA-2026-018', 14000),
    ('INUKA-2026-019', 14000),
    ('INUKA-2026-020', 4000),
    ('INUKA-2026-021', 8500),
    ('INUKA-2026-022', 14000),
    ('INUKA-2026-023', 8500),
    ('INUKA-2026-024', 10000),
    ('INUKA-2026-025', 9000),
    ('INUKA-2026-026', 15000),
    ('INUKA-2026-027', 8500),
    ('INUKA-2026-028', 10000),
    ('INUKA-2026-029', 8500),
    ('INUKA-2026-030', 8500),
    ('INUKA-2026-031', 37000),
    ('INUKA-2026-032', 4000),
    ('INUKA-2026-033', 11000),
    ('INUKA-2026-034', 8500),
    ('INUKA-2026-035', 14000),
    ('INUKA-2026-036', 14000),
    ('INUKA-2026-037', 8500),
    ('INUKA-2026-038', 14000),
    ('INUKA-2026-039', 14000),
    ('INUKA-2026-040', 9000),
    ('INUKA-2026-041', 15000),
    ('INUKA-2026-042', 15000),
    ('INUKA-2026-043', 10000),
    ('INUKA-2026-044', 14000),
    ('INUKA-2026-045', 5000),
    ('INUKA-2026-046', 15000),
    ('INUKA-2026-047', 14000),
    ('INUKA-2026-048', 11000),
    ('INUKA-2026-049', 12000),
    ('INUKA-2026-050', 7500),
    ('INUKA-2026-051', 12000),
    ('INUKA-2026-052', 12000),
    ('INUKA-2026-053', 12000),
    ('INUKA-2026-054', 14000),
    ('INUKA-2026-055', 8500),
    ('INUKA-2026-056', 15000),
    ('INUKA-2026-057', 8500),
    ('INUKA-2026-058', 25000),
    ('INUKA-2026-059', 12000),
    ('INUKA-2026-060', 10000),
    ('INUKA-2026-061', 11000),
    ('INUKA-2026-062', 6500),
    ('INUKA-2026-063', 8500),
    ('INUKA-2026-064', 12000),
    ('INUKA-2026-065', 14000),
    ('INUKA-2026-066', 15000),
    ('INUKA-2026-067', 14000),
    ('INUKA-2026-068', 6500),
    ('INUKA-2026-069', 6500),
    ('INUKA-2026-070', 3000),
    ('INUKA-2026-071', 5500),
    ('INUKA-2026-072', 8500),
    ('INUKA-2026-073', 5000),
    ('INUKA-2026-074', 5000),
    ('INUKA-2026-075', 5000),
    ('INUKA-2026-076', 6500),
    ('INUKA-2026-077', 6500),
    ('INUKA-2026-078', 6500),
    ('INUKA-2026-079', 18000),
    ('INUKA-2026-080', 13000),
    ('INUKA-2026-081', 5000)
)
INSERT INTO public.precos_revenda (product_id, preco, nota, updated_at)
SELECT p.id, o.preco, 'Tabela 2026 — preço de revenda', now()
FROM oficial o
JOIN public.products p ON p.sku = o.sku
ON CONFLICT (product_id) DO UPDATE
  SET preco = EXCLUDED.preco
  WHERE public.precos_revenda.preco IS NULL;

-- -----------------------------------------------------------------------------
-- 2. UMA SÓ PERGUNTA: «QUAL É O PREÇO ESCRITO DESTE PRODUTO?»
-- -----------------------------------------------------------------------------
-- `NULL` é uma resposta legítima: não há preço de revenda definido. Todas as
-- funções abaixo usam esta porta, para não haver duas maneiras de ler o mesmo
-- número.
CREATE OR REPLACE FUNCTION public.preco_revenda_escrito(p_produto uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pr.preco
  FROM public.precos_revenda pr
  WHERE pr.product_id = p_produto;
$$;

-- -----------------------------------------------------------------------------
-- 3. O CATÁLOGO DO REVENDEDOR: SÓ PREÇO ESCRITO, SÓ PRODUTO COM PREÇO
-- -----------------------------------------------------------------------------
-- `RETURNS TABLE` obriga a recriar: `CREATE OR REPLACE` não muda a lista de
-- colunas de saída. O `DROP` leva o `GRANT` atrás, e o `GRANT` volta no fim.
--
-- As colunas `reducao`, `lucro_unidade`, `margem_pct` e `desconto_pct`
-- continuam a sair (há ecrãs antigos que as pedem) mas já não são uma política
-- de preço: são a diferença entre a tabela de loja e o preço escrito, para
-- uso interno. O ecrã do revendedor deixou de as mostrar.
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
         pr.preco,
         b.loja - pr.preco,
         b.loja - pr.preco,
         round(100 * (b.loja - pr.preco) / NULLIF(pr.preco, 0), 1),
         round(100 * (b.loja - pr.preco) / NULLIF(b.loja, 0), 1),
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
    SELECT COALESCE(p.promotional_price, p.official_price)::numeric AS loja
  ) b
  WHERE p.is_active
    AND pr.preco IS NOT NULL
    AND pr.preco > 0
  ORDER BY c.name NULLS LAST, p.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revendedor_catalogo(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. O PEDIDO É COTADO PELO PREÇO ESCRITO — NUNCA PELO BROWSER
-- -----------------------------------------------------------------------------
-- Antes cotava por `preco_revendedor()`, que ainda aplicava o desconto
-- negociado: o pedido saía a um preço diferente do que o catálogo mostrava.
-- Agora é o mesmo número nas duas pontas, e um produto sem preço escrito é
-- recusado em vez de entrar a zero.
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

    v_preco := public.preco_revenda_escrito(v_prod);

    IF v_preco IS NULL OR v_preco <= 0 THEN
      RAISE EXCEPTION 'O produto «%» ainda não tem preço de revenda definido.', v_nome;
    END IF;

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
-- 5. O CADASTRO DA GESTÃO MOSTRA O PREÇO ESCRITO E AS LINHAS PENDENTES
-- -----------------------------------------------------------------------------
-- `preco_grosso` passa a ser o preço escrito, e pode ser `NULL`: é assim que a
-- gestão vê, sem abrir produto a produto, o que está no catálogo mas ainda não
-- tem preço. `totais.pendentes` conta exactamente esses.
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
      'com_preco',   count(*) FILTER (WHERE pr.preco IS NOT NULL),
      'pendentes',   count(*) FILTER (WHERE pr.product_id IS NOT NULL AND pr.preco IS NULL)
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
          'reducao',      CASE WHEN pr.preco IS NULL THEN 0 ELSE b.loja - pr.preco END,
          'preco_grosso', pr.preco,
          'margem_pct',   CASE WHEN pr.preco IS NULL OR pr.preco = 0 THEN 0
                               ELSE round(100 * (b.loja - pr.preco) / pr.preco, 1) END,
          'nota',         pr.nota,
          'stock',        (SELECT CASE WHEN count(*) = 0 THEN NULL
                                       ELSE GREATEST(0, sum(i.quantity - i.reserved_quantity))::int
                                  END
                           FROM public.inventory i
                           WHERE i.product_id = p.id)
        )
        ORDER BY (pr.product_id IS NULL), (pr.preco IS NULL), c.name NULLS LAST, p.name
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
-- 6. VERIFICAÇÃO
-- -----------------------------------------------------------------------------
-- Depois de correr, isto deve devolver 81 com preço:
--
--   SELECT count(*) FILTER (WHERE preco IS NOT NULL) AS com_preco,
--          count(*) FILTER (WHERE preco IS NULL)     AS sem_preco
--   FROM public.precos_revenda;
--
-- `sem_preco` conta os produtos que a gestão inscreveu no catálogo sem lhes
-- dar preço. Não são vendidos a grosso enquanto não tiverem um: aparecem no
-- cadastro da gestão como pendentes e ficam fora do catálogo do revendedor.
--
-- Os 18 artigos antigos que a tabela 2026 não lista (perfumes e cremes
-- clássicos, sem SKU) foram retirados do catálogo de grosso — continuam
-- activos na loja, com o preço de cliente final intacto. Para os vender a
-- grosso, a gestão inscreve-os e escreve o preço de revenda.
