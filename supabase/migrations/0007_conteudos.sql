-- =============================================================================
-- INUKA ANGOLA — MIGRAÇÃO 7 : CONTEÚDOS PUBLICADOS E FORMAÇÃO
--
-- O estúdio de design deixa de ser um editor isolado e passa a ter um destino.
-- Esta migração cria o registo central de conteúdos (`content_items`) que liga
-- um projeto do designer a uma área do sistema:
--
--   comunicado  -> feed dos colaboradores        (/vendedor/comunicados)
--   testemunho  -> área dos clientes             (/cliente/testemunhos)
--   promocao    -> loja                          (/promocoes)
--   formacao    -> capa de um curso              (/vendedor/formacao)
--
-- Decisões:
--   * Um único registo para os quatro tipos. As diferenças (datas, produtos,
--     autor do testemunho) são colunas opcionais, não tabelas separadas: o
--     gestor publica sempre a partir do mesmo diálogo e a listagem de gestão
--     é uma só consulta. Tabelas por tipo obrigariam a quatro cópias de tudo.
--   * `project_id` é ÚNICO. É isto que impede a duplicação de publicações
--     quando o gestor volta a publicar o mesmo projeto: o segundo publish
--     atualiza o registo existente em vez de criar outro.
--   * A escrita é toda do gestor (política RLS). Não há RPC de publicação
--     porque o registo é um documento simples — a validação vive em triggers
--     (título, datas, published_at), que se aplicam também a quem escrever
--     por outra via.
--   * A leitura de `content_items` para `anon` só devolve testemunhos e
--     promoções nacionais e publicados. Um rascunho ou um comunicado interno
--     nunca sai da base por esta porta.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CONTEÚDOS
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL
                  CHECK (kind IN ('comunicado', 'testemunho', 'promocao', 'formacao')),
  title           text NOT NULL,
  subtitle        text,
  body            text,
  -- Projeto do designer que originou o conteúdo. Único: um projeto, uma
  -- publicação. Republicar atualiza esta linha.
  project_id      uuid REFERENCES public.design_projects(id) ON DELETE SET NULL,
  image_url       text,
  image_path      text,
  status          text NOT NULL DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho', 'em_edicao', 'publicado', 'agendado', 'suspenso', 'arquivado')),
  provincia_id    uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  -- Comunicado importante: fica no topo do feed.
  is_pinned       boolean NOT NULL DEFAULT false,
  allow_reactions boolean NOT NULL DEFAULT true,
  allow_comments  boolean NOT NULL DEFAULT true,
  -- Identificação autorizada do cliente (testemunho).
  author_name     text,
  author_photo    text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  cta_label       text,
  cta_href        text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order      int NOT NULL DEFAULT 0,
  created_by      uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_items_title_not_empty CHECK (length(btrim(title)) > 0),
  CONSTRAINT content_items_datas CHECK (
    ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at
  ),
  CONSTRAINT content_items_metadata_obj CHECK (jsonb_typeof(metadata) = 'object')
);

