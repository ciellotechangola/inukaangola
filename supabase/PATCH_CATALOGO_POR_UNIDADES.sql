-- =============================================================================
--  INUKA ANGOLA — PATCH: CATÁLOGO A GROSSO POR UNIDADES
-- =============================================================================
--  Supabase -> SQL Editor -> New query -> colar tudo -> RUN
--  Idempotente. Pode ser executado mais do que uma vez sem perder dados.
--  Equivale à migração 0035_catalogo_grosso_por_unidades.sql (mesmo conteúdo).
--  Requer a 0001 a 0034 já aplicadas.
--
--  O QUE RESOLVE
--    · O mínimo do pedido deixa de ser «4 produtos diferentes» e passa a ser
--      «4 UNIDADES no total». Um produto ×4 é um pedido válido. 2+2 também.
--      Cada linha pode ter 1 unidade; acima de 4 não há tecto.
--    · O catálogo abre pelo que foi submetido por último: a gestão inscreve
--      um produto no grosso e ele aparece em primeiro, sem ninguém o procurar.
--    · O preço de loja passa a ser mostrado ao revendedor como
--      «PREÇO MÍNIMO OFICIAL DE VENDA AO CLIENTE FINAL» — o número que ele
--      já tinha na base, agora com o nome certo e com o lucro ao lado.
--
--  O QUE NÃO MUDA
--    · Preços de revenda, produtos, fotografias, stock, pedidos antigos.
--      Nada é apagado. A 0033 continua a mandar no preço: só o preço escrito
--      em `precos_revenda.preco` conta.
--
--  DEPOIS DE CORRER
--    SELECT public.config_revenda('revenda_minimo_unidades', 4);  -- 4
--    -- com sessão de revendedor:
--    SELECT nome, preco_grosso FROM public.revendedor_catalogo() LIMIT 10;
-- =============================================================================

-- =============================================================================
-- 0035 — O GROSSO COMPRA-SE POR UNIDADES, E O QUE É NOVO VEM PRIMEIRO
-- =============================================================================
--  O QUE ESTAVA MAL
--    1. **A regra do pedido era a regra errada.** O grosso exigia 4 produtos
--       *diferentes* e 5 unidades *por linha*. Quem quisesse comprar 6
--       unidades do mesmo produto — o caso mais comum de quem está a começar
--       — não conseguia: tinha de inventar três linhas de outros produtos
--       para o pedido passar. A regra protegia a facturação, não o revendedor.
--    2. **O catálogo abria por ordem alfabética.** A gestão inscrevia um
--       produto novo e ele aparecia no meio da lista, na letra dele. Não havia
--       maneira de o revendedor ver o que tinha acabado de entrar.
--    3. **O preço de loja era um número escondido.** O revendedor via quanto
--       pagava, e mais nada. Não sabia qual era o preço mínimo oficial a que
--       podia vender ao cliente final — logo, não sabia qual era o seu lucro.
--       A 0033 escondeu-o para o ecrã não parecer uma folha de cálculo; o
--       resultado foi um revendedor a comprar às cegas.
--
--  O QUE PASSA A ACONTECER
--    1. **O MÍNIMO É DE 4 UNIDADES NO PEDIDO, NÃO 4 PRODUTOS.** Um produto ×4
--       é um pedido válido. Dois produtos 2+2 também. Um de cada, quatro
--       produtos, também. Cada linha pode ter 1 unidade: quem manda é o total.
--       Acima de 4 não há tecto — 4, 5, 6, 7, 10, 40.
--    2. **O QUE FOI SUBMETIDO POR ÚLTIMO FICA EM CIMA.** A ordem do catálogo
--       passa a ser a data da última alteração — do produto ou da linha de
--       grosso, a mais recente das duas. A gestão inscreve um produto e ele
--       aparece no primeiro lugar, sem ninguém ter de o procurar.
--    3. **O PREÇO DE LOJA PASSA A SER O PREÇO MÍNIMO OFICIAL.** O mesmo número
--       que já vinha na função, agora com o nome que tem: é o preço mínimo a
--       que a INUKA recomenda a venda ao cliente final. O revendedor pode
--       vender acima — nunca é obrigado a vender ao mínimo.
--
--  NOTA DELIBERADA — ISTO CONTRARIA A 0033
--    A 0033 decidiu esconder o preço de loja, o lucro e a margem do ecrã do
--    revendedor. Essa decisão está revertida: a partir daqui o revendedor vê
--    o preço mínimo oficial e o lucro que faz a esse preço. Não é um desconto
--    nem uma margem calculada pela INUKA — é a diferença entre dois preços que
--    já existiam na base. Ver `docs/CATALOGO_GROSSO_2026.md`.
--
--  Nada é apagado. Os preços de revenda ficam como estão, os produtos ficam
--  como estão, o histórico de pedidos fica como está. Idempotente: pode correr
--  mais do que uma vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. QUANDO É QUE ESTA LINHA ENTROU NO GROSSO
-- -----------------------------------------------------------------------------
-- `updated_at` já existia e diz «quando é que isto mudou pela última vez».
-- Falta a outra metade: «quando é que isto apareceu». Sem ela não se
-- distingue um produto que entrou ontem de um que só levou uma correcção de
-- preço. A coluna entra com o valor de `updated_at` nas linhas antigas — é a
-- melhor aproximação que existe para o passado, e não inventa datas.
--
-- O `ALTER` está dentro do `IF` porque `ADD COLUMN` com `DEFAULT now()`
-- carimba todas as linhas com a hora de execução: numa segunda execução, os
-- 81 produtos antigos passavam a parecer novos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'precos_revenda'
      AND column_name  = 'created_at'
  ) THEN
    ALTER TABLE public.precos_revenda ADD COLUMN created_at timestamptz;
    UPDATE public.precos_revenda SET created_at = updated_at;
    ALTER TABLE public.precos_revenda ALTER COLUMN created_at SET DEFAULT now();
    ALTER TABLE public.precos_revenda ALTER COLUMN created_at SET NOT NULL;
  END IF;
