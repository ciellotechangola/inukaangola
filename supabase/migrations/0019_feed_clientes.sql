-- =============================================================================
-- 0019 — FEED CLIENTES: COMUNICADOS SÓ PARA A EQUIPA
-- =============================================================================
-- A 0013 abriu os comunicados aos clientes de propósito: na altura o feed do
-- cliente era uma lista única e o comunicado era o que a gestão publicava. Com
-- o feed separado, o cliente passa a ter o «Feed Clientes» — promoções e
-- testemunhos — e o comunicado volta a ser o que sempre foi: um aviso interno.
--
-- O que muda, em concreto:
--
--   1. `kind_so_equipa(kind)` e `pode_ver_kind(kind)` passam a ser a **única**
--      definição de que tipos são internos. Hoje são dois — `comunicado` e
--      `formacao` — mas a regra fica num sítio só, para o próximo tipo não
--      obrigar a mexer em quatro sítios outra vez.
--   2. `pode_ver_conteudo`, a política `content_items_read` e `conteudo_feed`
--      passam a usar essa função. As três concordavam por copy-paste; agora
--      concordam por construção.
--   3. `conteudo_reacoes(item)` dá à gestão a lista de **quem** reagiu. A
--      tabela `content_reactions` já guardava `user_id` desde a 0007 — o que
--      faltava era uma leitura com nome, telefone e província (o `user_id`
--      aponta para `auth.users`, e o PostgREST não consegue embutir `profiles`
--      a partir daí).
--
-- O que **não** muda: o cliente continua a ver promoções e testemunhos, dentro
-- das datas e da província; o visitante sem sessão continua a ver o mesmo; a
-- gestão continua a ser a única que publica (`content_items_write`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. QUE TIPOS SÃO INTERNOS
-- -----------------------------------------------------------------------------

/**
 * Um tipo de conteúdo que só a equipa INUKA vê.
 *
 * `IMMUTABLE` de propósito: depende só do argumento, e assim pode entrar numa
 * política sem ser reavaliada por linha.
 */
CREATE OR REPLACE FUNCTION public.kind_so_equipa(p_kind text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_kind IN ('comunicado', 'formacao');
$$;

/**
 * Posso ver este tipo de conteúdo?
 *
 * Equipa = colaborador, vendedor de loja e gestão (`is_staff()`). Um cliente
 * autenticado e um visitante ficam com promoções e testemunhos.
 */
CREATE OR REPLACE FUNCTION public.pode_ver_kind(p_kind text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT NOT public.kind_so_equipa(p_kind) OR public.is_staff();
$$;

GRANT EXECUTE ON FUNCTION public.kind_so_equipa(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.pode_ver_kind(text)   TO authenticated, anon;

-- -----------------------------------------------------------------------------
-- 2. VISIBILIDADE DE UM CONTEÚDO
-- -----------------------------------------------------------------------------
-- Mesma forma da 0013; a lista de tipos passa a vir de `pode_ver_kind`. A
-- cláusula `auth.uid() IS NOT NULL` mantém-se: sem sessão só se vê o que está
-- publicado, é testemunho ou promoção, e a promoção tem de estar a decorrer.
CREATE OR REPLACE FUNCTION public.pode_ver_conteudo(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.content_items c
    WHERE c.id = p_id
      AND (
        public.is_manager()
        OR (
          c.status = 'publicado'
          AND public.can_see_province(c.provincia_id)
          AND public.pode_ver_kind(c.kind)
          AND (
            auth.uid() IS NOT NULL
            OR (
              c.kind IN ('testemunho', 'promocao')
              AND (
                c.kind <> 'promocao'
                OR (
                  (c.starts_at IS NULL OR c.starts_at <= now())
                  AND (c.ends_at IS NULL OR c.ends_at >= now())
                )
              )
            )
          )
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.pode_ver_conteudo(uuid) TO authenticated, anon;

-- A política tinha a mesma lista de tipos escrita à mão. Agora chama a função.
DROP POLICY IF EXISTS content_items_read ON public.content_items;
CREATE POLICY content_items_read ON public.content_items
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR (
      status = 'publicado'
      AND public.can_see_province(provincia_id)
      AND public.pode_ver_kind(kind)
    )
  );

-- -----------------------------------------------------------------------------
-- 3. FEED
-- -----------------------------------------------------------------------------
-- O corpo é o da 0013; a única diferença é a linha dos tipos, que passa a ser
-- `public.pode_ver_kind(c.kind)`. Um cliente que peça `p_kind = 'comunicado'`
-- recebe uma lista vazia, não um erro.
CREATE OR REPLACE FUNCTION public.conteudo_feed(
  p_kind  text DEFAULT NULL,
  p_limit int  DEFAULT 40
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(item ORDER BY fixado DESC, publicado DESC NULLS LAST), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT
      jsonb_build_object(
        'id',              c.id,
        'kind',            c.kind,
        'title',           c.title,
        'subtitle',        c.subtitle,
        'body',            c.body,
        'image_url',       c.image_url,
        'status',          c.status,
        'is_pinned',       c.is_pinned,
        'allow_reactions', c.allow_reactions,
        'allow_comments',  c.allow_comments,
        'author_name',     c.author_name,
        'author_photo',    c.author_photo,
        'starts_at',       c.starts_at,
        'ends_at',         c.ends_at,
        'published_at',    c.published_at,
        'cta_label',       c.cta_label,
        'cta_href',        c.cta_href,
        'metadata',        c.metadata,
        'provincia_id',    c.provincia_id,
        'provincia_nome',  pr.nome,
        'project_id',      c.project_id,
        'reacoes',         (SELECT count(*) FROM public.content_reactions r WHERE r.item_id = c.id),
        'comentarios',     (SELECT count(*) FROM public.content_comments m
                             WHERE m.item_id = c.id AND NOT m.is_hidden),
        'minha_reacao',    (SELECT r.reaction FROM public.content_reactions r
                             WHERE r.item_id = c.id AND r.user_id = auth.uid()),
        'produtos',        (
          SELECT coalesce(jsonb_agg(produto ORDER BY ordem), '[]'::jsonb)
          FROM (
            SELECT cp.sort_order AS ordem,
                   jsonb_build_object(
                     'id',    p.id,
                     'name',  p.name,
                     'sku',   p.sku,
                     'preco', coalesce(p.promotional_price, p.official_price),
                     'oficial', p.official_price,
                     'imagem', (
                       SELECT pi.url FROM public.product_images pi
                       WHERE pi.product_id = p.id
                       ORDER BY pi.is_primary DESC, pi.sort_order
                       LIMIT 1
                     )
                   ) AS produto
            FROM public.content_products cp
            JOIN public.products p ON p.id = cp.product_id
            WHERE cp.item_id = c.id
          ) t
        )
      ) AS item,
      c.is_pinned  AS fixado,
      c.published_at AS publicado
    FROM public.content_items c
    LEFT JOIN public.provincias pr ON pr.id = c.provincia_id
    WHERE (p_kind IS NULL OR c.kind = p_kind)
      AND (
        public.is_manager()
        OR (
          c.status = 'publicado'
          AND public.can_see_province(c.provincia_id)
          AND public.pode_ver_kind(c.kind)
          AND (
            auth.uid() IS NOT NULL
            OR (
              c.kind IN ('testemunho', 'promocao')
              AND (
                c.kind <> 'promocao'
                OR (
                  (c.starts_at IS NULL OR c.starts_at <= now())
                  AND (c.ends_at IS NULL OR c.ends_at >= now())
                )
              )
            )
          )
        )
      )
    ORDER BY c.is_pinned DESC, c.published_at DESC NULLS LAST, c.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 40), 100))
  ) lista;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.conteudo_feed(text, int) TO authenticated, anon;

-- -----------------------------------------------------------------------------
-- 4. QUEM REAGIU (GESTÃO)
-- -----------------------------------------------------------------------------
-- A contagem já saía em `conteudo_feed.reacoes`; o que faltava era o nome de
-- quem reagiu. O `user_id` de `content_reactions` aponta para `auth.users` —
-- daí a função e não um embed.
--
-- A resposta traz os totais por tipo de reacção e por papel (cliente/equipa),
-- e a lista ordenada do mais recente para o mais antigo. O telefone e a
-- referência só saem para a gestão: é o que permite reconhecer o cliente sem
-- abrir outra página.
CREATE OR REPLACE FUNCTION public.conteudo_reacoes(p_item_id uuid)
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
    RAISE EXCEPTION 'Só a gestão vê quem reagiu a cada publicação.'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total',    count(*),
    'gosto',    count(*) FILTER (WHERE r.reaction = 'gosto'),
    'adoro',    count(*) FILTER (WHERE r.reaction = 'adoro'),
    'util',     count(*) FILTER (WHERE r.reaction = 'util'),
    'clientes', count(*) FILTER (WHERE coalesce(p.role::text, 'customer') = 'customer'),
    'equipa',   count(*) FILTER (WHERE p.role::text IN ('seller', 'store_seller', 'manager')),
    'gente',    coalesce(
                  jsonb_agg(
                    jsonb_build_object(
                      'user_id',    r.user_id,
                      'nome',       coalesce(nullif(p.full_name, ''), 'Cliente'),
                      'telefone',   p.phone,
                      'referencia', p.referencia,
                      'papel',      coalesce(p.role::text, 'customer'),
                      'provincia',  pr.nome,
                      'reacao',     r.reaction,
                      'quando',     r.created_at
                    ) ORDER BY r.created_at DESC
                  ) FILTER (WHERE r.id IS NOT NULL),
                  '[]'::jsonb
                )
  )
  INTO v_out
  FROM public.content_reactions r
  LEFT JOIN public.profiles   p  ON p.id  = r.user_id
  LEFT JOIN public.provincias pr ON pr.id = p.provincia_id
  WHERE r.item_id = p_item_id;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.conteudo_reacoes(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. VERIFICAÇÃO
-- -----------------------------------------------------------------------------
-- Um comunicado publicado não é visível a um cliente, mas é visível a um
-- colaborador. Como `pode_ver_kind` depende de quem chama, isto verifica-se com
-- a sessão de cada um (nos testes de `tests/functional.test.mjs`), não aqui.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'pode_ver_kind'
  ) THEN
    RAISE EXCEPTION '0019: pode_ver_kind() não foi criada.';
  END IF;
END;
$$;
