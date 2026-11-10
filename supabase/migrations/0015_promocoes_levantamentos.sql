-- =============================================================================
--  0015 — PROMOÇÕES POR PROVÍNCIA, COMISSÕES E LEVANTAMENTOS
-- =============================================================================
--  Três coisas que a plataforma prometia e não tinha:
--
--   1. PROMOÇÕES COM ÂMBITO. Até aqui a única promoção era
--      `products.promotional_price`, igual em todo o país. Passa a haver
--      campanhas com províncias, período de validade e produtos escolhidos.
--      O preço que o cliente paga sai de `preco_efetivo()` — uma regra só,
--      usada pela loja e por `place_order`.
--
--   2. ENTREGA «POR DEFINIR». A entrega é gratuita no Uíge. Nas outras
--      províncias não se inventa uma taxa: `taxa_entrega()` devolve NULL e a
--      encomenda fica com a taxa pendente, à espera que a gerência a defina.
--
--   3. LEVANTAMENTO DE COMISSÕES. O colaborador passa a pedir o dinheiro
--      (XPRESS ou transferência) e a gestão aprova, processa e paga. O saldo
--      nunca é um número guardado: é sempre calculado a partir das comissões
--      menos o que já foi pago e o que está reservado num pedido em curso.
--
--  O QUE NÃO SE TOCA
--   - `sale_commissions` e `commission_payouts` continuam a ser o livro de
--     comissões e de pagamentos. Os levantamentos são pedidos; o pagamento
--     continua a ser um `commission_payouts`. Não há dois livros.
--   - A taxa de 10% continua a vir de `taxa_comissao_efetiva()`.
--
--  Idempotente. Pode correr mais do que uma vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TIPOS
-- -----------------------------------------------------------------------------
-- Tipo novo (CREATE TYPE), não um valor acrescentado a um enum existente:
-- assim pode ser usado já nesta migração, na mesma transacção.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'levantamento_status') THEN
    CREATE TYPE public.levantamento_status AS ENUM (
      'pendente', 'aprovado', 'em_processamento', 'pago', 'rejeitado'
    );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. PROMOÇÕES
-- -----------------------------------------------------------------------------
-- `tipo='percentagem'` desconta `valor` por cento do preço base;
-- `tipo='preco'` fixa o preço final. Em ambos os casos o preço nunca sobe:
-- `preco_efetivo()` fica com o menor dos dois.
CREATE TABLE IF NOT EXISTS public.promocoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  descricao   text,
  tipo        text NOT NULL DEFAULT 'percentagem',
  valor       numeric(12,2) NOT NULL CHECK (valor >= 0),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  ativo       boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promocoes_nome_nao_vazio CHECK (length(btrim(nome)) > 0),
  CONSTRAINT promocoes_tipo_valido CHECK (tipo IN ('percentagem', 'preco')),
  CONSTRAINT promocoes_percentagem_valida CHECK (tipo <> 'percentagem' OR valor <= 100),
  CONSTRAINT promocoes_periodo_valido CHECK (ends_at IS NULL OR ends_at > starts_at)
);

COMMENT ON TABLE public.promocoes IS
  'Campanha promocional com âmbito de províncias e produtos. Sem linhas em promocao_provincias vale no país inteiro; sem linhas em promocao_produtos vale para todo o catálogo.';

-- Âmbito geográfico. Vazio = nacional.
CREATE TABLE IF NOT EXISTS public.promocao_provincias (
  promocao_id  uuid NOT NULL REFERENCES public.promocoes(id) ON DELETE CASCADE,
  provincia_id uuid NOT NULL REFERENCES public.provincias(id) ON DELETE CASCADE,
  PRIMARY KEY (promocao_id, provincia_id)
);