END $$;

-- A ordem do catálogo é uma leitura por data decrescente: o índice evita
-- ordenar 99 linhas em cada abertura do ecrã.
CREATE INDEX IF NOT EXISTS precos_revenda_updated_idx
  ON public.precos_revenda (updated_at DESC);

-- -----------------------------------------------------------------------------
-- 2. A REGRA NOVA, NUMA CHAVE SÓ
-- -----------------------------------------------------------------------------
-- `revenda_minimo` (5) e `revenda_minimo_produtos` (4) ficam na tabela como
-- estão: são as chaves antigas, e apagá-las só estragaria instalações que
-- ainda as lêem. A regra que conta a partir de agora é esta.
--
-- `ON CONFLICT DO NOTHING`: se a gestão já tiver escrito um valor próprio,
-- uma segunda execução não lhe passa por cima.
INSERT INTO public.platform_settings (key, value)
VALUES ('revenda_minimo_unidades', '{"value": 4}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- O mínimo do pedido é 4 unidades. O valor por revendedor continua a existir
-- (`revendedores.minimo_unidades`) para um acordo mais exigente — mas o `5`
-- que lá estava não foi escolhido por ninguém: era o `DEFAULT` da tabela,
-- herdado da regra antiga «5 por linha». Passa a 4, que é a regra da casa.
ALTER TABLE public.revendedores ALTER COLUMN minimo_unidades SET DEFAULT 4;
UPDATE public.revendedores SET minimo_unidades = 4 WHERE minimo_unidades = 5;

-- -----------------------------------------------------------------------------
-- 3. O CATÁLOGO: O ÚLTIMO SUBMETIDO EM PRIMEIRO
-- -----------------------------------------------------------------------------
-- `CREATE OR REPLACE` chega: a lista de colunas de saída não muda, por isso o
-- `GRANT` da 0033 continua válido e não há `DROP` a meio.
--
-- A coluna `minimo` muda de significado, e é a única mudança de contrato:
--   · antes — unidades mínimas **de cada linha** (5);
--   · agora — unidades mínimas **do pedido inteiro** (4).
-- A linha pode ter 1. Quem manda é a soma.
--
-- A ordem: a data mais recente entre a linha de grosso e o produto. Assim,
-- tanto «inscrevi este produto no grosso» como «corrigi a fotografia deste
-- produto» o trazem para cima. Empate resolve-se por categoria e nome, para a
-- lista não andar a saltar entre dois ecrãs abertos ao mesmo tempo.
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

  -- Mínimo do pedido: o acordo do revendedor, se existir; senão a regra da
  -- casa (4). `revenda_minimo` fica como última rede para bases antigas que
  -- nunca correram esta migração.
  SELECT COALESCE(
           (SELECT r.minimo_unidades FROM public.revendedores r WHERE r.id = v_rev),
           public.config_revenda('revenda_minimo_unidades',
             public.config_revenda('revenda_minimo', 4))
         )::int
  INTO v_minimo;

  RETURN QUERY
  SELECT p.id,
         p.name,
         p.sku,
         c.name,
         (SELECT pi.url FROM public.product_images pi
          WHERE pi.product_id = p.id AND pi.url IS NOT NULL
          ORDER BY pi.is_primary DESC, pi.sort_order LIMIT 1),
         -- PREÇO MÍNIMO OFICIAL DE VENDA AO CLIENTE FINAL.
         -- É este o número que o revendedor pode cobrar, no mínimo, ao
         -- cliente. Pode cobrar mais; nunca é obrigado a cobrar menos.
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
  -- O ÚLTIMO SUBMETIDO EM PRIMEIRO.
  ORDER BY GREATEST(pr.updated_at, COALESCE(p.updated_at, pr.updated_at)) DESC,
           c.name NULLS LAST,
           p.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revendedor_catalogo(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. O PEDIDO: 4 UNIDADES NO TOTAL, 1 POR LINHA
-- -----------------------------------------------------------------------------
-- A conta faz-se **antes** de escrever o pedido: o erro sai com o número que
-- falta, e não a meio de uma transacção que já inseriu metade das linhas.
--
-- O que continua a ser recusado, e porquê:
--   · linha com 0 unidades — não é uma compra;
--   · o mesmo produto em duas linhas — duas linhas do mesmo produto escondem
--     a quantidade real de quem lê o pedido do outro lado;
--   · produto fora do catálogo ou sem preço escrito — a 0033 já o fazia e
--     mantém-se: não se inventa um preço para tapar um buraco.
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
  v_min_unid   int;
  v_distintos  int;
  v_linhas     int;
  v_pedidas    int;
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

  -- --- quantas linhas, quantos produtos distintos, quantas unidades ---
  SELECT count(DISTINCT (i ->> 'product_id'))::int,
         count(*)::int,
         COALESCE(sum(COALESCE(NULLIF(i ->> 'quantidade', '')::int, 0)), 0)::int
  INTO v_distintos, v_linhas, v_pedidas
  FROM jsonb_array_elements(p_itens) i;

  IF v_linhas <> v_distintos THEN
    RAISE EXCEPTION 'Há produtos repetidos no pedido. Junte as quantidades numa linha só.';
  END IF;

  -- --- o mínimo é de UNIDADES, não de produtos diferentes ---
  v_min_unid := COALESCE(NULLIF(v_rev.minimo_unidades, 0),
                         public.config_revenda('revenda_minimo_unidades', 4)::int);

  IF v_pedidas < v_min_unid THEN
    RAISE EXCEPTION 'O pedido de grosso exige pelo menos % unidades no total (tem %).',
      v_min_unid, v_pedidas;
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

    -- Uma linha pode ter 1 unidade: quem soma é o pedido.
    IF v_qtd < 1 THEN
      RAISE EXCEPTION 'Há uma linha sem quantidade. Indique pelo menos 1 unidade.';
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
    'valor_estimado', v_total_v,
    'minimo_unidades', v_min_unid
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.registar_pedido_revendedor(jsonb, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. AS REGRAS QUE O ECRÃ LÊ
-- -----------------------------------------------------------------------------
-- `minimo_unidades` passa a ser o mínimo **do pedido**. `minimo_produtos`
-- continua a sair, com 1, para um ecrã antigo que ainda lhe peça não partir —
-- mas já não é uma regra: nenhum caminho o usa para decidir nada.
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
  v_min      int;
BEGIN
  SELECT * INTO v_rev FROM public.revendedores r WHERE r.user_id = auth.uid();
  IF v_rev.id IS NULL THEN
    RETURN jsonb_build_object('revendedor', NULL);
  END IF;

  v_min := COALESCE(NULLIF(v_rev.minimo_unidades, 0),
                    public.config_revenda('revenda_minimo_unidades', 4)::int);

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

  IF v_gestor IS NULL THEN
    SELECT p.id, p.full_name INTO v_gestor, v_gestor_n
    FROM public.profiles p
    WHERE p.role = 'manager'::public.user_role
      AND p.is_active
      AND p.provincia_id = v_rev.provincia_id
    ORDER BY p.created_at
    LIMIT 1;
  END IF;

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
      'minimo_unidades', v_min,
      'status', v_rev.status,
      'nota', v_rev.nota
    ),
    'regras', jsonb_build_object(
      'minimo_unidades', v_min,
      'minimo_produtos', 1,
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

GRANT EXECUTE ON FUNCTION public.minha_revenda() TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. O ECRÃ DA GESTÃO PASSA A MOSTRAR A REGRA CERTA
-- -----------------------------------------------------------------------------
-- `PrecosGrosso` editava «produtos diferentes por pedido». Deixa de fazer
-- sentido: o campo passa a ser «unidades por pedido». A chave antiga continua
-- a sair com 1 para nada partir, mas é a nova que o formulário grava.
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
    'minimo_unidades', public.config_revenda('revenda_minimo_unidades', 4)::int,
    'minimo_produtos', 1,
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
          'actualizado_em', GREATEST(pr.updated_at, COALESCE(p.updated_at, pr.updated_at)),
          'stock',        (SELECT CASE WHEN count(*) = 0 THEN NULL
                                       ELSE GREATEST(0, sum(i.quantity - i.reserved_quantity))::int
                                  END
                           FROM public.inventory i
                           WHERE i.product_id = p.id)
        )
        ORDER BY (pr.product_id IS NULL), (pr.preco IS NULL),
                 GREATEST(pr.updated_at, COALESCE(p.updated_at, pr.updated_at)) DESC,
                 c.name NULLS LAST, p.name
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

GRANT EXECUTE ON FUNCTION public.catalogo_revenda_gestao() TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. VERIFICAÇÃO
-- -----------------------------------------------------------------------------
-- Este bloco corre como `postgres`, sem sessão: não pode chamar
-- `revendedor_catalogo()` (que exige papel de revendedor ou gestor). Verifica
-- o que é verificável sem sessão — a regra gravada e a coluna nova.
--
-- Para ver o catálogo pela ordem nova, com sessão de revendedor:
--
--   SELECT nome, preco_grosso FROM public.revendedor_catalogo() LIMIT 10;
--
-- O primeiro da lista tem de ser o último produto que a gestão inscreveu ou
-- alterou no grosso.
DO $$
DECLARE
  v_min   int;
  v_col   int;
  v_gross int;
BEGIN
  v_min := public.config_revenda('revenda_minimo_unidades', 4)::int;

  IF v_min < 1 THEN
    RAISE EXCEPTION '0035: revenda_minimo_unidades ficou a % (tem de ser ≥ 1).', v_min;
  END IF;

  SELECT count(*) INTO v_col
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'precos_revenda'
    AND column_name  = 'created_at';

  IF v_col <> 1 THEN
    RAISE EXCEPTION '0035: a coluna precos_revenda.created_at não foi criada.';
  END IF;

  SELECT count(*) INTO v_gross
  FROM public.precos_revenda pr
  JOIN public.products p ON p.id = pr.product_id
  WHERE p.is_active AND pr.preco IS NOT NULL AND pr.preco > 0;

  RAISE NOTICE '0035: mínimo do pedido = % unidades; % produtos vendáveis a grosso.',
    v_min, v_gross;
END $$;