-- Um projeto do designer só pode estar publicado num sítio.
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_items_project
  ON public.content_items (project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_content_items_feed
  ON public.content_items (kind, status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_items_provincia
  ON public.content_items (provincia_id);

CREATE INDEX IF NOT EXISTS idx_content_items_gestao
  ON public.content_items (status, updated_at DESC);

-- Produtos anunciados numa promoção (ou associados a um conteúdo).
CREATE TABLE IF NOT EXISTS public.content_products (
  item_id    uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_content_products_item
  ON public.content_products (item_id, sort_order);

-- Reações: uma por utilizador e conteúdo.
CREATE TABLE IF NOT EXISTS public.content_reactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  reaction   text NOT NULL DEFAULT 'gosto' CHECK (reaction IN ('gosto', 'adoro', 'util')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_content_reactions_item
  ON public.content_reactions (item_id);

CREATE TABLE IF NOT EXISTS public.content_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  body       text NOT NULL,
  is_hidden  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_comments_body_not_empty CHECK (length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_content_comments_item
  ON public.content_comments (item_id, created_at);

-- -----------------------------------------------------------------------------
-- 2. FORMAÇÃO
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.training_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  slug        text NOT NULL UNIQUE,
  description text,
  icon        text,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.training_courses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid REFERENCES public.training_categories(id) ON DELETE SET NULL,
  title        text NOT NULL,
  description  text,
  cover_url    text,
  level        text NOT NULL DEFAULT 'iniciacao'
               CHECK (level IN ('iniciacao', 'intermedio', 'avancado')),
  status       text NOT NULL DEFAULT 'rascunho'
               CHECK (status IN ('rascunho', 'publicado', 'suspenso', 'arquivado')),
  provincia_id uuid REFERENCES public.provincias(id) ON DELETE SET NULL,
  duration_min int NOT NULL DEFAULT 0 CHECK (duration_min >= 0),
  sort_order   int NOT NULL DEFAULT 0,
  -- Capa produzida no estúdio: permite abrir o curso de volta no editor.
  project_id   uuid REFERENCES public.design_projects(id) ON DELETE SET NULL,
  -- Registo de conteúdo correspondente. Existe para o curso poder ter
  -- reações e comentários sem uma segunda tabela de comentários.
  content_id   uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  created_by   uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_courses_title_not_empty CHECK (length(btrim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_training_courses_status
  ON public.training_courses (status, sort_order, title);

CREATE TABLE IF NOT EXISTS public.training_lessons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  title        text NOT NULL,
  summary      text,
  body         text,
  kind         text NOT NULL DEFAULT 'texto'
               CHECK (kind IN ('texto', 'video', 'pdf', 'link', 'quiz')),
  video_url    text,
  file_path    text,
  file_name    text,
  duration_min int NOT NULL DEFAULT 0 CHECK (duration_min >= 0),
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_lessons_title_not_empty CHECK (length(btrim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_training_lessons_course
  ON public.training_lessons (course_id, sort_order);

CREATE TABLE IF NOT EXISTS public.training_enrollments (
  course_id    uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (course_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.training_progress (
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id    uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  lesson_id    uuid NOT NULL REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_training_progress_curso
  ON public.training_progress (course_id, user_id);

CREATE TABLE IF NOT EXISTS public.training_bookmarks (
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id  uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);

-- -----------------------------------------------------------------------------
-- 3. TRIGGERS
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_content_items_updated_at ON public.content_items;
CREATE TRIGGER trg_content_items_updated_at
  BEFORE UPDATE ON public.content_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_training_courses_updated_at ON public.training_courses;
CREATE TRIGGER trg_training_courses_updated_at
  BEFORE UPDATE ON public.training_courses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_training_lessons_updated_at ON public.training_lessons;
CREATE TRIGGER trg_training_lessons_updated_at
  BEFORE UPDATE ON public.training_lessons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- `published_at` é carimbado pelo servidor, não pelo cliente. Assim uma
-- alteração de estado feita por qualquer via fica com a data certa.
CREATE OR REPLACE FUNCTION public.content_items_antes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- `OLD` não existe num INSERT: separar os ramos evita o erro em vez de
  -- depender do curto-circuito do `OR`.
  IF NEW.status = 'publicado' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.published_at := COALESCE(NEW.published_at, now());
    ELSIF OLD.status IS DISTINCT FROM 'publicado' THEN
      NEW.published_at := COALESCE(NEW.published_at, now());
    END IF;
  END IF;

  -- Uma promoção sem início começa agora; sem isto a loja não a mostra.
  IF NEW.kind = 'promocao' AND NEW.starts_at IS NULL THEN
    NEW.starts_at := COALESCE(NEW.published_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_content_items_antes ON public.content_items;
CREATE TRIGGER trg_content_items_antes
  BEFORE INSERT OR UPDATE ON public.content_items
  FOR EACH ROW EXECUTE FUNCTION public.content_items_antes();

CREATE OR REPLACE FUNCTION public.training_courses_antes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_content uuid;
BEGIN
  IF NEW.status = 'publicado' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.published_at := COALESCE(NEW.published_at, now());
    ELSIF OLD.status IS DISTINCT FROM 'publicado' THEN
      NEW.published_at := COALESCE(NEW.published_at, now());
    END IF;
  END IF;

  -- Cada curso ganha um registo de conteúdo, criado aqui e não na aplicação:
  -- assim os comentários funcionam mesmo para um curso criado por SQL.
  -- Sem `project_id`: esse índice é único (um projeto, uma publicação) e o
  -- cartaz do curso pode já estar publicado como conteúdo próprio.
  IF TG_OP = 'INSERT' AND NEW.content_id IS NULL THEN
    INSERT INTO public.content_items (
      kind, title, subtitle, body, image_url, status, provincia_id,
      allow_reactions, allow_comments
    )
    VALUES (
      'formacao', NEW.title, NULL, NEW.description, NEW.cover_url, NEW.status,
      NEW.provincia_id, true, true
    )
    RETURNING id INTO v_content;

    NEW.content_id := v_content;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_courses_antes ON public.training_courses;
CREATE TRIGGER trg_training_courses_antes
  BEFORE INSERT OR UPDATE ON public.training_courses
  FOR EACH ROW EXECUTE FUNCTION public.training_courses_antes();

-- Manter o registo de conteúdo alinhado com o curso (título, capa, estado).
CREATE OR REPLACE FUNCTION public.training_courses_sincronizar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.content_id IS NOT NULL THEN
    UPDATE public.content_items
       SET title        = NEW.title,
           body         = NEW.description,
           image_url    = COALESCE(NEW.cover_url, image_url),
           status       = NEW.status,
           provincia_id = NEW.provincia_id
     WHERE id = NEW.content_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_courses_sincronizar ON public.training_courses;
CREATE TRIGGER trg_training_courses_sincronizar
  AFTER UPDATE ON public.training_courses
  FOR EACH ROW EXECUTE FUNCTION public.training_courses_sincronizar();

-- -----------------------------------------------------------------------------
-- 4. VISIBILIDADE (funções de apoio ao RLS)
-- -----------------------------------------------------------------------------

-- Posso ver este conteúdo?
--   * gestor: tudo
--   * publicado + província que me é visível
--   * anónimo: só publicados, nacionais, e apenas testemunhos/promoções
--   * promoções: só dentro das datas
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
          -- Comunicados e material de formação são internos: um cliente não
          -- os vê, mesmo que peça o id diretamente.
          AND (c.kind IN ('testemunho', 'promocao') OR public.is_seller())
          AND (
            auth.uid() IS NOT NULL
            OR (
              c.kind IN ('testemunho', 'promocao')
              -- Visitante sem sessão só vê promoções dentro das datas. Quem
              -- tem sessão vê também as terminadas, marcadas como tal.
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

-- Posso ver este curso? A formação é interna: clientes não entram.
CREATE OR REPLACE FUNCTION public.pode_ver_formacao(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.training_courses c
    WHERE c.id = p_id
      AND (
        public.is_manager()
        OR (
          c.status = 'publicado'
          AND (public.is_seller() OR public.is_manager())
          AND public.can_see_province(c.provincia_id)
        )
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.content_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_reactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_comments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_courses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_lessons    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_progress   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_bookmarks  ENABLE ROW LEVEL SECURITY;

-- 5.1 Conteúdos ---------------------------------------------------------------
DROP POLICY IF EXISTS content_items_read ON public.content_items;
CREATE POLICY content_items_read ON public.content_items
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR (
      status = 'publicado'
      AND public.can_see_province(provincia_id)
      AND (kind IN ('testemunho', 'promocao') OR public.is_seller())
    )
  );

DROP POLICY IF EXISTS content_items_read_anon ON public.content_items;
CREATE POLICY content_items_read_anon ON public.content_items
  FOR SELECT TO anon
  USING (
    status = 'publicado'
    AND kind IN ('testemunho', 'promocao')
    AND provincia_id IS NULL
    AND (
      kind <> 'promocao'
      OR (
        (starts_at IS NULL OR starts_at <= now())
        AND (ends_at IS NULL OR ends_at >= now())
      )
    )
  );

DROP POLICY IF EXISTS content_items_write ON public.content_items;
CREATE POLICY content_items_write ON public.content_items
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- 5.2 Produtos anunciados -----------------------------------------------------
DROP POLICY IF EXISTS content_products_read ON public.content_products;
CREATE POLICY content_products_read ON public.content_products
  FOR SELECT TO authenticated
  USING (public.pode_ver_conteudo(item_id));

DROP POLICY IF EXISTS content_products_read_anon ON public.content_products;
CREATE POLICY content_products_read_anon ON public.content_products
  FOR SELECT TO anon
  USING (public.pode_ver_conteudo(item_id));

DROP POLICY IF EXISTS content_products_write ON public.content_products;
CREATE POLICY content_products_write ON public.content_products
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- 5.3 Reações ----------------------------------------------------------------
-- Ler as reações de um conteúdo visível é necessário para mostrar a contagem
-- e para saber se já reagi. Não se lê reações de conteúdos que não posso ver.
DROP POLICY IF EXISTS content_reactions_read ON public.content_reactions;
CREATE POLICY content_reactions_read ON public.content_reactions
  FOR SELECT TO authenticated
  USING (public.pode_ver_conteudo(item_id));

DROP POLICY IF EXISTS content_reactions_insert ON public.content_reactions;
CREATE POLICY content_reactions_insert ON public.content_reactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.pode_ver_conteudo(item_id));

DROP POLICY IF EXISTS content_reactions_update ON public.content_reactions;
CREATE POLICY content_reactions_update ON public.content_reactions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS content_reactions_delete ON public.content_reactions;
CREATE POLICY content_reactions_delete ON public.content_reactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_manager());

-- 5.4 Comentários ------------------------------------------------------------
DROP POLICY IF EXISTS content_comments_read ON public.content_comments;
CREATE POLICY content_comments_read ON public.content_comments
  FOR SELECT TO authenticated
  USING (public.is_manager() OR (NOT is_hidden AND public.pode_ver_conteudo(item_id)));

DROP POLICY IF EXISTS content_comments_insert ON public.content_comments;
CREATE POLICY content_comments_insert ON public.content_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.content_items c
      WHERE c.id = item_id
        AND c.allow_comments
        AND (public.is_manager() OR c.status = 'publicado')
    )
    AND public.pode_ver_conteudo(item_id)
  );

DROP POLICY IF EXISTS content_comments_update ON public.content_comments;
CREATE POLICY content_comments_update ON public.content_comments
  FOR UPDATE TO authenticated
  USING (public.is_manager() OR user_id = auth.uid())
  WITH CHECK (public.is_manager() OR user_id = auth.uid());

DROP POLICY IF EXISTS content_comments_delete ON public.content_comments;
CREATE POLICY content_comments_delete ON public.content_comments
  FOR DELETE TO authenticated
  USING (public.is_manager() OR user_id = auth.uid());

-- 5.5 Formação ---------------------------------------------------------------
DROP POLICY IF EXISTS training_categories_read ON public.training_categories;
CREATE POLICY training_categories_read ON public.training_categories
  FOR SELECT TO authenticated
  USING (is_active OR public.is_manager());

DROP POLICY IF EXISTS training_categories_write ON public.training_categories;
CREATE POLICY training_categories_write ON public.training_categories
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS training_courses_read ON public.training_courses;
CREATE POLICY training_courses_read ON public.training_courses
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR (
      status = 'publicado'
      AND (public.is_seller() OR public.is_manager())
      AND public.can_see_province(provincia_id)
    )
  );

DROP POLICY IF EXISTS training_courses_write ON public.training_courses;
CREATE POLICY training_courses_write ON public.training_courses
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

DROP POLICY IF EXISTS training_lessons_read ON public.training_lessons;
CREATE POLICY training_lessons_read ON public.training_lessons
  FOR SELECT TO authenticated
  USING (public.pode_ver_formacao(course_id));

DROP POLICY IF EXISTS training_lessons_write ON public.training_lessons;
CREATE POLICY training_lessons_write ON public.training_lessons
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- 5.6 Progresso: cada colaborador só vê e escreve o seu -----------------------
DROP POLICY IF EXISTS training_enrollments_rw ON public.training_enrollments;
CREATE POLICY training_enrollments_rw ON public.training_enrollments
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_manager())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS training_progress_rw ON public.training_progress;
CREATE POLICY training_progress_rw ON public.training_progress
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_manager())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS training_bookmarks_rw ON public.training_bookmarks;
CREATE POLICY training_bookmarks_rw ON public.training_bookmarks
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 6. LÓGICA DE NEGÓCIO
-- -----------------------------------------------------------------------------

-- 6.1 Duplicar um conteúdo (o gestor cria variações sem perder o original).
CREATE OR REPLACE FUNCTION public.content_duplicate(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_src public.content_items;
  v_new uuid;
BEGIN
  IF NOT COALESCE(public.is_manager(), false) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO';
  END IF;

  SELECT * INTO v_src FROM public.content_items WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  INSERT INTO public.content_items (
    kind, title, subtitle, body, image_url, image_path, status, provincia_id,
    is_pinned, allow_reactions, allow_comments, author_name, author_photo,
    starts_at, ends_at, cta_label, cta_href, metadata, sort_order
  )
  VALUES (
    v_src.kind,
    left(v_src.title || ' (cópia)', 160),
    v_src.subtitle, v_src.body, v_src.image_url, v_src.image_path,
    'rascunho',                       -- a cópia nunca nasce publicada
    v_src.provincia_id, false, v_src.allow_reactions, v_src.allow_comments,
    v_src.author_name, v_src.author_photo,
    v_src.starts_at, v_src.ends_at, v_src.cta_label, v_src.cta_href,
    v_src.metadata, v_src.sort_order
  )
  RETURNING id INTO v_new;

  INSERT INTO public.content_products (item_id, product_id, sort_order)
  SELECT v_new, product_id, sort_order
  FROM public.content_products WHERE item_id = p_id;

  RETURN v_new;
END;
$$;

-- 6.2 Feed: uma chamada devolve tudo o que um cartão precisa.
--     Evita quatro consultas por cartão (reações, comentários, produtos,
--     província) que é o que aconteceria com embeds do PostgREST.
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
          -- Comunicados e material de formação são internos: um cliente não
          -- os vê, mesmo que peça o id diretamente.
          AND (c.kind IN ('testemunho', 'promocao') OR public.is_seller())
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

-- 6.3 Cursos com progresso do utilizador atual.
CREATE OR REPLACE FUNCTION public.formacao_cursos(
  p_categoria uuid DEFAULT NULL,
  p_limit     int  DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(curso ORDER BY ordem, titulo), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT
      jsonb_build_object(
        'id',           c.id,
        'title',        c.title,
        'description',  c.description,
        'cover_url',    c.cover_url,
        'level',        c.level,
        'status',       c.status,
        'duration_min', c.duration_min,
        'category_id',  c.category_id,
        'categoria',    tc.name,
        'categoria_slug', tc.slug,
        'provincia_nome', pr.nome,
        'aulas',        (SELECT count(*) FROM public.training_lessons l WHERE l.course_id = c.id),
        'concluidas',   (SELECT count(*) FROM public.training_progress p
                          WHERE p.course_id = c.id AND p.user_id = v_uid),
        'inscrito',     EXISTS (SELECT 1 FROM public.training_enrollments e
                                 WHERE e.course_id = c.id AND e.user_id = v_uid),
        'guardado',     EXISTS (SELECT 1 FROM public.training_bookmarks b
                                 WHERE b.course_id = c.id AND b.user_id = v_uid),
        'publicado',    c.published_at
      ) AS curso,
      tc.sort_order AS ordem,
      c.title       AS titulo
    FROM public.training_courses c
    LEFT JOIN public.training_categories tc ON tc.id = c.category_id
    LEFT JOIN public.provincias pr ON pr.id = c.provincia_id
    WHERE (p_categoria IS NULL OR c.category_id = p_categoria)
      AND (
        public.is_manager()
        OR (
          c.status = 'publicado'
          AND public.can_see_province(c.provincia_id)
          AND public.is_seller()
        )
      )
    ORDER BY tc.sort_order NULLS LAST, c.sort_order, c.title
    LIMIT greatest(1, least(coalesce(p_limit, 60), 200))
  ) lista;

  RETURN v_out;
END;
$$;

-- 6.4 Um curso com aulas e o progresso de quem está a ver.
CREATE OR REPLACE FUNCTION public.formacao_curso(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_curso public.training_courses;
  v_total int;
  v_feitas int;
  v_out jsonb;
BEGIN
  IF NOT public.pode_ver_formacao(p_id) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO';
  END IF;

  SELECT * INTO v_curso FROM public.training_courses WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NAO_ENCONTRADO';
  END IF;

  SELECT count(*) INTO v_total FROM public.training_lessons WHERE course_id = p_id;
  SELECT count(*) INTO v_feitas FROM public.training_progress
   WHERE course_id = p_id AND user_id = v_uid;

  SELECT jsonb_build_object(
    'id',           v_curso.id,
    'title',        v_curso.title,
    'description',  v_curso.description,
    'cover_url',    v_curso.cover_url,
    'level',        v_curso.level,
    'status',       v_curso.status,
    'duration_min', v_curso.duration_min,
    'project_id',   v_curso.project_id,
    'categoria',    (SELECT tc.name FROM public.training_categories tc WHERE tc.id = v_curso.category_id),
    'aulas_total',  v_total,
    'aulas_feitas', v_feitas,
    'percentagem',  CASE WHEN v_total = 0 THEN 0
                         ELSE round((v_feitas::numeric / v_total) * 100) END,
    'inscrito',     EXISTS (SELECT 1 FROM public.training_enrollments e
                             WHERE e.course_id = p_id AND e.user_id = v_uid),
    'guardado',     EXISTS (SELECT 1 FROM public.training_bookmarks b
                             WHERE b.course_id = p_id AND b.user_id = v_uid),
    'content_id',   v_curso.content_id,
    'reacoes',      (SELECT count(*) FROM public.content_reactions r
                      WHERE r.item_id = v_curso.content_id),
    'comentarios',  (SELECT count(*) FROM public.content_comments m
                      WHERE m.item_id = v_curso.content_id AND NOT m.is_hidden),
    'minha_reacao', (SELECT r.reaction FROM public.content_reactions r
                      WHERE r.item_id = v_curso.content_id AND r.user_id = v_uid),
    'aulas', (
      SELECT coalesce(jsonb_agg(aula ORDER BY ordem), '[]'::jsonb)
      FROM (
        SELECT l.sort_order AS ordem,
               jsonb_build_object(
                 'id',           l.id,
                 'title',        l.title,
                 'summary',      l.summary,
                 'body',         l.body,
                 'kind',         l.kind,
                 'video_url',    l.video_url,
                 'file_path',    l.file_path,
                 'file_name',    l.file_name,
                 'duration_min', l.duration_min,
                 'concluida',    EXISTS (
                   SELECT 1 FROM public.training_progress p
                   WHERE p.lesson_id = l.id AND p.user_id = v_uid
                 )
               ) AS aula
        FROM public.training_lessons l
        WHERE l.course_id = p_id
      ) t
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

-- 6.5 Marcar/desmarcar uma aula como concluída.
--     Devolve o progresso do curso já recalculado, para a interface não ter de
--     voltar a perguntar. Marca a inscrição e, quando todas as aulas ficam
--     feitas, carimba a conclusão do curso.
CREATE OR REPLACE FUNCTION public.formacao_concluir_aula(
  p_lesson_id uuid,
  p_concluida boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_course uuid;
  v_total  int;
  v_feitas int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO';
  END IF;

  SELECT course_id INTO v_course FROM public.training_lessons WHERE id = p_lesson_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AULA_NAO_ENCONTRADA';
  END IF;

  IF NOT public.pode_ver_formacao(v_course) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO';
  END IF;

  IF p_concluida THEN
    INSERT INTO public.training_progress (user_id, course_id, lesson_id)
    VALUES (v_uid, v_course, p_lesson_id)
    ON CONFLICT (user_id, lesson_id) DO NOTHING;
  ELSE
    DELETE FROM public.training_progress
    WHERE user_id = v_uid AND lesson_id = p_lesson_id;
  END IF;

  INSERT INTO public.training_enrollments (course_id, user_id, last_seen_at)
  VALUES (v_course, v_uid, now())
  ON CONFLICT (course_id, user_id)
  DO UPDATE SET last_seen_at = now();

  SELECT count(*) INTO v_total FROM public.training_lessons WHERE course_id = v_course;
  SELECT count(*) INTO v_feitas FROM public.training_progress
   WHERE course_id = v_course AND user_id = v_uid;

  UPDATE public.training_enrollments
     SET completed_at = CASE WHEN v_total > 0 AND v_feitas >= v_total THEN now() ELSE NULL END
   WHERE course_id = v_course AND user_id = v_uid;

  RETURN jsonb_build_object(
    'concluidas',  v_feitas,
    'total',       v_total,
    'percentagem', CASE WHEN v_total = 0 THEN 0
                        ELSE round((v_feitas::numeric / v_total) * 100) END,
    'curso_concluido', v_total > 0 AND v_feitas >= v_total
  );
END;
$$;

-- 6.6 Estatísticas de participação, para o gestor.
CREATE OR REPLACE FUNCTION public.formacao_estatisticas(p_course_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT COALESCE(public.is_manager(), false) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO';
  END IF;

  SELECT coalesce(jsonb_agg(linha ORDER BY inscritos DESC, titulo), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT jsonb_build_object(
             'course_id', c.id,
             'titulo',    c.title,
             'status',    c.status,
             'aulas',     (SELECT count(*) FROM public.training_lessons l WHERE l.course_id = c.id),
             'inscritos', (SELECT count(*) FROM public.training_enrollments e WHERE e.course_id = c.id),
             'concluidos',(SELECT count(*) FROM public.training_enrollments e
                            WHERE e.course_id = c.id AND e.completed_at IS NOT NULL),
             'media_pct', (
               SELECT CASE WHEN count(*) = 0 THEN 0
                           ELSE round(avg(
                             CASE WHEN l.total = 0 THEN 0
                                  ELSE (SELECT count(*) FROM public.training_progress p
                                         WHERE p.course_id = c.id AND p.user_id = e.user_id)::numeric
                                       / l.total * 100
                             END))
                      END
               FROM public.training_enrollments e
               CROSS JOIN (SELECT count(*) AS total FROM public.training_lessons WHERE course_id = c.id) l
               WHERE e.course_id = c.id
             )
           ) AS linha,
           (SELECT count(*) FROM public.training_enrollments e WHERE e.course_id = c.id) AS inscritos,
           c.title AS titulo
    FROM public.training_courses c
    WHERE p_course_id IS NULL OR c.id = p_course_id
  ) t;

  RETURN v_out;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. STORAGE — bucket público para as imagens publicadas
--    Caminho: content-media/{kind}/{uuid}.{ext}
--    Público porque o site e a app mostram estas imagens a visitantes sem
--    sessão. A escrita continua restrita ao gestor.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    RAISE NOTICE 'Schema storage inexistente — políticas de Storage dos conteúdos ignoradas.';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public)
  VALUES ('content-media', 'content-media', true)
  ON CONFLICT (id) DO NOTHING;

  BEGIN
    DROP POLICY IF EXISTS "inuka_content_media_write"  ON storage.objects;
    DROP POLICY IF EXISTS "inuka_content_media_update" ON storage.objects;
    DROP POLICY IF EXISTS "inuka_content_media_delete" ON storage.objects;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Sem permissão para gerir políticas de storage.objects.';
  END;

  CREATE POLICY "inuka_content_media_write" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'content-media' AND public.is_manager());

  CREATE POLICY "inuka_content_media_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'content-media' AND public.is_manager())
    WITH CHECK (bucket_id = 'content-media' AND public.is_manager());

  CREATE POLICY "inuka_content_media_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'content-media' AND public.is_manager());
END $$;

-- -----------------------------------------------------------------------------
-- 8. PERMISSÕES
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_items     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_products  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_reactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_comments  TO authenticated;
GRANT SELECT ON public.content_items TO anon;
GRANT SELECT ON public.content_products TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_categories  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_courses     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_lessons     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_enrollments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_progress    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_bookmarks   TO authenticated;

GRANT EXECUTE ON FUNCTION public.content_duplicate(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.conteudo_feed(text, int)                TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.pode_ver_conteudo(uuid)                 TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.pode_ver_formacao(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.formacao_cursos(uuid, int)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.formacao_curso(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.formacao_concluir_aula(uuid, boolean)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.formacao_estatisticas(uuid)             TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. CATEGORIAS DE FORMAÇÃO (as nove áreas pedidas pela gestão)
-- -----------------------------------------------------------------------------
INSERT INTO public.training_categories (name, slug, description, icon, sort_order) VALUES
  ('Conhecimento da INUKA Angola', 'inuka', 'História, valores e identidade da marca.', 'sparkles', 1),
  ('Conhecimento dos Produtos', 'produtos', 'Linhas, benefícios e argumentos de venda.', 'package', 2),
  ('Técnicas de Vendas', 'vendas', 'Abordagem, demonstração e fecho.', 'trending-up', 3),
  ('Atendimento e Experiência do Cliente', 'atendimento', 'Receber bem e resolver bem.', 'heart', 4),
  ('Comunicação e Marketing', 'comunicacao', 'Como falar da marca e divulgar.', 'megaphone', 5),
  ('Fidelização de Clientes', 'fidelizacao', 'Relações que duram.', 'repeat', 6),
  ('Desenvolvimento Pessoal', 'desenvolvimento', 'Postura, disciplina e confiança.', 'user', 7),
  ('Liderança e Gestão de Equipas', 'lideranca', 'Gerir pessoas e resultados.', 'users', 8),
  ('Ética e Postura Profissional', 'etica', 'O que se espera de quem representa a INUKA.', 'shield', 9)
ON CONFLICT (slug) DO NOTHING;