-- Âmbito de catálogo. Vazio = todos os produtos.
CREATE TABLE IF NOT EXISTS public.promocao_produtos (
  promocao_id uuid NOT NULL REFERENCES public.promocoes(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  PRIMARY KEY (promocao_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_promocoes_vigencia ON public.promocoes (ativo, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_promocao_provincias_prov ON public.promocao_provincias (provincia_id);
CREATE INDEX IF NOT EXISTS idx_promocao_produtos_prod ON public.promocao_produtos (product_id);

-- -----------------------------------------------------------------------------
-- 3. PREÇO EFECTIVO — A REGRA ÚNICA
-- -----------------------------------------------------------------------------
-- Devolve a promoção que dá o melhor preço a este produto nesta província.
-- `NULL` quando não há campanha aplicável.
--
--   base  = COALESCE(promotional_price, official_price)
--   promo = percentagem → base × (1 − valor/100)  |  preço → valor
--   final = LEAST(base, promo)
--
-- `p_provincia` NULL (visitante sem província) só apanha campanhas nacionais:
-- mostrar o preço de uma província a quem não está nela seria publicidade
-- enganosa.
CREATE OR REPLACE FUNCTION public.promocao_do_produto(
  p_product   uuid,
  p_provincia uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT COALESCE(pr.promotional_price, pr.official_price)::numeric AS preco
    FROM public.products pr
    WHERE pr.id = p_product
  ),
  candidatas AS (
    SELECT po.id,
           po.nome,
           po.tipo,
           po.valor,
           CASE
             WHEN po.tipo = 'percentagem' THEN round(b.preco * (1 - po.valor / 100.0), 2)
             ELSE po.valor
           END AS preco_promo
    FROM public.promocoes po
    CROSS JOIN base b
    WHERE po.ativo
      AND po.starts_at <= now()
      AND (po.ends_at IS NULL OR po.ends_at >= now())
      -- Província: campanha nacional (sem linhas) ou que inclua a do cliente.
      AND (
        NOT EXISTS (SELECT 1 FROM public.promocao_provincias pp WHERE pp.promocao_id = po.id)
        OR (p_provincia IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.promocao_provincias pp
              WHERE pp.promocao_id = po.id AND pp.provincia_id = p_provincia))
      )
      -- Catálogo: campanha de todo o catálogo (sem linhas) ou com este produto.
      AND (
        NOT EXISTS (SELECT 1 FROM public.promocao_produtos ppr WHERE ppr.promocao_id = po.id)
        OR EXISTS (SELECT 1 FROM public.promocao_produtos ppr
                   WHERE ppr.promocao_id = po.id AND ppr.product_id = p_product)
      )
  )
  SELECT jsonb_build_object(
           'promocao_id',  c.id,
           'nome',         c.nome,
           'tipo',         c.tipo,
           'valor',        c.valor,
           'preco_base',   b.preco,
           'preco_final',  GREATEST(LEAST(b.preco, c.preco_promo), 0)
         )
  FROM candidatas c
  CROSS JOIN base b
  WHERE c.preco_promo < b.preco          -- uma promoção nunca aumenta o preço
  ORDER BY GREATEST(c.preco_promo, 0) ASC, c.id
  LIMIT 1;
$$;

-- Preço que o cliente paga. É esta a função que `place_order` usa; a loja
-- mostra o mesmo número, por isso não há dois preços em lado nenhum.
CREATE OR REPLACE FUNCTION public.preco_efetivo(
  p_product   uuid,
  p_provincia uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (public.promocao_do_produto(p_product, p_provincia) ->> 'preco_final')::numeric,
    (SELECT COALESCE(pr.promotional_price, pr.official_price)::numeric
     FROM public.products pr WHERE pr.id = p_product)
  );
$$;

-- O mesmo preço, mas para uma lista inteira de produtos.
--
-- A montra mostra 24 cartões de uma vez; chamar `preco_efetivo` 24 vezes eram
-- 24 idas ao Supabase por visita. Devolve uma linha por produto pedido, com o
-- preço base ao lado para a loja poder mostrar o risco do desconto.
-- Produtos inexistentes são simplesmente ignorados.
CREATE OR REPLACE FUNCTION public.precos_efetivos(
  p_produtos  uuid[],
  p_provincia uuid DEFAULT NULL
)
RETURNS TABLE (
  product_id    uuid,
  preco_base    numeric,
  preco_final   numeric,
  promocao_id   uuid,
  promocao_nome text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pr.id,
         COALESCE(pr.promotional_price, pr.official_price)::numeric AS preco_base,
         public.preco_efetivo(pr.id, p_provincia)                   AS preco_final,
         (public.promocao_do_produto(pr.id, p_provincia) ->> 'promocao_id')::uuid AS promocao_id,
         public.promocao_do_produto(pr.id, p_provincia) ->> 'nome'               AS promocao_nome
  FROM public.products pr
  WHERE pr.id = ANY (COALESCE(p_produtos, ARRAY[]::uuid[]));
$$;
GRANT EXECUTE ON FUNCTION public.precos_efetivos(uuid[], uuid)   TO anon, authenticated;

-- Campanhas a decorrer numa província, para a montra e para o carrinho.
CREATE OR REPLACE FUNCTION public.promocoes_vigentes(p_provincia uuid DEFAULT NULL)
RETURNS TABLE (
  id          uuid,
  nome        text,
  descricao   text,
  tipo        text,
  valor       numeric,
  starts_at   timestamptz,
  ends_at     timestamptz,
  nacional    boolean,
  provincias  text[],
  produtos    int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT po.id,
         po.nome,
         po.descricao,
         po.tipo,
         po.valor,
         po.starts_at,
         po.ends_at,
         NOT EXISTS (SELECT 1 FROM public.promocao_provincias pp WHERE pp.promocao_id = po.id) AS nacional,
         COALESCE(ARRAY(
           SELECT pr.nome
           FROM public.promocao_provincias pp
           JOIN public.provincias pr ON pr.id = pp.provincia_id
           WHERE pp.promocao_id = po.id
           ORDER BY pr.nome
         ), ARRAY[]::text[]) AS provincias,
         (SELECT COUNT(*)::int FROM public.promocao_produtos ppr WHERE ppr.promocao_id = po.id) AS produtos
  FROM public.promocoes po
  WHERE po.ativo
    AND po.starts_at <= now()
    AND (po.ends_at IS NULL OR po.ends_at >= now())
    AND (
      NOT EXISTS (SELECT 1 FROM public.promocao_provincias pp WHERE pp.promocao_id = po.id)
      OR (p_provincia IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.promocao_provincias pp
            WHERE pp.promocao_id = po.id AND pp.provincia_id = p_provincia))
    )
  ORDER BY po.starts_at DESC;
$$;

-- -----------------------------------------------------------------------------
-- 4. GESTÃO DAS PROMOÇÕES (só gestão)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_promocao(
  p_nome       text,
  p_tipo       text,
  p_valor      numeric,
  p_starts_at  timestamptz DEFAULT NULL,
  p_ends_at    timestamptz DEFAULT NULL,
  p_provincias uuid[]      DEFAULT NULL,
  p_produtos   uuid[]      DEFAULT NULL,
  p_descricao  text        DEFAULT NULL,
  p_ativo      boolean     DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode criar promoções' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(btrim(p_nome), '') = '' THEN
    RAISE EXCEPTION 'Indique o nome da promoção';
  END IF;

  IF p_tipo NOT IN ('percentagem', 'preco') THEN
    RAISE EXCEPTION 'Tipo de promoção inválido';
  END IF;

  IF p_valor IS NULL OR p_valor < 0 THEN
    RAISE EXCEPTION 'Valor da promoção inválido';
  END IF;

  IF p_tipo = 'percentagem' AND p_valor > 100 THEN
    RAISE EXCEPTION 'O desconto não pode passar dos 100 %%';
  END IF;

  INSERT INTO public.promocoes (nome, descricao, tipo, valor, starts_at, ends_at, ativo, created_by)
  VALUES (
    btrim(p_nome),
    NULLIF(btrim(COALESCE(p_descricao, '')), ''),
    p_tipo,
    p_valor,
    COALESCE(p_starts_at, now()),
    p_ends_at,
    COALESCE(p_ativo, true),
    auth.uid()
  )
  RETURNING id INTO v_id;

  -- Âmbito: sem elementos = nacional / todo o catálogo.
  IF p_provincias IS NOT NULL AND array_length(p_provincias, 1) > 0 THEN
    INSERT INTO public.promocao_provincias (promocao_id, provincia_id)
    SELECT v_id, unnest(p_provincias)
    ON CONFLICT DO NOTHING;
  END IF;

  IF p_produtos IS NOT NULL AND array_length(p_produtos, 1) > 0 THEN
    INSERT INTO public.promocao_produtos (promocao_id, product_id)
    SELECT v_id, unnest(p_produtos)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'nome', btrim(p_nome));
END;
$$;

CREATE OR REPLACE FUNCTION public.actualizar_promocao(
  p_id         uuid,
  p_nome       text        DEFAULT NULL,
  p_tipo       text        DEFAULT NULL,
  p_valor      numeric     DEFAULT NULL,
  p_starts_at  timestamptz DEFAULT NULL,
  p_ends_at    timestamptz DEFAULT NULL,
  p_provincias uuid[]      DEFAULT NULL,
  p_produtos   uuid[]      DEFAULT NULL,
  p_descricao  text        DEFAULT NULL,
  p_ativo      boolean     DEFAULT NULL,
  p_limpar_fim boolean     DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode alterar promoções' USING ERRCODE = '42501';
  END IF;

  UPDATE public.promocoes po
  SET nome       = COALESCE(NULLIF(btrim(COALESCE(p_nome, '')), ''), po.nome),
      descricao  = CASE WHEN p_descricao IS NULL THEN po.descricao
                        ELSE NULLIF(btrim(p_descricao), '') END,
      tipo       = COALESCE(p_tipo, po.tipo),
      valor      = COALESCE(p_valor, po.valor),
      starts_at  = COALESCE(p_starts_at, po.starts_at),
      ends_at    = CASE WHEN p_limpar_fim THEN NULL
                        ELSE COALESCE(p_ends_at, po.ends_at) END,
      ativo      = COALESCE(p_ativo, po.ativo),
      updated_at = now()
  WHERE po.id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promoção inexistente';
  END IF;

  -- Âmbito só muda quando o parâmetro vem: `NULL` = «não mexas».
  IF p_provincias IS NOT NULL THEN
    DELETE FROM public.promocao_provincias WHERE promocao_id = p_id;
    IF array_length(p_provincias, 1) > 0 THEN
      INSERT INTO public.promocao_provincias (promocao_id, provincia_id)
      SELECT p_id, unnest(p_provincias) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF p_produtos IS NOT NULL THEN
    DELETE FROM public.promocao_produtos WHERE promocao_id = p_id;
    IF array_length(p_produtos, 1) > 0 THEN
      INSERT INTO public.promocao_produtos (promocao_id, product_id)
      SELECT p_id, unnest(p_produtos) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object('id', p_id, 'ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.eliminar_promocao(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode eliminar promoções' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.promocoes WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promoção inexistente';
  END IF;

  RETURN jsonb_build_object('id', p_id, 'eliminada', true);
END;
$$;

-- Lista completa para a gestão (inclui agendadas e desactivadas).
CREATE OR REPLACE FUNCTION public.promocoes_lista()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(linha ORDER BY linha->>'starts_at' DESC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
             'id',         po.id,
             'nome',       po.nome,
             'descricao',  po.descricao,
             'tipo',       po.tipo,
             'valor',      po.valor,
             'starts_at',  po.starts_at,
             'ends_at',    po.ends_at,
             'ativo',      po.ativo,
             'vigente',    po.ativo AND po.starts_at <= now()
                            AND (po.ends_at IS NULL OR po.ends_at >= now()),
             'nacional',   NOT EXISTS (SELECT 1 FROM public.promocao_provincias pp WHERE pp.promocao_id = po.id),
             'provincia_ids', COALESCE(ARRAY(
                SELECT pp.provincia_id FROM public.promocao_provincias pp WHERE pp.promocao_id = po.id
             ), ARRAY[]::uuid[]),
             'provincias', COALESCE(ARRAY(
                SELECT pr.nome FROM public.promocao_provincias pp
                JOIN public.provincias pr ON pr.id = pp.provincia_id
                WHERE pp.promocao_id = po.id ORDER BY pr.nome
             ), ARRAY[]::text[]),
             'product_ids', COALESCE(ARRAY(
                SELECT ppr.product_id FROM public.promocao_produtos ppr WHERE ppr.promocao_id = po.id
             ), ARRAY[]::uuid[]),
             'produtos',   (SELECT COUNT(*)::int FROM public.promocao_produtos ppr WHERE ppr.promocao_id = po.id)
           ) AS linha
    FROM public.promocoes po
    WHERE public.is_manager()
  ) t;
$$;

-- -----------------------------------------------------------------------------
-- 5. ENTREGA: «POR DEFINIR» FORA DO UÍGE
-- -----------------------------------------------------------------------------
-- A taxa deixa de ter um valor inventado por omissão. Sem configuração, só o
-- Uíge é gratuito; nas outras províncias `taxa_entrega` devolve NULL e a
-- encomenda fica com a taxa pendente.
INSERT INTO public.platform_settings (key, value)
VALUES ('entrega', '{"taxaPadrao": null, "gratis": ["uige"], "nota": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_fee_pendente boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.delivery_fee_pendente IS
  'true = a entrega ainda não tem preço definido (província sem taxa configurada). delivery_fee fica 0 até a gestão a definir.';

CREATE OR REPLACE FUNCTION public.taxa_entrega(p_provincia uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_def  jsonb;
  v_slug text;
BEGIN
  SELECT value INTO v_def FROM public.platform_settings WHERE key = 'entrega';

  IF v_def IS NULL OR jsonb_typeof(v_def) <> 'object' THEN
    v_def := '{"taxaPadrao": null, "gratis": ["uige"]}'::jsonb;
  END IF;

  IF p_provincia IS NOT NULL THEN
    SELECT pr.slug INTO v_slug FROM public.provincias pr WHERE pr.id = p_provincia;
  END IF;

  -- Província isenta (por omissão, o Uíge): entrega gratuita.
  IF v_slug IS NOT NULL
     AND jsonb_typeof(COALESCE(v_def->'gratis', '[]'::jsonb)) = 'array'
     AND (COALESCE(v_def->'gratis', '[]'::jsonb) @> to_jsonb(v_slug)) THEN
    RETURN 0;
  END IF;

  -- Sem taxa configurada devolve-se NULL — «por definir». Não é 0: zero é
  -- entrega grátis, e oferecer portes fora do Uíge não foi decidido.
  IF jsonb_typeof(v_def->'taxaPadrao') <> 'number' THEN
    RETURN NULL;
  END IF;

  RETURN GREATEST((v_def->>'taxaPadrao')::numeric, 0);
END;
$$;

-- Estado da entrega para quem está a ver (a app do telemóvel usa esta).
CREATE OR REPLACE FUNCTION public.minha_entrega()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prov uuid := public.my_province();
  v_taxa numeric;
BEGIN
  v_taxa := public.taxa_entrega(v_prov);

  RETURN jsonb_build_object(
    'provincia_id', v_prov,
    'taxa',         v_taxa,
    'gratis',       (v_taxa IS NOT NULL AND v_taxa = 0),
    'por_definir',  (v_taxa IS NULL)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. LEVANTAMENTOS
-- -----------------------------------------------------------------------------
-- O pedido do colaborador. O pagamento em si continua a ser uma linha em
-- `commission_payouts` — este registo é o pedido, com o seu estado.
CREATE TABLE IF NOT EXISTS public.levantamentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referencia      text UNIQUE,
  seller_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provincia_id    uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  valor           numeric(12,2) NOT NULL CHECK (valor > 0),
  metodo          text NOT NULL,
  dados           jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado          public.levantamento_status NOT NULL DEFAULT 'pendente',
  notas           text,
  motivo_rejeicao text,
  payout_id       uuid REFERENCES public.commission_payouts(id) ON DELETE SET NULL,
  solicitado_em   timestamptz NOT NULL DEFAULT now(),
  decidido_por    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decidido_em     timestamptz,
  processado_em   timestamptz,
  pago_em         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT levantamentos_metodo_valido CHECK (metodo IN ('xpress', 'transferencia'))
);

CREATE INDEX IF NOT EXISTS idx_levantamentos_seller ON public.levantamentos (seller_id, solicitado_em DESC);
CREATE INDEX IF NOT EXISTS idx_levantamentos_estado ON public.levantamentos (estado, solicitado_em DESC);
CREATE INDEX IF NOT EXISTS idx_levantamentos_prov   ON public.levantamentos (provincia_id, estado);

-- Sequência das referências `LEV-2026-00001`.
CREATE SEQUENCE IF NOT EXISTS public.levantamento_seq START 1;

-- Dados de recebimento guardados no perfil do colaborador. Ficam em
-- `seller_profiles`, que já só é legível pelo próprio ou pela gestão — é o
-- sítio certo para dados bancários, e não uma tabela nova com RLS nova.
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS xpress_dados jsonb,
  ADD COLUMN IF NOT EXISTS banco_dados  jsonb;

-- ---------------------------------------------------------------- 6.1 SALDO
-- O saldo nunca é guardado: é sempre recalculado. Um número guardado fica
-- errado no dia em que uma venda é cancelada ou uma comissão muda.
--
--   ganho     = comissões de vendas CONCLUÍDAS e PAGAS
--   pendente  = comissões de vendas ainda não pagas (não levantáveis)
--   pago      = soma dos pagamentos já feitos (`commission_payouts`)
--   reservado = pedidos em curso (pendente/aprovado/em_processamento)
--   disponível = ganho − pago − reservado
CREATE OR REPLACE FUNCTION public.levantamento_resumo(p_seller uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_minimo    int := 5;
  v_vendas    int;
  v_ganho     numeric(12,2);
  v_pendente  numeric(12,2);
  v_pago      numeric(12,2);
  v_reservado numeric(12,2);
  v_disponivel numeric(12,2);
  v_cfg       jsonb;
BEGIN
  IF p_seller IS DISTINCT FROM auth.uid() AND NOT public.is_manager() THEN
    RAISE EXCEPTION 'Sem permissão para ver o saldo de outra pessoa' USING ERRCODE = '42501';
  END IF;

  SELECT value INTO v_cfg FROM public.platform_settings WHERE key = 'levantamento';
  IF v_cfg IS NOT NULL AND jsonb_typeof(v_cfg->'vendas_minimas') = 'number' THEN
    v_minimo := GREATEST((v_cfg->>'vendas_minimas')::int, 0);
  END IF;

  -- Vendas confirmadas e pagas: é o que conta para o desbloqueio.
  SELECT COUNT(*)::int INTO v_vendas
  FROM public.sales s
  WHERE s.seller_id = p_seller
    AND s.status = 'completed'
    AND s.payment_status = 'paid';

  SELECT COALESCE(SUM(c.amount), 0) INTO v_ganho
  FROM public.sale_commissions c
  JOIN public.sales s ON s.id = c.sale_id
  WHERE c.seller_id = p_seller
    AND c.status <> 'cancelled'
    AND s.status = 'completed'
    AND s.payment_status = 'paid';

  -- Ainda por pagar ao colaborador: vendas por confirmar/pagar, e vendas
  -- canceladas ficam de fora (o gatilho marca-as 'cancelled').
  SELECT COALESCE(SUM(c.amount), 0) INTO v_pendente
  FROM public.sale_commissions c
  JOIN public.sales s ON s.id = c.sale_id
  WHERE c.seller_id = p_seller
    AND c.status <> 'cancelled'
    AND NOT (s.status = 'completed' AND s.payment_status = 'paid');

  SELECT COALESCE(SUM(p.amount), 0) INTO v_pago
  FROM public.commission_payouts p
  WHERE p.seller_id = p_seller;

  SELECT COALESCE(SUM(l.valor), 0) INTO v_reservado
  FROM public.levantamentos l
  WHERE l.seller_id = p_seller
    AND l.estado IN ('pendente', 'aprovado', 'em_processamento');

  v_disponivel := GREATEST(v_ganho - v_pago - v_reservado, 0);

  RETURN jsonb_build_object(
    'seller_id',       p_seller,
    'vendas_pagas',    v_vendas,
    'vendas_minimas',  v_minimo,
    'vendas_faltam',   GREATEST(v_minimo - v_vendas, 0),
    'habilitado',      v_vendas >= v_minimo,
    'comissoes_ganhas',   v_ganho,
    'comissoes_pendentes', v_pendente,
    'total_pago',      v_pago,
    'reservado',       v_reservado,
    'disponivel',      v_disponivel,
    'taxa',            public.taxa_comissao_efetiva(p_seller)
  );
END;
$$;

-- ------------------------------------------------- 6.2 HISTÓRICO DE VENDAS
CREATE OR REPLACE FUNCTION public.minhas_comissoes(p_limite int DEFAULT 100)
RETURNS TABLE (
  sale_id     uuid,
  referencia  text,
  criada_em   timestamptz,
  total       numeric,
  taxa        numeric,
  comissao    numeric,
  estado      text,
  provincia   text,
  metodo      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT s.id,
         s.reference,
         s.created_at,
         s.total_amount,
         c.rate,
         c.amount,
         CASE
           WHEN c.status = 'cancelled' THEN 'cancelada'
           WHEN s.status = 'cancelled' THEN 'cancelada'
           WHEN s.payment_status <> 'paid' THEN 'pendente'
           WHEN c.status = 'paid' THEN 'paga'
           ELSE 'disponivel'
         END,
         pr.nome,
         s.payment_method
  FROM public.sale_commissions c
  JOIN public.sales s ON s.id = c.sale_id
  LEFT JOIN public.provincias pr ON pr.id = c.provincia_id
  WHERE c.seller_id = auth.uid()
  ORDER BY s.created_at DESC
  LIMIT GREATEST(COALESCE(p_limite, 100), 1);
$$;

-- ------------------------------------------------------- 6.3 DADOS DE RECEBIMENTO
CREATE OR REPLACE FUNCTION public.dados_recebimento()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  RETURN COALESCE(
    (SELECT jsonb_build_object('xpress', sp.xpress_dados, 'banco', sp.banco_dados)
     FROM public.seller_profiles sp WHERE sp.id = v_uid),
    '{"xpress": null, "banco": null}'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.guardar_dados_recebimento(
  p_metodo text,
  p_dados  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF p_metodo NOT IN ('xpress', 'transferencia') THEN
    RAISE EXCEPTION 'Método de recebimento inválido';
  END IF;

  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    RAISE EXCEPTION 'Dados de recebimento inválidos';
  END IF;

  -- A linha do colaborador pode não existir (vendedor de loja não tem). Só se
  -- cria para quem vende por carteira; os restantes não recebem comissão.
  INSERT INTO public.seller_profiles (id) VALUES (v_uid)
  ON CONFLICT (id) DO NOTHING;

  IF p_metodo = 'xpress' THEN
    UPDATE public.seller_profiles SET xpress_dados = p_dados, updated_at = now() WHERE id = v_uid;
  ELSE
    UPDATE public.seller_profiles SET banco_dados = p_dados, updated_at = now() WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'metodo', p_metodo);
END;
$$;

-- ------------------------------------------------------------ 6.4 PEDIR
CREATE OR REPLACE FUNCTION public.solicitar_levantamento(
  p_valor  numeric,
  p_metodo text,
  p_dados  jsonb DEFAULT NULL,
  p_notas  text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_resumo    jsonb;
  v_disponivel numeric;
  v_dados     jsonb;
  v_prov      uuid;
  v_id        uuid;
  v_ref       text;
  v_abertos   int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  -- Um pedido de cada vez por colaborador: dois cliques ao mesmo tempo não
  -- podem reservar o mesmo saldo duas vezes.
  PERFORM pg_advisory_xact_lock(hashtext('levantamento:' || v_uid::text));

  IF NOT public.is_seller() THEN
    RAISE EXCEPTION 'Apenas colaboradores com comissões podem levantar' USING ERRCODE = '42501';
  END IF;

  IF p_metodo NOT IN ('xpress', 'transferencia') THEN
    RAISE EXCEPTION 'Escolha o método de recebimento';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Indique um valor válido';
  END IF;

  v_resumo := public.levantamento_resumo(v_uid);

  IF NOT (v_resumo->>'habilitado')::boolean THEN
    RAISE EXCEPTION 'Faltam % vendas confirmadas e pagas para poder levantar',
      (v_resumo->>'vendas_faltam')::int USING ERRCODE = '42501';
  END IF;

  -- Dados: usa os enviados ou, se não vierem, os que estão guardados.
  v_dados := NULLIF(p_dados, 'null'::jsonb);
  IF v_dados IS NULL OR jsonb_typeof(v_dados) <> 'object' OR v_dados = '{}'::jsonb THEN
    SELECT CASE WHEN p_metodo = 'xpress' THEN sp.xpress_dados ELSE sp.banco_dados END
      INTO v_dados
    FROM public.seller_profiles sp WHERE sp.id = v_uid;
  END IF;

  IF v_dados IS NULL OR jsonb_typeof(v_dados) <> 'object' OR v_dados = '{}'::jsonb THEN
    RAISE EXCEPTION 'Indique os dados de recebimento';
  END IF;

  -- Validação mínima do destino, para não mandar dinheiro para o vazio.
  IF p_metodo = 'xpress' THEN
    IF COALESCE(btrim(v_dados->>'conta'), '') = ''
       AND COALESCE(btrim(v_dados->>'telefone'), '') = '' THEN
      RAISE EXCEPTION 'Indique a conta ou o telefone XPRESS';
    END IF;
  ELSE
    IF COALESCE(btrim(v_dados->>'titular'), '') = ''
       OR COALESCE(btrim(v_dados->>'banco'), '') = ''
       OR COALESCE(btrim(v_dados->>'conta'), '') = '' THEN
      RAISE EXCEPTION 'Indique o titular, o banco e o número de conta';
    END IF;
  END IF;

  v_disponivel := (v_resumo->>'disponivel')::numeric;

  IF p_valor > v_disponivel THEN
    RAISE EXCEPTION 'O valor pedido (%,00 Kz) é superior ao disponível (% Kz)',
      round(p_valor), round(v_disponivel) USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::int INTO v_abertos
  FROM public.levantamentos l
  WHERE l.seller_id = v_uid AND l.estado IN ('pendente', 'aprovado', 'em_processamento');

  IF v_abertos > 0 THEN
    RAISE EXCEPTION 'Já tem um levantamento em curso. Aguarde a decisão da gestão.';
  END IF;

  SELECT p.provincia_id INTO v_prov FROM public.profiles p WHERE p.id = v_uid;

  v_ref := 'LEV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.levantamento_seq')::text, 5, '0');

  INSERT INTO public.levantamentos (referencia, seller_id, provincia_id, valor, metodo, dados, notas)
  VALUES (v_ref, v_uid, v_prov, round(p_valor, 2), p_metodo, v_dados,
          NULLIF(btrim(COALESCE(p_notas, '')), ''))
  RETURNING id INTO v_id;

  -- Guarda os dados para a próxima vez (o colaborador não os escreve duas vezes).
  IF p_metodo = 'xpress' THEN
    UPDATE public.seller_profiles SET xpress_dados = v_dados, updated_at = now() WHERE id = v_uid;
  ELSE
    UPDATE public.seller_profiles SET banco_dados = v_dados, updated_at = now() WHERE id = v_uid;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, new_data)
  VALUES (v_uid, 'levantamento_pedido', 'levantamentos', v_id,
          jsonb_build_object('valor', round(p_valor, 2), 'metodo', p_metodo, 'referencia', v_ref));

  RETURN jsonb_build_object(
    'id', v_id,
    'referencia', v_ref,
    'valor', round(p_valor, 2),
    'metodo', p_metodo,
    'estado', 'pendente',
    'resumo', public.levantamento_resumo(v_uid)
  );
END;
$$;

-- ------------------------------------------------------- 6.5 DECIDIR
CREATE OR REPLACE FUNCTION public.decidir_levantamento(
  p_id      uuid,
  p_estado  public.levantamento_status,
  p_nota    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_lev    public.levantamentos;
  v_payout uuid;
  v_ok     boolean := false;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode decidir levantamentos' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lev FROM public.levantamentos l WHERE l.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Levantamento inexistente';
  END IF;

  IF NOT public.can_manage_province(v_lev.provincia_id) THEN
    RAISE EXCEPTION 'Só pode gerir levantamentos da província que gere' USING ERRCODE = '42501';
  END IF;

  -- Transições permitidas. Um pedido pago é final; um rejeitado também.
  v_ok := CASE v_lev.estado
            WHEN 'pendente'         THEN p_estado IN ('aprovado', 'rejeitado')
            WHEN 'aprovado'         THEN p_estado IN ('em_processamento', 'rejeitado')
            WHEN 'em_processamento' THEN p_estado IN ('pago', 'rejeitado')
            ELSE false
          END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Não é possível passar de % para %', v_lev.estado, p_estado;
  END IF;

  IF p_estado = 'rejeitado' AND COALESCE(btrim(COALESCE(p_nota, '')), '') = '' THEN
    RAISE EXCEPTION 'Indique o motivo da rejeição';
  END IF;

  -- Marcar como PAGO é o único passo que mexe no dinheiro. Aprovar não paga
  -- nada: só liberta o pedido para processamento.
  IF p_estado = 'pago' THEN
    INSERT INTO public.commission_payouts (seller_id, provincia_id, amount, method, notes, paid_by)
    VALUES (
      v_lev.seller_id,
      v_lev.provincia_id,
      v_lev.valor,
      v_lev.metodo,
      'Levantamento ' || COALESCE(v_lev.referencia, v_lev.id::text),
      auth.uid()
    )
    RETURNING id INTO v_payout;

    -- Fecha as comissões por ordem de antiguidade até cobrir o valor. Uma
    -- comissão maior do que o resto fica pendente e é paga no pedido seguinte.
    WITH pend AS (
      SELECT c.id,
             SUM(c.amount) OVER (ORDER BY c.created_at, c.id) AS acumulado
      FROM public.sale_commissions c
      JOIN public.sales s ON s.id = c.sale_id
      WHERE c.seller_id = v_lev.seller_id
        AND c.status = 'pending'
        AND c.amount > 0
        AND s.status = 'completed'
        AND s.payment_status = 'paid'
    )
    UPDATE public.sale_commissions c
    SET status = 'paid', paid_at = now(), payout_id = v_payout, updated_at = now()
    FROM pend
    WHERE c.id = pend.id AND pend.acumulado <= v_lev.valor;
  END IF;

  UPDATE public.levantamentos l
  SET estado          = p_estado,
      notas           = COALESCE(NULLIF(btrim(COALESCE(p_nota, '')), ''), l.notas),
      motivo_rejeicao = CASE WHEN p_estado = 'rejeitado' THEN btrim(p_nota) ELSE l.motivo_rejeicao END,
      payout_id       = COALESCE(v_payout, l.payout_id),
      decidido_por    = auth.uid(),
      decidido_em     = COALESCE(l.decidido_em, now()),
      processado_em   = CASE WHEN p_estado = 'em_processamento' THEN now() ELSE l.processado_em END,
      pago_em         = CASE WHEN p_estado = 'pago' THEN now() ELSE l.pago_em END,
      updated_at      = now()
  WHERE l.id = p_id;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, old_data, new_data)
  VALUES (auth.uid(), 'levantamento_' || p_estado::text, 'levantamentos', p_id,
          jsonb_build_object('estado', v_lev.estado),
          jsonb_build_object('estado', p_estado, 'valor', v_lev.valor, 'nota', p_nota));

  RETURN jsonb_build_object(
    'id', p_id,
    'estado', p_estado,
    'payout_id', v_payout,
    'resumo', public.levantamento_resumo(v_lev.seller_id)
  );
END;
$$;

-- ------------------------------------------------------- 6.6 CONSULTAS
CREATE OR REPLACE FUNCTION public.meus_levantamentos(p_limite int DEFAULT 50)
RETURNS TABLE (
  id            uuid,
  referencia    text,
  valor         numeric,
  metodo        text,
  estado        public.levantamento_status,
  solicitado_em timestamptz,
  pago_em       timestamptz,
  motivo        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT l.id, l.referencia, l.valor, l.metodo, l.estado,
         l.solicitado_em, l.pago_em,
         COALESCE(l.motivo_rejeicao, l.notas)
  FROM public.levantamentos l
  WHERE l.seller_id = auth.uid()
  ORDER BY l.solicitado_em DESC
  LIMIT GREATEST(COALESCE(p_limite, 50), 1);
$$;

-- Painel da gestão: todos os pedidos, com quem pediu e para onde vai o dinheiro.
CREATE OR REPLACE FUNCTION public.levantamentos_equipa(p_estado text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF NOT public.is_manager() THEN
    RAISE EXCEPTION 'Apenas a gestão pode ver os levantamentos' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(linha ORDER BY (linha->>'solicitado_em') DESC), '[]'::jsonb)
  INTO v_res
  FROM (
    SELECT jsonb_build_object(
             'id',            l.id,
             'referencia',    l.referencia,
             'valor',         l.valor,
             'metodo',        l.metodo,
             'estado',        l.estado,
             'dados',         l.dados,
             'notas',         l.notas,
             'motivo',        l.motivo_rejeicao,
             'solicitado_em', l.solicitado_em,
             'pago_em',       l.pago_em,
             'seller_id',     l.seller_id,
             'seller_nome',   p.full_name,
             'seller_ref',    p.referencia,
             'seller_phone',  p.phone,
             'provincia',     pr.nome
           ) AS linha
    FROM public.levantamentos l
    JOIN public.profiles p   ON p.id  = l.seller_id
    LEFT JOIN public.provincias pr ON pr.id = l.provincia_id
    WHERE public.can_manage_province(l.provincia_id)
      AND (p_estado IS NULL OR l.estado::text = p_estado)
  ) t;

  RETURN v_res;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. `pagar_comissoes` PASSA A RESPEITAR VENDAS NÃO PAGAS
-- -----------------------------------------------------------------------------
-- Antes pagava qualquer comissão pendente, mesmo de uma venda por receber.
-- O requisito é claro: só contam vendas confirmadas e pagas.
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

  SELECT COALESCE(SUM(c.amount), 0), COUNT(*)
    INTO v_total, v_qtd
  FROM public.sale_commissions c
  JOIN public.sales s ON s.id = c.sale_id
  WHERE c.seller_id = p_seller_id
    AND c.status = 'pending'
    AND c.amount > 0
    AND s.status = 'completed'
    AND s.payment_status = 'paid';

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Não há comissões pendentes';
  END IF;

  INSERT INTO public.commission_payouts (seller_id, provincia_id, amount, method, notes, paid_by)
  VALUES (p_seller_id, v_prov, v_total, p_method, p_notes, auth.uid())
  RETURNING id INTO v_payout;

  UPDATE public.sale_commissions c
  SET status = 'paid', paid_at = now(), payout_id = v_payout, updated_at = now()
  FROM public.sales s
  WHERE s.id = c.sale_id
    AND c.seller_id = p_seller_id
    AND c.status = 'pending'
    AND c.amount > 0
    AND s.status = 'completed'
    AND s.payment_status = 'paid';

  RETURN jsonb_build_object('payout_id', v_payout, 'amount', v_total, 'comissoes', v_qtd);
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. `place_order` COBRA O PREÇO DA PROMOÇÃO DA PROVÍNCIA
-- -----------------------------------------------------------------------------
-- Antes lia `products.official_price` directamente. Passa a usar
-- `preco_efetivo()`, que já tem em conta as campanhas da província do cliente.
CREATE OR REPLACE FUNCTION public.place_order(
  p_items            jsonb,
  p_delivery_method  text DEFAULT 'pickup',
  p_delivery_address text DEFAULT NULL,
  p_contact_phone    text DEFAULT NULL,
  p_notes            text DEFAULT NULL,
  p_client_ref       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_order_id uuid;
  v_ref      text;
  v_item     jsonb;
  v_prod     record;
  v_inv      record;
  v_prov     uuid;
  v_qty      int;
  v_price    numeric(12,2);
  v_total    numeric(12,2) := 0;
  v_taxa     numeric(12,2);
  v_pendente boolean := false;
  v_existing public.orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'É necessário iniciar sessão' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_customer() THEN
    RAISE EXCEPTION 'Apenas clientes podem criar encomendas' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'O carrinho está vazio';
  END IF;

  IF p_delivery_method NOT IN ('pickup', 'delivery') THEN
    RAISE EXCEPTION 'Modalidade de entrega inválida';
  END IF;

  IF p_delivery_method = 'delivery' AND COALESCE(btrim(p_delivery_address), '') = '' THEN
    RAISE EXCEPTION 'Indique o endereço de entrega';
  END IF;

  IF p_client_ref IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.orders o
    WHERE o.customer_id = v_uid AND o.client_ref = p_client_ref;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id', v_existing.id,
        'reference', v_existing.reference,
        'total', v_existing.total_amount,
        'delivery_fee', v_existing.delivery_fee,
        'delivery_fee_pendente', v_existing.delivery_fee_pendente,
        'duplicated', true
      );
    END IF;
  END IF;

  v_ref := public.generate_order_reference();
  v_prov := public.my_province();

  -- Levantamento na delegação não paga entrega. Só a entrega ao domicílio
  -- paga — e só quando a província tem taxa definida. NULL = por definir.
  IF p_delivery_method = 'delivery' THEN
    v_taxa := public.taxa_entrega(v_prov);
    IF v_taxa IS NULL THEN
      v_taxa := 0;
      v_pendente := true;
    END IF;
  ELSE
    v_taxa := 0;
  END IF;

  INSERT INTO public.orders (
    reference, client_ref, customer_id, status, delivery_method,
    delivery_address, contact_phone, notes, payment_status, provincia_id,
    delivery_fee, delivery_fee_pendente
  )
  VALUES (
    v_ref, p_client_ref, v_uid, 'pending', p_delivery_method,
    NULLIF(btrim(p_delivery_address), ''), NULLIF(btrim(p_contact_phone), ''),
    NULLIF(btrim(p_notes), ''), 'pending', v_prov,
    v_taxa, v_pendente
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida';
    END IF;

    SELECT p.id, p.name, p.official_price, p.promotional_price, p.is_active, p.provincia_id
      INTO v_prod
    FROM public.products p
    WHERE p.id = (v_item->>'product_id')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto inexistente';
    END IF;

    IF NOT v_prod.is_active THEN
      RAISE EXCEPTION 'Produto indisponível: %', v_prod.name;
    END IF;

    -- Produto provincial só se vende na sua província.
    IF v_prod.provincia_id IS NOT NULL AND v_prod.provincia_id IS DISTINCT FROM v_prov THEN
      RAISE EXCEPTION 'O produto % não está disponível na sua província', v_prod.name
        USING ERRCODE = '42501';
    END IF;

    -- O preço é o da promoção que se aplica à província do cliente. A regra
    -- vive em `preco_efetivo()`; aqui não se repete.
    v_price := public.preco_efetivo(v_prod.id, v_prov);

    -- Linha de stock: a da província do cliente; se não existir, a da sede.
    SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
    FROM public.inventory i
    WHERE i.product_id = v_prod.id
      AND i.provincia_id IS NOT DISTINCT FROM v_prov
    LIMIT 1;

    IF NOT FOUND AND v_prov IS NOT NULL THEN
      SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
      FROM public.inventory i
      WHERE i.product_id = v_prod.id AND i.provincia_id IS NULL
      LIMIT 1;
    END IF;

    -- Última tentativa: o armazém-sede.
    IF v_inv.id IS NULL THEN
      SELECT i.id, i.quantity, i.reserved_quantity INTO v_inv
      FROM public.inventory i
      JOIN public.provincias pr ON pr.id = i.provincia_id
      WHERE i.product_id = v_prod.id AND pr.is_default
      ORDER BY i.updated_at DESC
      LIMIT 1;
    END IF;

    IF v_inv.id IS NOT NULL THEN
      UPDATE public.inventory i
      SET reserved_quantity = i.reserved_quantity + v_qty,
          updated_at = now()
      WHERE i.id = v_inv.id
        AND (i.quantity - i.reserved_quantity) >= v_qty;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente para %', v_prod.name;
      END IF;
    END IF;

    INSERT INTO public.order_items (order_id, product_id, product_name, quantity, unit_price, total_price)
    VALUES (v_order_id, v_prod.id, v_prod.name, v_qty, v_price, round(v_price * v_qty, 2));
  END LOOP;

  -- `recalc_order_total` já correu a cada linha e somou a taxa; este SELECT
  -- só serve para devolver ao cliente o mesmo número que ficou gravado.
  SELECT COALESCE(o.total_amount, 0) INTO v_total
  FROM public.orders o WHERE o.id = v_order_id;

  INSERT INTO public.order_status_history (order_id, status, previous_status, changed_by, notes)
  VALUES (v_order_id, 'pending', NULL, v_uid, 'Encomenda criada');

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'reference', v_ref,
    'total', v_total,
    'delivery_fee', v_taxa,
    'delivery_fee_pendente', v_pendente,
    'duplicated', false
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. RLS E ACESSOS
-- -----------------------------------------------------------------------------
ALTER TABLE public.promocoes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocao_provincias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocao_produtos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.levantamentos       ENABLE ROW LEVEL SECURITY;

-- Promoções: toda a gente lê as que estão a decorrer; a gestão lê tudo.
DROP POLICY IF EXISTS promocoes_select ON public.promocoes;
CREATE POLICY promocoes_select ON public.promocoes
  FOR SELECT TO authenticated, anon
  USING (
    (ativo AND starts_at <= now() AND (ends_at IS NULL OR ends_at >= now()))
    OR public.is_manager()
  );

DROP POLICY IF EXISTS promocoes_manager_write ON public.promocoes;
CREATE POLICY promocoes_manager_write ON public.promocoes
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS promocao_provincias_select ON public.promocao_provincias;
CREATE POLICY promocao_provincias_select ON public.promocao_provincias
  FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS promocao_provincias_manager_write ON public.promocao_provincias;
CREATE POLICY promocao_provincias_manager_write ON public.promocao_provincias
  FOR ALL TO authenticated
  USING (public.is_manager()) WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS promocao_produtos_select ON public.promocao_produtos;
CREATE POLICY promocao_produtos_select ON public.promocao_produtos
  FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS promocao_produtos_manager_write ON public.promocao_produtos;
CREATE POLICY promocao_produtos_manager_write ON public.promocao_produtos
  FOR ALL TO authenticated
  USING (public.is_manager()) WITH CHECK (public.is_manager());

-- Levantamentos: o colaborador vê os seus; a gestão vê os da sua província.
-- Não há INSERT/UPDATE directo: só pelas funções acima, que validam o saldo.
DROP POLICY IF EXISTS levantamentos_select ON public.levantamentos;
CREATE POLICY levantamentos_select ON public.levantamentos
  FOR SELECT TO authenticated
  USING (
    seller_id = auth.uid()
    OR (public.is_manager() AND public.can_see_province(provincia_id))
  );

GRANT SELECT ON public.promocoes           TO anon, authenticated;
GRANT SELECT ON public.promocao_provincias TO anon, authenticated;
GRANT SELECT ON public.promocao_produtos   TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.promocao_do_produto(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preco_efetivo(uuid, uuid)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promocoes_vigentes(uuid)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promocoes_lista()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_promocao(text, text, numeric, timestamptz, timestamptz, uuid[], uuid[], text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_promocao(uuid, text, text, numeric, timestamptz, timestamptz, uuid[], uuid[], text, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_promocao(uuid)         TO authenticated;

GRANT EXECUTE ON FUNCTION public.taxa_entrega(uuid)              TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.minha_entrega()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.levantamento_resumo(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.minhas_comissoes(int)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.meus_levantamentos(int)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.levantamentos_equipa(text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.dados_recebimento()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_dados_recebimento(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.solicitar_levantamento(numeric, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decidir_levantamento(uuid, public.levantamento_status, text) TO authenticated;

-- Os dados bancários não saem para ninguém além do próprio e da gestão:
-- `seller_profiles` já tem essa política desde a 0001, mas reforça-se aqui a
-- coluna, que é a mais sensível da tabela.
COMMENT ON COLUMN public.seller_profiles.banco_dados IS
  'Coordenadas bancárias do colaborador para levantamentos. Visível só ao próprio e à gestão (RLS de seller_profiles).';
COMMENT ON COLUMN public.seller_profiles.xpress_dados IS
  'Conta/telefone XPRESS do colaborador para levantamentos. Visível só ao próprio e à gestão.';
